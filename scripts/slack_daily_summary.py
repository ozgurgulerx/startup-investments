#!/usr/bin/env python3
"""
Daily Slack summary for BuildAtlas.

Includes:
- Recent workflow run outcomes (GitHub Actions API — CI/CD workflows only)
- VM cron job health (when running on VM, parses /var/log/buildatlas/ logs)
- Core product metrics from Postgres (news editions, ingestion runs, digest deliveries, LLM enrichment coverage)
- Subscription lifecycle + segment metrics (region / digest frequency / newly confirmed emails)
- Optional site usage metrics from PostHog (when server API credentials are configured)

No third-party deps for HTTP (stdlib); uses asyncpg for DB (already in analysis requirements).

Supports two contexts:
- GitHub Actions: checks all workflows (original behavior)
- VM cron (BUILDATLAS_RUNNER=vm-cron): checks only CI/CD workflows + parses cron logs
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import urllib.parse
import urllib.request
import urllib.error
import re
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


try:
    import asyncpg  # type: ignore
except Exception as e:  # pragma: no cover
    asyncpg = None
    _asyncpg_import_error = e


# CI/CD workflows that remain on GitHub Actions
CICD_WORKFLOWS = [
    "backend-deploy.yml",
    "frontend-deploy.yml",
    "functions-deploy.yml",
    "sync-to-database.yml",
]

# Legacy: all workflows (when running inside GitHub Actions)
ALL_WORKFLOWS = CICD_WORKFLOWS + [
    "news-ingest.yml",
    "news-digest-daily.yml",
    "sync-data.yml",
    "crawl-frontier.yml",
    "keep-aks-running.yml",
    "keep-aks-alive.yml",
]

# Cron jobs that run on the VM and their expected max interval (minutes)
VM_CRON_JOBS = {
    "keep-alive": 20,
    "news-ingest": 75,
    "x-trends": 90,
    "event-processor": 30,
    "deep-research": 45,
    "onboarding-alerts": 20,
    "crawl-frontier": 45,
    "news-digest": 1500,     # daily
    "x-post-generate": 300,
    "x-post-publish": 180,
    "x-post-metrics": 420,
    "slack-summary": 1500,   # daily (this script itself)
    "release-reconciler": 20,
    "sync-data": 45,
    "code-update": 400,      # every 6h
}

_IS_VM = bool(os.environ.get("BUILDATLAS_RUNNER") == "vm-cron")
BACKEND_ACTIVITY_WINDOW_HOURS = 3

# Select workflow list based on context
WORKFLOWS = CICD_WORKFLOWS if _IS_VM else ALL_WORKFLOWS


class GitHubApiAuthError(Exception):
    pass


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v


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


def _as_bool(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        s = value.strip().lower()
        return s in ("1", "true", "yes", "y", "on")
    return False


def _mask_email(email: str) -> str:
    e = (email or "").strip()
    if "@" not in e:
        return (e[:2] + "***") if e else ""
    local, domain = e.split("@", 1)
    if len(local) <= 1:
        masked_local = "*"
    elif len(local) == 2:
        masked_local = local[0] + "*"
    else:
        masked_local = local[:2] + ("*" * (len(local) - 2))
    return f"{masked_local}@{domain}"


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
            "User-Agent": "buildatlas-slack-summary",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        body = resp.read().decode("utf-8")
        return json.loads(body)


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
    metrics = {
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


def _github_api_get(url: str, token: str) -> dict[str, Any]:
    req = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "buildatlas-slack-summary",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            payload = resp.read().decode("utf-8")
            return json.loads(payload)
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            raise GitHubApiAuthError(f"HTTP {e.code}") from e
        raise


@dataclass
class WorkflowRunSummary:
    workflow: str
    status: str
    conclusion: str | None
    created_at: str
    html_url: str


def _parse_iso(ts: str) -> datetime:
    # GitHub returns ISO8601 like 2026-02-07T08:10:26Z
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return datetime.fromisoformat(ts)


def _fmt_dt(ts: str) -> str:
    try:
        d = _parse_iso(ts)
        return d.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return ts


def _days_ago(hours: int = 24) -> datetime:
    return datetime.now(timezone.utc) - timedelta(hours=hours)


def _workflow_runs(repo: str, token: str, since: datetime) -> list[WorkflowRunSummary]:
    owner, name = repo.split("/", 1)
    results: list[WorkflowRunSummary] = []
    for wf in WORKFLOWS:
        url = f"https://api.github.com/repos/{owner}/{name}/actions/workflows/{urllib.parse.quote(wf)}/runs?per_page=10"
        try:
            data = _github_api_get(url, token)
        except GitHubApiAuthError:
            # Global auth failure: caller should report CI status unavailable once.
            raise
        except Exception as e:
            results.append(
                WorkflowRunSummary(
                    workflow=wf,
                    status="error",
                    conclusion=str(e),
                    created_at=datetime.now(timezone.utc).isoformat(),
                    html_url="",
                )
            )
            continue

        runs = data.get("workflow_runs") or []
        # find the most recent run within window; if none, keep latest as context
        chosen = None
        for r in runs:
            created_at = r.get("created_at") or ""
            if created_at and _parse_iso(created_at) >= since:
                chosen = r
                break
        if chosen is None and runs:
            chosen = runs[0]
        if chosen:
            results.append(
                WorkflowRunSummary(
                    workflow=wf,
                    status=chosen.get("status") or "",
                    conclusion=chosen.get("conclusion"),
                    created_at=chosen.get("created_at") or "",
                    html_url=chosen.get("html_url") or "",
                )
            )
    return results


@dataclass
class CronJobHealth:
    name: str
    last_status: str  # "SUCCESS", "FAILED", "TIMEOUT", "SKIP", "UNKNOWN"
    last_run: datetime | None
    minutes_since: int | None
    overdue: bool


def _cron_job_health(log_dir: str = "/var/log/buildatlas") -> list[CronJobHealth]:
    """Parse VM cron job logs to determine health of each job."""
    results: list[CronJobHealth] = []
    now = datetime.now(timezone.utc)
    log_path = Path(log_dir)

    for job_name, max_interval_min in VM_CRON_JOBS.items():
        log_file = log_path / f"{job_name}.log"
        if not log_file.exists():
            results.append(CronJobHealth(job_name, "UNKNOWN", None, None, False))
            continue

        last_status = "UNKNOWN"
        last_run: datetime | None = None

        try:
            # Read last 200 lines (efficient enough for daily summary)
            lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()[-200:]
            # Scan from bottom for most recent status line
            for line in reversed(lines):
                m = re.match(
                    r"\[(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) UTC\] (SUCCESS|FAILED|TIMEOUT|SKIP):",
                    line,
                )
                if m:
                    ts_str, status = m.group(1), m.group(2)
                    last_run = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
                    last_status = status
                    break
        except Exception:
            pass

        minutes_since = int((now - last_run).total_seconds() / 60) if last_run else None
        overdue = (minutes_since is not None and minutes_since > max_interval_min * 2)

        results.append(CronJobHealth(job_name, last_status, last_run, minutes_since, overdue))

    return results


async def _db_metrics(database_url: str) -> dict[str, Any]:
    if asyncpg is None:
        raise RuntimeError(f"asyncpg import failed: {_asyncpg_import_error}")

    conn = await asyncpg.connect(database_url)
    try:
        metrics: dict[str, Any] = {}
        warnings: list[str] = []

        latest_edition = await conn.fetchrow(
            """
            SELECT edition_date, generated_at, status
            FROM news_daily_editions
            ORDER BY edition_date DESC
            LIMIT 1
            """
        )
        if latest_edition:
            metrics["latest_edition_date"] = str(latest_edition["edition_date"])
            metrics["latest_edition_generated_at"] = latest_edition["generated_at"].isoformat()
            metrics["latest_edition_status"] = latest_edition["status"]

            edition_date = latest_edition["edition_date"]
            cluster_counts = await conn.fetchrow(
                """
                SELECT
                  (SELECT COUNT(*) FROM news_topic_index WHERE edition_date = $1) AS topic_index_rows,
                  (SELECT COUNT(*) FROM news_clusters WHERE published_at::date = $1) AS clusters_published_that_day
                """,
                edition_date,
            )
            if cluster_counts:
                metrics["topic_index_rows"] = int(cluster_counts["topic_index_rows"])
                metrics["clusters_published_that_day"] = int(cluster_counts["clusters_published_that_day"])

        run_row = await conn.fetchrow(
            """
            SELECT started_at, completed_at, status, sources_attempted, items_fetched, items_kept, clusters_built, stats_json
            FROM news_ingestion_runs
            ORDER BY started_at DESC
            LIMIT 1
            """
        )
        if run_row:
            metrics["last_ingest"] = {
                "started_at": run_row["started_at"].isoformat(),
                "completed_at": run_row["completed_at"].isoformat() if run_row["completed_at"] else None,
                "status": run_row["status"],
                "sources_attempted": int(run_row["sources_attempted"]),
                "items_fetched": int(run_row["items_fetched"]),
                "items_kept": int(run_row["items_kept"]),
                "clusters_built": int(run_row["clusters_built"]),
            }
            try:
                raw_stats = run_row.get("stats_json")
                stats_obj: dict[str, Any]
                if isinstance(raw_stats, dict):
                    stats_obj = raw_stats
                elif isinstance(raw_stats, str):
                    stats_obj = json.loads(raw_stats)
                else:
                    stats_obj = {}
                llm_stats = stats_obj.get("llm")
                if isinstance(llm_stats, dict):
                    metrics["last_ingest_llm"] = {
                        "intel_attempted": int(llm_stats.get("intel_attempted") or 0),
                        "intel_accepted": int(llm_stats.get("intel_accepted") or 0),
                        "intel_rejected_validation": int(llm_stats.get("intel_rejected_validation") or 0),
                        "intel_missing_source_proof": int(llm_stats.get("intel_missing_source_proof") or 0),
                        "intel_rejection_reasons": llm_stats.get("intel_rejection_reasons") or {},
                    }
            except Exception as e:
                warnings.append(f"last_ingest_llm unavailable: {e}")

        try:
            win_hours = BACKEND_ACTIVITY_WINDOW_HOURS
            recent_window = f"{int(win_hours)} hours"

            recent_ingest = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE status = 'success') AS success,
                  COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                  COUNT(*) FILTER (WHERE status = 'running') AS running,
                  MAX(completed_at) FILTER (WHERE status = 'success') AS last_success_at
                FROM news_ingestion_runs
                WHERE started_at >= NOW() - ($1::text)::interval
                """,
                recent_window,
            )
            if recent_ingest:
                metrics["backend_ingest_activity"] = {
                    "window_hours": int(win_hours),
                    "success": int(recent_ingest["success"]),
                    "failed": int(recent_ingest["failed"]),
                    "running": int(recent_ingest["running"]),
                    "last_success_at": recent_ingest["last_success_at"].isoformat() if recent_ingest["last_success_at"] else None,
                }

            # Region-aware news cluster updates (fallback to global-only if old schema).
            try:
                cluster_rows = await conn.fetch(
                    """
                    SELECT region, COUNT(*) AS cnt
                    FROM news_clusters
                    WHERE published_at >= NOW() - ($1::text)::interval
                    GROUP BY region
                    ORDER BY region ASC
                    """,
                    recent_window,
                )
                metrics["backend_news_updates"] = {
                    "window_hours": int(win_hours),
                    "clusters_total": int(sum(int(r["cnt"]) for r in cluster_rows)),
                    "clusters_by_region": [
                        {"region": str(r["region"]), "count": int(r["cnt"])}
                        for r in cluster_rows
                    ],
                }
            except Exception:
                cluster_total = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM news_clusters
                    WHERE published_at >= NOW() - ($1::text)::interval
                    """,
                    recent_window,
                )
                metrics["backend_news_updates"] = {
                    "window_hours": int(win_hours),
                    "clusters_total": int(cluster_total or 0),
                    "clusters_by_region": [{"region": "global", "count": int(cluster_total or 0)}],
                }

            try:
                edition_rows = await conn.fetch(
                    """
                    SELECT region, COUNT(*) AS cnt
                    FROM news_daily_editions
                    WHERE generated_at >= NOW() - ($1::text)::interval
                    GROUP BY region
                    ORDER BY region ASC
                    """,
                    recent_window,
                )
                metrics["backend_edition_updates"] = [
                    {"region": str(r["region"]), "count": int(r["cnt"])}
                    for r in edition_rows
                ]
            except Exception:
                edition_total = await conn.fetchval(
                    """
                    SELECT COUNT(*)
                    FROM news_daily_editions
                    WHERE generated_at >= NOW() - ($1::text)::interval
                    """,
                    recent_window,
                )
                metrics["backend_edition_updates"] = [{"region": "global", "count": int(edition_total or 0)}]

            onboarding_row = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE success = TRUE) AS success,
                  COUNT(*) FILTER (WHERE success = FALSE) AS failed
                FROM startup_onboarding_attempts
                WHERE attempted_at >= NOW() - ($1::text)::interval
                """,
                recent_window,
            )
            if onboarding_row:
                metrics["backend_onboarding_attempts"] = {
                    "window_hours": int(win_hours),
                    "total": int(onboarding_row["total"]),
                    "success": int(onboarding_row["success"]),
                    "failed": int(onboarding_row["failed"]),
                }

                stage_rows = await conn.fetch(
                    """
                    SELECT stage, COUNT(*) AS total
                    FROM startup_onboarding_attempts
                    WHERE attempted_at >= NOW() - ($1::text)::interval
                    GROUP BY stage
                    ORDER BY total DESC, stage ASC
                    LIMIT 4
                    """,
                    recent_window,
                )
                metrics["backend_onboarding_stages"] = [
                    {"stage": str(r["stage"]), "total": int(r["total"])}
                    for r in stage_rows
                ]

                recent_entities = await conn.fetch(
                    """
                    SELECT entity_name, region, stage, success
                    FROM startup_onboarding_attempts
                    WHERE attempted_at >= NOW() - ($1::text)::interval
                    ORDER BY attempted_at DESC
                    LIMIT 5
                    """,
                    recent_window,
                )
                metrics["backend_onboarding_recent_entities"] = [
                    {
                        "entity_name": str(r["entity_name"]),
                        "region": str(r["region"]),
                        "stage": str(r["stage"]),
                        "success": bool(r["success"]),
                    }
                    for r in recent_entities
                ]

            queue_movement = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE queued_at >= NOW() - ($1::text)::interval) AS queued,
                  COUNT(*) FILTER (WHERE started_at >= NOW() - ($1::text)::interval) AS started,
                  COUNT(*) FILTER (
                    WHERE completed_at >= NOW() - ($1::text)::interval
                      AND status = 'completed'
                  ) AS completed,
                  COUNT(*) FILTER (
                    WHERE completed_at >= NOW() - ($1::text)::interval
                      AND status = 'failed'
                  ) AS failed
                FROM deep_research_queue
                """,
                recent_window,
            )
            queue_state = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                  COUNT(*) FILTER (WHERE status = 'processing') AS processing
                FROM deep_research_queue
                """
            )
            if queue_movement and queue_state:
                metrics["backend_research_queue"] = {
                    "window_hours": int(win_hours),
                    "queued": int(queue_movement["queued"]),
                    "started": int(queue_movement["started"]),
                    "completed": int(queue_movement["completed"]),
                    "failed": int(queue_movement["failed"]),
                    "pending": int(queue_state["pending"]),
                    "processing": int(queue_state["processing"]),
                }

            trace_activity = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE occurred_at >= NOW() - ($1::text)::interval) AS traces_window,
                  COUNT(*) FILTER (
                    WHERE should_notify = TRUE
                      AND occurred_at >= NOW() - ($1::text)::interval
                  ) AS alerts_candidate_window,
                  COUNT(*) FILTER (
                    WHERE should_notify = TRUE
                      AND notified_at >= NOW() - ($1::text)::interval
                  ) AS alerts_sent_window,
                  COUNT(*) FILTER (
                    WHERE should_notify = TRUE
                      AND notified_at IS NULL
                  ) AS alerts_pending
                FROM onboarding_trace_events
                """,
                recent_window,
            )
            if trace_activity:
                metrics["backend_onboarding_trace"] = {
                    "window_hours": int(win_hours),
                    "traces_window": int(trace_activity["traces_window"]),
                    "alerts_candidate_window": int(trace_activity["alerts_candidate_window"]),
                    "alerts_sent_window": int(trace_activity["alerts_sent_window"]),
                    "alerts_pending": int(trace_activity["alerts_pending"]),
                }

            context_activity = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE created_at >= NOW() - ($1::text)::interval) AS context_added,
                  (
                    SELECT COUNT(*)
                    FROM deep_research_queue
                    WHERE reason = 'human_context'
                      AND queued_at >= NOW() - ($1::text)::interval
                  ) AS human_requeued
                FROM startup_onboarding_context
                """,
                recent_window,
            )
            if context_activity:
                metrics["backend_onboarding_context"] = {
                    "window_hours": int(win_hours),
                    "context_added": int(context_activity["context_added"]),
                    "human_requeued": int(context_activity["human_requeued"]),
                }
        except Exception as e:
            warnings.append(f"backend_activity unavailable: {e}")

        deliveries = await conn.fetchrow(
            """
            SELECT
              COUNT(*) FILTER (WHERE status='sent') AS sent,
              COUNT(*) FILTER (WHERE status='failed') AS failed,
              COUNT(*) AS total
            FROM news_digest_deliveries
            WHERE sent_at >= NOW() - INTERVAL '24 hours'
            """
        )
        if deliveries:
            metrics["digest_24h"] = {
                "sent": int(deliveries["sent"]),
                "failed": int(deliveries["failed"]),
                "total": int(deliveries["total"]),
            }

        llm = await conn.fetchrow(
            """
            SELECT
              COUNT(*) FILTER (WHERE llm_summary IS NOT NULL AND btrim(llm_summary) <> '') AS with_llm_summary,
              COUNT(*) FILTER (WHERE builder_takeaway IS NOT NULL AND btrim(builder_takeaway) <> '') AS with_builder_takeaway,
              COUNT(*) FILTER (WHERE ba_title IS NOT NULL AND btrim(ba_title) <> '') AS with_ba_title,
              COUNT(*) AS total
            FROM news_clusters
            WHERE published_at >= NOW() - INTERVAL '24 hours'
            """
        )
        if llm:
            metrics["llm_24h"] = {
                "with_llm_summary": int(llm["with_llm_summary"]),
                "with_builder_takeaway": int(llm["with_builder_takeaway"]),
                "with_ba_title": int(llm["with_ba_title"]),
                "total": int(llm["total"]),
            }

        subs = await conn.fetchrow(
            """
            SELECT
              COUNT(*) FILTER (WHERE status='active') AS active,
              COUNT(*) FILTER (WHERE status='unsubscribed') AS unsubscribed,
              COUNT(*) AS total
            FROM news_email_subscriptions
            """
        )
        if subs:
            metrics["subscriptions"] = {
                "active": int(subs["active"]),
                "unsubscribed": int(subs["unsubscribed"]),
                "total": int(subs["total"]),
            }

        try:
            subs_24h = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') AS created,
                  COUNT(*) FILTER (WHERE confirmed_at >= NOW() - INTERVAL '24 hours') AS confirmed,
                  COUNT(*) FILTER (
                    WHERE status = 'unsubscribed'
                      AND updated_at >= NOW() - INTERVAL '24 hours'
                  ) AS unsubscribed
                FROM news_email_subscriptions
                """
            )
            if subs_24h:
                metrics["subscriptions_24h"] = {
                    "created": int(subs_24h["created"]),
                    "confirmed": int(subs_24h["confirmed"]),
                    "unsubscribed": int(subs_24h["unsubscribed"]),
                }
        except Exception as e:
            warnings.append(f"subscriptions_24h unavailable: {e}")

        try:
            sub_segments = await conn.fetch(
                """
                SELECT
                  region,
                  COALESCE(NULLIF(digest_frequency, ''), 'daily') AS digest_frequency,
                  COUNT(*) FILTER (WHERE status = 'active') AS active,
                  COUNT(*) FILTER (WHERE status = 'pending_confirmation') AS pending_confirmation,
                  COUNT(*) FILTER (WHERE status = 'unsubscribed') AS unsubscribed,
                  COUNT(*) FILTER (WHERE status = 'bounced') AS bounced
                FROM news_email_subscriptions
                GROUP BY region, COALESCE(NULLIF(digest_frequency, ''), 'daily')
                ORDER BY region ASC, digest_frequency ASC
                """
            )
            metrics["subscription_segments"] = [
                {
                    "region": str(r["region"]),
                    "digest_frequency": str(r["digest_frequency"]),
                    "active": int(r["active"]),
                    "pending_confirmation": int(r["pending_confirmation"]),
                    "unsubscribed": int(r["unsubscribed"]),
                    "bounced": int(r["bounced"]),
                }
                for r in sub_segments
            ]
        except Exception as e:
            warnings.append(f"subscription_segments unavailable: {e}")

        try:
            confirmed_rows = await conn.fetch(
                """
                SELECT
                  email,
                  region,
                  COALESCE(NULLIF(digest_frequency, ''), 'daily') AS digest_frequency
                FROM news_email_subscriptions
                WHERE confirmed_at >= NOW() - INTERVAL '24 hours'
                ORDER BY confirmed_at DESC
                LIMIT 8
                """
            )
            metrics["confirmed_subscribers_24h"] = [
                {
                    "email_masked": _mask_email(str(r["email"])),
                    "region": str(r["region"]),
                    "digest_frequency": str(r["digest_frequency"]),
                }
                for r in confirmed_rows
            ]
        except Exception as e:
            warnings.append(f"confirmed_subscribers_24h unavailable: {e}")

        try:
            digest_by_region = await conn.fetch(
                """
                SELECT
                  s.region,
                  COUNT(*) FILTER (WHERE d.status='sent') AS sent,
                  COUNT(*) FILTER (WHERE d.status='failed') AS failed,
                  COUNT(*) FILTER (WHERE d.status='skipped') AS skipped,
                  COUNT(*) AS total
                FROM news_digest_deliveries d
                JOIN news_email_subscriptions s ON s.id = d.subscription_id
                WHERE d.sent_at >= NOW() - INTERVAL '24 hours'
                GROUP BY s.region
                ORDER BY s.region ASC
                """
            )
            metrics["digest_24h_by_region"] = [
                {
                    "region": str(r["region"]),
                    "sent": int(r["sent"]),
                    "failed": int(r["failed"]),
                    "skipped": int(r["skipped"]),
                    "total": int(r["total"]),
                }
                for r in digest_by_region
            ]
        except Exception as e:
            warnings.append(f"digest_24h_by_region unavailable: {e}")

        try:
            x_posts = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE status = 'queued') AS queued,
                  COUNT(*) FILTER (WHERE status = 'publishing') AS publishing,
                  COUNT(*) FILTER (WHERE status = 'published' AND published_at >= NOW() - INTERVAL '24 hours') AS published_24h,
                  COUNT(*) FILTER (WHERE status = 'failed' AND updated_at >= NOW() - INTERVAL '24 hours') AS failed_24h
                FROM x_post_queue
                """
            )
            if x_posts:
                metrics["x_posts_24h"] = {
                    "queued": int(x_posts["queued"]),
                    "publishing": int(x_posts["publishing"]),
                    "published_24h": int(x_posts["published_24h"]),
                    "failed_24h": int(x_posts["failed_24h"]),
                }
        except Exception as e:
            warnings.append(f"x_posts_24h unavailable: {e}")

        try:
            x_attempts = await conn.fetchrow(
                """
                SELECT
                  COUNT(*) FILTER (WHERE status = 'success') AS success,
                  COUNT(*) FILTER (WHERE status = 'failed') AS failed
                FROM x_post_attempts
                WHERE attempted_at >= NOW() - INTERVAL '24 hours'
                """
            )
            if x_attempts:
                metrics["x_attempts_24h"] = {
                    "success": int(x_attempts["success"]),
                    "failed": int(x_attempts["failed"]),
                }
        except Exception as e:
            warnings.append(f"x_attempts_24h unavailable: {e}")

        try:
            x_metrics = await conn.fetchrow(
                """
                SELECT
                  COALESCE(SUM(impressions), 0) AS impressions,
                  COALESCE(SUM(likes), 0) AS likes,
                  COALESCE(SUM(replies), 0) AS replies,
                  COALESCE(SUM(reposts), 0) AS reposts,
                  COALESCE(SUM(url_clicks), 0) AS url_clicks
                FROM x_post_metrics_daily
                WHERE metric_date = CURRENT_DATE
                """
            )
            if x_metrics:
                metrics["x_metrics_today"] = {
                    "impressions": int(x_metrics["impressions"]),
                    "likes": int(x_metrics["likes"]),
                    "replies": int(x_metrics["replies"]),
                    "reposts": int(x_metrics["reposts"]),
                    "url_clicks": int(x_metrics["url_clicks"]),
                }
        except Exception as e:
            warnings.append(f"x_metrics_today unavailable: {e}")

        if warnings:
            metrics["db_metrics_warnings"] = warnings[:3]

        return metrics
    finally:
        await conn.close()


async def _subscriber_list_rows(
    database_url: str,
    *,
    status: str,
    region: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    if asyncpg is None:
        raise RuntimeError(f"asyncpg import failed: {_asyncpg_import_error}")

    status_norm = (status or "active").strip().lower()
    if status_norm not in ("active", "pending_confirmation", "unsubscribed", "bounced", "all"):
        status_norm = "active"

    region_norm = (region or "").strip().lower() or None
    if region_norm not in (None, "global", "turkey"):
        region_norm = None

    limit = max(1, min(int(limit), 20000))

    where = []
    args: list[Any] = []
    if status_norm != "all":
        where.append(f"status = ${len(args) + 1}")
        args.append(status_norm)
    if region_norm is not None:
        where.append(f"region = ${len(args) + 1}")
        args.append(region_norm)

    where_sql = ("WHERE " + " AND ".join(where)) if where else ""
    query = f"""
        SELECT
          email,
          region,
          COALESCE(NULLIF(digest_frequency, ''), 'daily') AS digest_frequency,
          status,
          created_at,
          confirmed_at
        FROM news_email_subscriptions
        {where_sql}
        ORDER BY confirmed_at DESC NULLS LAST, created_at DESC
        LIMIT {limit}
    """

    conn = await asyncpg.connect(database_url)
    try:
        rows = await conn.fetch(query, *args)
        out: list[dict[str, Any]] = []
        for r in rows:
            out.append(
                {
                    "email": str(r["email"] or ""),
                    "region": str(r["region"] or ""),
                    "digest_frequency": str(r["digest_frequency"] or ""),
                    "status": str(r["status"] or ""),
                    "created_at": r["created_at"].isoformat() if r["created_at"] else None,
                    "confirmed_at": r["confirmed_at"].isoformat() if r["confirmed_at"] else None,
                }
            )
        return out
    finally:
        await conn.close()


def _subscriber_list_state_path() -> Path:
    preferred = Path("/var/lib/buildatlas")
    if _IS_VM and preferred.is_dir() and os.access(str(preferred), os.W_OK):
        return preferred / "subscriber-list-email.last"

    repo_root = Path(__file__).resolve().parents[1]
    tmp_dir = repo_root / ".tmp"
    try:
        tmp_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass
    return tmp_dir / "subscriber-list-email.last"


def _read_state_marker(path: Path) -> str | None:
    try:
        raw = path.read_text(encoding="utf-8", errors="replace").strip()
        return raw or None
    except FileNotFoundError:
        return None
    except Exception:
        return None


def _write_state_marker(path: Path, value: str) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text((value or "").strip() + "\n", encoding="utf-8")
    except Exception:
        # Best-effort; avoid failing Slack summary on state persistence issues.
        pass


def _build_subscriber_list_report(
    *,
    report_date: str,
    generated_at_utc: datetime,
    rows: list[dict[str, Any]],
    include_full_emails: bool,
    status: str,
    region: str | None,
    truncated: bool,
) -> str:
    lines: list[str] = []
    lines.append("Build Atlas subscriber email list")
    lines.append(f"Report date (UTC): {report_date}")
    lines.append(f"Generated at (UTC): {generated_at_utc.strftime('%Y-%m-%d %H:%M UTC')}")
    region_suffix = f" region={region}" if region else ""
    lines.append(f"Filter: status={status}{region_suffix}")
    lines.append(f"Rows: {len(rows)}{' (TRUNCATED)' if truncated else ''}")
    lines.append("")

    segments = Counter((str(r.get("region") or ""), str(r.get("digest_frequency") or "")) for r in rows)
    if segments:
        lines.append("Segments:")
        for (seg_region, seg_freq), count in sorted(segments.items(), key=lambda x: (x[0][0], x[0][1])):
            lines.append(f"- {seg_region}/{seg_freq}: {count}")
        lines.append("")

    lines.append("Emails:")
    for r in rows:
        email = str(r.get("email") or "").strip()
        if not email:
            continue
        lines.append(email if include_full_emails else _mask_email(email))
    return "\n".join(lines)


def _slack_post(webhook_url: str, payload: dict[str, Any]) -> None:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        if resp.status < 200 or resp.status >= 300:
            raise RuntimeError(f"Slack webhook returned HTTP {resp.status}")


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
    # preserve input order but dedupe
    deduped: list[str] = []
    seen: set[str] = set()
    for email in recipients:
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(email)
    return deduped


def _slack_to_plain_text(line: str) -> str:
    text = line.replace("`", "").replace("*", "")
    # Convert Slack links like <https://example|open> into "open: https://example"
    text = re.sub(r"<([^|>]+)\|([^>]+)>", r"\2: \1", text)
    return text


def _build_plain_report(
    *,
    title: str,
    status_emoji: str,
    body_lines: list[str],
    repo: str,
) -> str:
    runner = "vm-cron" if _IS_VM else "github-actions"
    lines = [
        f"{status_emoji} {title}",
        "",
    ]
    lines.extend(_slack_to_plain_text(line) for line in body_lines)
    lines.extend(
        [
            "",
            f"Repo: {repo}",
            f"Runner: {runner}",
            f"At: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        ]
    )
    return "\n".join(lines)


def _send_email_via_resend(
    *,
    api_key: str,
    from_email: str,
    to_emails: list[str],
    subject: str,
    text_body: str,
) -> None:
    payload = {
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
            "User-Agent": "buildatlas-slack-summary",
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
        raise RuntimeError(f"resend_http_{e.code}:{body[:200]}") from e


def main() -> int:
    # Back-compat: some environments use SLACK_WEBHOOK instead of SLACK_WEBHOOK_URL.
    webhook_url = _env("SLACK_WEBHOOK_URL") or _env("SLACK_WEBHOOK")
    metrics_email_to_raw = _env("METRICS_REPORT_EMAIL_TO")
    subscriber_list_to_raw = _env("SUBSCRIBER_LIST_EMAIL_TO")
    if not webhook_url and not metrics_email_to_raw and not subscriber_list_to_raw:
        return 0

    repo = _env("GITHUB_REPOSITORY")
    token = _env("GITHUB_TOKEN")
    database_url = _env("DATABASE_URL")
    posthog_host = _env("POSTHOG_HOST") or _env("NEXT_PUBLIC_POSTHOG_HOST") or "https://us.i.posthog.com"
    posthog_project_id = _env("POSTHOG_PROJECT_ID")
    posthog_api_key = _env("POSTHOG_PERSONAL_API_KEY") or _env("POSTHOG_API_KEY")
    resend_api_key = _env("RESEND_API_KEY")
    metrics_email_from = (
        _env("METRICS_REPORT_EMAIL_FROM")
        or _env("NEWS_DIGEST_FROM_EMAIL")
        or "Build Atlas <news@buildatlas.net>"
    )
    subject_prefix = (_env("METRICS_REPORT_EMAIL_SUBJECT_PREFIX") or "").strip()
    if subject_prefix and not subject_prefix.endswith(" "):
        subject_prefix += " "

    since = _days_ago(24)
    runs: list[WorkflowRunSummary] = []
    ci_status_note: str | None = None
    if not repo or not token:
        ci_status_note = "CI/CD workflow status unavailable: missing GITHUB_REPOSITORY or GITHUB_TOKEN"
    else:
        try:
            runs = _workflow_runs(repo, token, since)
        except GitHubApiAuthError:
            ci_status_note = "CI/CD workflow status unavailable: GitHub API auth failed (401/403)"
        except Exception as e:
            ci_status_note = f"CI/CD workflow status unavailable: {e}"

    failures = [r for r in runs if (r.conclusion or "").lower() == "failure" or r.status == "error"]
    failure_lines = []
    for r in failures:
        if r.html_url:
            failure_lines.append(f"- `{r.workflow}`: *{r.conclusion or r.status}* (<{r.html_url}|open>)")
        else:
            failure_lines.append(f"- `{r.workflow}`: *{r.conclusion or r.status}*")

    # DB metrics are optional; summary still posts without them.
    metrics: dict[str, Any] = {}
    if database_url:
        try:
            metrics = asyncio.run(_db_metrics(database_url))
        except Exception as e:
            metrics = {"db_metrics_error": str(e)}

    site_metrics: dict[str, Any] = {}
    if posthog_project_id and posthog_api_key:
        try:
            site_metrics = _posthog_metrics(posthog_host, posthog_project_id, posthog_api_key)
        except Exception as e:
            site_metrics = {"site_metrics_error": str(e)}
    elif _env("NEXT_PUBLIC_POSTHOG_KEY"):
        site_metrics = {
            "site_metrics_info": (
                "PostHog client key is configured, but POSTHOG_PROJECT_ID/POSTHOG_PERSONAL_API_KEY are missing"
            )
        }

    # VM cron job health (only when running on VM)
    cron_health: list[CronJobHealth] = []
    cron_failures: list[CronJobHealth] = []
    if _IS_VM:
        cron_health = _cron_job_health()
        cron_failures = [c for c in cron_health if c.last_status in ("FAILED", "TIMEOUT") or c.overdue]

    title = "BuildAtlas Daily Ops Summary"
    has_problems = bool(failures or cron_failures)
    status_emoji = ":white_check_mark:" if not has_problems else ":warning:"

    body_lines = []
    body_lines.append(f"*Window:* last 24 hours (since {since.strftime('%Y-%m-%d %H:%M UTC')})")

    # GitHub Actions CI/CD status
    if ci_status_note:
        body_lines.append(f"*{ci_status_note}*")
    else:
        body_lines.append(f"*CI/CD workflow failures:* {len(failures)}")
        if failure_lines:
            body_lines.append("")
            body_lines.append("*CI/CD Failures*")
            body_lines.extend(failure_lines)

    # VM cron job status
    if _IS_VM and cron_health:
        body_lines.append("")
        body_lines.append("*VM cron jobs*")
        for c in cron_health:
            icon = ":white_check_mark:" if c.last_status == "SUCCESS" and not c.overdue else ":x:"
            if c.last_status == "SKIP":
                icon = ":fast_forward:"
            if c.last_status == "UNKNOWN":
                icon = ":grey_question:"
            age = f"{c.minutes_since}min ago" if c.minutes_since is not None else "never"
            extra = " *OVERDUE*" if c.overdue else ""
            body_lines.append(f"- {icon} `{c.name}`: {c.last_status} ({age}){extra}")

    if metrics:
        body_lines.append("")
        body_lines.append("*Product metrics*")
        if "latest_edition_date" in metrics:
            body_lines.append(
                f"- Latest edition: `{metrics.get('latest_edition_date')}` ({metrics.get('latest_edition_status')})"
            )
        if "last_ingest" in metrics:
            li = metrics["last_ingest"]
            body_lines.append(
                f"- Last ingest: {li.get('status')} • sources={li.get('sources_attempted')} • fetched={li.get('items_fetched')} • kept={li.get('items_kept')} • clusters={li.get('clusters_built')}"
            )
        if "digest_24h" in metrics:
            d = metrics["digest_24h"]
            body_lines.append(f"- Digest (24h): sent={d.get('sent')} failed={d.get('failed')} total={d.get('total')}")
        if "subscriptions" in metrics:
            s = metrics["subscriptions"]
            body_lines.append(f"- Subscriptions: active={s.get('active')} total={s.get('total')}")
        if "subscriptions_24h" in metrics:
            s24 = metrics["subscriptions_24h"]
            body_lines.append(
                f"- Subscription lifecycle (24h): created={s24.get('created')} confirmed={s24.get('confirmed')} unsubscribed={s24.get('unsubscribed')}"
            )
        if "subscription_segments" in metrics:
            segs = metrics["subscription_segments"]
            if segs:
                parts = [
                    f"{seg.get('region')}/{seg.get('digest_frequency')}: active={seg.get('active')} pending={seg.get('pending_confirmation')}"
                    for seg in segs
                ]
                body_lines.append(f"- Subscription segments: {'; '.join(parts)}")
        if "confirmed_subscribers_24h" in metrics:
            confirmed = metrics["confirmed_subscribers_24h"]
            if confirmed:
                people = [
                    f"{c.get('email_masked')} ({c.get('region')}/{c.get('digest_frequency')})"
                    for c in confirmed
                ]
                body_lines.append(f"- Newly confirmed subscribers (24h): {', '.join(people)}")
            else:
                body_lines.append("- Newly confirmed subscribers (24h): none")
        if "digest_24h_by_region" in metrics:
            rows = metrics["digest_24h_by_region"]
            if rows:
                parts = [
                    f"{r.get('region')}: sent={r.get('sent')} failed={r.get('failed')} skipped={r.get('skipped')}"
                    for r in rows
                ]
                body_lines.append(f"- Digest by region (24h): {'; '.join(parts)}")
        if "x_posts_24h" in metrics:
            xq = metrics["x_posts_24h"]
            body_lines.append(
                f"- X queue: queued={xq.get('queued')} publishing={xq.get('publishing')} published_24h={xq.get('published_24h')} failed_24h={xq.get('failed_24h')}"
            )
        if "x_attempts_24h" in metrics:
            xa = metrics["x_attempts_24h"]
            body_lines.append(f"- X publish attempts (24h): success={xa.get('success')} failed={xa.get('failed')}")
        if "x_metrics_today" in metrics:
            xm = metrics["x_metrics_today"]
            body_lines.append(
                f"- X engagement (today): impressions={xm.get('impressions')} likes={xm.get('likes')} replies={xm.get('replies')} reposts={xm.get('reposts')} url_clicks={xm.get('url_clicks')}"
            )
        if "llm_24h" in metrics:
            l = metrics["llm_24h"]
            body_lines.append(
                f"- LLM (24h clusters): llm_summary={l.get('with_llm_summary')}/{l.get('total')} • builder_takeaway={l.get('with_builder_takeaway')}/{l.get('total')} • ba_title={l.get('with_ba_title')}/{l.get('total')}"
            )
        if "last_ingest_llm" in metrics:
            il = metrics["last_ingest_llm"]
            body_lines.append(
                f"- Intel validation (last ingest): attempted={il.get('intel_attempted')} accepted={il.get('intel_accepted')} rejected={il.get('intel_rejected_validation')} missing_source_proof={il.get('intel_missing_source_proof')}"
            )
            reasons = il.get("intel_rejection_reasons") or {}
            if isinstance(reasons, dict) and reasons:
                reason_parts = [f"{k}={v}" for k, v in reasons.items()]
                body_lines.append(f"- Intel rejection reasons: {', '.join(reason_parts)}")
        if "backend_ingest_activity" in metrics or "backend_news_updates" in metrics or "backend_onboarding_attempts" in metrics:
            window_hours = BACKEND_ACTIVITY_WINDOW_HOURS
            if "backend_ingest_activity" in metrics:
                window_hours = int(metrics["backend_ingest_activity"].get("window_hours") or window_hours)
            elif "backend_news_updates" in metrics:
                window_hours = int(metrics["backend_news_updates"].get("window_hours") or window_hours)
            body_lines.append("")
            body_lines.append(f"*Backend activity (last {window_hours}h)*")
            if "backend_ingest_activity" in metrics:
                bi = metrics["backend_ingest_activity"]
                body_lines.append(
                    f"- News ingest runs: success={bi.get('success')} failed={bi.get('failed')} running={bi.get('running')}"
                )
            if "backend_news_updates" in metrics:
                bn = metrics["backend_news_updates"]
                by_region = bn.get("clusters_by_region") or []
                region_parts = [f"{r.get('region')}={r.get('count')}" for r in by_region]
                body_lines.append(
                    f"- News updates: clusters={bn.get('clusters_total')} ({', '.join(region_parts)})"
                )
            if "backend_edition_updates" in metrics:
                be = metrics["backend_edition_updates"]
                if be:
                    parts = [f"{r.get('region')}={r.get('count')}" for r in be]
                    body_lines.append(f"- Edition rebuilds: {', '.join(parts)}")
            if "backend_onboarding_attempts" in metrics:
                bo = metrics["backend_onboarding_attempts"]
                body_lines.append(
                    f"- Onboarding triggered: total={bo.get('total')} success={bo.get('success')} failed={bo.get('failed')}"
                )
            if "backend_onboarding_stages" in metrics:
                stage_parts = [f"{s.get('stage')}={s.get('total')}" for s in (metrics.get("backend_onboarding_stages") or [])]
                if stage_parts:
                    body_lines.append(f"- Onboarding stages: {', '.join(stage_parts)}")
            if "backend_onboarding_recent_entities" in metrics:
                entities = metrics["backend_onboarding_recent_entities"] or []
                if entities:
                    names = [str(e.get("entity_name") or "") for e in entities if e.get("entity_name")]
                    if names:
                        body_lines.append(f"- Recent onboarding entities: {', '.join(names[:5])}")
            if "backend_research_queue" in metrics:
                rq = metrics["backend_research_queue"]
                body_lines.append(
                    f"- Deep research queue: queued={rq.get('queued')} started={rq.get('started')} completed={rq.get('completed')} failed={rq.get('failed')} pending={rq.get('pending')} processing={rq.get('processing')}"
                )
            if "backend_onboarding_trace" in metrics:
                bt = metrics["backend_onboarding_trace"]
                body_lines.append(
                    f"- Onboarding traces: total={bt.get('traces_window')} alerts_candidate={bt.get('alerts_candidate_window')} alerts_sent={bt.get('alerts_sent_window')} alerts_pending={bt.get('alerts_pending')}"
                )
            if "backend_onboarding_context" in metrics:
                bc = metrics["backend_onboarding_context"]
                body_lines.append(
                    f"- Human context: added={bc.get('context_added')} requeued={bc.get('human_requeued')}"
                )
        if "db_metrics_warnings" in metrics:
            warns = metrics["db_metrics_warnings"]
            if warns:
                body_lines.append(f"- DB metrics warnings: {'; '.join(str(w) for w in warns)}")
        if "db_metrics_error" in metrics:
            body_lines.append(f"- DB metrics error: `{metrics.get('db_metrics_error')}`")

    if site_metrics:
        body_lines.append("")
        body_lines.append("*Site usage (PostHog, 24h)*")
        if "pageviews" in site_metrics:
            body_lines.append(
                f"- pageviews={site_metrics.get('pageviews')} unique_visitors={site_metrics.get('unique_visitors')} sessions_started={site_metrics.get('sessions_started')} watchlist_add={site_metrics.get('watchlist_add')}"
            )
        if "subscription_submit" in site_metrics:
            conv_suffix = ""
            if "subscription_submit_success_rate" in site_metrics:
                conv_suffix = f" success_rate={site_metrics.get('subscription_submit_success_rate')}%"
            body_lines.append(
                "- subscriptions: "
                f"submit={site_metrics.get('subscription_submit')} "
                f"submit_success={site_metrics.get('subscription_submit_success')} "
                f"submit_error={site_metrics.get('subscription_submit_error')} "
                f"confirmed={site_metrics.get('subscription_confirmed')} "
                f"unsubscribed={site_metrics.get('subscription_unsubscribed')}{conv_suffix}"
            )
        if "site_metrics_info" in site_metrics:
            body_lines.append(f"- Info: {site_metrics.get('site_metrics_info')}")
        if "site_metrics_error" in site_metrics:
            body_lines.append(f"- Site metrics error: `{site_metrics.get('site_metrics_error')}`")

    email_delivery_lines: list[str] = []

    metrics_email_status_line: str | None = None
    metrics_recipients = _parse_email_list(metrics_email_to_raw)
    if metrics_email_to_raw is not None:
        if not metrics_recipients:
            metrics_email_status_line = "Metrics email skipped: no valid `METRICS_REPORT_EMAIL_TO` recipients parsed."
        elif not resend_api_key:
            metrics_email_status_line = "Metrics email skipped: `RESEND_API_KEY` is not configured."
        else:
            try:
                subject = (
                    f"{subject_prefix}{title} — {datetime.now(timezone.utc).strftime('%Y-%m-%d')}"
                )
                plain_report = _build_plain_report(
                    title=title,
                    status_emoji=status_emoji,
                    body_lines=body_lines,
                    repo=repo,
                )
                _send_email_via_resend(
                    api_key=resend_api_key,
                    from_email=metrics_email_from,
                    to_emails=metrics_recipients,
                    subject=subject,
                    text_body=plain_report,
                )
                metrics_email_status_line = f"Metrics email sent ({len(metrics_recipients)} recipient(s))."
            except Exception as e:
                metrics_email_status_line = f"Metrics email failed (best-effort): `{e}`"

    if metrics_email_status_line:
        email_delivery_lines.append(metrics_email_status_line)

    subscriber_list_status_line: str | None = None
    subscriber_recipients = _parse_email_list(subscriber_list_to_raw)
    if subscriber_list_to_raw is not None:
        if not subscriber_recipients:
            subscriber_list_status_line = (
                "Subscriber list email skipped: no valid `SUBSCRIBER_LIST_EMAIL_TO` recipients parsed."
            )
        elif not resend_api_key:
            subscriber_list_status_line = "Subscriber list email skipped: `RESEND_API_KEY` is not configured."
        elif not database_url:
            subscriber_list_status_line = "Subscriber list email skipped: `DATABASE_URL` is not configured."
        else:
            force_send = _as_bool(_env("SUBSCRIBER_LIST_FORCE_SEND"))
            include_full_emails = _as_bool(_env("SUBSCRIBER_LIST_INCLUDE_FULL_EMAILS"))
            status_filter = (_env("SUBSCRIBER_LIST_STATUS", "active") or "active").strip().lower()
            region_filter = _env("SUBSCRIBER_LIST_REGION")

            max_rows = _as_int(_env("SUBSCRIBER_LIST_MAX_ROWS", "5000")) or 5000
            max_rows = max(1, min(int(max_rows), 20000))

            send_hour = _as_int(_env("SUBSCRIBER_LIST_SEND_AT_UTC_HOUR", "0")) or 0
            send_minute = _as_int(_env("SUBSCRIBER_LIST_SEND_AT_UTC_MINUTE", "0")) or 0
            if send_hour < 0 or send_hour > 23:
                send_hour = 0
            if send_minute < 0 or send_minute > 59:
                send_minute = 0

            now_utc = datetime.now(timezone.utc)
            report_date = now_utc.date().isoformat()
            send_after_dt = datetime(
                now_utc.year,
                now_utc.month,
                now_utc.day,
                send_hour,
                send_minute,
                tzinfo=timezone.utc,
            )

            state_path = _subscriber_list_state_path()
            last_sent = _read_state_marker(state_path)
            should_send = force_send or (now_utc >= send_after_dt and last_sent != report_date)

            if should_send:
                try:
                    rows = asyncio.run(
                        _subscriber_list_rows(
                            database_url,
                            status=status_filter,
                            region=region_filter,
                            limit=max_rows + 1,
                        )
                    )
                    truncated = len(rows) > max_rows
                    if truncated:
                        rows = rows[:max_rows]

                    from_email = (
                        _env("SUBSCRIBER_LIST_EMAIL_FROM")
                        or _env("METRICS_REPORT_EMAIL_FROM")
                        or _env("NEWS_DIGEST_FROM_EMAIL")
                        or "Build Atlas <news@buildatlas.net>"
                    )
                    subj = (_env("SUBSCRIBER_LIST_EMAIL_SUBJECT_PREFIX") or subject_prefix).strip()
                    if subj and not subj.endswith(" "):
                        subj += " "
                    subject = f"{subj}Subscriber email list — {report_date}"

                    text_body = _build_subscriber_list_report(
                        report_date=report_date,
                        generated_at_utc=now_utc,
                        rows=rows,
                        include_full_emails=include_full_emails,
                        status=status_filter,
                        region=(region_filter or "").strip() or None,
                        truncated=truncated,
                    )

                    _send_email_via_resend(
                        api_key=resend_api_key,
                        from_email=from_email,
                        to_emails=subscriber_recipients,
                        subject=subject,
                        text_body=text_body,
                    )
                    _write_state_marker(state_path, report_date)
                    subscriber_list_status_line = (
                        "Subscriber list email sent "
                        f"({len(subscriber_recipients)} recipient(s), {len(rows)} row(s))"
                        f"{' [PII]' if include_full_emails else ''}."
                    )
                except Exception as e:
                    subscriber_list_status_line = f"Subscriber list email failed (best-effort): `{e}`"

    if subscriber_list_status_line:
        email_delivery_lines.append(subscriber_list_status_line)

    if email_delivery_lines:
        body_lines.append("")
        body_lines.append("*Email delivery*")
        for line in email_delivery_lines:
            body_lines.append(f"- {line}")

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{status_emoji} {title}", "emoji": True}},
        {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(body_lines)}},
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"*Repo:* `{repo}`  •  *Runner:* `{'vm-cron' if _IS_VM else 'github-actions'}`  •  *At:* {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"},
            ],
        },
    ]

    if webhook_url:
        _slack_post(webhook_url, {"blocks": blocks})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
