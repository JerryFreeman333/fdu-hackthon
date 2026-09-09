from __future__ import annotations

import unittest

from rescan_action_merge import merge


class RescanActionMergeTests(unittest.TestCase):
    def _action(self, status: str = "open") -> dict:
        return {
            "id": "action-risk-1",
            "riskId": "risk-1",
            "kind": "safety_check",
            "title": "处理绊倒障碍",
            "description": "处理后重新扫描。",
            "status": status,
            "requiresRescan": True,
            "closureRule": {"type": "risk-disappears-after-rescan", "riskId": "risk-1"},
        }

    def _risk(self, risk_id: str = "risk-1") -> dict:
        return {
            "id": risk_id,
            "level": "elevated",
            "kind": "trip-hazard",
            "title": "电缆障碍",
            "evidence": ["Home Twin: current route explicitly references cable"],
            "evidenceRefs": [],
            "action": "处理障碍。",
        }

    def _risk_payload(
        self,
        *risks: dict,
        home_version: int = 2,
        capture_id: str | None = "capture-2",
        reconstruction_id: str | None = "recon-2",
        home_id: str = "home-demo",
        rule_version: str = "person-home-risk-v1",
    ) -> dict:
        return {
            "schemaVersion": 1,
            "type": "person-home-risk-projection",
            "status": "non-diagnostic",
            "privacyScope": "family_ok",
            "riskRuleVersion": rule_version,
            "personAsOf": "2026-09-09T12:00:00Z",
            "homeId": home_id,
            "homeVersion": home_version,
            "generatedAt": "2026-09-09T12:01:00Z",
            "homeProvenance": {
                "homeId": home_id,
                "homeVersion": home_version,
                "capturedAt": "2026-09-09T11:55:00Z",
                "captureId": capture_id,
                "reconstructionId": reconstruction_id,
            },
            "risks": list(risks),
        }

    def _previous(
        self,
        *,
        home_version: int = 1,
        capture_id: str | None = "capture-1",
        reconstruction_id: str | None = "recon-1",
    ) -> dict:
        provenance = {
            "homeId": "home-demo",
            "homeVersion": home_version,
            "riskRuleVersion": "person-home-risk-v1",
            "projectionAsOf": "2026-09-09T10:00:00Z",
            "generatedAt": "2026-09-09T10:01:00Z",
            "captureId": capture_id,
            "reconstructionId": reconstruction_id,
        }
        return {
            "schemaVersion": 1,
            "type": "person-home-action-plan",
            "status": "open",
            "privacyScope": "family_ok",
            "actions": [self._action()],
            "provenance": {"current": provenance, "previous": None},
        }

    def test_completed_action_stays_open_when_risk_remains(self) -> None:
        previous = self._previous()
        previous["actions"][0]["status"] = "completed"
        result = merge(previous, self._risk_payload(self._risk()))
        self.assertEqual(result["status"], "open")
        self.assertEqual(result["actions"][0]["status"], "completed")

    def test_open_action_resolves_only_after_new_snapshot_risk_disappears(self) -> None:
        result = merge(self._previous(), self._risk_payload())
        self.assertEqual(result["status"], "clear")
        self.assertEqual(result["actions"][0]["status"], "resolved")
        self.assertEqual(result["actions"][0]["resolvedBy"], "rescan")
        self.assertEqual(result["actions"][0]["resolvedAtProvenance"]["homeVersion"], 2)

    def test_same_snapshot_cannot_close_previous_risk(self) -> None:
        previous = self._previous(home_version=2, capture_id="capture-2", reconstruction_id="recon-2")
        with self.assertRaisesRegex(RuntimeError, "version 未前进"):
            merge(previous, self._risk_payload(home_version=2, capture_id="capture-3", reconstruction_id="recon-3"))

    def test_same_capture_cannot_close_previous_risk(self) -> None:
        previous = self._previous(home_version=1, capture_id="capture-1", reconstruction_id="recon-1")
        with self.assertRaisesRegex(RuntimeError, "captureId 未变化"):
            merge(previous, self._risk_payload(home_version=2, capture_id="capture-1", reconstruction_id="recon-2"))

    def test_same_reconstruction_cannot_close_previous_risk(self) -> None:
        previous = self._previous(home_version=1, capture_id="capture-1", reconstruction_id="recon-1")
        with self.assertRaisesRegex(RuntimeError, "reconstructionId 未变化"):
            merge(previous, self._risk_payload(home_version=2, capture_id="capture-2", reconstruction_id="recon-1"))

    def test_missing_capture_id_blocks_auto_close(self) -> None:
        previous = self._previous()
        with self.assertRaisesRegex(RuntimeError, "captureId"):
            merge(previous, self._risk_payload(capture_id=None, reconstruction_id="recon-2"))

    def test_missing_reconstruction_id_blocks_auto_close(self) -> None:
        previous = self._previous()
        with self.assertRaisesRegex(RuntimeError, "reconstructionId"):
            merge(previous, self._risk_payload(capture_id="capture-2", reconstruction_id=None))

    def test_home_id_mismatch_cannot_close_previous_risk(self) -> None:
        previous = self._previous()
        with self.assertRaisesRegex(RuntimeError, "homeId 不一致"):
            merge(previous, self._risk_payload(home_id="another-home"))

    def test_risk_rule_change_cannot_close_previous_risk(self) -> None:
        previous = self._previous()
        with self.assertRaisesRegex(RuntimeError, "risk rule version 不一致"):
            merge(previous, self._risk_payload(rule_version="person-home-risk-v2"))

    def test_new_risk_creates_open_action_with_provenance(self) -> None:
        previous = {"schemaVersion": 1, "type": "person-home-action-plan", "status": "clear", "actions": []}
        result = merge(previous, self._risk_payload(self._risk("risk-2")))
        self.assertEqual(result["status"], "open")
        self.assertEqual(result["actions"][0]["riskId"], "risk-2")
        self.assertEqual(result["actions"][0]["status"], "open")
        self.assertEqual(result["actions"][0]["provenance"]["homeVersion"], 2)


if __name__ == "__main__":
    unittest.main()
