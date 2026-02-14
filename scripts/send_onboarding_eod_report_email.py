#!/usr/bin/env python3
"""
Send the EOD onboarding/graph/news report via email (Resend).

This is intentionally small and stdlib-only so it can run on the VM venv.

Config (env):
  - RESEND_API_KEY (required to send)
  - METRICS_REPORT_EMAIL_TO (comma/semicolon/newline separated; required to send)
  - METRICS_REPORT_EMAIL_FROM (optional; falls back to NEWS_DIGEST_FROM_EMAIL)
  - NEWS_DIGEST_FROM_EMAIL (optional)
  - ONBOARDING_EOD_REPORT_EMAIL_MAX_CHARS (optional; default 50000)
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.request
from typing import Any


def _env(name: str) -> str:
    return (os.environ.get(name) or "").strip()


def _as_int(raw: str, default: int) -> int:
    try:
        v = int(str(raw).strip())
    except Exception:
        return default
    return v


def _parse_email_list(raw: str | None) -> list[str]:
    if not raw:
        return []
    tokens = re.split(r"[,\n;]+", raw)
    recipients: list[str] = []
    for token in tokens:
        email = token.strip()
        if not email:
            continue
        recipients.append(email)
    # Preserve input order but dedupe.
    deduped: list[str] = []
    seen: set[str] = set()
    for email in recipients:
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(email)
    return deduped


def _slack_to_plain_text(text: str) -> str:
    # Keep this intentionally conservative: strip Slack emphasis and rewrite Slack links.
    out = text.replace("`", "").replace("*", "")
    out = re.sub(r"<([^|>]+)\|([^>]+)>", r"\2: \1", out)
    out = re.sub(r"<(https?://[^>]+)>", r"\1", out)
    return out


def _send_email_via_resend(
    *,
    api_key: str,
    from_email: str,
    to_emails: list[str],
    subject: str,
    text_body: str,
) -> None:
    payload: dict[str, Any] = {
        "from": from_email,
        "to": to_emails,
        "subject": subject,
        "text": text_body,
    }
    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json; charset=utf-8",
            "Accept": "application/json",
            "User-Agent": "buildatlas-onboarding-eod-report",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            if resp.status < 200 or resp.status >= 300:
                raise RuntimeError(f"resend returned HTTP {resp.status}")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8", errors="ignore")
        except Exception:
            body = ""
        body = (body or "").strip()
        if len(body) > 200:
            body = body[:200] + "...(truncated)"
        suffix = f": {body}" if body else ""
        raise RuntimeError(f"resend_http_{e.code}{suffix}") from e


def main() -> int:
    parser = argparse.ArgumentParser(description="Send the EOD onboarding report email (Resend).")
    parser.add_argument("--subject", required=True, help="Email subject")
    parser.add_argument("--body", required=True, help="Report body (Slack-ish text)")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Do not send; print what would happen and exit 0.",
    )
    args = parser.parse_args()

    recipients = _parse_email_list(_env("METRICS_REPORT_EMAIL_TO") or None)
    if not recipients:
        print("SKIP: EOD report email: no valid `METRICS_REPORT_EMAIL_TO` recipients parsed.")
        return 0

    resend_api_key = _env("RESEND_API_KEY")
    if not resend_api_key:
        print("SKIP: EOD report email: `RESEND_API_KEY` is not configured.")
        return 0

    from_email = _env("METRICS_REPORT_EMAIL_FROM") or _env("NEWS_DIGEST_FROM_EMAIL") or "Build Atlas <news@buildatlas.net>"
    subject = str(args.subject or "").strip()
    if not subject:
        sys.stderr.write("ERROR: subject is empty\n")
        return 2

    max_chars = _as_int(_env("ONBOARDING_EOD_REPORT_EMAIL_MAX_CHARS") or "50000", 50000)
    max_chars = max(1000, min(max_chars, 200000))

    body_raw = str(args.body or "")
    body_text = _slack_to_plain_text(body_raw).strip() + "\n"
    if len(body_text) > max_chars:
        body_text = body_text[: max_chars - 40].rstrip() + "\n\n... truncated ...\n"

    if args.dry_run:
        print(
            "DRY_RUN: EOD report email: would send "
            f"(recipients={len(recipients)}, from={from_email}, subject={subject!r}, body_chars={len(body_text)})"
        )
        return 0

    _send_email_via_resend(
        api_key=resend_api_key,
        from_email=from_email,
        to_emails=recipients,
        subject=subject,
        text_body=body_text,
    )
    print(f"SENT: EOD report email ({len(recipients)} recipient(s)).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

