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
HAZARD_CATEGORIES = {"rug", "cable", "threshold"}


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


def route_hazard_evidence(snapshot: dict[str, Any]) -> tuple[list[dict[str, Any]], str]:
    """Return only hazards explicitly evidenced as belonging to the current route.

    Missing route-level hazard references are treated as unknown rather than falling
    back to every hazard in the home. This prevents false attribution such as
    "a cable exists in the home" -> "the bedroom-to-toilet route contains a cable".
    """
    objects = snapshot.get("objects", [])
    route = snapshot.get("personalizedSurfaceWalkability", {}).get("route") or snapshot.get("surfaceWalkability", {}).get("route")
    if not route:
        return [], "route-unavailable"

    hazard_ids = [str(value) for value in route.get("hazardIds") or [] if value]
    if not hazard_ids:
        return [], "route-hazard-coverage-unknown"

    by_id = {str(obj.get("id")): obj for obj in objects if obj.get("id")}
    selected: list[dict[str, Any]] = []
    for hazard_id in hazard_ids:
        obj = by_id.get(hazard_id)
        if obj and obj.get("category") in HAZARD_CATEGORIES:
            selected.append(obj)
    return selected, "explicit-route-hazard-ids"


def _evidence_refs(person: dict[str, Any], snapshot: dict[str, Any], hazards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    refs = [
        {
            "source": "person-twin",
            "sourceId": person.get("source", "route1-person-twin"),
            "asOf": person.get("asOf"),
        },
        {
            "source": "home-twin",
            "sourceId": snapshot.get("homeId"),
            "version": snapshot.get("version"),
            "capturedAt": snapshot.get("capturedAt"),
        },
    ]
    for hazard in hazards:
        refs.append(
            {
                "source": "home-object",
                "sourceId": hazard.get("id"),
                "category": hazard.get("category"),
                "observedAt": hazard.get("observedAt"),
                "evidence": hazard.get("evidence"),
            }
        )
    return refs


def compute_risks(person: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    validate_person(person)
    functional = person["functionalProfile"]
    risks: list[dict[str, Any]] = []
    route_hazard_objects, hazard_coverage = route_hazard_evidence(snapshot)
    hazard_categories = {o.get("category") for o in route_hazard_objects}
    route = snapshot.get("personalizedSurfaceWalkability", {}).get("route") or snapshot.get("surfaceWalkability", {}).get("route")
    shared_evidence = _evidence_refs(person, snapshot, route_hazard_objects)

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
            "evidence": ["Home Twin: current route explicitly references cable", "Person Twin: mobility requires/uses support or is declining"],
            "evidenceRefs": shared_evidence,
            "action": "建议优先移除或固定该电缆，再重新扫描路线。",
        })

    if hazard_categories & {"rug", "threshold"} and (high_clearance or poor_night_vision):
        risks.append({
            "id": "person-home-surface",
            "level": "elevated",
            "kind": "surface-hazard",
            "title": "当前通行能力与地面障碍叠加",
            "evidence": ["Home Twin: current route explicitly references rug/threshold", "Person Twin: reduced mobility reserve or reduced night vision"],
            "evidenceRefs": shared_evidence,
            "action": "建议检查并固定地毯/门槛边缘，优先处理夜间使用路线。",
        })

    if night_activity and poor_night_vision and route_hazard_objects:
        risks.append({
            "id": "person-home-night-route",
            "level": "elevated",
            "kind": "night-route",
            "title": "夜间活动增加且夜间视力较差",
            "evidence": ["Person Twin: night activity increased", "Person Twin: reduced night vision", "Home Twin: current route explicitly references identified hazards"],
            "evidenceRefs": shared_evidence,
            "action": "建议优先复核床到卫生间的夜间路线照明与地面障碍。",
        })

    if dizzy_recently and route_hazard_objects:
        risks.append({
            "id": "person-home-dizziness",
            "level": "watch",
            "kind": "functional-context",
            "title": "近期头晕与居家行走环境同时存在",
            "evidence": ["Person Twin: recent dizziness", "Home Twin: current route explicitly references identified hazards"],
            "evidenceRefs": shared_evidence,
            "action": "建议先处理明确的居家障碍；若头晕持续或加重，按医疗建议进一步处理。",
        })

    if mobility_declining and route and route.get("safetyStatus", "").startswith("candidate"):
        risks.append({
            "id": "person-home-route-confidence",
            "level": "watch",
            "kind": "evidence-limit",
            "title": "行动能力下降时，不应把候选路线视为已验证安全路线",
            "evidence": ["Person Twin: mobility declining", "Home Twin: route remains candidate"],
            "evidenceRefs": shared_evidence,
            "action": "建议现场步行验证后再把路线作为固定照护建议。",
        })

    return {
        "schemaVersion": 1,
        "type": "person-home-risk-projection",
        "status": "non-diagnostic",
        "privacyScope": person["sharing"]["privacyScope"],
        "personAsOf": person.get("asOf"),
        "homeVersion": snapshot.get("version"),
        "hazardCoverage": hazard_coverage,
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
