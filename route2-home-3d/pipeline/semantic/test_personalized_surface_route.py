import json
import tempfile
import unittest
from pathlib import Path

import personalized_surface_route as adapter


class PersonalizedSurfaceRouteTests(unittest.TestCase):
    def test_profile_requires_metric_scale(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'profile.json'
            path.write_text(json.dumps({
                'profileId': 'elder',
                'clearanceMetres': 0.36,
                'assistiveDeviceExtraMetres': 0.10,
                'minimumFreeWidthMetres': 0.72,
                'requiresMetricScale': True,
            }), encoding='utf-8')
            profile = adapter.load_profile(path)
            self.assertTrue(profile['requiresMetricScale'])

    def test_invalid_profile_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            path = Path(td) / 'profile.json'
            path.write_text(json.dumps({
                'profileId': 'bad',
                'clearanceMetres': 0,
                'assistiveDeviceExtraMetres': 0.1,
                'minimumFreeWidthMetres': 0.7,
                'requiresMetricScale': True,
            }), encoding='utf-8')
            with self.assertRaises(RuntimeError):
                adapter.load_profile(path)


if __name__ == '__main__':
    unittest.main()
