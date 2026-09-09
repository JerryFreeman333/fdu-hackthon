"""Deterministic Person Twin × Home Twin risk projection for Route 2.

This module is deliberately non-diagnostic. It only combines explicit functional
signals from Person Twin with spatial evidence already present in Home Twin.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ALLOWED_CONSENT = {"family_ok", "private"}


def _require(mapping: dict[str, Any], key: str) -> Any:
    if key not in mapping:
        raise RuntimeError(f"缺少字段: {key}")
    return mapping[key]


def validate_person(person: dict[str, Any]) -> None:
    if person.get("schemaVersion") != 1:
        raise RuntimeError("Person Twin schemaVersion 必须为 1")
    if person.get("source") != "route1-person-twin":
        raise RuntimeError("Person Twin source 必须为 route1-person-twin")
    sharing = _require(person, "sharing")
    if sharing.get("privacyScope") not in ALLOWED_CONSENT:
        raise RuntimeError("Person Twin privacyScope 无效")
    functional = _require(person, "functionalProfile")
    for key in ("mobility", "usesCane", "nightVision", "cognition"):
        _require(functional, key)


def _objects(snapshot: dict[str, Any], category: str) -> list[dict[str, Any]]:
    return [o for o in snapshot.get("objects", []) if o.get("category") == category]


def compute_risks(person: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    validate_person(person)
    functional = person["functionalProfile"]
    risks: list[dict[str, Any]] = []
    objects = snapshot.get("objects", [])

    routes = snapshot.get("personalizedSurfaceWalkability", {}).get("route") or snapshot.get("surfaceWalkability", {}).get("route")
    route_hazards = []
    if routes:
        route_ids = set(routes.get("hazardIds", []))
        route_hazards = [o for o in objects if o.get("id") in route_ids]
    else:
        route_hazards = _objects(snapshot, "rug") + _objects(snapshot, "cable") + _objects(snapshot, "threshold")

    hazard_categories = {o.get("category") for o in route_hazards}
    high_clearance = functional.get("mobility") in {"uses_cane", "needs_support"} or bool(functional.get("usesCane"))
    poor_night_vision = functional.get("nightVision") == "reduced"
    night_activity = person.get("nightActivity") == "declining"
    mobility_declining = person.get("mobility") == "declining"
    dizzy_recently = "dizziness" in person.get("recentSymptoms", [])

    if "cable" in hazard_categories and (high_clearance or mobility_declining):
        risks.append({
            "id": "person-home-cable",
            "level": "elevated",
            "kind": "trip-hazard",
            "title": "行走能力变化与电缆障碍叠加",
            "evidence": ["Home Twin: route contains cable", "Person Twin: mobility requires/uses support or is declining"],
            "action": "建议优先移除或固定该电缆，再重新扫描路线。",
        })

    if ("rug" in hazard_categories or "threshold" in hazard_categories) and (high_clearance or poor_night_vision):
        risks.append({
            "id": "person-home-surface",
            "level": "elevated",
            "kind": "surface-hazard",
            "title": "当前通行能力与地面障碍叠加",
            "evidence": [
                "Home Twin: route contains rug/threshold",
                "Person Twin: reduced mobility reserve or reduced night vision",
            ],
            "action": "建议检查并固定地毯/门槛边缘，优先处理夜间使用路线。",
        })

    if night_activity and poor_night_vision and route_hazards:
        risks.append({
            "id": "person-home-night-route",
            "level": "elevated",
            "kind": "night-route",
            "title": "夜间活动增加且夜间视力较差",
            "evidence": ["Person Twin: night activity increased", "Person Twin: reduced night vision", "Home Twin: route has identified surface hazards"],
            "action": "建议优先复核床到卫生间的夜间路线照明与地面障碍。",
        })

    if dizzy_recently and route_hazards:
        risks.append({
            "id": "person-home-dizziness",
            "level": "watch",
            "kind": "functional-context",
            "title": "近期头晕与居家行走环境同时存在",
            "evidence": ["Person Twin: recent dizziness", "Home Twin: route has identified hazards"],
            "action": "建议先处理明确的居家障碍；若头晕持续或加重，按医疗建议进一步处理。",
        })

    if mobility_declining and routes and routes.get("safetyStatus", "").startswith("candidate"):
        risks.append({
            "id": "person-home-route-confidence",
            "level": "watch",
            "kind": "evidence-limit",
            "title": "行动能力下降时，不应把候选路线视为已验证安全路线",
            "evidence": ["Person Twin: mobility declining", "Home Twin: route remains candidate"],
            "action": "建议现场步行验证后再把路线作为固定照护建议。",
        })

    return {
        "schemaVersion": 1,
        "type": "person-home-risk-projection",
        "status": "non-diagnostic",
        "privacyScope": person["sharing"]["privacyScope"],
        "personAsOf": person.get("asOf"),
        "homeVersion": snapshot.get("version"),
        "riskCount": len(risks),
        "risks": risks,
        "disclaimer": "本模块只做功能状态与家庭空间证据的组合，不做疾病诊断或医疗风险概率估计。",
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--person", required=True, type=Path)
    ap.add_argument("--home", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    args = ap.parse_args()

    person = json.loads(args.person.read_text(encoding="utf-8"))
    home = json.loads(args.home.read_text(encoding="utf-8"))
    result = compute_risks(person, home)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"person-home risk projection: {result['riskCount']} risks")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"ERROR: {exc}")
        raise SystemExit(1)
