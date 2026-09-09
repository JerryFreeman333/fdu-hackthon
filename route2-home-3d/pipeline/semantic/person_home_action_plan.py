"""Person Twin × Home Twin action planning with explicit rescan closure."""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

ACTION_MAP = {
    "trip-hazard": ("safety_check", "处理绊倒障碍", "移除或固定路线上的电缆，并重新扫描路线。"),
    "surface-hazard": ("safety_check", "处理地面障碍", "固定或移除地毯/门槛等地面障碍，并重新扫描路线。"),
    "night-route": ("safety_check", "复核夜间通行路线", "检查夜间照明和床到卫生间路线上的障碍，完成后重新扫描。"),
    "functional-context": ("observation", "处理已识别环境障碍", "先处理明确的环境障碍；身体不适本身沿用原有医疗建议处理。"),
    "evidence-limit": ("safety_check", "现场验证候选路线", "在真实环境中步行验证候选路线后，再把它作为固定照护建议。"),
}


def validate_projection(p: dict[str, Any]) -> None:
    if p.get("schemaVersion") != 1 or p.get("type") != "person-home-risk-projection":
        raise RuntimeError("risk projection schema 无效")
    if p.get("status") != "non-diagnostic":
        raise RuntimeError("risk projection 必须保持 non-diagnostic")
    if p.get("privacyScope") not in {"private", "family_ok"}:
        raise RuntimeError("privacyScope 无效")
    for risk in p.get("risks", []):
        for key in ("id", "level", "kind", "title", "evidence", "action"):
            if key not in risk:
                raise RuntimeError(f"risk 缺少字段: {key}")


def validate_plan(plan: dict[str, Any]) -> None:
    if plan.get("schemaVersion") != 1 or plan.get("type") != "person-home-action-plan":
        raise RuntimeError("action plan schema 无效")
    if plan.get("privacyScope") not in {"private", "family_ok"}:
        raise RuntimeError("action plan privacyScope 无效")
    for action in plan.get("actions", []):
        for key in ("id", "riskId", "kind", "title", "description", "status", "requiresRescan", "closureRule"):
            if key not in action:
                raise RuntimeError(f"action 缺少字段: {key}")
        if action.get("closureRule", {}).get("riskId") != action.get("riskId"):
            raise RuntimeError("action closureRule.riskId 与 riskId 不一致")


def _action_from_risk(risk: dict[str, Any]) -> dict[str, Any]:
    action_kind, title, description = ACTION_MAP.get(
        risk["kind"], ("observation", "复核家庭环境", risk["action"])
    )
    return {
        "id": f"action-{risk['id']}",
        "riskId": risk["id"],
        "kind": action_kind,
        "title": title,
        "description": description,
        "status": "open",
        "requiresRescan": True,
        "closureRule": {"type": "risk-disappears-after-rescan", "riskId": risk["id"]},
    }


def build_action_plan(projection: dict[str, Any]) -> dict[str, Any]:
    validate_projection(projection)
    actions = [_action_from_risk(risk) for risk in projection.get("risks", [])]
    return {
        "schemaVersion": 1,
        "type": "person-home-action-plan",
        "status": "open" if actions else "clear",
        "privacyScope": projection["privacyScope"],
        "homeVersion": projection.get("homeVersion"),
        "actions": actions,
        "principle": "先形成可执行的家庭行动，再由复扫结果决定风险是否关闭。",
    }


def apply_rescan_closure(plan: dict[str, Any], latest_projection: dict[str, Any]) -> dict[str, Any]:
    validate_plan(plan)
    validate_projection(latest_projection)
    active_ids = {r["id"] for r in latest_projection.get("risks", [])}
    result = json.loads(json.dumps(plan, ensure_ascii=False))
    for action in result.get("actions", []):
        if action.get("status") == "completed":
            continue
        if action.get("requiresRescan") and action.get("riskId") not in active_ids:
            action["status"] = "resolved"
            action["resolvedBy"] = "rescan"
    result["status"] = "open" if any(a.get("status") in {"open", "in_progress"} for a in result.get("actions", [])) else "clear"
    result["homeVersion"] = latest_projection.get("homeVersion")
    return result


def merge_rescan_plan(previous_plan: dict[str, Any], latest_projection: dict[str, Any]) -> dict[str, Any]:
    """Keep action history, resolve disappeared risks, and append genuinely new risks."""
    validate_plan(previous_plan)
    validate_projection(latest_projection)
    latest_ids = {risk["id"] for risk in latest_projection.get("risks", [])}
    result = apply_rescan_closure(previous_plan, latest_projection)
    existing_ids = {action["riskId"] for action in result.get("actions", [])}

    for risk in latest_projection.get("risks", []):
        if risk["id"] not in existing_ids:
            result.setdefault("actions", []).append(_action_from_risk(risk))

    result["status"] = "open" if any(a.get("status") in {"open", "in_progress"} for a in result.get("actions", [])) else "clear"
    result["homeVersion"] = latest_projection.get("homeVersion")
    result["rescan"] = {
        "applied": True,
        "activeRiskIds": sorted(latest_ids),
        "resolvedRiskIds": sorted(
            a["riskId"] for a in result.get("actions", []) if a.get("resolvedBy") == "rescan"
        ),
    }
    return result


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--risk", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--rescan-risk", type=Path)
    ap.add_argument("--rescan-plan", type=Path)
    args = ap.parse_args()

    projection = json.loads(args.risk.read_text(encoding="utf-8"))
    if args.rescan_plan:
        previous_plan = json.loads(args.rescan_plan.read_text(encoding="utf-8"))
        plan = merge_rescan_plan(previous_plan, projection)
    else:
        plan = build_action_plan(projection)
        if args.rescan_risk:
            plan = apply_rescan_closure(plan, json.loads(args.rescan_risk.read_text(encoding="utf-8")))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"person-home action plan: {plan['status']}, actions={len(plan['actions'])}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
