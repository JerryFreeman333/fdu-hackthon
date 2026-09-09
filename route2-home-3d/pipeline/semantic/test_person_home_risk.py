import unittest

from person_home_risk import compute_risks


class PersonHomeRiskTests(unittest.TestCase):
    def setUp(self):
        self.person = {
            "schemaVersion": 1,
            "source": "route1-person-twin",
            "asOf": "2026-09-09",
            "activity": "stable",
            "mobility": "declining",
            "sleep": "stable",
            "nightActivity": "declining",
            "recentSymptoms": ["dizziness"],
            "functionalProfile": {
                "mobility": "uses_cane",
                "usesCane": True,
                "nightVision": "reduced",
                "cognition": "stable",
            },
            "sharing": {"familySharing": "granted", "privacyScope": "family_ok"},
        }
        self.home = {
            "version": 3,
            "objects": [
                {"id": "rug-1", "category": "rug"},
                {"id": "cable-1", "category": "cable"},
            ],
            "personalizedSurfaceWalkability": {
                "route": {"hazardIds": ["rug-1", "cable-1"], "safetyStatus": "candidate-personalized-needs-validation"}
            },
        }

    def test_combines_functional_and_spatial_evidence(self):
        result = compute_risks(self.person, self.home)
        ids = {risk["id"] for risk in result["risks"]}
        self.assertIn("person-home-cable", ids)
        self.assertIn("person-home-surface", ids)
        self.assertIn("person-home-night-route", ids)
        self.assertIn("person-home-dizziness", ids)
        self.assertEqual(result["status"], "non-diagnostic")

    def test_private_scope_is_preserved(self):
        person = dict(self.person)
        person["sharing"] = {"familySharing": "denied", "privacyScope": "private"}
        result = compute_risks(person, self.home)
        self.assertEqual(result["privacyScope"], "private")

    def test_rejects_unknown_person_source(self):
        person = dict(self.person)
        person["source"] = "chat"
        with self.assertRaises(RuntimeError):
            compute_risks(person, self.home)


if __name__ == "__main__":
    unittest.main()
