"""Person Twin × Home Twin action planning with explicit rescan provenance."""
from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

ACTION_MAP = {
    "trip-hazard": ("safety_check", "处理绊倒障碍", "移除或固定路线上的电缆，并重新扫描路线。"),
    "surface-hazard": ("safety_check", "处理地面障碍", "固定或移除地毯/门槛等地面障碍，并重新扫描路线。"),
    "night-route": ("safety_check", "复核夜间通行路线", "检查夜间照明和床到卫生间路线上的障碍，完成后重新扫描。"),
    "functional-context": ("observation", "处理已识别环境障碍", "先处理明确的环境障碍；身体不适本身沿用原有医疗建议。"),
    "evidence-limit": ("safety_check", "现场验证候选路线", "在真实环境中步行验证候选路线后，再把它作为固定照护建议。"),
}


def validate_projection(p: dict[str, Any]) -> None:
    if p.get("schemaVersion") != 1 or p.get("type") != "person-home-risk-projection":
        raise RuntimeError("risk projection schema 无效")
    if p.get("status") != "non-diagnostic":
        raise RuntimeError("risk projection 必须保持 non-diagnostic")
    if p.get("privacyScope") not in {"private", "family_ok"}:
        raise RuntimeError("privacyScope 无效")
    for key in ("riskRuleVersion", "homeId", "homeVersion", "homeProvenance"):
        if key not in p:
            raise RuntimeError(f"risk projection 缺少 provenance 字段: {key}")
    home_provenance = p["homeProvenance"]
    if not isinstance(home_provenance, dict) or home_provenance.get("homeId") != p.get("homeId") or home_provenance.get("homeVersion") != p.get("homeVersion"):
        raise RuntimeError("Home Twin provenance 与 projection 不一致")
    for risk in p.get("risks", []):
        for key in ("id", "level", "kind", "title", "evidence", "evidenceRefs", "action"):
            if key not in risk:
                raise RuntimeError(f"risk 缺少字段: {key}")


def _projection_provenance(projection: dict[str, Any]) -> dict[str, Any]:
    home_provenance = dict(projection["homeProvenance"])
    return {
        "homeId": projection.get("homeId"),
        "homeVersion": projection.get("homeVersion"),
        "riskRuleVersion": projection.get("riskRuleVersion"),
        "projectionAsOf": projection.get("personAsOf"),
        "generatedAt": projection.get("generatedAt"),
        "captureId": home_provenance.get("captureId"),
        "reconstructionId": home_provenance.get("reconstructionId"),
    }


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
        "provenance": {},
    }


def build_action_plan(projection: dict[str, Any]) -> dict[str, Any]:
    validate_projection(projection)
    provenance = _projection_provenance(projection)
    actions = [_action_from_risk(risk) for risk in projection.get("risks", [])]
    for action in actions:
        action["provenance"] = {**provenance, "riskId": action["riskId"]}
    return {
        "schemaVersion": 1,
        "type": "person-home-action-plan",
        "status": "open" if actions else "clear",
        "privacyScope": projection["privacyScope"],
        "actions": actions,
        "provenance": {"current": provenance, "previous": None},
        "principle": "先形成可执行的家庭行动，再由复扫结果决定风险是否关闭。",
    }


def merge_rescan_plan(previous_plan: dict[str, Any], latest_projection: dict[str, Any]) -> dict[str, Any]:
    validate_projection(latest_projection)
    previous = copy.deepcopy(previous_plan)
    current_risks = {risk["id"]: risk for risk in latest_projection.get("risks", [])}
    previous_actions = previous.get("actions", [])
    previous_by_risk = {action.get("riskId"): action for action in previous_actions if action.get("riskId")}
    latest_provenance = _projection_provenance(latest_projection)
    previous_provenance = previous.get("provenance", {}).get("current")

    if previous_provenance:
        if previous_provenance.get("homeId") != latest_provenance.get("homeId"):
            raise RuntimeError("复扫 Home Twin homeId 不一致，拒绝关闭历史风险")
        previous_version = previous_provenance.get("homeVersion")
        latest_version = latest_provenance.get("homeVersion")
        if isinstance(previous_version, int) and isinstance(latest_version, int) and latest_version <= previous_version:
            raise RuntimeError("复扫 Home Twin version 未前进，拒绝自动关闭历史风险")
        if previous_provenance.get("riskRuleVersion") != latest_provenance.get("riskRuleVersion"):
            raise RuntimeError("risk rule version 不一致，拒绝自动关闭历史风险")
        if previous_provenance.get("captureId") and latest_provenance.get("captureId") and previous_provenance.get("captureId") == latest_provenance.get("captureId"):
            raise RuntimeError("复扫 captureId 未变化，拒绝把同一批输入当作新复扫")
        if previous_provenance.get("reconstructionId") and latest_provenance.get("reconstructionId") and previous_provenance.get("reconstructionId") == latest_provenance.get("reconstructionId"):
            raise RuntimeError("复扫 reconstructionId 未变化，拒绝把同一轮重建当作新证据")

    merged: list[dict[str, Any]] = []
    for action in previous_actions:
        risk_id = action.get("riskId")
        if risk_id not in current_risks and action.get("status") not in {"completed", "resolved"}:
            action["status"] = "resolved"
            action["resolvedBy"] = "rescan"
            action["resolvedAtProvenance"] = {**latest_provenance, "riskId": risk_id}
        merged.append(action)

    for risk_id, risk in current_risks.items():
        if risk_id not in previous_by_risk:
            action = _action_from_risk(risk)
            action["provenance"] = {**latest_provenance, "riskId": risk_id}
            merged.append(action)

    previous["privacyScope"] = latest_projection["privacyScope"]
    previous["actions"] = merged
    previous["provenance"] = {"current": latest_provenance, "previous": previous_provenance}
    previous["status"] = (
        "open"
        if any(action.get("status") in {"open", "in_progress"} for action in merged)
        else "clear"
    )
    return previous


def apply_rescan_closure(plan: dict[str, Any], latest_projection: dict[str, Any]) -> dict[str, Any]:
    return merge_rescan_plan(plan, latest_projection)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--risk", required=True, type=Path)
    ap.add_argument("--output", required=True, type=Path)
    ap.add_argument("--rescan-risk", type=Path)
    ap.add_argument("--rescan-plan", type=Path)
    args = ap.parse_args()

    projection = json.loads(args.risk.read_text(encoding="utf-8"))
    if args.rescan_plan:
        previous = json.loads(args.rescan_plan.read_text(encoding="utf-8"))
        plan = merge_rescan_plan(previous, projection)
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
