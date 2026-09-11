import unittest

from walkability import plan


def obj(id_, category, x, y=0.0, z=0.0, confidence=0.9, clearanceRadius=0.15):
    return {
        'id': id_, 'category': category,
        'position': {'x': x, 'y': y, 'z': z},
        'confidence': confidence,
        'clearanceRadius': clearanceRadius,
    }


class WalkabilityTests(unittest.TestCase):
    def test_soft_hazard_remains_on_candidate_route(self):
        result = plan([
            obj('bed', 'bed', 0),
            obj('rug', 'rug', 1),
            obj('toilet', 'toilet', 2),
        ])
        self.assertEqual(result['status'], 'candidate')
        self.assertIn('rug', result['route']['hazardIds'])
        self.assertEqual(result['route']['safetyStatus'], 'needs-surface-validation')

    def test_cable_can_block_route(self):
        result = plan([
            obj('bed', 'bed', 0),
            obj('cable', 'cable', 1, z=0.0, clearanceRadius=0.6),
            obj('toilet', 'toilet', 2),
        ])
        self.assertEqual(result['status'], 'unavailable')
        self.assertIn('硬障碍物', result['reason'])

    def test_missing_endpoint_is_explicit(self):
        result = plan([obj('bed', 'bed', 0)])
        self.assertEqual(result['status'], 'unavailable')
        self.assertIn('卫生间', result['reason'])


if __name__ == '__main__':
    unittest.main()
