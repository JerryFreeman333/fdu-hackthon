"""Conservative spatial-topology inference for Route 2 Home Twin.

The input is the localized semantic snapshot emitted by detect_and_localize.py.
Because COLMAP coordinates are arbitrary-scale and object anchors are sparse-point
centroids, this module never calls an inferred edge a guaranteed safe connection.
It emits candidate `connects` relations with source=`inferred` and a confidence.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

ALLOWED = {
    frozenset(("bed", "door")),
    frozenset(("door", "door")),
    frozenset(("door", "rug")),
    frozenset(("rug", "threshold")),
    frozenset(("threshold", "door")),
    frozenset(("door", "toilet")),
}


def distance(a: dict[str, float], b: dict[str, float]) -> float:
    return math.sqrt(sum((a[k] - b[k]) ** 2 for k in ("x", "y", "z")))


def infer_relations(objects: list[dict[str, Any]], max_neighbors: int = 2) -> list[dict[str, Any]]:
    relations: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for obj in objects:
        peers: list[tuple[float, dict[str, Any]]] = []
        for other in objects:
            if obj["id"] == other["id"]:
                continue
            if frozenset((obj["category"], other["category"])) not in ALLOWED:
                continue
            peers.append((distance(obj["position"], other["position"]), other))
        peers.sort(key=lambda item: item[0])
        for rank, (d, other) in enumerate(peers[:max_neighbors]):
            left, right = sorted((obj["id"], other["id"]))
            key = (left, right)
            if key in seen:
                continue
            seen.add(key)
            base = min(float(obj["confidence"]), float(other["confidence"]))
            rank_factor = 1.0 / (1.0 + 0.25 * rank)
            distance_factor = 1.0 / (1.0 + max(d, 0.0))
            relations.append({
                "subjectId": left,
                "relation": "connects",
                "objectId": right,
                "confidence": round(max(0.0, min(1.0, base * rank_factor * distance_factor)), 4),
                "source": "inferred",
            })
    return relations


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--min-confidence", type=float, default=0.18)
    args = parser.parse_args()

    data = json.loads(args.input.read_text(encoding="utf-8"))
    snapshot = data.get("snapshot")
    if not isinstance(snapshot, dict):
        raise RuntimeError("输入缺少 snapshot")
    objects = [
        obj for obj in snapshot.get("objects", [])
        if all(k in obj for k in ("id", "category", "position", "confidence"))
    ]
    relations = [r for r in infer_relations(objects) if r["confidence"] >= args.min_confidence]
    snapshot["relations"] = relations
    snapshot["topology"] = {
        "status": "candidate",
        "method": "semantic-3d-nearest-neighbor",
        "metricScaleAvailable": bool(data.get("localization", {}).get("metricScaleAvailable", False)),
        "warning": "inferred connects are candidate spatial relationships, not verified safe walking corridors",
    }
    data["topology"] = snapshot["topology"]
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"inferred topology relations: {len(relations)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
