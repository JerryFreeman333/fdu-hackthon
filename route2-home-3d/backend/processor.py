from __future__ import annotations

import json
import os
import platform
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .capture import CaptureBatch


@dataclass(frozen=True)
class ProcessResult:
    status: str
    message: str
    latest_risk_ids: list[str] | None = None
    action_plan: dict[str, Any] | None = None


class RescanProcessor:
    """Common processor interface; capture hardware is deliberately outside it."""

    def process(self, batch: CaptureBatch, job_dir: Path) -> ProcessResult:
        raise NotImplementedError


class SafeQueueProcessor(RescanProcessor):
    """Default processor for local development.

    It accepts and validates real media, but makes no safety claim until the actual
    spatial pipeline is enabled. In particular it never invents an empty risk list,
    so an existing family action cannot be falsely resolved.
    """

    def process(self, batch: CaptureBatch, job_dir: Path) -> ProcessResult:
        return ProcessResult(
            status="ready",
            message=(
                "复扫素材已接收；当前运行模式未启用空间推理，因此不改变现有风险/行动状态。"
                "启用 Route 2 本地 pipeline 后才会产生新的风险投影。"
            ),
        )


class LocalPipelineProcessor(RescanProcessor):
    """Windows local adapter for the existing 12_rescan_home.ps1 pipeline."""

    def __init__(self, repo_root: Path) -> None:
        self.repo_root = repo_root
        self.script = repo_root / "pipeline" / "scripts" / "12_rescan_home.ps1"
        self.person_profile = Path(
            os.getenv(
                "ROUTE2_PERSON_PROFILE",
                str(repo_root / "pipeline" / "semantic" / "person-twin.example.json"),
            )
        )
        self.previous_plan = Path(
            os.getenv(
                "ROUTE2_PREVIOUS_PLAN",
                str(repo_root / "pipeline" / "data" / "home" / "semantic" / "person-home-action-plan.json"),
            )
        )
        self.scene_prefix = os.getenv("ROUTE2_RESCAN_SCENE_PREFIX", "api-rescan")
        self.fps = os.getenv("ROUTE2_RESCAN_FPS", "2")
        self.iterations = os.getenv("ROUTE2_RESCAN_ITERATIONS", "30000")
        self.timeout_seconds = int(os.getenv("ROUTE2_PIPELINE_TIMEOUT_SECONDS", "1800"))

    def process(self, batch: CaptureBatch, job_dir: Path) -> ProcessResult:
        if platform.system() != "Windows":
            return ProcessResult(
                status="failed",
                message="本地 GPU/PowerShell 复扫 pipeline 当前仅在 Windows 适配；请关闭 ROUTE2_ENABLE_PIPELINE 或使用 Windows。",
            )
        if not self.script.is_file():
            return ProcessResult(status="failed", message=f"复扫脚本不存在: {self.script}")
        if not self.person_profile.is_file():
            return ProcessResult(status="failed", message=f"Person Twin 不存在: {self.person_profile}")
        if not self.previous_plan.is_file():
            return ProcessResult(status="failed", message=f"上一轮行动计划不存在: {self.previous_plan}")

        scene = f"{self.scene_prefix}-{batch.batch_id}"
        photos_dir = job_dir / "photos"
        photos_dir.mkdir(parents=True, exist_ok=True)
        video_files = [f.path for f in batch.files if batch.media_kind == "video" or f.media_type.startswith("video/")]
        photo_files = [f.path for f in batch.files if f.path not in video_files]

        args = [
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(self.script),
            "-Scene",
            scene,
            "-PersonProfile",
            str(self.person_profile),
            "-PreviousPlan",
            str(self.previous_plan),
            "-Fps",
            self.fps,
            "-Iterations",
            self.iterations,
        ]
        if video_files:
            args += ["-Video", str(video_files[0])]
        else:
            for source in photo_files:
                target = photos_dir / source.name
                if source.resolve() != target.resolve():
                    target.write_bytes(source.read_bytes())
            args += ["-Photos", str(photos_dir)]

        try:
            completed = subprocess.run(
                ["powershell.exe", *args],
                cwd=self.repo_root,
                capture_output=True,
                text=True,
                timeout=self.timeout_seconds,
                check=False,
            )
        except subprocess.TimeoutExpired:
            return ProcessResult(status="failed", message="复扫 pipeline 超时，未关闭任何既有风险。")
        except OSError as exc:
            return ProcessResult(status="failed", message=f"无法启动 PowerShell pipeline: {exc}")

        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout or "未知错误").strip()
            return ProcessResult(status="failed", message=f"复扫 pipeline 失败: {detail[-1200:]}")

        semantic_dir = self.repo_root / "pipeline" / "data" / scene / "semantic"
        risk_path = semantic_dir / "person-home-risk.json"
        action_path = semantic_dir / "person-home-action-plan.rescan.json"
        if not risk_path.is_file():
            return ProcessResult(status="failed", message="复扫完成但未生成风险投影；未关闭任何既有风险。")

        try:
            risk_payload = json.loads(risk_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            return ProcessResult(status="failed", message=f"无法读取复扫风险结果: {exc}")

        latest_risk_ids = [
            str(item["id"])
            for item in risk_payload.get("risks", [])
            if isinstance(item, dict) and isinstance(item.get("id"), str)
        ]
        action_plan: dict[str, Any] | None = None
        if action_path.is_file():
            try:
                parsed = json.loads(action_path.read_text(encoding="utf-8"))
                if isinstance(parsed, dict):
                    action_plan = parsed
            except (OSError, json.JSONDecodeError):
                action_plan = None

        return ProcessResult(
            status="ready",
            message="复扫完成；行动状态仅依据新的风险投影更新。",
            latest_risk_ids=latest_risk_ids,
            action_plan=action_plan,
        )


def build_processor(repo_root: Path) -> RescanProcessor:
    mode = os.getenv("ROUTE2_PROCESSOR_MODE", "queue").strip().lower()
    pipeline_enabled = os.getenv("ROUTE2_ENABLE_PIPELINE", "0").strip() == "1"
    if mode == "local-pipeline" and pipeline_enabled:
        return LocalPipelineProcessor(repo_root)
    return SafeQueueProcessor()
