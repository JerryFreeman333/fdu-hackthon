"""Local single-household capture workflow. Media and model manifests survive restarts."""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

router = APIRouter(prefix="/api/route2/homes")
ROOT = Path(__file__).resolve().parent.parent
DATA = Path(os.getenv("ROUTE2_HOME_DATA_ROOT", str(ROOT / "backend" / ".data" / "homes")))
pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="home-model")
lock = threading.RLock()
active: set[str] = set()
LIMIT = 200 * 1024 * 1024


def folder(home_id: str) -> Path:
    if not re.fullmatch(r"[a-f0-9]{32}", home_id):
        raise HTTPException(404, "家庭空间不存在")
    path = DATA / home_id
    if not (path / "state.json").is_file():
        raise HTTPException(404, "家庭空间不存在")
    return path


def read(home_id: str) -> dict:
    return json.loads((folder(home_id) / "state.json").read_text(encoding="utf-8"))


def write(path: Path, state: dict) -> None:
    tmp = path / "state.tmp"
    tmp.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path / "state.json")


def update(home_id: str, **changes) -> None:
    with lock:
        state = read(home_id)
        state.update(changes)
        write(folder(home_id), state)


def process(home_id: str) -> None:
    try:
        engine = Path(os.getenv("ROUTE2_PIPELINE_ROOT", str(ROOT))).resolve()
        state = read(home_id)
        scene = state["jobId"]
        scripts = engine / "pipeline" / "scripts"
        stages = [
            ("extracting", "正在从视频提取画面", "02_prepare_data.ps1", ["-Video", str(folder(home_id) / state["video"]), "-Fps", "2"]),
            ("reconstructing", "正在重建房间结构", "03_run_colmap.ps1", []),
            ("training", "正在生成可浏览的房间模型", "04_train_3dgs.ps1", ["-Iterations", os.getenv("ROUTE2_CAPTURE_ITERATIONS", "30000")]),
        ]
        for status, message, script, arguments in stages:
            update(home_id, status=status, message=message)
            with (folder(home_id) / "worker.log").open("a", encoding="utf-8") as log:
                result = subprocess.run(["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(scripts / script), "-Scene", scene, *arguments], cwd=engine, stdout=log, stderr=log, timeout=int(os.getenv("ROUTE2_PIPELINE_TIMEOUT_SECONDS", "7200")))
            if result.returncode:
                raise RuntimeError(f"{message}失败，请检查建模服务日志后重试。")
        candidates = list((engine / "pipeline" / "output" / scene / "point_cloud").glob("iteration_*/point_cloud.ply"))
        if not candidates:
            raise RuntimeError("训练未生成模型文件，请检查建模服务。")
        model = max(candidates, key=lambda p: int(p.parent.name.split("_")[-1]))
        if model.stat().st_size < 1000:
            raise RuntimeError("模型文件不完整，请重新处理。")
        # Publish a task-owned artifact instead of overwriting the global demo home.ply.
        import shutil
        published = folder(home_id) / (scene + ".ply")
        shutil.copyfile(model, published)
        update(home_id, status="ready", message="您的家庭空间已生成，可以打开查看。", model=published.name, modelUrl=f"/api/route2/homes/{home_id}/model.ply?v={scene}")
    except Exception as exc:
        update(home_id, status="failed", message=str(exc) if isinstance(exc, RuntimeError) else "建模服务中断或运行失败。素材已保留，可重新处理。")
    finally:
        with lock:
            active.discard(home_id)


def enqueue(home_id: str) -> None:
    with lock:
        if home_id in active:
            return
        if os.getenv("ROUTE2_ENABLE_PIPELINE", "0") != "1":
            update(home_id, status="waiting_worker", message="视频已保存，等待建模服务启用。可稍后点击重新处理。")
            return
        update(home_id, status="queued", message="正在排队等待建模")
        active.add(home_id)
        pool.submit(process, home_id)


@router.post("")
def create_home() -> dict:
    home_id = uuid.uuid4().hex
    path = DATA / home_id
    path.mkdir(parents=True)
    state = {"homeId": home_id, "status": "empty", "message": "请按照指引拍摄家庭空间。", "modelUrl": None}
    write(path, state)
    return state


@router.get("/{home_id}")
def get_home(home_id: str) -> dict:
    with lock:
        state = read(home_id)
        if state["status"] in {"uploading", "queued", "extracting", "reconstructing", "training"} and home_id not in active:
            update(home_id, status="failed", message="上次任务中断。已保存的视频可以重新处理；上传未完成时请重新上传。")
            state = read(home_id)
        return {k: v for k, v in state.items() if k not in {"model", "video"}}


@router.post("/{home_id}/capture", status_code=202)
async def capture(home_id: str, file: UploadFile = File(...)) -> dict:
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in {".mp4", ".webm", ".mov", ".m4v"} or not (file.content_type or "").startswith("video/"):
        raise HTTPException(415, "请选择 MP4、WebM 或 MOV 视频")
    with lock:
        folder(home_id)
        if home_id in active:
            raise HTTPException(409, "当前任务正在处理，请等待完成")
        active.add(home_id)
    job_id = "capture-" + uuid.uuid4().hex
    target = folder(home_id) / (job_id + suffix)
    size = 0
    try:
        with target.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > LIMIT:
                    raise HTTPException(413, "视频超过 200 MB，请缩短拍摄时间")
                out.write(chunk)
        if not size:
            raise HTTPException(422, "视频为空，请重新拍摄")
        update(home_id, video=target.name, jobId=job_id, status="queued", modelUrl=None, model=None)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        await file.close()
        with lock:
            active.discard(home_id)
    enqueue(home_id)
    return get_home(home_id)


@router.post("/{home_id}/retry", status_code=202)
def retry(home_id: str) -> dict:
    with lock:
        state = read(home_id)
        if home_id in active:
            raise HTTPException(409, "任务仍在进行")
        if not state.get("video") or not (folder(home_id) / state["video"]).is_file():
            raise HTTPException(409, "没有可处理的视频，请重新拍摄")
        if state["status"] == "ready":
            return get_home(home_id)
        # Each retry gets an isolated output directory; stale PLY cannot count as new success.
        update(home_id, jobId="capture-" + uuid.uuid4().hex)
        enqueue(home_id)
        return get_home(home_id)


@router.get("/{home_id}/model.ply")
def model(home_id: str):
    state = read(home_id)
    if state["status"] != "ready" or not state.get("model"):
        raise HTTPException(409, "模型尚未生成")
    path = (folder(home_id) / state["model"]).resolve()
    if not path.is_relative_to(folder(home_id).resolve()) or not path.is_file():
        raise HTTPException(404, "模型文件不存在")
    return FileResponse(path, media_type="application/octet-stream", filename="home.ply")
