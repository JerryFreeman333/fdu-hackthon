"""Surface-derived 2.5D walkability model for Route 2 Home Twin.

The module deliberately distinguishes *surface evidence* from semantic anchors:
- estimates a dominant planar candidate floor from COLMAP sparse points;
- rasterizes ground-supported cells and point-cloud obstacle cells;
- inflates obstacles by a configurable clearance margin;
- projects semantic hazards onto the candidate floor and adds cost/blocking;
- plans an A* path over the resulting 2D cost map.

COLMAP has arbitrary scale unless an external metres-per-unit calibration is supplied.
Without it, all resolution/clearance values remain reconstruction-unit parameters and
are never presented as physical metres.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

Vec3 = tuple[float, float, float]

HARD_CATEGORIES = {"cable"}
SOFT_COST = {"rug": 3.0, "threshold": 5.0}


@dataclass(frozen=True)
class Plane:
    point: Vec3
    normal: Vec3


@dataclass(frozen=True)
class Basis:
    origin: Vec3
    u: Vec3
    v: Vec3
    n: Vec3

    def project(self, p: Vec3) -> tuple[float, float, float]:
        d = sub(p, self.origin)
        return dot(d, self.u), dot(d, self.v), dot(d, self.n)

    def unproject(self, u: float, v: float, h: float = 0.0) -> Vec3:
        return add(self.origin, add(add(scale(self.u, u), scale(self.v, v)), scale(self.n, h)))


@dataclass
class Grid:
    min_u: float
    min_v: float
    cell: float
    width: int
    height: int
    cost: list[float]
    blocked: list[bool]
    ground: list[bool]

    def index(self, x: int, y: int) -> int:
        return y * self.width + x

    def cell_of(self, u: float, v: float) -> tuple[int, int]:
        x = int(math.floor((u - self.min_u) / self.cell))
        y = int(math.floor((v - self.min_v) / self.cell))
        return x, y

    def inside(self, x: int, y: int) -> bool:
        return 0 <= x < self.width and 0 <= y < self.height


def add(a: Vec3, b: Vec3) -> Vec3:
    return a[0] + b[0], a[1] + b[1], a[2] + b[2]


def sub(a: Vec3, b: Vec3) -> Vec3:
    return a[0] - b[0], a[1] - b[1], a[2] - b[2]


def scale(a: Vec3, s: float) -> Vec3:
    return a[0] * s, a[1] * s, a[2] * s


def dot(a: Vec3, b: Vec3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a: Vec3, b: Vec3) -> Vec3:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def norm(a: Vec3) -> float:
    return math.sqrt(dot(a, a))


def normalize(a: Vec3) -> Vec3:
    n = norm(a)
    if n <= 1e-12:
        raise ValueError("zero-length vector")
    return scale(a, 1.0 / n)


def distance(a: Vec3, b: Vec3) -> float:
    return norm(sub(a, b))


def parse_point3d_line(line: str) -> Vec3 | None:
    parts = line.split()
    if len(parts) < 4 or line.startswith("#"):
        return None
    try:
        return float(parts[1]), float(parts[2]), float(parts[3])
    except ValueError:
        return None


def load_points(path: Path) -> list[Vec3]:
    points = [p for line in path.read_text(encoding="utf-8").splitlines() if (p := parse_point3d_line(line)) is not None]
    if len(points) < 12:
        raise RuntimeError(f"COLMAP 3D 点过少: {len(points)}，至少需要 12 个点才能估计表面")
    if not all(all(math.isfinite(v) for v in p) for p in points):
        raise RuntimeError("COLMAP 点云包含非有限坐标")
    return points


def plane_from_three(a: Vec3, b: Vec3, c: Vec3) -> Plane | None:
    n = cross(sub(b, a), sub(c, a))
    length = norm(n)
    if length <= 1e-9:
        return None
    return Plane(a, scale(n, 1.0 / length))


def point_plane_distance(p: Vec3, plane: Plane) -> float:
    return abs(dot(sub(p, plane.point), plane.normal))


def estimate_candidate_ground(points: list[Vec3], threshold: float = 0.02, iterations: int = 500) -> tuple[Plane, list[Vec3], float]:
    """RANSAC the largest planar support; caller must treat it as candidate ground.

    There is no guaranteed gravity vector in a COLMAP reconstruction, so a dominant
    plane can be a wall/table/etc. This function therefore returns a confidence that
    is based only on support ratio, not a claim that the plane is physically the floor.
    """
    rng = random.Random(42)
    best: tuple[int, float, Plane] | None = None
    n = len(points)
    for _ in range(min(iterations, max(1, n * 3))):
        i, j, k = rng.sample(range(n), 3)
        plane = plane_from_three(points[i], points[j], points[k])
        if plane is None:
            continue
        distances = [point_plane_distance(p, plane) for p in points]
        inliers = [d for d in distances if d <= threshold]
        if not inliers:
            continue
        count = len(inliers)
        median_error = sorted(inliers)[len(inliers) // 2]
        score = (count, -median_error)
        if best is None or score > (best[0], best[1]):
            best = (count, -median_error, plane)
    if best is None:
        raise RuntimeError("无法从 COLMAP 点云估计候选平面")
    count, neg_error, plane = best
    support = count / len(points)
    if support < 0.12:
        raise RuntimeError(f"候选平面支持率过低: {support:.1%}")
    inliers = [p for p in points if point_plane_distance(p, plane) <= threshold]
    return plane, inliers, support


def make_basis(plane: Plane) -> Basis:
    n = normalize(plane.normal)
    ref = (0.0, 0.0, 1.0) if abs(n[2]) < 0.9 else (1.0, 0.0, 0.0)
    u = normalize(cross(ref, n))
    v = normalize(cross(n, u))
    return Basis(plane.point, u, v, n)


def mark_disk(grid: Grid, center_u: float, center_v: float, radius: float, *, blocked: bool = False, cost: float = 0.0) -> None:
    r = max(0, int(math.ceil(radius / grid.cell)))
    cx, cy = grid.cell_of(center_u, center_v)
    for y in range(cy - r, cy + r + 1):
        for x in range(cx - r, cx + r + 1):
            if not grid.inside(x, y):
                continue
            du = (x - cx) * grid.cell
            dv = (y - cy) * grid.cell
            d = math.sqrt(du * du + dv * dv)
            if d <= radius:
                idx = grid.index(x, y)
                if blocked:
                    grid.blocked[idx] = True
                if cost:
                    grid.cost[idx] += cost * max(0.0, 1.0 - d / max(radius, 1e-9))


def inflate_blocked(grid: Grid, radius: float) -> None:
    original = list(grid.blocked)
    r = max(0, int(math.ceil(radius / grid.cell)))
    for y in range(grid.height):
        for x in range(grid.width):
            idx = grid.index(x, y)
            if not original[idx]:
                continue
            for yy in range(max(0, y - r), min(grid.height, y + r + 1)):
                for xx in range(max(0, x - r), min(grid.width, x + r + 1)):
                    if math.hypot((xx - x) * grid.cell, (yy - y) * grid.cell) <= radius:
                        grid.blocked[grid.index(xx, yy)] = True


def build_grid(points: list[Vec3], plane: Plane, ground_inliers: list[Vec3], cell: float, obstacle_height: float) -> tuple[Grid, Basis, dict[str, float]]:
    basis = make_basis(plane)
    projected = [basis.project(p) for p in points]
    grounds = [basis.project(p) for p in ground_inliers]
    all_uv = projected
    min_u = min(p[0] for p in all_uv) - cell
    max_u = max(p[0] for p in all_uv) + cell
    min_v = min(p[1] for p in all_uv) - cell
    max_v = max(p[1] for p in all_uv) + cell
    width = max(1, int(math.ceil((max_u - min_u) / cell)) + 1)
    height = max(1, int(math.ceil((max_v - min_v) / cell)) + 1)
    size = width * height
    grid = Grid(min_u, min_v, cell, width, height, [1.0] * size, [False] * size, [False] * size)

    for u, v, _h in grounds:
        x, y = grid.cell_of(u, v)
        if grid.inside(x, y):
            grid.ground[grid.index(x, y)] = True

    # Per-cell point heights above candidate plane. Any elevated sparse point marks an
    # obstacle candidate; this deliberately errs toward blocking rather than inventing free space.
    heights: dict[int, list[float]] = {}
    for u, v, h in projected:
        x, y = grid.cell_of(u, v)
        if not grid.inside(x, y):
            continue
        heights.setdefault(grid.index(x, y), []).append(h)
    obstacle_cells = 0
    for idx, hs in heights.items():
        if max(hs) >= obstacle_height:
            grid.blocked[idx] = True
            obstacle_cells += 1

    return grid, basis, {
        "obstacleCells": float(obstacle_cells),
        "groundCells": float(sum(grid.ground)),
        "width": float(width),
        "height": float(height),
    }


def nearest_ground_cell(grid: Grid, basis: Basis, p: Vec3, max_radius_cells: int = 30) -> tuple[int, int] | None:
    u, v, _h = basis.project(p)
    sx, sy = grid.cell_of(u, v)
    if grid.inside(sx, sy):
        candidates = [(0.0, sx, sy)]
    else:
        candidates = []
    for radius in range(1, max_radius_cells + 1):
        found: list[tuple[float, int, int]] = []
        for y in range(max(0, sy - radius), min(grid.height, sy + radius + 1)):
            for x in range(max(0, sx - radius), min(grid.width, sx + radius + 1)):
                if not grid.ground[grid.index(x, y)] or grid.blocked[grid.index(x, y)]:
                    continue
                d = math.hypot(x - sx, y - sy)
                found.append((d, x, y))
        if found:
            candidates.extend(found)
            break
    if not candidates:
        return None
    return min(candidates)[1:]


def astar(grid: Grid, start: tuple[int, int], goal: tuple[int, int]) -> list[tuple[int, int]] | None:
    if grid.blocked[grid.index(*start)] or grid.blocked[grid.index(*goal)]:
        return None
    open_set: list[tuple[float, float, tuple[int, int]]] = []
    heapq.heappush(open_set, (0.0, 0.0, start))
    came: dict[tuple[int, int], tuple[int, int]] = {}
    g_score = {start: 0.0}
    closed: set[tuple[int, int]] = set()

    def heuristic(a: tuple[int, int], b: tuple[int, int]) -> float:
        return math.hypot(a[0] - b[0], a[1] - b[1])

    while open_set:
        _, g, current = heapq.heappop(open_set)
        if current in closed:
            continue
        closed.add(current)
        if current == goal:
            path = [current]
            while current in came:
                current = came[current]
                path.append(current)
            path.reverse()
            return path
        cx, cy = current
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            nx, ny = cx + dx, cy + dy
            if not grid.inside(nx, ny):
                continue
            idx = grid.index(nx, ny)
            if grid.blocked[idx] or not grid.ground[idx]:
                continue
            step = math.sqrt(2.0) if dx and dy else 1.0
            step_cost = step + grid.cost[idx]
            tentative = g_score[current] + step_cost
            nxt = (nx, ny)
            if tentative < g_score.get(nxt, math.inf):
                came[nxt] = current
                g_score[nxt] = tentative
                f = tentative + heuristic(nxt, goal)
                heapq.heappush(open_set, (f, tentative, nxt))
    return None


def apply_semantic_hazards(grid: Grid, basis: Basis, objects: Iterable[dict[str, Any]], clearance: float) -> dict[str, int]:
    hard = soft = 0
    for obj in objects:
        category = obj.get("category")
        position = obj.get("position")
        if category not in HARD_CATEGORIES and category not in SOFT_COST:
            continue
        if not isinstance(position, dict):
            continue
        p = (float(position["x"]), float(position["y"]), float(position["z"]))
        u, v, _h = basis.project(p)
        radius = float(obj.get("clearanceRadius", clearance))
        if category in HARD_CATEGORIES:
            mark_disk(grid, u, v, radius, blocked=True)
            hard += 1
        else:
            mark_disk(grid, u, v, radius, cost=SOFT_COST[category])
            soft += 1
    return {"hard": hard, "soft": soft}


def path_to_points(grid: Grid, basis: Basis, path: list[tuple[int, int]]) -> list[dict[str, float]]:
    points = []
    for x, y in path:
        u = grid.min_u + (x + 0.5) * grid.cell
        v = grid.min_v + (y + 0.5) * grid.cell
        p = basis.unproject(u, v, 0.0)
        points.append({"x": round(p[0], 6), "y": round(p[1], 6), "z": round(p[2], 6)})
    return points


def plan_surface(snapshot: dict[str, Any], colmap_points: list[Vec3], *, cell: float, plane_threshold: float, obstacle_height: float, clearance: float, metres_per_unit: float | None) -> dict[str, Any]:
    plane, inliers, support = estimate_candidate_ground(colmap_points, plane_threshold)
    grid, basis, stats = build_grid(colmap_points, plane, inliers, cell, obstacle_height)
    semantic_stats = apply_semantic_hazards(grid, basis, snapshot.get("objects", []), clearance)
    # Unknown space stays blocked. This prevents a sparse point cloud from being treated
    # as an open floor simply because no points happened to be reconstructed there.
    for idx, supported in enumerate(grid.ground):
        if not supported:
            grid.blocked[idx] = True
    inflate_blocked(grid, clearance)

    bed = next((o for o in snapshot.get("objects", []) if o.get("category") == "bed"), None)
    toilet = next((o for o in snapshot.get("objects", []) if o.get("category") == "toilet"), None)
    if not bed or not toilet:
        return {"status": "unavailable", "reason": "缺少床或卫生间三维对象。", "surface": surface_metadata(plane, support, grid, stats, semantic_stats, metres_per_unit)}

    start = nearest_ground_cell(grid, basis, vec_from_obj(bed))
    goal = nearest_ground_cell(grid, basis, vec_from_obj(toilet))
    if start is None or goal is None:
        return {"status": "unavailable", "reason": "床或卫生间无法吸附到有地面证据的自由栅格。", "surface": surface_metadata(plane, support, grid, stats, semantic_stats, metres_per_unit)}

    path = astar(grid, start, goal)
    surface = surface_metadata(plane, support, grid, stats, semantic_stats, metres_per_unit)
    if path is None:
        return {"status": "unavailable", "reason": "地面证据与障碍膨胀后没有连通的候选通行空间。", "surface": surface}

    physical_length = (len(path) - 1) * grid.cell
    metres = physical_length * metres_per_unit if metres_per_unit else None
    return {
        "status": "candidate",
        "route": {
            "id": "bed-to-toilet-surface-candidate",
            "title": "床 → 卫生间（表面代价图候选路线）",
            "startCell": {"x": start[0], "y": start[1]},
            "goalCell": {"x": goal[0], "y": goal[1]},
            "pathPoints3D": path_to_points(grid, basis, path),
            "gridSteps": len(path),
            "reconstructionLength": round(physical_length, 6),
            "lengthMetres": round(metres, 3) if metres is not None else None,
            "confidence": round(min(float(bed.get("confidence", 0.0)), float(toilet.get("confidence", 0.0)), support), 4),
            "source": "surface-inferred",
            "safetyStatus": "needs-real-scale-and-surface-validation",
            "warning": "候选路径来自稀疏表面点与语义障碍投影；仍需真实尺度、连续表面、通行宽度和现场复核。",
        },
        "surface": surface,
    }


def surface_metadata(plane: Plane, support: float, grid: Grid, stats: dict[str, float], semantic: dict[str, int], metres_per_unit: float | None) -> dict[str, Any]:
    return {
        "evidenceLevel": "sparse-surface",
        "planeRole": "candidate-ground",
        "planeSupportRatio": round(support, 4),
        "planePoint": {"x": plane.point[0], "y": plane.point[1], "z": plane.point[2]},
        "planeNormal": {"x": plane.normal[0], "y": plane.normal[1], "z": plane.normal[2]},
        "grid": {"width": int(stats["width"]), "height": int(stats["height"]), "cellSizeUnits": grid.cell},
        "groundCells": int(stats["groundCells"]),
        "obstacleCells": int(stats["obstacleCells"]),
        "semanticHardHazards": semantic["hard"],
        "semanticSoftHazards": semantic["soft"],
        "metresPerUnit": metres_per_unit,
        "metricScaleAvailable": metres_per_unit is not None,
        "unknownCellsBlocked": True,
    }


def vec_from_obj(obj: dict[str, Any]) -> Vec3:
    p = obj.get("position")
    if not isinstance(p, dict):
        raise RuntimeError(f"对象 {obj.get('id')} 缺少 position")
    return float(p["x"]), float(p["y"]), float(p["z"])


def load_meters_per_unit(path: Path | None) -> float | None:
    if path is None or not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    value = data.get("metresPerUnit")
    if value is None:
        value = data.get("metersPerUnit")
    if not isinstance(value, (int, float)) or not math.isfinite(float(value)) or float(value) <= 0:
        raise RuntimeError("scale.json 的 metresPerUnit 必须是正数")
    return float(value)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--snapshot", required=True, type=Path)
    parser.add_argument("--points", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--cell", type=float, default=0.05)
    parser.add_argument("--plane-threshold", type=float, default=0.02)
    parser.add_argument("--obstacle-height", type=float, default=0.08)
    parser.add_argument("--clearance", type=float, default=0.18)
    parser.add_argument("--scale", type=Path, default=None)
    args = parser.parse_args()

    if args.cell <= 0 or args.plane_threshold <= 0 or args.obstacle_height <= 0 or args.clearance <= 0:
        raise RuntimeError("cell/plane-threshold/obstacle-height/clearance 必须为正数")

    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    points = load_points(args.points)
    metres_per_unit = load_meters_per_unit(args.scale)
    result = plan_surface(snapshot, points, cell=args.cell, plane_threshold=args.plane_threshold, obstacle_height=args.obstacle_height, clearance=args.clearance, metres_per_unit=metres_per_unit)
    snapshot["surfaceWalkability"] = result
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"surface walkability status: {result['status']}")
    print(f"metric scale available: {bool(result.get('surface', {}).get('metricScaleAvailable', False))}")
    if result.get("route"):
        print(f"surface path steps: {result['route']['gridSteps']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}")
        raise SystemExit(1)
