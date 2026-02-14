#!/usr/bin/env python3
"""
Post a message to a Slack Incoming Webhook.

Design goals:
- No third-party dependencies (uses stdlib only)
- Safe logs (never prints webhook URL)
- Simple Block Kit formatting
"""

from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v


def _status_emoji(status: str) -> str:
    s = (status or "").lower().strip()
    if s in ("failure", "failed", "error"):
        return ":x:"
    if s in ("success", "ok"):
        return ":white_check_mark:"
    if s in ("warning", "warn"):
        return ":warning:"
    return ":information_source:"


def main() -> int:
    # Back-compat: some environments use SLACK_WEBHOOK instead of SLACK_WEBHOOK_URL.
    webhook_url = _env("SLACK_WEBHOOK_URL") or _env("SLACK_WEBHOOK")

    title = _env("SLACK_TITLE", "BuildAtlas Notification") or "BuildAtlas Notification"
    status = _env("SLACK_STATUS", "info") or "info"
    body = _env("SLACK_BODY", "") or ""
    url = _env("SLACK_URL")
    context_json = _env("SLACK_CONTEXT_JSON")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    repo = _env("GITHUB_REPOSITORY")
    run_id = _env("GITHUB_RUN_ID")
    workflow = _env("GITHUB_WORKFLOW")
    ref = _env("GITHUB_REF_NAME") or _env("GITHUB_REF")
    sha = _env("GITHUB_SHA")

    context_bits: list[str] = []
    if repo:
        context_bits.append(f"*Repo:* `{repo}`")
    if workflow:
        context_bits.append(f"*Workflow:* `{workflow}`")
    if ref:
        context_bits.append(f"*Ref:* `{ref}`")
    if sha:
        context_bits.append(f"*SHA:* `{sha[:7]}`")
    if run_id:
        context_bits.append(f"*Run:* `{run_id}`")
    context_bits.append(f"*At:* {now}")

    extra_context_bits: list[str] = []
    if context_json:
        try:
            obj = json.loads(context_json)
            if isinstance(obj, dict):
                for k, v in obj.items():
                    extra_context_bits.append(f"*{k}:* {v}")
        except Exception:
            # Ignore bad context JSON
            pass

    if not webhook_url:
        # Intentionally a no-op to keep scripts functional when Slack isn't configured.
        return 0

    blocks: list[dict] = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"{_status_emoji(status)} {title}", "emoji": True},
        },
    ]

    if body.strip():
        blocks.append({"type": "section", "text": {"type": "mrkdwn", "text": body}})

    if url:
        blocks.append(
            {
                "type": "actions",
                "elements": [
                    {
                        "type": "button",
                        "text": {"type": "plain_text", "text": "Open", "emoji": True},
                        "url": url,
                    }
                ],
            }
        )

    context_line = "  •  ".join(context_bits)
    blocks.append({"type": "context", "elements": [{"type": "mrkdwn", "text": context_line}]})

    if extra_context_bits:
        blocks.append(
            {
                "type": "context",
                "elements": [{"type": "mrkdwn", "text": "  •  ".join(extra_context_bits)}],
            }
        )

    payload = {"blocks": blocks}
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            if resp.status < 200 or resp.status >= 300:
                sys.stderr.write(f"Slack webhook returned HTTP {resp.status}\n")
                return 1
    except Exception as e:
        sys.stderr.write(f"Slack webhook POST failed: {e}\n")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
