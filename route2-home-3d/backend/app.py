from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .capture import BrowserUploadCaptureSource, CaptureFile
from .processor import ProcessResult, build_processor
from .home_capture import router as home_capture_router

APP_ROOT = Path(__file__).resolve().parent
REPO_ROOT = APP_ROOT.parent
DATA_ROOT = APP_ROOT / ".data"
MAX_FILE_BYTES = int(os.getenv("ROUTE2_MAX_FILE_BYTES", str(50 * 1024 * 1024)))
MAX_TOTAL_BYTES = int(os.getenv("ROUTE2_MAX_TOTAL_BYTES", str(200 * 1024 * 1024)))
MAX_FILES = int(os.getenv("ROUTE2_MAX_FILES", "60"))
SUPPORTED_SUFFIXES = {
    ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif",
    ".mp4", ".webm", ".mov", ".m4v",
}
BATCH_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")

app = FastAPI(title="Route 2 Rescan Backend", version="0.1.0")
app.include_router(home_capture_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in os.getenv(
        "ROUTE2_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173",
    ).split(",") if origin.strip()],
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="route2-rescan")
_processor = build_processor(REPO_ROOT)
_capture_source = BrowserUploadCaptureSource()
_action_status: dict[str, str] = {}


def _read_json(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=503, detail=f"Home Twin 数据不可用: {exc}") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=503, detail="Home Twin 数据格式无效")
    return payload


def _integration_payload() -> dict[str, Any]:
    hazards = _read_json(REPO_ROOT / "web" / "public" / "data" / "hazards.json")
    plan = _read_json(REPO_ROOT / "web" / "public" / "data" / "family-action-plan.json")
    meta = hazards.get("meta", {})
    provenance = meta.get("provenance", "unknown") if isinstance(meta, dict) else "unknown"
    items = hazards.get("items", []) if isinstance(hazards.get("items"), list) else []
    actions = plan.get("actions", []) if isinstance(plan.get("actions"), list) else []
    normalized_actions = []
    for raw in actions:
        if not isinstance(raw, dict):
            continue
        closure = raw.get("closureRule")
        normalized_actions.append({
            **raw,
            "action": raw.get("description", "请家属核实并处理。"),
            "closureRule": closure.get("type", "risk-disappears-after-rescan") if isinstance(closure, dict) else str(closure or "risk-disappears-after-rescan"),
            "status": _action_status.get(str(raw.get("id", "")), str(raw.get("status", "open"))),
            "source": "route2-person-home-risk",
        })
    return {
        "schemaVersion": 1,
        "service": "route2-home-twin",
        "status": "ready",
        "dataMode": "demo" if provenance == "demo" else "real",
        "capturedAt": meta.get("capturedAt") if isinstance(meta, dict) else None,
        "items": items,
        "actions": normalized_actions,
    }


def _utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_batch_id(value: str) -> str:
    value = value.strip()
    if not BATCH_ID_RE.fullmatch(value):
        raise HTTPException(status_code=422, detail="batchId 格式无效")
    return value


def _parse_captured_at(value: str) -> str:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="capturedAt 必须是 ISO-8601 时间") from exc
    if parsed.tzinfo is None:
        raise HTTPException(status_code=422, detail="capturedAt 必须带时区")
    return value


def _validate_manifest(manifest_text: str, batch_id: str, captured_at: str, media_kind: str) -> list[dict[str, Any]]:
    try:
        manifest = json.loads(manifest_text)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="manifest 不是合法 JSON") from exc
    if not isinstance(manifest, dict):
        raise HTTPException(status_code=422, detail="manifest 必须是对象")
    if manifest.get("id") != batch_id or manifest.get("capturedAt") != captured_at or manifest.get("kind") != media_kind:
        raise HTTPException(status_code=422, detail="manifest 与表单字段不一致")
    files = manifest.get("files")
    if not isinstance(files, list) or not files:
        raise HTTPException(status_code=422, detail="manifest.files 不能为空")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=413, detail="文件数量超过限制")
    for entry in files:
        if not isinstance(entry, dict):
            raise HTTPException(status_code=422, detail="manifest.files 项格式无效")
        if not isinstance(entry.get("name"), str) or not entry["name"].strip():
            raise HTTPException(status_code=422, detail="manifest.files.name 无效")
        if not isinstance(entry.get("size"), int) or entry["size"] < 0:
            raise HTTPException(status_code=422, detail="manifest.files.size 无效")
        if not isinstance(entry.get("type"), str) or not entry["type"]:
            raise HTTPException(status_code=422, detail="manifest.files.type 无效")
    return files


async def _save_upload(upload: UploadFile, target: Path) -> int:
    suffix = Path(upload.filename or "").suffix.lower()
    if suffix not in SUPPORTED_SUFFIXES:
        raise HTTPException(status_code=415, detail="包含不支持的媒体格式")
    size = 0
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as handle:
        while True:
            chunk = await upload.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_FILE_BYTES:
                handle.close()
                target.unlink(missing_ok=True)
                raise HTTPException(status_code=413, detail="单个文件超过大小限制")
            handle.write(chunk)
    return size


def _sanitize_filename(name: str, index: int) -> str:
    raw = Path(name or f"capture-{index}").name
    stem = re.sub(r"[^A-Za-z0-9._-]", "_", raw)
    if not stem or stem in {".", ".."}:
        stem = f"capture-{index}"
    return stem[:180]


def _cleanup_job(job_dir: Path) -> None:
    if os.getenv("ROUTE2_KEEP_INPUT", "0") != "1":
        shutil.rmtree(job_dir, ignore_errors=True)


def _run_job(job_id: str, batch_payload: dict[str, Any]) -> None:
    job_dir = DATA_ROOT / "jobs" / job_id
    try:
        with _jobs_lock:
            _jobs[job_id]["status"] = "processing"
            _jobs[job_id]["startedAt"] = _utc_now()
        files = tuple(
            CaptureFile(
                path=Path(item["path"]),
                name=item["name"],
                media_type=item["media_type"],
                size_bytes=item["size_bytes"],
            )
            for item in batch_payload["files"]
        )
        batch = _capture_source.from_files(
            batch_id=batch_payload["batch_id"],
            captured_at=batch_payload["captured_at"],
            media_kind=batch_payload["media_kind"],
            files=files,
        )
        result: ProcessResult = _processor.process(batch, job_dir)
        update: dict[str, Any] = {
            "status": result.status,
            "message": result.message,
            "finishedAt": _utc_now(),
        }
        if result.latest_risk_ids is not None:
            update["latestRiskIds"] = result.latest_risk_ids
        if result.action_plan is not None:
            update["actionPlan"] = result.action_plan
        with _jobs_lock:
            _jobs[job_id].update(update)
    except Exception as exc:
        with _jobs_lock:
            _jobs[job_id].update({
                "status": "failed",
                "message": f"复扫任务异常: {exc}",
                "finishedAt": _utc_now(),
            })
    finally:
        _cleanup_job(job_dir)


@app.get("/api/route2/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "processor": os.getenv("ROUTE2_PROCESSOR_MODE", "queue"),
        "hardware": "adapter-ready",
        "homeCapture": "enabled" if os.getenv("ROUTE2_ENABLE_PIPELINE", "0") == "1" else "waiting-worker",
    }


@app.get("/api/route2/integration")
def integration() -> dict[str, Any]:
    """Route 1 stable boundary: connection state, item index and family actions."""
    return _integration_payload()


@app.get("/api/route2/items/find")
def find_item(q: str) -> dict[str, Any]:
    query = q.strip().lower()
    if not query:
        raise HTTPException(status_code=422, detail="q 不能为空")
    payload = _integration_payload()
    aliases = {"药": "medicine", "眼镜": "glasses", "老花镜": "glasses", "钥匙": "keys"}
    category = next((value for key, value in aliases.items() if key in query), "")
    for raw in payload["items"]:
        if not isinstance(raw, dict):
            continue
        haystack = f"{raw.get('id', '')} {raw.get('title', '')} {raw.get('location', '')}".lower()
        if query in haystack or (category and category == str(raw.get("id", "")).lower()):
            return {
                "status": "found",
                "dataMode": payload["dataMode"],
                "item": raw,
                "message": raw.get("say") or f"{raw.get('title', '物品')}在{raw.get('location', '尚未确认的位置')}。",
            }
    return {
        "status": "not_found",
        "dataMode": payload["dataMode"],
        "item": None,
        "message": "当前 Home Twin 里没有可靠的位置记录，请让家属确认后再更新。",
    }


@app.post("/api/route2/actions/{action_id}/status")
def update_action_status(action_id: str, status: str) -> dict[str, str]:
    if status not in {"open", "done"}:
        raise HTTPException(status_code=422, detail="status 仅允许 open 或 done；resolved 必须由复扫结果产生")
    known = {str(item.get("id")) for item in _integration_payload()["actions"] if isinstance(item, dict)}
    if action_id not in known:
        raise HTTPException(status_code=404, detail="家庭行动不存在")
    _action_status[action_id] = status
    return {"id": action_id, "status": status}


@app.post("/api/route2/rescan")
async def submit_rescan(
    batchId: str = Form(...),
    capturedAt: str = Form(...),
    mediaKind: str = Form(...),
    manifest: str = Form(...),
    files: list[UploadFile] = File(...),
) -> JSONResponse:
    batch_id = _safe_batch_id(batchId)
    captured_at = _parse_captured_at(capturedAt)
    if mediaKind not in {"image", "video"}:
        raise HTTPException(status_code=422, detail="mediaKind 必须为 image 或 video")
    manifest_files = _validate_manifest(manifest, batch_id, captured_at, mediaKind)
    if not files or len(files) > MAX_FILES:
        raise HTTPException(status_code=413, detail="文件数量不合法")
    if len(manifest_files) != len(files):
        raise HTTPException(status_code=422, detail="manifest.files 与实际上传文件数量不一致")
    if mediaKind == "video" and len(files) != 1:
        raise HTTPException(status_code=422, detail="当前真实 pipeline 的视频复扫一次只允许一个视频文件")

    job_id = f"rs-{uuid.uuid4().hex[:20]}"
    input_dir = DATA_ROOT / "jobs" / job_id / "input"
    input_dir.mkdir(parents=True, exist_ok=False)
    saved: list[dict[str, Any]] = []
    total = 0
    try:
        for index, upload in enumerate(files, start=1):
            manifest_entry = manifest_files[index - 1]
            original_name = Path(upload.filename or "").name
            if original_name != Path(str(manifest_entry["name"])).name:
                raise HTTPException(status_code=422, detail="manifest.files 与实际文件名不一致")
            filename = _sanitize_filename(original_name, index)
            target = input_dir / filename
            if target.exists():
                target = input_dir / f"{index}-{filename}"
            size = await _save_upload(upload, target)
            total += size
            if total > MAX_TOTAL_BYTES:
                raise HTTPException(status_code=413, detail="本批次文件总大小超过限制")
            media_type = upload.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
            if int(manifest_entry["size"]) != size:
                raise HTTPException(status_code=422, detail="manifest.files.size 与实际文件大小不一致")
            if str(manifest_entry["type"]) != media_type:
                raise HTTPException(status_code=422, detail="manifest.files.type 与实际文件类型不一致")
            if mediaKind == "image" and media_type.startswith("video/"):
                raise HTTPException(status_code=422, detail="mediaKind=image 不允许上传视频")
            if mediaKind == "video" and not media_type.startswith("video/"):
                raise HTTPException(status_code=422, detail="mediaKind=video 必须上传视频")
            saved.append({
                "path": str(target),
                "name": filename,
                "media_type": media_type,
                "size_bytes": size,
            })
    except Exception:
        shutil.rmtree(DATA_ROOT / "jobs" / job_id, ignore_errors=True)
        raise

    batch_payload = {
        "batch_id": batch_id,
        "captured_at": captured_at,
        "media_kind": mediaKind,
        "files": saved,
    }
    with _jobs_lock:
        _jobs[job_id] = {
            "jobId": job_id,
            "status": "queued",
            "batchId": batch_id,
            "createdAt": _utc_now(),
            "message": "复扫已进入本地队列。",
        }
    _executor.submit(_run_job, job_id, batch_payload)
    return JSONResponse(status_code=202, content={
        "status": "queued",
        "jobId": job_id,
        "message": "复扫已进入本地队列。",
    })


@app.get("/api/route2/rescan/{job_id}")
def get_rescan(job_id: str) -> dict[str, Any]:
    with _jobs_lock:
        job = _jobs.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="复扫任务不存在或已过期")
        return dict(job)
