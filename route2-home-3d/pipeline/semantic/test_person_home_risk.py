import unittest

from person_home_risk import compute_risks


def person_profile(**overrides):
    person = {
        "schemaVersion": 1,
        "source": "route1-person-twin",
        "asOf": "2026-09-09T12:00:00Z",
        "sharing": {"privacyScope": "private"},
        "functionalProfile": {
            "mobility": "uses_cane",
            "usesCane": True,
            "nightVision": "normal",
            "cognition": "normal",
        },
        "nightActivity": "stable",
        "recentSymptoms": [],
    }
    person.update(overrides)
    return person


def home_snapshot(*, hazard_ids=None, with_route=True):
    snapshot = {
        "homeId": "home-demo",
        "version": 7,
        "capturedAt": "2026-09-09T11:00:00Z",
        "objects": [
            {
                "id": "cable-1",
                "category": "cable",
                "label": "地面电线",
                "position": {"x": 1, "y": 0, "z": 0},
                "confidence": 0.9,
                "source": "vision",
                "observedAt": "2026-09-09T10:00:00Z",
                "evidence": {"imageIds": ["img-12"], "annotationId": "ann-12"},
            },
            {
                "id": "rug-1",
                "category": "rug",
                "label": "地毯",
                "position": {"x": 2, "y": 0, "z": 0},
                "confidence": 0.88,
                "source": "vision",
                "observedAt": "2026-09-09T10:00:00Z",
                "evidence": {"imageIds": ["img-13"], "annotationId": "ann-13"},
            },
        ],
        "surfaceWalkability": {"route": {"safetyStatus": "candidate-personalized-needs-validation"}},
    }
    if with_route:
        snapshot["surfaceWalkability"]["route"]["hazardIds"] = hazard_ids or []
    return snapshot


class PersonHomeRiskContractTests(unittest.TestCase):
    def test_missing_route_hazard_coverage_does_not_attribute_whole_home(self):
        result = compute_risks(person_profile(), home_snapshot(hazard_ids=[]))
        self.assertEqual(result["hazardCoverage"], "route-hazard-coverage-unknown")
        self.assertEqual(result["riskCount"], 0)

    def test_explicit_route_hazard_is_traceable_to_home_object(self):
        result = compute_risks(person_profile(), home_snapshot(hazard_ids=["cable-1"]))
        self.assertEqual(result["hazardCoverage"], "explicit-route-hazard-ids")
        self.assertEqual(result["riskCount"], 1)
        risk = result["risks"][0]
        self.assertEqual(risk["id"], "person-home-cable")
        refs = risk["evidenceRefs"]
        self.assertIn({"source": "home-object", "sourceId": "cable-1", "category": "cable", "observedAt": "2026-09-09T10:00:00Z", "evidence": {"imageIds": ["img-12"], "annotationId": "ann-12"}, "localization": None}, refs)
        self.assertEqual(next(ref for ref in refs if ref["source"] == "home-twin")["homeVersion"], 7)

    def test_unknown_route_coverage_blocks_night_route_risk(self):
        person = person_profile(nightActivity="declining")
        person["functionalProfile"]["nightVision"] = "reduced"
        result = compute_risks(person, home_snapshot(hazard_ids=[]))
        self.assertEqual(result["hazardCoverage"], "route-hazard-coverage-unknown")
        self.assertEqual(result["riskCount"], 0)


if __name__ == "__main__":
    unittest.main()
