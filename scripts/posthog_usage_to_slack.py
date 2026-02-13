#!/usr/bin/env python3
"""
AKS/Vm-friendly ops task: query PostHog (HogQL) for last-24h site usage metrics and post to Slack.

This is intentionally stdlib-only so it can run in a minimal container image.

Required env:
  - SLACK_WEBHOOK_URL
  - POSTHOG_PROJECT_ID
  - POSTHOG_PERSONAL_API_KEY (preferred) OR POSTHOG_API_KEY

Optional env:
  - POSTHOG_HOST (defaults to https://us.i.posthog.com)
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None:
        return default
    v = v.strip()
    return v if v else default


def _as_int(value: Any) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            return int(float(s))
        except ValueError:
            return None
    return None


def _posthog_query(host: str, project_id: str, token: str, hogql: str) -> dict[str, Any]:
    host = host.strip().rstrip("/")
    if not host.startswith("http://") and not host.startswith("https://"):
        host = "https://" + host
    url = f"{host}/api/projects/{project_id}/query/"
    payload = json.dumps({"query": {"kind": "HogQLQuery", "query": hogql}}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": "buildatlas-posthog-usage",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        raise RuntimeError(f"posthog_http_{e.code}:{body[:200]}") from e


def _posthog_scalar(host: str, project_id: str, token: str, hogql: str) -> int:
    data = _posthog_query(host, project_id, token, hogql)
    rows = data.get("results")
    if not isinstance(rows, list) or not rows:
        raise RuntimeError("unexpected PostHog response: missing results")

    first = rows[0]
    raw: Any
    if isinstance(first, list):
        if not first:
            raise RuntimeError("unexpected PostHog response: empty row")
        raw = first[0]
    elif isinstance(first, dict):
        if not first:
            raise RuntimeError("unexpected PostHog response: empty object row")
        raw = next(iter(first.values()))
    else:
        raw = first

    value = _as_int(raw)
    if value is None:
        raise RuntimeError("unexpected PostHog response: non-numeric scalar")
    return value


def _posthog_metrics(host: str, project_id: str, token: str) -> dict[str, Any]:
    metrics: dict[str, Any] = {
        "pageviews": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count() FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
        "unique_visitors": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count(DISTINCT distinct_id) FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
        "sessions_started": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count() FROM events WHERE event = '$session_start' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
        "watchlist_add": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count() FROM events WHERE event = 'watchlist_add' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
        "subscription_submit": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count() FROM events WHERE event = 'subscription_submit' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
        "subscription_submit_success": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count() FROM events WHERE event = 'subscription_submit_success' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
        "subscription_submit_error": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count() FROM events WHERE event = 'subscription_submit_error' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
        "subscription_confirmed": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count() FROM events WHERE event = 'subscription_confirmed' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
        "subscription_unsubscribed": _posthog_scalar(
            host,
            project_id,
            token,
            "SELECT count() FROM events WHERE event = 'subscription_unsubscribed' AND timestamp >= now() - INTERVAL 1 DAY",
        ),
    }
    submit = _as_int(metrics.get("subscription_submit")) or 0
    submit_success = _as_int(metrics.get("subscription_submit_success")) or 0
    if submit > 0:
        metrics["subscription_submit_success_rate"] = round((submit_success / submit) * 100, 1)
    return metrics


def _slack_post(webhook_url: str, payload: dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status < 200 or resp.status >= 300:
                raise RuntimeError(f"Slack webhook returned HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        raise RuntimeError(f"slack_http_{e.code}:{body[:200]}") from e


def main() -> int:
    slack_webhook_url = _env("SLACK_WEBHOOK_URL")
    posthog_host = _env("POSTHOG_HOST") or "https://us.i.posthog.com"
    posthog_project_id = _env("POSTHOG_PROJECT_ID")
    posthog_api_key = _env("POSTHOG_PERSONAL_API_KEY") or _env("POSTHOG_API_KEY")

    missing = []
    if not slack_webhook_url:
        missing.append("SLACK_WEBHOOK_URL")
    if not posthog_project_id:
        missing.append("POSTHOG_PROJECT_ID")
    if not posthog_api_key:
        missing.append("POSTHOG_PERSONAL_API_KEY (or POSTHOG_API_KEY)")

    if missing:
        sys.stderr.write("Missing required env: " + ", ".join(missing) + "\n")
        return 2

    since = datetime.now(timezone.utc) - timedelta(days=1)
    metrics = _posthog_metrics(posthog_host, posthog_project_id, posthog_api_key)

    body_lines = []
    body_lines.append(f"*Window:* last 24 hours (since {since.strftime('%Y-%m-%d %H:%M UTC')})")
    body_lines.append(
        "- pageviews="
        f"{metrics.get('pageviews')} "
        "unique_visitors="
        f"{metrics.get('unique_visitors')} "
        "sessions_started="
        f"{metrics.get('sessions_started')} "
        "watchlist_add="
        f"{metrics.get('watchlist_add')}"
    )

    conv_suffix = ""
    if "subscription_submit_success_rate" in metrics:
        conv_suffix = f" success_rate={metrics.get('subscription_submit_success_rate')}%"
    body_lines.append(
        "- subscriptions: "
        f"submit={metrics.get('subscription_submit')} "
        f"submit_success={metrics.get('subscription_submit_success')} "
        f"submit_error={metrics.get('subscription_submit_error')} "
        f"confirmed={metrics.get('subscription_confirmed')} "
        f"unsubscribed={metrics.get('subscription_unsubscribed')}{conv_suffix}"
    )

    # Also emit to logs for kubectl visibility (no secrets).
    sys.stdout.write("\n".join(body_lines) + "\n")

    now_utc = datetime.now(timezone.utc)
    payload = {
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": "BuildAtlas Site Usage (PostHog)"}},
            {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(body_lines)}},
            {
                "type": "context",
                "elements": [{"type": "mrkdwn", "text": f"*At:* {now_utc.strftime('%Y-%m-%d %H:%M UTC')}"}],
            },
        ]
    }
    _slack_post(slack_webhook_url, payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
