#!/usr/bin/env python3
"""CLI access to the shared pipeline runtime state store."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "packages" / "analysis"))

from src.runtime.job_state import RuntimeStateStore  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description="Read/write shared pipeline runtime state")
    subparsers = parser.add_subparsers(dest="command", required=True)

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--job", required=True, help="Logical job name")
    common.add_argument("--scope", default="global", help="State scope (default: global)")
    common.add_argument("--state-key", default="default", help="State key (default: default)")

    get_parser = subparsers.add_parser("get", parents=[common])
    get_parser.add_argument("--field", default="", help="Optional top-level field to print")
    get_parser.add_argument("--default", default="", help="Default scalar/string when state or field is missing")

    set_parser = subparsers.add_parser("set", parents=[common])
    set_parser.add_argument("--json", default="", help="Inline JSON payload")
    set_parser.add_argument("--field", default="", help="Set a single top-level field")
    set_parser.add_argument("--value", default="", help="Value for --field")

    subparsers.add_parser("delete", parents=[common])

    args = parser.parse_args()
    store = RuntimeStateStore()

    if args.command == "get":
        state = store.load(args.job, scope=args.scope, state_key=args.state_key) or {}
        if args.field:
            value = state.get(args.field, args.default)
            if isinstance(value, (dict, list)):
                print(json.dumps(value, ensure_ascii=True))
            else:
                print("" if value is None else value)
            return 0
        if not state:
            if args.default:
                print(args.default)
            return 0
        print(json.dumps(state, ensure_ascii=True))
        return 0

    if args.command == "set":
        if args.field:
            state = store.load(args.job, scope=args.scope, state_key=args.state_key) or {}
            state[args.field] = args.value
        else:
            raw_json = args.json.strip() or sys.stdin.read().strip() or "{}"
            state = json.loads(raw_json)
            if not isinstance(state, dict):
                raise SystemExit("State payload must be a JSON object")
        store.save(args.job, state, scope=args.scope, state_key=args.state_key)
        return 0

    store.delete(args.job, scope=args.scope, state_key=args.state_key)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
