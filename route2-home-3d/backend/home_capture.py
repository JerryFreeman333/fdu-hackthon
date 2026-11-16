"""Local single-household capture workflow. Media and model manifests survive restarts."""
from __future__ import annotations

import json
import math
import os
import re
import shutil
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
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
CATEGORIES = {"bed", "door", "rug", "cable", "threshold", "toilet"}


def _on_windows() -> bool:
    return os.name == "nt"


def nvidia_command() -> str | None:
    command = shutil.which("nvidia-smi")
    if command:
        return command
    if _on_windows():
        candidate = Path(os.getenv("ProgramFiles", r"C:\Program Files")) / "NVIDIA Corporation" / "NVSMI" / "nvidia-smi.exe"
        if candidate.is_file():
            return str(candidate)
    return None


def semantic_availability() -> tuple[bool, str]:
    """Only claim vision semantics on a host that can actually run them."""
    if os.getenv("ROUTE2_ENABLE_PIPELINE", "0") != "1":
        return False, "尚未连接建模服务，暂不进行视觉语义识别。视频会保留，可稍后重新处理。"
    if not _on_windows():
        return False, "当前建模服务不在 Windows 上运行，未执行视觉语义识别；房间外观模型仍可查看。"
    command = nvidia_command()
    if not command:
        return False, "建模服务未检测到 NVIDIA 显卡，未执行视觉语义识别；房间外观模型仍可查看。"
    try:
        result = subprocess.run([command, "-L"], capture_output=True, text=True, timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        return False, "无法确认 NVIDIA 显卡状态，未执行视觉语义识别；房间外观模型仍可查看。"
    if result.returncode or not result.stdout.strip():
        return False, "NVIDIA 显卡不可用，未执行视觉语义识别；房间外观模型仍可查看。"
    return True, "房间模型生成后，会尝试识别门、地面障碍等物品位置；识别结果仍需人工确认。"


def semantic_state() -> dict:
    available, message = semantic_availability()
    return {
        "semanticReady": False,
        "semanticStatus": "pending" if available else "unavailable",
        "semanticMessage": message,
        "semanticUrl": None,
    }


def finite_number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value))


def validate_semantic(payload: object, home_id: str, captured_at: str) -> int:
    """Reject demo, guessed, unscaled or mismatched semantic artifacts."""
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1:
        raise ValueError("视觉识别结果版本不受支持，已拒绝导入。")
    localization = payload.get("localization")
    if not isinstance(localization, dict):
        raise ValueError("视觉识别结果缺少定位声明，已拒绝导入。")
    if localization.get("coordinateFrame") != "colmap-arbitrary" or localization.get("metricScaleAvailable") is not False:
        raise ValueError("视觉识别结果不是明确的非米制 COLMAP 坐标，已拒绝导入。")
    snapshot = payload.get("snapshot")
    if not isinstance(snapshot, dict):
        raise ValueError("视觉识别结果缺少 Home Twin，已拒绝导入。")
    if snapshot.get("homeId") != home_id or snapshot.get("capturedAt") != captured_at:
        raise ValueError("视觉识别结果与本次拍摄不匹配，已拒绝导入。")
    if snapshot.get("scaleConfidence") != 0.0:
        raise ValueError("视觉识别结果声称已有尺度标定，已拒绝导入。")
    objects = snapshot.get("objects")
    if not isinstance(objects, list):
        raise ValueError("视觉识别结果缺少物品列表，已拒绝导入。")
    seen: set[str] = set()
    for item in objects:
        if not isinstance(item, dict):
            raise ValueError("视觉识别结果包含格式错误的物品，已拒绝导入。")
        object_id = item.get("id")
        if not isinstance(object_id, str) or not object_id or object_id in seen:
            raise ValueError("视觉识别结果包含无效或重复的物品编号，已拒绝导入。")
        if item.get("source") != "vision" or item.get("category") not in CATEGORIES:
            raise ValueError("视觉识别结果包含非视觉来源或未知类别，已拒绝导入。")
        position = item.get("position")
        if not isinstance(position, dict) or not all(finite_number(position.get(axis)) for axis in ("x", "y", "z")):
            raise ValueError("视觉识别结果包含无效的 3D 坐标，已拒绝导入。")
        confidence = item.get("confidence")
        if not finite_number(confidence) or not 0.0 <= float(confidence) <= 1.0:
            raise ValueError("视觉识别结果包含无效的置信度，已拒绝导入。")
        evidence = item.get("evidence")
        images = evidence.get("imageIds") if isinstance(evidence, dict) else None
        if not isinstance(images, list) or not images or not all(isinstance(name, str) and name for name in images):
            raise ValueError("视觉识别结果缺少画面证据，已拒绝导入。")
        item_localization = item.get("localization")
        if not isinstance(item_localization, dict) or item_localization.get("coordinateFrame") != "colmap-arbitrary":
            raise ValueError("视觉识别结果缺少非米制 COLMAP 物品坐标声明，已拒绝导入。")
        support = item_localization.get("supportPointCount")
        if not isinstance(support, int) or isinstance(support, bool) or support < 1:
            raise ValueError("视觉识别结果缺少 COLMAP 轨迹支持，已拒绝导入。")
        seen.add(object_id)

    # 关系与路线是可选的（当前流水线输出空数组），但一旦提供就必须自洽：
    # 引用不存在的物品、自环、非法类别或 demo 来源，都会让下游路线规划
    # 在不存在的空间结构上"推导"出一条看似可靠的路线。
    relation_types = {"inside", "adjacent", "connects", "near", "blocks", "on-route"}
    relations = snapshot.get("relations", [])
    if relations is None:
        relations = []
    if not isinstance(relations, list):
        raise ValueError("视觉识别结果的空间关系不是列表，已拒绝导入。")
    for relation in relations:
        if not isinstance(relation, dict):
            raise ValueError("视觉识别结果包含格式错误的空间关系，已拒绝导入。")
        subject = relation.get("subjectId")
        obj = relation.get("objectId")
        if subject not in seen or obj not in seen:
            raise ValueError("空间关系引用了不存在的物品，已拒绝导入。")
        if subject == obj:
            raise ValueError("空间关系存在自引用，已拒绝导入。")
        if relation.get("relation") not in relation_types:
            raise ValueError("空间关系类型不受支持，已拒绝导入。")
        confidence = relation.get("confidence")
        if not finite_number(confidence) or not 0.0 <= float(confidence) <= 1.0:
            raise ValueError("空间关系缺少有效置信度，已拒绝导入。")
        if relation.get("source") not in {"vision", "manual", "inferred"}:
            raise ValueError("空间关系来源不是视觉/人工/推导，已拒绝导入。")

    routes = snapshot.get("routes", [])
    if routes is None:
        routes = []
    if not isinstance(routes, list):
        raise ValueError("视觉识别结果的路线不是列表，已拒绝导入。")
    route_statuses = {"verified", "candidate", "needs_confirmation", "unavailable"}
    for route in routes:
        if not isinstance(route, dict):
            raise ValueError("视觉识别结果包含格式错误的路线，已拒绝导入。")
        if route.get("startObjectId") not in seen or route.get("endObjectId") not in seen:
            raise ValueError("路线端点引用了不存在的物品，已拒绝导入。")
        object_ids = route.get("objectIds")
        if not isinstance(object_ids, list) or not object_ids or not all(isinstance(i, str) for i in object_ids):
            raise ValueError("路线缺少有效的物品序列，已拒绝导入。")
        if any(item not in seen for item in object_ids):
            raise ValueError("路线引用了不存在的物品，已拒绝导入。")
        confidence = route.get("confidence")
        if not finite_number(confidence) or not 0.0 <= float(confidence) <= 1.0:
            raise ValueError("路线缺少有效置信度，已拒绝导入。")
        if route.get("status") is not None and route.get("status") not in route_statuses:
            raise ValueError("路线状态不受支持，已拒绝导入。")
        # 演示来源不能进入真实家庭的语义产物：那等于把演示路线冒充成这家的路线。
        if route.get("source") == "demo":
            raise ValueError("路线来源不能是演示数据，已拒绝导入。")
    return len(objects)


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


def capture_timestamp() -> str:
    """Timestamp for the moment a video is accepted, stable across retries."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def run_semantics(home_id: str, scene: str, engine: Path) -> None:
    available, unavailable_message = semantic_availability()
    if not available:
        update(home_id, semantic=None, semanticReady=False, semanticStatus="unavailable", semanticMessage=unavailable_message, semanticUrl=None)
        return
    update(home_id, semanticReady=False, semanticStatus="processing", semanticMessage="房间外观已生成，正在识别物品与位置；识别失败不会影响查看模型。", semanticUrl=None)
    captured_at = read(home_id).get("capturedAt")
    if not isinstance(captured_at, str) or not captured_at:
        # Legacy task accepted before capture metadata existed: persist the
        # fallback so the semantic artifact and the task agree on one time.
        captured_at = capture_timestamp()
        update(home_id, capturedAt=captured_at)
    scripts = engine / "pipeline" / "scripts"
    try:
        with (folder(home_id) / "worker.log").open("a", encoding="utf-8") as log:
            result = subprocess.run(
                ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(scripts / "06_detect_semantics.ps1"), "-Scene", scene, "-CapturedAt", captured_at, "-HomeId", home_id],
                cwd=engine, stdout=log, stderr=log, timeout=int(os.getenv("ROUTE2_PIPELINE_TIMEOUT_SECONDS", "7200")),
            )
        if result.returncode:
            raise RuntimeError("视觉语义识别未完成，房间外观模型仍可查看。")
        source = engine / "pipeline" / "data" / scene / "semantic" / "hometwin-semantic.json"
        payload = json.loads(source.read_text(encoding="utf-8"))
        count = validate_semantic(payload, home_id, captured_at)
        published = folder(home_id) / (scene + "-semantic.json")
        temp = folder(home_id) / (scene + "-semantic.tmp")
        temp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        temp.replace(published)
        message = (
            f"视觉识别完成，已定位 {count} 个有画面和 3D 证据的物品；路线和风险结论仍需人工确认。"
            if count
            else "视觉识别已完成，但没有获得足够 3D 证据的物品；系统不会生成猜测坐标。"
        )
        update(home_id, semantic=published.name, semanticReady=True, semanticStatus="ready", semanticMessage=message, semanticUrl=f"/api/route2/homes/{home_id}/semantic.json?v={scene}")
    except Exception as exc:
        message = str(exc) if isinstance(exc, RuntimeError) else "视觉语义识别未完成，房间外观模型仍可查看；不会显示猜测的物品位置。"
        update(home_id, semantic=None, semanticReady=False, semanticStatus="failed", semanticMessage=message, semanticUrl=None)


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
        published = folder(home_id) / (scene + ".ply")
        shutil.copyfile(model, published)
        update(home_id, status="ready", message="您的家庭空间已生成，可以打开查看。", model=published.name, modelReady=True, modelUrl=f"/api/route2/homes/{home_id}/model.ply?v={scene}")
        # Semantic recognition is a separate, optional stage: its failure must
        # never take away the already published room appearance model.
        run_semantics(home_id, scene, engine)
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
    state = {"homeId": home_id, "status": "empty", "message": "请按照指引拍摄家庭空间。", "modelUrl": None, "modelReady": False, "capturedAt": None, **semantic_state()}
    write(path, state)
    return state


@router.get("/{home_id}")
def get_home(home_id: str) -> dict:
    with lock:
        state = read(home_id)
        if state["status"] in {"uploading", "queued", "extracting", "reconstructing", "training"} and home_id not in active:
            update(home_id, status="failed", message="上次任务中断。已保存的视频可以重新处理；上传未完成时请重新上传。")
            state = read(home_id)
        if state["status"] == "ready" and home_id not in active and state.get("semanticStatus") in {"pending", "processing"}:
            update(home_id, semanticReady=False, semanticStatus="failed", semanticMessage="视觉语义识别中断；房间外观模型仍可查看，不会显示猜测的物品位置。", semanticUrl=None)
            state = read(home_id)
        model_ready = state.get("modelReady")
        if model_ready is None:
            # States written before modelReady existed still have a published
            # artifact; trust the file on disk instead of hiding a valid model.
            model_ready = bool(state.get("model"))
        state["modelReady"] = bool(
            model_ready and state.get("status") == "ready" and state.get("model")
            and (folder(home_id) / state["model"]).is_file()
        )
        state["semanticReady"] = bool(
            state.get("semanticReady") and state.get("status") == "ready" and state.get("semantic")
            and (folder(home_id) / state["semantic"]).is_file()
        )
        if not state["modelReady"]:
            state["modelUrl"] = None
        if not state["semanticReady"]:
            state["semanticUrl"] = None
        state.setdefault("semanticStatus", "unavailable")
        state.setdefault("semanticMessage", "本次未能确认物品识别状态；不会显示猜测的物品位置。")
        return {k: v for k, v in state.items() if k not in {"model", "video", "semantic"}}


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
        update(home_id, video=target.name, jobId=job_id, capturedAt=capture_timestamp(), status="queued", modelUrl=None, model=None, modelReady=False, semantic=None, **semantic_state())
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
        if state["status"] == "ready" and state.get("model") and (folder(home_id) / state["model"]).is_file():
            return get_home(home_id)
        # A retry processes the same video, so it must keep the original
        # acceptance time instead of pretending the capture happened later.
        captured_at = state.get("capturedAt")
        if not isinstance(captured_at, str) or not captured_at:
            captured_at = capture_timestamp()
        # Each retry gets an isolated output directory; stale PLY/semantic output cannot count as new success.
        update(home_id, capturedAt=captured_at, jobId="capture-" + uuid.uuid4().hex, modelUrl=None, model=None, modelReady=False, semantic=None, **semantic_state())
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


@router.get("/{home_id}/semantic.json")
def semantic(home_id: str):
    state = read(home_id)
    if state.get("status") != "ready" or not state.get("semanticReady") or not state.get("semantic"):
        raise HTTPException(409, "视觉语义结果尚未生成")
    path = (folder(home_id) / state["semantic"]).resolve()
    if not path.is_relative_to(folder(home_id).resolve()) or not path.is_file():
        raise HTTPException(404, "视觉语义结果不存在")
    return FileResponse(path, media_type="application/json", filename="hometwin-semantic.json")
