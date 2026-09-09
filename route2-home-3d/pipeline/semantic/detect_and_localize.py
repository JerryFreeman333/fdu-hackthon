"""Route 2: open-vocabulary semantic detection + COLMAP 3D anchoring.

This is deliberately a conservative pipeline:
- YOLO-World supplies 2D detections from an explicit six-class vocabulary.
- COLMAP sparse tracks are used to anchor each detection to 3D points observed
  inside the 2D bounding box.
- Objects without 3D support stay unlocalized instead of receiving guessed
  coordinates.
- COLMAP coordinates are not treated as metric unless an external scale
  calibration is supplied.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

from PIL import Image
from ultralytics import YOLOWorld

CATEGORIES = ["bed", "door", "rug", "cable", "threshold", "toilet"]
PROMPTS = [
    "bed",
    "door",
    "rug",
    "cable",
    "threshold step",
    "toilet",
]


def fail(message: str) -> None:
    raise RuntimeError(message)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--images", required=True, type=Path)
    parser.add_argument("--colmap", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--model", default="yolov8s-worldv2.pt")
    parser.add_argument("--confidence", type=float, default=0.20)
    parser.add_argument("--min-track-points", type=int, default=3)
    parser.add_argument("--cluster-distance", type=float, default=0.75)
    return parser.parse_args()


def load_colmap_points(points_file: Path) -> dict[int, tuple[float, float, float]]:
    points: dict[int, tuple[float, float, float]] = {}
    for raw in points_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 4:
            continue
        pid = int(parts[0])
        points[pid] = (float(parts[1]), float(parts[2]), float(parts[3]))
    return points


def load_image_tracks(images_file: Path) -> dict[str, list[tuple[float, float, int]]]:
    lines = images_file.read_text(encoding="utf-8").splitlines()
    tracks: dict[str, list[tuple[float, float, int]]] = {}
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        index += 1
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 10:
            continue
        name = " ".join(parts[9:])
        if index >= len(lines):
            fail(f"COLMAP images.txt 缺少 2D track 行: {name}")
        xy = lines[index].strip().split()
        index += 1
        observations: list[tuple[float, float, int]] = []
        for pos in range(0, len(xy) - 2, 3):
            x = float(xy[pos])
            y = float(xy[pos + 1])
            point_id = int(xy[pos + 2])
            if point_id >= 0:
                observations.append((x, y, point_id))
        tracks[name] = observations
    return tracks


def finite_point(point: tuple[float, float, float]) -> bool:
    return all(math.isfinite(v) for v in point)


def anchor_detection(
    image_tracks: list[tuple[float, float, int]],
    points3d: dict[int, tuple[float, float, float]],
    bbox: tuple[float, float, float, float],
) -> tuple[tuple[float, float, float] | None, int]:
    x0, y0, x1, y1 = bbox
    matched: list[tuple[float, float, float]] = []
    for x, y, pid in image_tracks:
        if x0 <= x <= x1 and y0 <= y <= y1 and pid in points3d:
            point = points3d[pid]
            if finite_point(point):
                matched.append(point)
    if not matched:
        return None, 0
    ordered = sorted(matched, key=lambda p: (p[0], p[1], p[2]))
    mid = len(ordered) // 2
    anchor = tuple(ordered[mid])
    return anchor, len(matched)


def distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def weighted_average(samples: list[dict[str, Any]]) -> tuple[float, float, float]:
    weight_sum = sum(float(sample["weight"]) for sample in samples)
    if weight_sum <= 0:
        return tuple(samples[0]["anchor"])
    return tuple(
        sum(float(sample["anchor"][i]) * float(sample["weight"]) for sample in samples) / weight_sum
        for i in range(3)
    )


def main() -> int:
    args = parse_args()
    if not args.images.is_dir():
        fail(f"输入图像目录不存在: {args.images}")
    if not args.colmap.is_dir():
        fail(f"COLMAP 文本模型目录不存在: {args.colmap}")
    if not 0.0 < args.confidence < 1.0:
        fail("--confidence 必须在 (0, 1) 内")
    if args.min_track_points < 1:
        fail("--min-track-points 必须 >= 1")

    points3d = load_colmap_points(args.colmap / "points3D.txt")
    image_tracks = load_image_tracks(args.colmap / "images.txt")
    if not points3d or not image_tracks:
        fail("COLMAP 文本模型没有可用的 3D 点或图像 track")

    model = YOLOWorld(args.model)
    model.set_classes(PROMPTS)

    candidates: list[dict[str, Any]] = []
    image_files = sorted(
        p for p in args.images.iterdir() if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp"}
    )
    if not image_files:
        fail(f"没有可识别的输入图片: {args.images}")

    for image_path in image_files:
        image_name = image_path.name
        if image_name not in image_tracks:
            continue
        with Image.open(image_path) as image:
            width, height = image.size
        results = model.predict(str(image_path), conf=args.confidence, verbose=False)
        if not results:
            continue
        result = results[0]
        boxes = result.boxes
        if boxes is None:
            continue
        for idx in range(len(boxes)):
            cls_id = int(boxes.cls[idx].item())
            if cls_id < 0 or cls_id >= len(CATEGORIES):
                continue
            category = CATEGORIES[cls_id]
            score = float(boxes.conf[idx].item())
            xyxy = [float(v) for v in boxes.xyxy[idx].tolist()]
            x0, y0, x1, y1 = xyxy
            x0 = max(0.0, min(x0, width))
            x1 = max(0.0, min(x1, width))
            y0 = max(0.0, min(y0, height))
            y1 = max(0.0, min(y1, height))
            anchor, support = anchor_detection(image_tracks[image_name], points3d, (x0, y0, x1, y1))
            if support < args.min_track_points:
                anchor = None
            candidates.append(
                {
                    "annotationId": f"{image_path.stem}:{idx}",
                    "imageId": image_name,
                    "category": category,
                    "label": category,
                    "confidence": score,
                    "bbox": {"x": x0, "y": y0, "width": max(0.0, x1 - x0), "height": max(0.0, y1 - y0)},
                    "anchor": (
                        {
                            "position": {"x": anchor[0], "y": anchor[1], "z": anchor[2]},
                            "confidence": min(1.0, score * min(1.0, support / 20.0)),
                            "source": "vision",
                            "imageIds": [image_name],
                            "supportPointCount": support,
                        }
                        if anchor is not None
                        else None
                    ),
                }
            )

    clusters: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for candidate in candidates:
        anchor = candidate["anchor"]
        if anchor is not None:
            point = anchor["position"]
            tuple_point = (point["x"], point["y"], point["z"])
            weight = float(anchor["confidence"]) * max(1, int(anchor["supportPointCount"]))
            placed = False
            for cluster in clusters[candidate["category"]]:
                if distance(tuple_point, cluster["anchor"]) <= args.cluster_distance:
                    cluster["samples"].append({"anchor": tuple_point, "weight": weight, "candidate": candidate})
                    cluster["anchor"] = weighted_average(cluster["samples"])
                    cluster["images"].add(candidate["imageId"])
                    cluster["candidateCount"] += 1
                    cluster["supportPointCount"] += int(anchor["supportPointCount"])
                    cluster["confidence"] = max(cluster["confidence"], float(anchor["confidence"]))
                    placed = True
                    break
            if not placed:
                clusters[candidate["category"]].append(
                    {
                        "anchor": tuple_point,
                        "samples": [{"anchor": tuple_point, "weight": weight, "candidate": candidate}],
                        "images": {candidate["imageId"]},
                        "candidateCount": 1,
                        "supportPointCount": int(anchor["supportPointCount"]),
                        "confidence": float(anchor["confidence"]),
                    }
                )

    objects: list[dict[str, Any]] = []
    object_counter = 0
    for category in CATEGORIES:
        for cluster in clusters.get(category, []):
            object_counter += 1
            anchor = cluster["anchor"]
            objects.append(
                {
                    "id": f"vision-{category}-{object_counter}",
                    "category": category,
                    "label": category,
                    "roomId": "unknown-room",
                    "position": {"x": anchor[0], "y": anchor[1], "z": anchor[2]},
                    "confidence": cluster["confidence"],
                    "source": "vision",
                    "observedAt": "runtime",
                    "evidence": {
                        "imageIds": sorted(cluster["images"]),
                        "annotationId": cluster["samples"][0]["candidate"]["annotationId"],
                    },
                    "localization": {
                        "supportPointCount": cluster["supportPointCount"],
                        "supportingCandidates": cluster["candidateCount"],
                        "coordinateFrame": "colmap-arbitrary",
                    },
                }
            )

    snapshot = {
        "homeId": args.images.parent.name or "home",
        "version": 1,
        "capturedAt": "runtime",
        "scaleConfidence": 0.0,
        "rooms": [
            {"id": "unknown-room", "label": "待分区", "kind": "other"}
        ],
        "objects": objects,
        "relations": [],
        "routes": [],
    }
    output = {
        "schemaVersion": 1,
        "detector": {"provider": "ultralytics-yolo-world", "model": args.model, "confidenceThreshold": args.confidence},
        "localization": {
            "provider": "colmap-track-anchor",
            "coordinateFrame": "colmap-arbitrary",
            "metricScaleAvailable": False,
            "minimumTrackPoints": args.min_track_points,
        },
        "observations": candidates,
        "snapshot": snapshot,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"semantic observations: {len(candidates)}")
    print(f"localized HomeObjects: {len(objects)}")
    if not objects:
        print("WARNING: 没有获得足够 COLMAP 轨迹支持的 3D 语义对象；不会生成虚假的坐标。", file=sys.stderr)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
