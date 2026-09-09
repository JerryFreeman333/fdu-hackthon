from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse

from .capture import BrowserUploadCaptureSource, CaptureFile
from .processor import ProcessResult, build_processor

APP_ROOT = Path(__file__).resolve().parent
REPO_ROOT = APP_ROOT.parent
DATA_ROOT = APP_ROOT / ".data"
MAX_FILE_BYTES = int(os.getenv("ROUTE2_MAX_FILE_BYTES", str(50 * 1024 * 1024)))
MAX_TOTAL_BYTES = int(os.getenv("ROUTE2_MAX_TOTAL_BYTES", str(200 * 1024 * 1024)))
MAX_FILES = int(os.getenv("ROUTE2_MAX_FILES", "60"))
JOB_TTL_SECONDS = int(os.getenv("ROUTE2_JOB_TTL_SECONDS", "3600"))
SUPPORTED_SUFFIXES = {
    ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif",
    ".mp4", ".webm", ".mov", ".m4v",
}
BATCH_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$")

app = FastAPI(title="Route 2 Rescan Backend", version="0.1.0")
_jobs: dict[str, dict[str, Any]] = {}
_jobs_lock = threading.Lock()
_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="route2-rescan")
_processor = build_processor(REPO_ROOT)
_capture_source = BrowserUploadCaptureSource()


def _utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


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


def _validate_manifest(manifest_text: str, batch_id: str, captured_at: str, media_kind: str) -> dict[str, Any]:
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
    return manifest


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
        shutil.rmtree(job_dir / "input", ignore_errors=True)


def _run_job(job_id: str, batch_payload: dict[str, Any]) -> None:
    job_dir = DATA_ROOT / "jobs" / job_id
    input_dir = job_dir / "input"
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
    except Exception as exc:  # defensive boundary for async jobs
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
    }


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
    _validate_manifest(manifest, batch_id, captured_at, mediaKind)
    if not files or len(files) > MAX_FILES:
        raise HTTPException(status_code=413, detail="文件数量不合法")

    job_id = f"rs-{uuid.uuid4().hex[:20]}"
    input_dir = DATA_ROOT / "jobs" / job_id / "input"
    input_dir.mkdir(parents=True, exist_ok=False)
    saved: list[dict[str, Any]] = []
    total = 0
    try:
        for index, upload in enumerate(files, start=1):
            filename = _sanitize_filename(upload.filename or "", index)
            target = input_dir / filename
            if target.exists():
                target = input_dir / f"{index}-{filename}"
            size = await _save_upload(upload, target)
            total += size
            if total > MAX_TOTAL_BYTES:
                raise HTTPException(status_code=413, detail="本批次文件总大小超过限制")
            media_type = upload.content_type or mimetypes.guess_type(filename)[0] or "application/octet-stream"
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
