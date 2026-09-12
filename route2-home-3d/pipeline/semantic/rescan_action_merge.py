from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from person_home_action_plan import merge_rescan_plan


def load(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding='utf-8'))


def merge(previous: dict[str, Any], latest_risk: dict[str, Any]) -> dict[str, Any]:
    """Both CLI entrypoints enforce the same closure and provenance contract."""
    return merge_rescan_plan(previous, latest_risk)


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
