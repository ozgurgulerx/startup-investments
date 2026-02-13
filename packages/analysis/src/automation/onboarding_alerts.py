"""Dispatch onboarding/deep-research trace alerts to Slack."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlencode

from .db import DatabaseConnection
from .onboarding_trace import guidance_for_reason

logger = logging.getLogger(__name__)


def _env_bool(name: str, default: bool) -> bool:
    raw = str(os.getenv(name, "") or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _slack_notify_script() -> Path:
    return _repo_root() / "scripts" / "slack_notify.py"


def _slack_status(trace_status: str, severity: str) -> str:
    status = (trace_status or "").lower().strip()
    sev = (severity or "").lower().strip()
    if status == "success":
        return "success"
    if status == "failure":
        return "failure" if sev == "critical" else "warning"
    if status == "warning":
        return "warning"
    return "info"


def _context_template_url(base_url: str, startup_id: Optional[str], trace_event_id: str) -> str:
    base = (base_url or "https://buildatlas.net").rstrip("/")
    params = {"traceEventId": trace_event_id}
    if startup_id:
        params["startupId"] = startup_id
    return f"{base}/api/v1/onboarding/context-template?{urlencode(params)}"


def _build_body(event: Dict[str, Any], context_url: str) -> str:
    startup_name = str(event.get("startup_name") or "Unknown startup")
    startup_id = str(event.get("startup_id") or "n/a")
    stage = str(event.get("stage") or "unknown")
    reason_code = str(event.get("reason_code") or "")
    message = str(event.get("message") or "").strip()
    region = str(event.get("startup_region") or (event.get("payload_json") or {}).get("region") or "global")
    guidance = guidance_for_reason(reason_code) if reason_code else "Review trace payload for details."

    lines = [
        f"*Startup:* {startup_name}",
        f"*Startup ID:* `{startup_id}`",
        f"*Stage:* `{stage}`",
        f"*Region:* `{region}`",
    ]
    if reason_code:
        lines.append(f"*Reason:* `{reason_code}`")
    if message:
        lines.append(f"*Message:* {message[:500]}")
    lines.extend(
        [
            "",
            "*Action needed:*",
            f"- {guidance}",
            "- Add context and requeue using the template endpoint below.",
            f"- Context helper: {context_url}",
        ]
    )
    return "\n".join(lines)


def _send_slack_notification(event: Dict[str, Any], *, base_url: str) -> bool:
    script_path = _slack_notify_script()
    if not script_path.exists():
        logger.error("slack_notify.py not found at %s", script_path)
        return False

    trace_id = str(event.get("id") or "")
    startup_name = str(event.get("startup_name") or "startup")
    stage = str(event.get("stage") or "trace")
    status = _slack_status(str(event.get("status") or ""), str(event.get("severity") or ""))
    context_url = _context_template_url(base_url, event.get("startup_id"), trace_id)
    title = f"Onboarding trace: {stage} ({startup_name})"
    body = _build_body(event, context_url)

    context_json = json.dumps(
        {
            "event_type": "onboarding_trace",
            "trace_event_id": trace_id,
            "startup_id": event.get("startup_id"),
            "queue_item_id": event.get("queue_item_id"),
            "trace_type": event.get("trace_type"),
            "stage": stage,
            "reason_code": event.get("reason_code"),
        },
        ensure_ascii=True,
    )

    env = os.environ.copy()
    env["SLACK_TITLE"] = title
    env["SLACK_STATUS"] = status
    env["SLACK_BODY"] = body
    env["SLACK_URL"] = context_url
    env["SLACK_CONTEXT_JSON"] = context_json

    try:
        completed = subprocess.run(
            [sys.executable, str(script_path)],
            env=env,
            capture_output=True,
            text=True,
            timeout=25,
            check=False,
        )
    except Exception:
        logger.exception("Slack notify subprocess failed for trace %s", trace_id)
        return False

    if completed.returncode != 0:
        logger.error(
            "Slack notify failed for trace %s (code=%s, stderr=%s)",
            trace_id,
            completed.returncode,
            (completed.stderr or "").strip()[:600],
        )
        return False
    return True


async def run_onboarding_alert_dispatcher(batch_size: int = 25) -> Dict[str, int]:
    """Send pending onboarding trace notifications to Slack."""
    if not _env_bool("ONBOARDING_ALERTS_ENABLED", True):
        return {"fetched": 0, "sent": 0, "failed": 0, "marked_notified": 0}

    db = DatabaseConnection()
    fetched = 0
    sent = 0
    failed = 0
    marked = 0
    sent_ids: List[str] = []
    base_url = str(os.getenv("PUBLIC_BASE_URL") or "https://buildatlas.net")

    try:
        await db.connect()
        events = await db.get_pending_onboarding_trace_notifications(limit=max(1, int(batch_size)))
        fetched = len(events)
        if not events:
            return {"fetched": fetched, "sent": sent, "failed": failed, "marked_notified": marked}

        for event in events:
            ok = _send_slack_notification(event, base_url=base_url)
            if ok:
                sent += 1
                if event.get("id"):
                    sent_ids.append(str(event["id"]))
            else:
                failed += 1

        if sent_ids:
            marked = await db.mark_onboarding_trace_events_notified(sent_ids)

        return {"fetched": fetched, "sent": sent, "failed": failed, "marked_notified": marked}
    finally:
        await db.close()


def run_dispatcher_sync(batch_size: int = 25) -> Dict[str, int]:
    return asyncio.run(run_onboarding_alert_dispatcher(batch_size=batch_size))
