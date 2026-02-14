#!/usr/bin/env python3
"""
Post a message to a Slack Incoming Webhook.

Design goals:
- No third-party dependencies (uses stdlib only)
- Safe logs (never prints webhook URL)
- Simple Block Kit formatting

Fallback:
- If no webhook is configured and we have GitHub credentials (repo + token),
  we can forward via `repository_dispatch` to a GitHub Actions workflow that posts to Slack.
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


def _github_repository_dispatch(
    *,
    repo: str,
    token: str,
    event_type: str,
    client_payload: dict,
) -> int:
    """
    Trigger a repository_dispatch event.

    Used as a fallback when running on the VM without a Slack webhook configured locally.
    """
    url = f"https://api.github.com/repos/{repo}/dispatches"
    data = json.dumps({"event_type": event_type, "client_payload": client_payload}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "buildatlas-slack-notify",
            "Content-Type": "application/json; charset=utf-8",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            # GitHub returns 204 No Content on success.
            if resp.status not in (200, 201, 202, 204):
                sys.stderr.write(f"GitHub dispatch returned HTTP {resp.status}\n")
                return 1
    except Exception as e:
        sys.stderr.write(f"GitHub dispatch failed: {e}\n")
        return 1

    return 0


def main() -> int:
    # Back-compat: some environments use SLACK_WEBHOOK instead of SLACK_WEBHOOK_URL.
    webhook_url = _env("SLACK_WEBHOOK_URL") or _env("SLACK_WEBHOOK")
    github_repo = _env("GITHUB_REPOSITORY")
    github_token = _env("GITHUB_TOKEN")

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
        # Only attempt dispatch when we're not already inside GitHub Actions.
        # This avoids recursive loops if Slack is misconfigured in CI.
        if (os.environ.get("GITHUB_ACTIONS") or "").lower().strip() == "true":
            return 0

        runner = _env("BUILDATLAS_RUNNER") or ""
        if runner != "vm-cron":
            return 0

        if github_repo and github_token:
            host = _env("BUILDATLAS_HOST") or _env("HOSTNAME") or ""
            job = _env("BUILDATLAS_JOB") or ""
            log_path = _env("BUILDATLAS_LOG") or ""

            try:
                context_obj = json.loads(context_json) if context_json else {}
            except Exception:
                context_obj = {}
            if not isinstance(context_obj, dict):
                context_obj = {}

            payload = {
                "title": title,
                "status": status,
                "body": body,
                "url": url or "",
                "context": {
                    "runner": runner,
                    "job": job,
                    "host": host,
                    "log": log_path,
                    **context_obj,
                },
            }

            return _github_repository_dispatch(
                repo=github_repo,
                token=github_token,
                event_type="vm-cron-slack-notify",
                client_payload=payload,
            )

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
