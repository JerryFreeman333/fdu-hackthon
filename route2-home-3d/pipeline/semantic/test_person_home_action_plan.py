import unittest

from person_home_action_plan import apply_rescan_closure, build_action_plan


def projection(risks):
    return {
        "schemaVersion": 1,
        "type": "person-home-risk-projection",
        "status": "non-diagnostic",
        "privacyScope": "family_ok",
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
        updated = apply_rescan_closure(plan, projection([]))
        self.assertEqual(updated["status"], "clear")
        self.assertEqual(updated["actions"][0]["status"], "resolved")
        self.assertEqual(updated["actions"][0]["resolvedBy"], "rescan")

    def test_remaining_risk_keeps_plan_open(self):
        plan = build_action_plan(projection([risk("r1"), risk("r2", "trip-hazard")]))
        updated = apply_rescan_closure(plan, projection([risk("r2", "trip-hazard")]))
        self.assertEqual(updated["status"], "open")
        states = {action["riskId"]: action["status"] for action in updated["actions"]}
        self.assertEqual(states["r1"], "resolved")
        self.assertEqual(states["r2"], "open")


if __name__ == "__main__":
    unittest.main()
