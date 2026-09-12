from __future__ import annotations

import unittest

from surface_costmap import Basis, hazard_evidence_for_path


class SurfaceHazardEvidenceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.basis = Basis(
            origin=(0.0, 0.0, 0.0),
            u=(1.0, 0.0, 0.0),
            v=(0.0, 1.0, 0.0),
            n=(0.0, 0.0, 1.0),
        )
        self.path = [
            {"x": 0.0, "y": 0.0, "z": 0.0},
            {"x": 1.0, "y": 0.0, "z": 0.0},
            {"x": 2.0, "y": 0.0, "z": 0.0},
        ]

    def test_only_hazards_inside_route_corridor_are_bound(self) -> None:
        snapshot = {
            "objects": [
                {
                    "id": "cable-near",
                    "category": "cable",
                    "position": {"x": 1.0, "y": 0.2, "z": 0.0},
                    "clearanceRadius": 0.18,
                    "observedAt": "capture-1",
                    "evidence": {"imageIds": ["img-1"]},
                },
                {
                    "id": "cable-far",
                    "category": "cable",
                    "position": {"x": 1.0, "y": 1.0, "z": 0.0},
                    "clearanceRadius": 0.18,
                },
            ]
        }
        hazard_ids, evidence = hazard_evidence_for_path(snapshot, self.basis, self.path, 0.05, 0.18)
        self.assertEqual(hazard_ids, ["cable-near"])
        self.assertEqual(evidence[0]["objectId"], "cable-near")
        self.assertEqual(evidence[0]["rule"], "path-point-proximity-with-clearance")

    def test_unrelated_home_hazard_is_not_route_evidence(self) -> None:
        snapshot = {
            "objects": [
                {
                    "id": "rug-kitchen",
                    "category": "rug",
                    "position": {"x": 10.0, "y": 10.0, "z": 0.0},
                    "clearanceRadius": 0.25,
                }
            ]
        }
        hazard_ids, evidence = hazard_evidence_for_path(snapshot, self.basis, self.path, 0.05, 0.18)
        self.assertEqual(hazard_ids, [])
        self.assertEqual(evidence, [])


if __name__ == "__main__":
    unittest.main()
