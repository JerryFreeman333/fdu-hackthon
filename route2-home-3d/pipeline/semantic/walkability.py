"""Conservative geometric walkability/risk routing for Home Twin.

This module operates on the localized semantic snapshot rather than pretending that
object-center waypoints are a validated corridor. It produces a candidate path and
explicitly reports what evidence is missing before a route can be shown as safe.
"""
from __future__ import annotations

import argparse
import heapq
import json
import math
from pathlib import Path
from typing import Any

HARD_BLOCK = {"cable"}
SOFT_HAZARD = {"rug": 3.0, "threshold": 5.0}


def dist(a: dict[str, float], b: dict[str, float]) -> float:
    return math.sqrt(sum((a[k] - b[k]) ** 2 for k in ("x", "y", "z")))


def lerp(a: dict[str, float], b: dict[str, float], t: float) -> dict[str, float]:
    return {k: a[k] + (b[k] - a[k]) * t for k in ("x", "y", "z")}


def point_segment_distance(p: dict[str, float], a: dict[str, float], b: dict[str, float]) -> float:
    ab = {k: b[k] - a[k] for k in ("x", "y", "z")}
    ap = {k: p[k] - a[k] for k in ("x", "y", "z")}
    denom = sum(ab[k] * ab[k] for k in ab)
    if denom <= 1e-12:
        return dist(p, a)
    t = max(0.0, min(1.0, sum(ap[k] * ab[k] for k in ab) / denom))
    return dist(p, lerp(a, b, t))


def score_segment(a: dict[str, float], b: dict[str, float], hazards: list[dict[str, Any]]) -> tuple[bool, float, list[str]]:
    length = dist(a, b)
    hard = False
    penalty = length
    hits: list[str] = []
    samples = max(4, int(length * 20) + 1)
    for i in range(samples):
        t = i / (samples - 1)
        p = lerp(a, b, t)
        for h in hazards:
            radius = float(h.get("clearanceRadius", 0.12))
            d = dist(p, h["position"])
            if d <= radius:
                category = h.get("category")
                hits.append(h["id"])
                if category in HARD_BLOCK:
                    hard = True
                elif category in SOFT_HAZARD:
                    penalty += SOFT_HAZARD[category] * (1.0 - d / max(radius, 1e-9))
    return hard, penalty, sorted(set(hits))


def plan(objects: list[dict[str, Any]]) -> dict[str, Any]:
    bed = next((o for o in objects if o.get("category") == "bed"), None)
    toilet = next((o for o in objects if o.get("category") == "toilet"), None)
    if not bed or not toilet:
        return {"status": "unavailable", "reason": "缺少床或卫生间的三维定位。"}

    candidates = [o for o in objects if o.get("category") in {"bed", "door", "rug", "threshold", "toilet", "cable"}]
    hazards = [o for o in candidates if o.get("category") in HARD_BLOCK or o.get("category") in SOFT_HAZARD]
    nodes = {o["id"]: o for o in candidates}
    graph: dict[str, list[tuple[float, str, list[str]]]] = {k: [] for k in nodes}

    for left in candidates:
        for right in candidates:
            if left["id"] >= right["id"]:
                continue
            blocked, cost, hits = score_segment(left["position"], right["position"], hazards)
            if blocked:
                continue
            # Penalize uncertain objects; a path through low-confidence geometry is worse.
            confidence = max(0.1, min(float(left.get("confidence", 0.0)), float(right.get("confidence", 0.0))))
            cost /= confidence
            graph[left["id"]].append((cost, right["id"], hits))
            graph[right["id"]].append((cost, left["id"], hits))

    if bed["id"] not in graph or toilet["id"] not in graph:
        return {"status": "unavailable", "reason": "路由节点不存在于可行空间候选图。"}

    distance_map = {k: math.inf for k in graph}
    previous: dict[str, tuple[str, list[str]]] = {}
    distance_map[bed["id"]] = 0.0
    queue: list[tuple[float, str]] = [(0.0, bed["id"])]

    while queue:
        best, current = heapq.heappop(queue)
        if best != distance_map[current]:
            continue
        if current == toilet["id"]:
            break
        for cost, nxt, hits in graph[current]:
            new_cost = best + cost
            if new_cost < distance_map[nxt]:
                distance_map[nxt] = new_cost
                previous[nxt] = (current, hits)
                heapq.heappush(queue, (new_cost, nxt))

    if not math.isfinite(distance_map[toilet["id"]]):
        return {"status": "unavailable", "reason": "考虑硬障碍物后没有找到连通路线。"}

    ids = [toilet["id"]]
    hazard_ids: set[str] = set()
    while ids[-1] != bed["id"]:
        parent, hits = previous[ids[-1]]
        hazard_ids.update(hits)
        ids.append(parent)
    ids.reverse()
    path_points = [nodes[i]["position"] for i in ids]
    endpoint_conf = min(float(bed.get("confidence", 0)), float(toilet.get("confidence", 0)))
    topology_conf = min(
        [endpoint_conf]
        + [float(nodes[i].get("confidence", 0)) for i in ids]
        + [0.0] if not ids else [endpoint_conf] + [float(nodes[i].get("confidence", 0)) for i in ids]
    )
    return {
        "status": "candidate",
        "route": {
            "id": "bed-to-toilet-walkable-candidate",
            "title": "床 → 卫生间（可通行候选路线）",
            "startObjectId": bed["id"],
            "endObjectId": toilet["id"],
            "objectIds": ids,
            "hazardIds": sorted(hazard_ids),
            "pathPoints3D": path_points,
            "confidence": round(topology_conf, 4),
            "source": "inferred",
            "safetyStatus": "needs-surface-validation",
            "warning": "这是基于稀疏语义锚点的可通行候选路线；尚未完成地面/障碍物表面级验证、绝对尺度和现场复核。",
        },
        "diagnostics": {
            "metricScaleAvailable": False,
            "hardBlockedCategories": sorted(HARD_BLOCK),
            "softHazardCategories": sorted(SOFT_HAZARD),
            "method": "semantic-anchor-graph-with-clearance-penalty",
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    data = json.loads(args.input.read_text(encoding="utf-8"))
    snapshot = data.get("snapshot")
    if not isinstance(snapshot, dict):
        raise RuntimeError("输入缺少 snapshot")
    result = plan([o for o in snapshot.get("objects", []) if isinstance(o, dict)])
    snapshot["walkability"] = result
    if result.get("route"):
        snapshot["routes"] = [result["route"]]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"walkability status: {result.get('status')}")
    if result.get("route"):
        print(f"candidate path nodes: {len(result['route']['pathPoints3D'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
