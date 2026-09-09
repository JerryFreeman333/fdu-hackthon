import unittest

from person_home_action_plan import apply_rescan_closure, build_action_plan, merge_rescan_plan


def projection(risks, home_version="v1"):
    return {
        "schemaVersion": 1,
        "type": "person-home-risk-projection",
        "status": "non-diagnostic",
        "privacyScope": "family_ok",
        "homeVersion": home_version,
        "risks": risks,
    }


def risk(risk_id="r1", kind="surface-hazard"):
    return {
        "id": risk_id,
        "level": "elevated",
        "kind": kind,
        "title": "test",
        "evidence": ["Home Twin evidence"],
        "action": "test action",
    }


class ActionPlanTests(unittest.TestCase):
    def test_open_action_requires_rescan(self):
        plan = build_action_plan(projection([risk()]))
        self.assertEqual(plan["status"], "open")
        self.assertEqual(plan["actions"][0]["status"], "open")
        self.assertTrue(plan["actions"][0]["requiresRescan"])

    def test_disappeared_risk_is_resolved_by_rescan(self):
        plan = build_action_plan(projection([risk()]))
        updated = apply_rescan_closure(plan, projection([], home_version="v2"))
        self.assertEqual(updated["status"], "clear")
        self.assertEqual(updated["actions"][0]["status"], "resolved")
        self.assertEqual(updated["actions"][0]["resolvedBy"], "rescan")
        self.assertEqual(updated["homeVersion"], "v2")

    def test_remaining_risk_keeps_plan_open(self):
        plan = build_action_plan(projection([risk("r1"), risk("r2", "trip-hazard")]))
        updated = apply_rescan_closure(plan, projection([risk("r2", "trip-hazard")]))
        self.assertEqual(updated["status"], "open")
        states = {action["riskId"]: action["status"] for action in updated["actions"]}
        self.assertEqual(states["r1"], "resolved")
        self.assertEqual(states["r2"], "open")

    def test_merge_rescan_preserves_history_and_adds_new_risk(self):
        previous = build_action_plan(projection([risk("r1")], home_version="v1"))
        updated = merge_rescan_plan(previous, projection([risk("r2", "trip-hazard")], home_version="v2"))
        states = {action["riskId"]: action["status"] for action in updated["actions"]}
        self.assertEqual(states["r1"], "resolved")
        self.assertEqual(states["r2"], "open")
        self.assertEqual(updated["homeVersion"], "v2")
        self.assertEqual(updated["rescan"]["resolvedRiskIds"], ["r1"])
        self.assertEqual(updated["rescan"]["activeRiskIds"], ["r2"])

    def test_completed_action_is_not_reopened_by_rescan(self):
        previous = build_action_plan(projection([risk("r1")]))
        previous["actions"][0]["status"] = "completed"
        updated = merge_rescan_plan(previous, projection([risk("r1")], home_version="v2"))
        self.assertEqual(updated["actions"][0]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
