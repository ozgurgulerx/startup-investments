#!/usr/bin/env python3
"""
Daily Slack summary for BuildAtlas.

Includes:
- Recent workflow run outcomes (GitHub Actions API)
- Core product metrics from Postgres (news editions, ingestion runs, digest deliveries, LLM enrichment coverage)

No third-party deps for HTTP (stdlib); uses asyncpg for DB (already in analysis requirements).
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any


try:
    import asyncpg  # type: ignore
except Exception as e:  # pragma: no cover
    asyncpg = None
    _asyncpg_import_error = e


WORKFLOWS = [
    "backend-deploy.yml",
    "frontend-deploy.yml",
    "functions-deploy.yml",
    "news-ingest.yml",
    "news-digest-daily.yml",
    "sync-to-database.yml",
    "sync-data.yml",
    "crawl-frontier.yml",
    "keep-aks-running.yml",
    "keep-aks-alive.yml",
]


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v


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
    with urllib.request.urlopen(req, timeout=20) as resp:
        payload = resp.read().decode("utf-8")
        return json.loads(payload)


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


async def _db_metrics(database_url: str) -> dict[str, Any]:
    if asyncpg is None:
        raise RuntimeError(f"asyncpg import failed: {_asyncpg_import_error}")

    conn = await asyncpg.connect(database_url)
    try:
        metrics: dict[str, Any] = {}

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
            SELECT started_at, completed_at, status, sources_attempted, items_fetched, items_kept, clusters_built
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
              COUNT(*) AS total
            FROM news_clusters
            WHERE published_at >= NOW() - INTERVAL '24 hours'
            """
        )
        if llm:
            metrics["llm_24h"] = {
                "with_llm_summary": int(llm["with_llm_summary"]),
                "with_builder_takeaway": int(llm["with_builder_takeaway"]),
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

        return metrics
    finally:
        await conn.close()


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


def main() -> int:
    webhook_url = _env("SLACK_WEBHOOK_URL")
    if not webhook_url:
        return 0

    repo = _env("GITHUB_REPOSITORY")
    token = _env("GITHUB_TOKEN")
    database_url = _env("DATABASE_URL")

    if not repo or not token:
        sys.stderr.write("Missing required env: GITHUB_REPOSITORY or GITHUB_TOKEN\n")
        return 1

    since = _days_ago(24)
    runs = _workflow_runs(repo, token, since)

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

    title = "BuildAtlas Daily Ops Summary"
    status_emoji = ":white_check_mark:" if not failures else ":warning:"

    body_lines = []
    body_lines.append(f"*Window:* last 24 hours (since {since.strftime('%Y-%m-%d %H:%M UTC')})")
    body_lines.append(f"*Workflow failures:* {len(failures)}")
    if failure_lines:
        body_lines.append("")
        body_lines.append("*Failures*")
        body_lines.extend(failure_lines)

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
        if "llm_24h" in metrics:
            l = metrics["llm_24h"]
            body_lines.append(
                f"- LLM (24h clusters): llm_summary={l.get('with_llm_summary')}/{l.get('total')} • builder_takeaway={l.get('with_builder_takeaway')}/{l.get('total')}"
            )
        if "db_metrics_error" in metrics:
            body_lines.append(f"- DB metrics error: `{metrics.get('db_metrics_error')}`")

    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": f"{status_emoji} {title}", "emoji": True}},
        {"type": "section", "text": {"type": "mrkdwn", "text": "\n".join(body_lines)}},
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"*Repo:* `{repo}`  •  *At:* {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}"},
            ],
        },
    ]

    _slack_post(webhook_url, {"blocks": blocks})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

