import unittest

from person_home_risk import compute_risks, route_hazard_evidence


PERSON = {
    "schemaVersion": 1,
    "source": "route1-person-twin",
    "asOf": "2026-09-09T10:00:00Z",
    "sharing": {"privacyScope": "family_ok"},
    "functionalProfile": {
        "mobility": "uses_cane",
        "usesCane": True,
        "nightVision": "normal",
        "cognition": "normal",
    },
}


class PersonHomeRiskContractTests(unittest.TestCase):
    def test_unlinked_home_hazard_is_not_attributed_to_route(self):
        home = {
            "homeId": "home-1",
            "version": 7,
            "capturedAt": "2026-09-09T09:00:00Z",
            "surfaceWalkability": {
                "route": {
                    "id": "bed-to-toilet",
                    "safetyStatus": "candidate",
                    "hazardIds": [],
                }
            },
            "objects": [
                {"id": "cable-kitchen", "category": "cable", "observedAt": "2026-09-09T08:00:00Z"}
            ],
        }
        hazards, coverage = route_hazard_evidence(home)
        self.assertEqual(hazards, [])
        self.assertEqual(coverage, "route-hazard-coverage-unknown")
        result = compute_risks(PERSON, home)
        self.assertEqual(result["riskCount"], 0)

    def test_explicit_route_hazard_produces_structured_evidence_refs(self):
        home = {
            "homeId": "home-1",
            "version": 8,
            "capturedAt": "2026-09-09T09:00:00Z",
            "surfaceWalkability": {
                "route": {
                    "id": "bed-to-toilet",
                    "safetyStatus": "candidate-personalized-needs-validation",
                    "hazardIds": ["cable-route"],
                }
            },
            "objects": [
                {
                    "id": "cable-route",
                    "category": "cable",
                    "observedAt": "2026-09-09T08:00:00Z",
                    "evidence": {"imageIds": ["img-12"]},
                }
            ],
        }
        result = compute_risks(PERSON, home)
        risk = next(r for r in result["risks"] if r["id"] == "person-home-cable")
        self.assertEqual(result["hazardCoverage"], "explicit-route-hazard-ids")
        refs = risk["evidenceRefs"]
        self.assertEqual(refs[0]["source"], "person-twin")
        self.assertEqual(refs[1]["source"], "home-twin")
        self.assertEqual(refs[1]["homeVersion"], 8)
        self.assertEqual(result["riskRuleVersion"], "person-home-risk-v1")
        self.assertTrue(any(ref.get("source") == "home-object" and ref.get("sourceId") == "cable-route" for ref in refs))


if __name__ == "__main__":
    unittest.main()
