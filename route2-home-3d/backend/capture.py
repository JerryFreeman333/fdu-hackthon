from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence


@dataclass(frozen=True)
class CaptureFile:
    """A single captured media file; the future hardware path uses this same contract."""

    path: Path
    name: str
    media_type: str
    size_bytes: int


@dataclass(frozen=True)
class CaptureBatch:
    """Hardware/browser-neutral capture batch passed to the rescan processor."""

    batch_id: str
    captured_at: str
    media_kind: str
    files: tuple[CaptureFile, ...]
    source: str = "browser-upload"


class CaptureSource(Protocol):
    """Future camera/depth-sensor adapters implement this interface."""

    def capture(self, *, batch_id: str) -> CaptureBatch:
        ...


class BrowserUploadCaptureSource:
    """Adapter for files already received over HTTP.

    Keeping this as an adapter means a hardware source can later provide the same
    CaptureBatch without changing Person × Home or action-loop business logic.
    """

    source = "browser-upload"

    def from_files(
        self,
        *,
        batch_id: str,
        captured_at: str,
        media_kind: str,
        files: Sequence[CaptureFile],
    ) -> CaptureBatch:
        return CaptureBatch(
            batch_id=batch_id,
            captured_at=captured_at,
            media_kind=media_kind,
            files=tuple(files),
            source=self.source,
        )
