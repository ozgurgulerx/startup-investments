#!/usr/bin/env python3
"""
Query PostHog for recent client-side exception volume and alert Slack on spikes.

Design goals:
- stdlib-only (AKS/Vm friendly)
- safe logs (never prints secrets)
- low-noise: posts only when thresholds are exceeded
- best-effort: PostHog slowness should not page us via failed Kubernetes Jobs

Required env:
  - SLACK_WEBHOOK_URL
  - POSTHOG_PROJECT_ID
  - POSTHOG_PERSONAL_API_KEY (preferred) OR POSTHOG_API_KEY

Optional env:
  - POSTHOG_HOST (defaults to https://us.i.posthog.com)
  - ALERT_WINDOW_MINUTES (default: 30)
  - TOTAL_EXCEPTION_THRESHOLD (default: 25)
  - LANDSCAPES_EXCEPTION_THRESHOLD (default: 3)
  - BASE_URL_FILTER (default: empty; if set, only count exceptions whose $current_url contains this string)
  - POSTHOG_TIMEOUT_SEC (default: 20; per-request timeout for PostHog queries)
  - POSTHOG_RETRIES (default: 1; retries for retryable PostHog errors)
"""

from __future__ import annotations

import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable


class _PostHogHTTPError(RuntimeError):
    def __init__(self, code: int, body: str) -> None:
        self.code = code
        self.body = (body or "")[:200]
        super().__init__(f"posthog_http_{code}:{self.body}")


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None:
        return default
    v = v.strip()
    return v if v else default


def _truncate(s: str, limit: int) -> str:
    s = s or ""
    if len(s) <= limit:
        return s
    return s[: max(0, limit - 3)] + "..."


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


def _as_str(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    try:
        return str(value)
    except Exception:
        return ""


def _clamp_int(raw: str | None, default: int, *, lo: int, hi: int) -> int:
    if raw is None:
        return default
    try:
        v = int(float(raw.strip()))
    except Exception:
        return default
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def _sleep_backoff(attempt: int) -> None:
    # Small exponential backoff (attempt is 1-based) with jitter.
    base = min(8.0, 0.5 * (2 ** max(0, attempt - 1)))
    time.sleep(base + random.random() * 0.25)


def _should_retry_http(code: int) -> bool:
    return code in (408, 429, 500, 502, 503, 504)


def _is_retryable_posthog_error(err: BaseException) -> bool:
    if isinstance(err, TimeoutError):
        return True
    if isinstance(err, json.JSONDecodeError):
        return True
    if isinstance(err, urllib.error.URLError):
        reason = getattr(err, "reason", None)
        if isinstance(reason, TimeoutError):
            return True
        msg = (_as_str(reason) or _as_str(err)).lower()
        if "timed out" in msg or "timeout" in msg or "connection reset" in msg:
            return True
        return False
    if isinstance(err, _PostHogHTTPError):
        return err.code == 429 or 500 <= err.code <= 599
    return False


def _posthog_query_once(
    host: str,
    project_id: str,
    token: str,
    hogql: str,
    *,
    timeout_sec: int,
) -> dict[str, Any]:
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
            "User-Agent": "buildatlas-posthog-exceptions",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            return json.loads(body)
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        raise _PostHogHTTPError(e.code, body) from e


def _posthog_query(
    host: str,
    project_id: str,
    token: str,
    hogql: str,
    *,
    timeout_sec: int,
    retries: int,
) -> dict[str, Any]:
    attempts = max(1, retries + 1)
    last_exc: BaseException | None = None
    for attempt in range(1, attempts + 1):
        try:
            return _posthog_query_once(
                host,
                project_id,
                token,
                hogql,
                timeout_sec=timeout_sec,
            )
        except BaseException as e:
            last_exc = e
            if attempt >= attempts or not _is_retryable_posthog_error(e):
                raise
            _sleep_backoff(attempt)
            continue

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("posthog_request_failed")


def _posthog_rows(
    host: str,
    project_id: str,
    token: str,
    hogql: str,
    *,
    timeout_sec: int,
    retries: int,
) -> list[Any]:
    data = _posthog_query(host, project_id, token, hogql, timeout_sec=timeout_sec, retries=retries)
    rows = data.get("results")
    if not isinstance(rows, list):
        raise RuntimeError("unexpected PostHog response: missing results")
    return rows


def _posthog_scalar(
    host: str,
    project_id: str,
    token: str,
    hogql: str,
    *,
    timeout_sec: int,
    retries: int,
) -> int:
    rows = _posthog_rows(host, project_id, token, hogql, timeout_sec=timeout_sec, retries=retries)
    if not rows:
        raise RuntimeError("unexpected PostHog response: empty results")
    first = rows[0]
    raw: Any
    if isinstance(first, list):
        raw = first[0] if first else None
    elif isinstance(first, dict):
        raw = next(iter(first.values())) if first else None
    else:
        raw = first
    v = _as_int(raw)
    if v is None:
        raise RuntimeError("unexpected PostHog response: non-numeric scalar")
    return v


def _pairs_from_rows(rows: Iterable[Any]) -> list[tuple[str, int]]:
    out: list[tuple[str, int]] = []
    for r in rows:
        if isinstance(r, list) and len(r) >= 2:
            k = _as_str(r[0]).strip()
            v = _as_int(r[1]) or 0
        elif isinstance(r, dict) and r:
            # Pick first two values deterministically.
            items = list(r.items())
            k = _as_str(items[0][1]).strip()
            v = _as_int(items[1][1]) if len(items) > 1 else None
            v = v or 0
        else:
            continue
        if not k:
            k = "<empty>"
        out.append((k, v))
    return out


def _slack_post(webhook_url: str, payload: dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )

    last_exc: Exception | None = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                if resp.status < 200 or resp.status >= 300:
                    raise RuntimeError(f"Slack webhook returned HTTP {resp.status}")
                return
        except urllib.error.HTTPError as e:
            body = ""
            try:
                body = e.read().decode("utf-8", errors="ignore")
            except Exception:
                body = ""
            if _should_retry_http(int(getattr(e, "code", 0) or 0)) and attempt < 3:
                last_exc = RuntimeError(f"slack_http_{e.code}:{body[:200]}")
                _sleep_backoff(attempt)
                continue
            raise RuntimeError(f"slack_http_{e.code}:{body[:200]}") from e
        except (TimeoutError, urllib.error.URLError, ConnectionError, OSError) as e:
            last_exc = e if isinstance(e, Exception) else Exception(str(e))
            if attempt < 3:
                _sleep_backoff(attempt)
                continue
            raise

    if last_exc is not None:
        raise last_exc
    raise RuntimeError("slack_post_failed")


def _hogql_url_filter(base_url_filter: str | None) -> str:
    """
    Return an additional HogQL predicate (with leading AND) to limit exceptions by URL substring.
    """
    if not base_url_filter:
        return ""
    # Minimal escaping for a LIKE string literal.
    needle = base_url_filter.replace("\\", "\\\\").replace("'", "\\'")
    return f" AND lower(toString(properties.$current_url)) LIKE lower('%{needle}%')"


def main() -> int:
    slack_webhook_url = _env("SLACK_WEBHOOK_URL")
    posthog_host = _env("POSTHOG_HOST") or "https://us.i.posthog.com"
    posthog_project_id = _env("POSTHOG_PROJECT_ID")
    posthog_api_key = _env("POSTHOG_PERSONAL_API_KEY") or _env("POSTHOG_API_KEY")

    window_min = _clamp_int(_env("ALERT_WINDOW_MINUTES"), 30, lo=5, hi=240)
    total_threshold = _clamp_int(_env("TOTAL_EXCEPTION_THRESHOLD"), 25, lo=1, hi=10_000)
    landscapes_threshold = _clamp_int(_env("LANDSCAPES_EXCEPTION_THRESHOLD"), 3, lo=1, hi=10_000)
    base_url_filter = _env("BASE_URL_FILTER")
    posthog_timeout_sec = _clamp_int(_env("POSTHOG_TIMEOUT_SEC"), 20, lo=5, hi=120)
    posthog_retries = _clamp_int(_env("POSTHOG_RETRIES"), 1, lo=0, hi=5)

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

    url_pred = _hogql_url_filter(base_url_filter)
    window_expr = f"now() - INTERVAL {window_min} MINUTE"

    try:
        total = _posthog_scalar(
            posthog_host,
            posthog_project_id,
            posthog_api_key,
            "SELECT count() FROM events "
            "WHERE event = '$exception' "
            f"AND timestamp >= {window_expr}"
            f"{url_pred}",
            timeout_sec=posthog_timeout_sec,
            retries=posthog_retries,
        )

        landscapes = _posthog_scalar(
            posthog_host,
            posthog_project_id,
            posthog_api_key,
            "SELECT count() FROM events "
            "WHERE event = '$exception' "
            f"AND timestamp >= {window_expr}"
            " AND lower(toString(properties.$current_url)) LIKE '%/landscapes%'"
            f"{url_pred}",
            timeout_sec=posthog_timeout_sec,
            retries=posthog_retries,
        )
    except BaseException as e:
        # Best-effort telemetry: PostHog flakiness shouldn't page us via failed jobs.
        sys.stdout.write(
            "posthog_warn=1 reason="
            f"{e.__class__.__name__}:{_truncate(_as_str(e), 240)}\n"
        )
        return 0

    since = datetime.now(timezone.utc) - timedelta(minutes=window_min)
    now_utc = datetime.now(timezone.utc)

    # Always emit to logs for kubectl visibility.
    sys.stdout.write(
        f"window_min={window_min} total_exceptions={total} landscapes_exceptions={landscapes} "
        f"thresholds(total={total_threshold}, landscapes={landscapes_threshold})\n"
    )

    should_alert = total >= total_threshold or landscapes >= landscapes_threshold
    if not should_alert:
        return 0

    # Detail queries are best-effort: include them when possible, but never fail the job if PostHog is slow.
    top_messages: list[tuple[str, int]] = []
    top_land_messages: list[tuple[str, int]] = []
    top_land_urls: list[tuple[str, int]] = []

    try:
        top_messages_rows = _posthog_rows(
            posthog_host,
            posthog_project_id,
            posthog_api_key,
            "SELECT toString(properties.$exception_message) AS msg, count() AS c "
            "FROM events "
            "WHERE event = '$exception' "
            f"AND timestamp >= {window_expr}"
            f"{url_pred} "
            "GROUP BY msg "
            "ORDER BY c DESC "
            "LIMIT 5",
            timeout_sec=posthog_timeout_sec,
            retries=posthog_retries,
        )
        top_messages = _pairs_from_rows(top_messages_rows)
    except BaseException:
        top_messages = []

    try:
        top_land_messages_rows = _posthog_rows(
            posthog_host,
            posthog_project_id,
            posthog_api_key,
            "SELECT toString(properties.$exception_message) AS msg, count() AS c "
            "FROM events "
            "WHERE event = '$exception' "
            f"AND timestamp >= {window_expr} "
            "AND lower(toString(properties.$current_url)) LIKE '%/landscapes%'"
            f"{url_pred} "
            "GROUP BY msg "
            "ORDER BY c DESC "
            "LIMIT 5",
            timeout_sec=posthog_timeout_sec,
            retries=posthog_retries,
        )
        top_land_messages = _pairs_from_rows(top_land_messages_rows)
    except BaseException:
        top_land_messages = []

    try:
        top_land_urls_rows = _posthog_rows(
            posthog_host,
            posthog_project_id,
            posthog_api_key,
            "SELECT toString(properties.$current_url) AS url, count() AS c "
            "FROM events "
            "WHERE event = '$exception' "
            f"AND timestamp >= {window_expr} "
            "AND lower(toString(properties.$current_url)) LIKE '%/landscapes%'"
            f"{url_pred} "
            "GROUP BY url "
            "ORDER BY c DESC "
            "LIMIT 5",
            timeout_sec=posthog_timeout_sec,
            retries=posthog_retries,
        )
        top_land_urls = _pairs_from_rows(top_land_urls_rows)
    except BaseException:
        top_land_urls = []

    lines: list[str] = []
    lines.append(f"*Window:* last {window_min} minutes (since {since.strftime('%Y-%m-%d %H:%M UTC')})")
    if base_url_filter:
        lines.append(f"*URL filter:* `{base_url_filter}`")
    lines.append(f"- total `$exception`: *{total}* (threshold {total_threshold})")
    lines.append(f"- `/landscapes` `$exception`: *{landscapes}* (threshold {landscapes_threshold})")

    if top_land_messages:
        lines.append("")
        lines.append("*Top /landscapes exceptions:*")
        for msg, c in top_land_messages:
            lines.append(f"- `{c}` {msg[:160]}")

    if top_land_urls:
        lines.append("")
        lines.append("*Top /landscapes URLs:*")
        for url, c in top_land_urls:
            lines.append(f"- `{c}` {url[:220]}")

    if top_messages:
        lines.append("")
        lines.append("*Top exceptions (overall):*")
        for msg, c in top_messages:
            lines.append(f"- `{c}` {msg[:160]}")

    payload = {
        "blocks": [
            {"type": "header", "text": {"type": "plain_text", "text": "BuildAtlas Client Exceptions (PostHog)"}},
            {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(lines)[:2900]}},
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

