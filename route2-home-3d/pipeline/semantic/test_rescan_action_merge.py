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
        return {"id": risk_id, "kind": "trip-hazard", "action": "处理障碍。"}

    def _risk_payload(self, *risks: dict) -> dict:
        return {
            "schemaVersion": 1,
            "type": "person-home-risk-projection",
            "privacyScope": "family_ok",
            "risks": list(risks),
        }

    def test_completed_action_stays_open_when_risk_remains(self) -> None:
        result = merge(
            {"schemaVersion": 1, "type": "person-home-action-plan", "status": "open", "actions": [self._action("completed")]},
            self._risk_payload(self._risk()),
        )
        self.assertEqual(result["status"], "open")
        self.assertEqual(result["actions"][0]["status"], "completed")

    def test_completed_action_resolves_only_after_risk_disappears(self) -> None:
        result = merge(
            {"schemaVersion": 1, "type": "person-home-action-plan", "status": "open", "actions": [self._action("completed")]},
            self._risk_payload(),
        )
        self.assertEqual(result["status"], "clear")
        self.assertEqual(result["actions"][0]["status"], "resolved")
        self.assertEqual(result["actions"][0]["resolvedBy"], "rescan")

    def test_new_risk_creates_open_action(self) -> None:
        result = merge(
            {"schemaVersion": 1, "type": "person-home-action-plan", "status": "clear", "actions": []},
            self._risk_payload(self._risk("risk-2")),
        )
        self.assertEqual(result["status"], "open")
        self.assertEqual(result["actions"][0]["riskId"], "risk-2")
        self.assertEqual(result["actions"][0]["status"], "open")


if __name__ == "__main__":
    unittest.main()
