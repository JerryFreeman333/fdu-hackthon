from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app
from backend.capture import BrowserUploadCaptureSource, CaptureFile
from backend.processor import SafeQueueProcessor


class RescanBackendTests(unittest.TestCase):
    def test_health_contract(self) -> None:
        client = TestClient(app)
        response = client.get("/api/route2/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["hardware"], "adapter-ready")

    def test_upload_queues_and_does_not_fake_risk_clearance(self) -> None:
        client = TestClient(app)
        batch_id = "test-batch-001"
        captured_at = "2026-09-09T07:00:00Z"
        manifest = {
            "id": batch_id,
            "capturedAt": captured_at,
            "kind": "image",
            "files": [{"name": "room.jpg", "size": 4, "type": "image/jpeg", "lastModified": 0}],
        }
        response = client.post(
            "/api/route2/rescan",
            data={
                "batchId": batch_id,
                "capturedAt": captured_at,
                "mediaKind": "image",
                "manifest": json.dumps(manifest),
            },
            files={"files": ("room.jpg", io.BytesIO(b"test"), "image/jpeg")},
        )
        self.assertEqual(response.status_code, 202)
        job_id = response.json()["jobId"]

        status = client.get(f"/api/route2/rescan/{job_id}")
        self.assertEqual(status.status_code, 200)
        payload = status.json()
        self.assertIn(payload["status"], {"queued", "processing", "ready"})
        if payload["status"] == "ready":
            self.assertNotIn("latestRiskIds", payload)
            self.assertNotIn("actionPlan", payload)

    def test_capture_contract_is_hardware_neutral(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "frame.jpg"
            path.write_bytes(b"x")
            source = BrowserUploadCaptureSource()
            batch = source.from_files(
                batch_id="capture-001",
                captured_at="2026-09-09T07:00:00Z",
                media_kind="image",
                files=(CaptureFile(path, "frame.jpg", "image/jpeg", 1),),
            )
            self.assertEqual(batch.source, "browser-upload")
            self.assertEqual(len(batch.files), 1)

    def test_safe_queue_makes_no_environment_claim(self) -> None:
        result = SafeQueueProcessor().process(
            batch=BrowserUploadCaptureSource().from_files(
                batch_id="batch-1",
                captured_at="2026-09-09T07:00:00Z",
                media_kind="image",
                files=(),
            ),
            job_dir=Path(tempfile.mkdtemp()),
        )
        self.assertEqual(result.status, "ready")
        self.assertIsNone(result.latest_risk_ids)
        self.assertIsNone(result.action_plan)


if __name__ == "__main__":
    unittest.main()
