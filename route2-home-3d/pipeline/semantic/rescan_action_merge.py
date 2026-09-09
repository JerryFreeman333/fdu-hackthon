from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding='utf-8'))


def action_from_risk(risk: dict[str, Any]) -> dict[str, Any]:
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
    }


def merge(previous: dict[str, Any], latest_risk: dict[str, Any]) -> dict[str, Any]:
    if latest_risk.get('schemaVersion') != 1 or latest_risk.get('type') != 'person-home-risk-projection':
        raise RuntimeError('复扫风险投影 schema 无效')
    latest = {risk['id']: risk for risk in latest_risk.get('risks', [])}
    actions = [dict(action) for action in previous.get('actions', [])]
    existing = {action.get('riskId') for action in actions}

    for action in actions:
        risk_id = action.get('riskId')
        if (
            risk_id
            and risk_id not in latest
            and action.get('requiresRescan') is True
            and action.get('status') != 'resolved'
        ):
            action['status'] = 'resolved'
            action['resolvedBy'] = 'rescan'

    for risk_id, risk in latest.items():
        if risk_id not in existing:
            actions.append(action_from_risk(risk))

    result = dict(previous)
    result['schemaVersion'] = 1
    result['type'] = 'person-home-action-plan'
    result['privacyScope'] = latest_risk.get('privacyScope', previous.get('privacyScope', 'family_ok'))
    result['actions'] = actions
    result['status'] = 'open' if any(a.get('status') != 'resolved' for a in actions) else 'clear'
    return result


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
