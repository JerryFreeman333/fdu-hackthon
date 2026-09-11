"""Run surface routing with a configurable mobility/clearance profile."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from surface_costmap import load_meters_per_unit, load_points, plan_surface


def load_profile(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    for key in ("profileId", "clearanceMetres", "assistiveDeviceExtraMetres", "minimumFreeWidthMetres", "requiresMetricScale"):
        if key not in data:
            raise RuntimeError(f"mobility profile 缺少字段: {key}")
    for key in ("clearanceMetres", "assistiveDeviceExtraMetres", "minimumFreeWidthMetres"):
        if not isinstance(data[key], (int, float)) or data[key] <= 0:
            raise RuntimeError(f"mobility profile 字段必须为正数: {key}")
    return data


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--snapshot", required=True, type=Path)
    ap.add_argument("--points", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--profile", required=True, type=Path)
    ap.add_argument("--scale", type=Path, default=None)
    ap.add_argument("--cell", type=float, default=0.05)
    ap.add_argument("--plane-threshold", type=float, default=0.02)
    ap.add_argument("--obstacle-height", type=float, default=0.08)
    args = ap.parse_args()

    profile = load_profile(args.profile)
    metres_per_unit = load_meters_per_unit(args.scale)
    if profile["requiresMetricScale"] and metres_per_unit is None:
        raise RuntimeError("该 mobility profile 要求真实尺度；请提供 scale.json")

    total_clearance_m = profile["clearanceMetres"] + profile["assistiveDeviceExtraMetres"]
    clearance_units = total_clearance_m / metres_per_unit if metres_per_unit else 0.18
    cell_units = args.cell / metres_per_unit if metres_per_unit else args.cell
    plane_threshold_units = args.plane_threshold / metres_per_unit if metres_per_unit else args.plane_threshold
    obstacle_height_units = args.obstacle_height / metres_per_unit if metres_per_unit else args.obstacle_height

    snapshot = json.loads(args.snapshot.read_text(encoding="utf-8"))
    result = plan_surface(
        snapshot,
        load_points(args.points),
        cell_units,
        plane_threshold_units,
        obstacle_height_units,
        clearance_units,
        metres_per_unit,
    )
    result["mobilityProfile"] = {
        "profileId": profile["profileId"],
        "clearanceMetres": profile["clearanceMetres"],
        "assistiveDeviceExtraMetres": profile["assistiveDeviceExtraMetres"],
        "effectiveClearanceMetres": total_clearance_m if metres_per_unit else None,
        "minimumFreeWidthMetres": profile["minimumFreeWidthMetres"],
        "metricScaleUsed": metres_per_unit is not None,
        "confidenceFloor": profile.get("confidenceFloor"),
    }
    if result.get("route"):
        result["route"]["mobilityProfileId"] = profile["profileId"]
        result["route"]["safetyStatus"] = "candidate-personalized-needs-validation"
        result["route"]["warning"] = "路线已按配置的通行余量进行障碍膨胀，但仍需连续表面、净宽、门洞和现场步行验证。"
    snapshot["personalizedSurfaceWalkability"] = result
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"personalized surface route: {result['status']}")
    print(f"profile: {profile['profileId']}")
    print(f"metric scale: {metres_per_unit is not None}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(1)
