import copy
import unittest
from person_home_action_plan import build_action_plan, merge_rescan_plan
from rescan_action_merge import merge
from test_person_home_action_plan import projection, risk


class RescanContinuityTests(unittest.TestCase):
    def test_both_entrypoints_accept_chained_snapshots_and_reopen_returned_risk(self):
        for merger in (merge, merge_rescan_plan):
            first = build_action_plan(projection([risk()]))
            second = merger(first, projection([], home_version=2, capture_id="c2", reconstruction_id="r2"))
            third = merger(second, projection([risk()], home_version=3, capture_id="c3", reconstruction_id="r3"))
            self.assertEqual(third["status"], "open")
            self.assertEqual(third["actions"][0]["status"], "open")
            self.assertNotIn("resolvedAtProvenance", third["actions"][0])
            self.assertEqual(third["provenance"]["previous"], second["provenance"]["current"])
            with self.assertRaisesRegex(RuntimeError, "version"):
                merger(third, projection([], home_version=2, capture_id="c4", reconstruction_id="r4"))

    def test_completed_is_not_resolved_until_new_evidence(self):
        first = build_action_plan(projection([risk()]))
        first["actions"][0]["status"] = "completed"
        second = merge(first, projection([risk()], home_version=2, capture_id="c2", reconstruction_id="r2"))
        self.assertEqual(second["status"], "open")
        third = merge(second, projection([], home_version=3, capture_id="c3", reconstruction_id="r3"))
        self.assertEqual(third["actions"][0]["status"], "resolved")

    def test_unknown_coverage_or_missing_baseline_cannot_clear_actions(self):
        first = build_action_plan(projection([risk()]))
        latest = projection([], home_version=2, capture_id="c2", reconstruction_id="r2")
        for coverage in (None, "route-hazard-coverage-unknown", "route-unavailable"):
            bad = {**latest, "hazardCoverage": coverage}
            with self.assertRaisesRegex(RuntimeError, "覆盖证据"):
                merge(first, bad)
        legacy = copy.deepcopy(first)
        del legacy["provenance"]
        with self.assertRaisesRegex(RuntimeError, "provenance"):
            merge(legacy, latest)
        blank = copy.deepcopy(first)
        blank["provenance"]["current"]["captureId"] = ""
        with self.assertRaisesRegex(RuntimeError, "captureId"):
            merge(blank, latest)

    def test_legacy_initial_capture_remains_viewable_but_does_not_claim_clear(self):
        legacy = {"schemaVersion": 1, "type": "person-home-risk-projection",
                  "status": "non-diagnostic", "privacyScope": "private", "risks": []}
        result = build_action_plan(legacy)
        self.assertEqual(result["status"], "open")
        self.assertNotIn("provenance", result)
        self.assertEqual(result["actions"][0]["riskId"], "route-evidence-pending")

    def test_missing_risks_is_not_an_empty_completed_scan(self):
        first = build_action_plan(projection([risk()]))
        latest = projection([], home_version=2, capture_id="c2", reconstruction_id="r2")
        del latest["risks"]
        with self.assertRaisesRegex(RuntimeError, "risks"):
            merge(first, latest)


if __name__ == "__main__":
    unittest.main()
