import unittest

from surface_costmap import (
    astar,
    build_grid,
    estimate_candidate_ground,
    inflate_blocked,
    make_basis,
    Plane,
    apply_semantic_hazards,
)


class SurfaceCostmapTests(unittest.TestCase):
    def test_ground_plane_is_recovered(self):
        points = [(float(x), float(y), 0.0) for x in range(5) for y in range(5)]
        plane, inliers, support = estimate_candidate_ground(points, threshold=0.001, iterations=50)
        self.assertGreaterEqual(support, 0.95)
        self.assertEqual(len(inliers), 25)
        self.assertAlmostEqual(abs(plane.normal[2]), 1.0, places=3)

    def test_astar_avoids_inflated_obstacle(self):
        grid = __import__('surface_costmap').Grid(
            min_u=0.0, min_v=0.0, cell=1.0, width=7, height=5,
            cost=[1.0] * 35, blocked=[False] * 35, ground=[True] * 35,
        )
        for y in range(5):
            grid.blocked[grid.index(3, y)] = True
        inflate_blocked(grid, 0.0)
        self.assertIsNone(astar(grid, (1, 2), (5, 2)))

    def test_semantic_cable_blocks_cells(self):
        plane = Plane((0.0, 0.0, 0.0), (0.0, 0.0, 1.0))
        grid = __import__('surface_costmap').Grid(
            min_u=0.0, min_v=0.0, cell=1.0, width=5, height=3,
            cost=[1.0] * 15, blocked=[False] * 15, ground=[True] * 15,
        )
        stats = apply_semantic_hazards(
            grid,
            make_basis(plane),
            [{
                'id': 'c1', 'category': 'cable',
                'position': {'x': 2.0, 'y': 1.0, 'z': 0.0},
                'clearanceRadius': 0.6,
            }],
            0.5,
        )
        self.assertEqual(stats['hard'], 1)
        self.assertTrue(any(grid.blocked))


if __name__ == '__main__':
    unittest.main()
