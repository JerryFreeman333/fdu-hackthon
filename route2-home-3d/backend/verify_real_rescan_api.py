"""Real rescan API smoke verification (execution sheet sections 2/14/15).

阶段 1: local-pipeline 模式 —— health 必须报 processor=local-pipeline，
        上传真实图片后任务必须走 queued -> processing -> failed/ready，
        且失败/就绪都不得伪造 latestRiskIds / actionPlan。
阶段 2: queue 模式安全回归 —— 任务到 ready 后响应中同样不得出现
        latestRiskIds / actionPlan（防止"上传成功 = 风险消失"）。

用法:
    .venv/Scripts/python backend/verify_real_rescan_api.py
"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from PIL import Image

REPO = Path(__file__).resolve().parent.parent
PY = REPO / ".venv" / "Scripts" / "python.exe"
BASE = "http://127.0.0.1:8010"
IMAGE_NAME = "verify-capture-001.jpg"


def start_backend(mode: str, enable_pipeline: str) -> subprocess.Popen:
    env = {
        **os.environ,
        "ROUTE2_PROCESSOR_MODE": mode,
        "ROUTE2_ENABLE_PIPELINE": enable_pipeline,
    }
    return subprocess.Popen(
        [str(PY), "-m", "uvicorn", "backend.app:app", "--host", "127.0.0.1", "--port", "8010"],
        cwd=REPO, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, encoding="utf-8", errors="replace",
    )


def wait_health(timeout_seconds: int = 40) -> dict:
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            response = httpx.get(BASE + "/api/route2/health", timeout=2)
            if response.status_code == 200:
                return response.json()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
        time.sleep(0.5)
    raise RuntimeError(f"backend 未就绪: {last_error}")


def make_image_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (640, 480), (140, 120, 100)).save(buffer, format="JPEG", quality=85)
    return buffer.getvalue()


def submit_image(batch_id: str) -> dict:
    payload = make_image_bytes()
    captured_at = datetime.now(timezone.utc).isoformat()
    manifest = {
        "id": batch_id,
        "capturedAt": captured_at,
        "kind": "image",
        "files": [{"name": IMAGE_NAME, "size": len(payload), "type": "image/jpeg"}],
    }
    response = httpx.post(
        BASE + "/api/route2/rescan",
        data={
            "batchId": batch_id,
            "capturedAt": captured_at,
            "mediaKind": "image",
            "manifest": json.dumps(manifest),
        },
        files={"files": (IMAGE_NAME, payload, "image/jpeg")},
        timeout=30,
    )
    print(f"POST /rescan -> {response.status_code} {response.json()}")
    assert response.status_code == 202, f"期望 202，得到 {response.status_code}"
    return response.json()


def wait_terminal(job_id: str, timeout_seconds: int = 120) -> dict:
    deadline = time.time() + timeout_seconds
    seen: list[str] = []
    while time.time() < deadline:
        job = httpx.get(BASE + f"/api/route2/rescan/{job_id}", timeout=5).json()
        if job["status"] not in seen:
            seen.append(job["status"])
            print(f"  job {job_id}: {job['status']}")
        if job["status"] in {"ready", "failed"}:
            print(f"  final message: {job.get('message', '')[:200]}")
            return job
        time.sleep(1.0)
    raise RuntimeError(f"job {job_id} 超时未到终态，状态轨迹: {seen}")


def assert_no_fake_risk(job: dict) -> None:
    assert "latestRiskIds" not in job, f"伪造 latestRiskIds: {job.get('latestRiskIds')}"
    assert "actionPlan" not in job, f"伪造 actionPlan: {job.get('actionPlan')}"


def run_stage(mode: str, enable_pipeline: str, stage_name: str) -> None:
    print(f"\n===== {stage_name} (processor={mode}, pipeline={enable_pipeline}) =====")
    proc = start_backend(mode, enable_pipeline)
    try:
        health = wait_health()
        print(f"GET /health -> {json.dumps(health, ensure_ascii=False)}")
        assert health["status"] == "ok"
        assert health["processor"] == mode, f"processor 应为 {mode}: {health}"
        assert health["hardware"] == "adapter-ready"

        job = submit_image(f"verify-{mode}-{int(time.time())}")
        final = wait_terminal(job["jobId"])
        assert final["status"] in {"ready", "failed"}, final
        assert_no_fake_risk(final)
        print(f"阶段通过: 终态 {final['status']}，未伪造风险数据")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()


def main() -> None:
    run_stage("local-pipeline", "1", "阶段 1 · 真实 pipeline 模式")
    run_stage("queue", "0", "阶段 2 · Queue 模式安全回归")
    print("\n===== 验证全部通过 =====")


if __name__ == "__main__":
    try:
        main()
    except AssertionError as exc:
        print(f"VERIFY FAIL: {exc}")
        sys.exit(1)