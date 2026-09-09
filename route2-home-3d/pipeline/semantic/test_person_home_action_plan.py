import unittest

from person_home_action_plan import apply_rescan_closure, build_action_plan


def projection(risks, *, home_version=1, capture_id="capture-1", reconstruction_id="recon-1"):
    return {
        "schemaVersion": 1,
        "type": "person-home-risk-projection",
        "status": "non-diagnostic",
        "privacyScope": "family_ok",
        "riskRuleVersion": "person-home-risk-v1",
        "personAsOf": "2026-09-09T10:00:00Z",
        "homeId": "home-1",
        "homeVersion": home_version,
        "generatedAt": "2026-09-09T10:01:00Z",
        "homeProvenance": {
            "homeId": "home-1",
            "homeVersion": home_version,
            "capturedAt": "2026-09-09T09:00:00Z",
            "captureId": capture_id,
            "reconstructionId": reconstruction_id,
        },
        "risks": risks,
    }


def risk(risk_id="r1", kind="surface-hazard"):
    return {
        "id": risk_id,
        "level": "elevated",
        "kind": kind,
        "title": "test",
        "evidence": ["Home Twin evidence"],
        "evidenceRefs": [],
        "action": "test action",
    }


class ActionPlanTests(unittest.TestCase):
    def test_open_action_requires_rescan(self):
        plan = build_action_plan(projection([risk()]))
        self.assertEqual(plan["status"], "open")
        self.assertEqual(plan["actions"][0]["status"], "open")
        self.assertTrue(plan["actions"][0]["requiresRescan"])
        self.assertEqual(plan["actions"][0]["provenance"]["homeVersion"], 1)

    def test_disappeared_risk_is_resolved_by_rescan(self):
        plan = build_action_plan(projection([risk()]))
        updated = apply_rescan_closure(plan, projection([], home_version=2, capture_id="capture-2", reconstruction_id="recon-2"))
        self.assertEqual(updated["status"], "clear")
        self.assertEqual(updated["actions"][0]["status"], "resolved")
        self.assertEqual(updated["actions"][0]["resolvedBy"], "rescan")
        self.assertEqual(updated["actions"][0]["resolvedAtProvenance"]["homeVersion"], 2)

    def test_remaining_risk_keeps_plan_open(self):
        plan = build_action_plan(projection([risk("r1"), risk("r2", "trip-hazard")]))
        updated = apply_rescan_closure(
            plan,
            projection([risk("r2", "trip-hazard")], home_version=2, capture_id="capture-2", reconstruction_id="recon-2"),
        )
        self.assertEqual(updated["status"], "open")
        states = {action["riskId"]: action["status"] for action in updated["actions"]}
        self.assertEqual(states["r1"], "resolved")
        self.assertEqual(states["r2"], "open")


if __name__ == "__main__":
    unittest.main()
