from __future__ import annotations

import argparse
import copy
import json
from pathlib import Path
from typing import Any

RISK_RULE_VERSION = 'person-home-risk-v1'


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding='utf-8'))


def validate_projection(risk_projection: dict[str, Any]) -> None:
    if risk_projection.get('schemaVersion') != 1 or risk_projection.get('type') != 'person-home-risk-projection':
        raise RuntimeError('复扫风险投影 schema 无效')
    for key in ('homeId', 'homeVersion', 'riskRuleVersion', 'homeProvenance'):
        if key not in risk_projection:
            raise RuntimeError(f'复扫风险投影缺少 provenance 字段: {key}')
    if risk_projection.get('riskRuleVersion') != RISK_RULE_VERSION:
        raise RuntimeError('risk rule version 不一致或不受支持')

    home_id = risk_projection.get('homeId')
    home_version = risk_projection.get('homeVersion')
    if not isinstance(home_id, str) or not home_id.strip():
        raise RuntimeError('复扫风险投影缺少有效 homeId')
    if not isinstance(home_version, int) or home_version < 1:
        raise RuntimeError('复扫风险投影缺少有效 homeVersion')

    home_provenance = risk_projection['homeProvenance']
    if not isinstance(home_provenance, dict) or home_provenance.get('homeId') != home_id or home_provenance.get('homeVersion') != home_version:
        raise RuntimeError('Home Twin provenance 与 risk projection 不一致')

    # An incremented snapshot version alone is not sufficient evidence of a fresh
    # rescan. Both identities must be present so the action plan can prove that
    # the current risk projection came from a distinct capture + reconstruction.
    for key in ('captureId', 'reconstructionId'):
        value = home_provenance.get(key)
        if not isinstance(value, str) or not value.strip():
            raise RuntimeError(f'Home Twin provenance 缺少有效 {key}，禁止自动关闭历史风险')


def provenance(risk_projection: dict[str, Any]) -> dict[str, Any]:
    home = risk_projection['homeProvenance']
    return {
        'homeId': risk_projection.get('homeId'),
        'homeVersion': risk_projection.get('homeVersion'),
        'riskRuleVersion': risk_projection.get('riskRuleVersion'),
        'projectionAsOf': risk_projection.get('personAsOf'),
        'generatedAt': risk_projection.get('generatedAt'),
        'captureId': home.get('captureId'),
        'reconstructionId': home.get('reconstructionId'),
    }


def action_from_risk(risk: dict[str, Any], source: dict[str, Any] | None = None) -> dict[str, Any]:
    kind = risk.get('kind', 'observation')
    titles = {
        'trip-hazard': ('safety_check', '处理绊倒障碍'),
        'surface-hazard': ('safety_check', '处理地面障碍'),
        'night-route': ('safety_check', '复核夜间通行路线'),
        'functional-context': ('observation', '处理已识别环境障碍'),
        'evidence-limit': ('safety_check', '现场验证候选路线'),
    }
    action_kind, title = titles.get(kind, ('observation', '复核家庭环境'))
    return {
        'id': f"action-{risk['id']}",
        'riskId': risk['id'],
        'kind': action_kind,
        'title': title,
        'description': risk.get('action', '请处理该环境风险后重新扫描。'),
        'status': 'open',
        'requiresRescan': True,
        'closureRule': {'type': 'risk-disappears-after-rescan', 'riskId': risk['id']},
        'provenance': {**(source or {}), 'riskId': risk['id']},
    }


def merge(previous: dict[str, Any], latest_risk: dict[str, Any]) -> dict[str, Any]:
    validate_projection(latest_risk)
    previous_copy = copy.deepcopy(previous)
    latest = {risk['id']: risk for risk in latest_risk.get('risks', [])}
    actions = previous_copy.get('actions', [])
    existing = {action.get('riskId') for action in actions}
    latest_provenance = provenance(latest_risk)
    previous_provenance = previous_copy.get('provenance', {}).get('current')

    if previous_provenance:
        if previous_provenance.get('homeId') != latest_provenance.get('homeId'):
            raise RuntimeError('复扫 Home Twin homeId 不一致，拒绝关闭历史风险')
        previous_version = previous_provenance.get('homeVersion')
        latest_version = latest_provenance.get('homeVersion')
        if not isinstance(previous_version, int) or not isinstance(latest_version, int) or latest_version <= previous_version:
            raise RuntimeError('复扫 Home Twin version 未前进，拒绝自动关闭历史风险')
        if previous_provenance.get('riskRuleVersion') != latest_provenance.get('riskRuleVersion'):
            raise RuntimeError('risk rule version 不一致，拒绝自动关闭历史风险')
        previous_capture = previous_provenance.get('captureId')
        latest_capture = latest_provenance.get('captureId')
        if previous_capture == latest_capture:
            raise RuntimeError('复扫 captureId 未变化，拒绝把同一批输入当作新复扫')
        previous_reconstruction = previous_provenance.get('reconstructionId')
        latest_reconstruction = latest_provenance.get('reconstructionId')
        if previous_reconstruction == latest_reconstruction:
            raise RuntimeError('复扫 reconstructionId 未变化，拒绝把同一轮重建当作新证据')

    for action in actions:
        risk_id = action.get('riskId')
        if (
            risk_id
            and risk_id not in latest
            and action.get('requiresRescan') is True
            and action.get('status') not in {'completed', 'resolved'}
        ):
            action['status'] = 'resolved'
            action['resolvedBy'] = 'rescan'
            action['resolvedAtProvenance'] = {**latest_provenance, 'riskId': risk_id}

    for risk_id, risk in latest.items():
        if risk_id not in existing:
            actions.append(action_from_risk(risk, latest_provenance))

    previous_copy['schemaVersion'] = 1
    previous_copy['type'] = 'person-home-action-plan'
    previous_copy['privacyScope'] = latest_risk.get('privacyScope', previous_copy.get('privacyScope', 'family_ok'))
    previous_copy['actions'] = actions
    previous_copy['provenance'] = {'current': latest_provenance, 'previous': previous_provenance}
    previous_copy['status'] = 'open' if any(a.get('status') != 'resolved' for a in actions) else 'clear'
    return previous_copy


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--previous', required=True, type=Path)
    parser.add_argument('--latest-risk', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()

    result = merge(load(args.previous), load(args.latest_risk))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f"rescan action merge: {result['status']}, actions={len(result['actions'])}")
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
