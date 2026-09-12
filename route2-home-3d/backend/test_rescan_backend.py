from __future__ import annotations

import io
import json
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import app
from backend.capture import BrowserUploadCaptureSource, CaptureFile
from backend.processor import LocalPipelineProcessor, SafeQueueProcessor


class RescanBackendTests(unittest.TestCase):
    def test_health_contract(self) -> None:
        client = TestClient(app)
        response = client.get("/api/route2/health")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ok")
        self.assertEqual(payload["hardware"], "adapter-ready")

    def test_route1_integration_contract_and_item_lookup(self) -> None:
        client = TestClient(app)
        response = client.get("/api/route2/integration")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["status"], "ready")
        self.assertIn(payload["dataMode"], {"demo", "real"})
        self.assertTrue(payload["items"])
        self.assertTrue(all(action["source"] == "route2-person-home-risk" for action in payload["actions"]))

        found = client.get("/api/route2/items/find", params={"q": "降压药"})
        self.assertEqual(found.status_code, 200)
        self.assertEqual(found.json()["status"], "found")
        self.assertIn("床头柜", found.json()["message"])

    def test_route1_cannot_resolve_action_without_rescan(self) -> None:
        client = TestClient(app)
        action_id = client.get("/api/route2/integration").json()["actions"][0]["id"]
        rejected = client.post(f"/api/route2/actions/{action_id}/status", params={"status": "resolved"})
        self.assertEqual(rejected.status_code, 422)
        accepted = client.post(f"/api/route2/actions/{action_id}/status", params={"status": "done"})
        self.assertEqual(accepted.status_code, 200)

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

    def test_local_pipeline_points_to_pipeline_scripts(self) -> None:
        repo_root = Path(__file__).resolve().parents[1]
        processor = LocalPipelineProcessor(repo_root)
        expected = repo_root / "pipeline" / "scripts" / "12_rescan_home.ps1"
        self.assertEqual(processor.script, expected)
        self.assertTrue(processor.script.is_file())


if __name__ == "__main__":
    unittest.main()
