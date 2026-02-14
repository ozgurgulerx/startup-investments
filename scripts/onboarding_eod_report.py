#!/usr/bin/env python3
"""
End-of-day onboarding + graph + news relationship report.

Outputs Slack mrkdwn to stdout. Intended to run from VM cron via runner.sh.

Data sources (best-effort; sections are skipped if tables don't exist):
- startup onboarding: startups, startup_onboarding_attempts, onboarding_trace_events
- investor onboarding: investors, investor_onboarding_queue, investor_profiles
- capital graph: capital_graph_edges
- news <> startup linking: startup_events (cluster_id), startup_refresh_jobs
- memory gate: news_item_extractions, news_entity_facts
- ingest telemetry: news_ingestion_runs.stats_json
"""

from __future__ import annotations

import argparse
import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Iterable

try:
    import asyncpg  # type: ignore
except Exception as e:  # pragma: no cover
    asyncpg = None
    _ASYNC_PG_IMPORT_ERROR = e


def _env(name: str) -> str:
    v = os.environ.get(name)
    return (v or "").strip()


def _iso(dt: datetime | None) -> str:
    if not dt:
        return ""
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _chunk(lines: Iterable[str], max_chars: int) -> str:
    # Keep Slack payload under practical limits; trim from the bottom.
    out: list[str] = []
    size = 0
    for line in lines:
        add = len(line) + 1
        if out and (size + add) > max_chars:
            out.append("")
            out.append("_... truncated_")
            break
        out.append(line)
        size += add
    return "\n".join(out).rstrip() + "\n"


def _bool(v: Any) -> bool:
    return bool(v) and str(v).lower() not in {"0", "false", "none", "null", ""}


async def _to_regclass(conn: "asyncpg.Connection", table: str) -> bool:
    try:
        ok = await conn.fetchval("SELECT to_regclass($1) IS NOT NULL", f"public.{table}")
        return bool(ok)
    except Exception:
        return False


async def _fetchrow(conn: "asyncpg.Connection", sql: str, *args: Any) -> dict[str, Any] | None:
    row = await conn.fetchrow(sql, *args)
    return dict(row) if row else None


async def _fetch(conn: "asyncpg.Connection", sql: str, *args: Any) -> list[dict[str, Any]]:
    rows = await conn.fetch(sql, *args)
    return [dict(r) for r in rows]


async def main() -> int:
    parser = argparse.ArgumentParser(description="Generate end-of-day onboarding report (Slack mrkdwn).")
    parser.add_argument("--max-items", type=int, default=15, help="Max list items per section (default: 15)")
    parser.add_argument("--slack-max-chars", type=int, default=3400, help="Max Slack body chars (default: 3400)")
    args = parser.parse_args()

    if asyncpg is None:
        raise RuntimeError(f"asyncpg import failed: {_ASYNC_PG_IMPORT_ERROR}")

    db_url = _env("DATABASE_URL")
    if not db_url:
        raise RuntimeError("DATABASE_URL is not set")

    now = datetime.now(timezone.utc)
    start_ts = datetime(now.year, now.month, now.day, tzinfo=timezone.utc)
    end_ts = now

    conn = await asyncpg.connect(db_url)
    try:
        max_items = max(1, min(50, int(args.max_items)))

        # Table presence (best-effort).
        has_attempts = await _to_regclass(conn, "startup_onboarding_attempts")
        has_traces = await _to_regclass(conn, "onboarding_trace_events")
        has_refresh_jobs = await _to_regclass(conn, "startup_refresh_jobs")
        has_events = await _to_regclass(conn, "startup_events")
        has_graph = await _to_regclass(conn, "capital_graph_edges")
        has_investor_queue = await _to_regclass(conn, "investor_onboarding_queue")
        has_investor_profiles = await _to_regclass(conn, "investor_profiles")
        has_item_extractions = await _to_regclass(conn, "news_item_extractions")
        has_entity_facts = await _to_regclass(conn, "news_entity_facts")
        has_ingest_runs = await _to_regclass(conn, "news_ingestion_runs")

        lines: list[str] = []
        lines.append(f"*EOD Onboarding/Graph/News Report* (UTC {now.strftime('%Y-%m-%d')})")
        lines.append(f"Window: `{_iso(start_ts)}` -> `{_iso(end_ts)}` (generated `{_iso(now)}`)")
        lines.append("")

        # ---------------------------------------------------------------------
        # News ingest telemetry (DB)
        # ---------------------------------------------------------------------
        if has_ingest_runs:
            try:
                agg = await _fetchrow(
                    conn,
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE status='success') AS success,
                      COUNT(*) FILTER (WHERE status='failed') AS failed,
                      MAX(completed_at) FILTER (WHERE status='success') AS last_success_at,
                      COALESCE(SUM(items_fetched) FILTER (WHERE status='success'), 0) AS items_fetched,
                      COALESCE(SUM(items_kept) FILTER (WHERE status='success'), 0) AS items_kept,
                      COALESCE(SUM(clusters_built) FILTER (WHERE status='success'), 0) AS clusters_built,
                      COALESCE(SUM((stats_json->'events'->>'persisted_total')::int) FILTER (WHERE status='success'), 0) AS events_persisted,
                      COALESCE(SUM((stats_json->'events'->>'graph_edges_upserted_total')::int) FILTER (WHERE status='success'), 0) AS graph_edges_upserted,
                      COALESCE(SUM((stats_json->'events'->'global'->>'onboarded_startups')::int) FILTER (WHERE status='success'), 0) AS onboarded_global,
                      COALESCE(SUM((stats_json->'events'->'turkey'->>'onboarded_startups')::int) FILTER (WHERE status='success'), 0) AS onboarded_turkey
                    FROM news_ingestion_runs
                    WHERE started_at >= $1 AND started_at < $2
                    """,
                    start_ts,
                    end_ts,
                )
                if agg:
                    lines.append("*News ingest (DB telemetry)*")
                    lines.append(
                        "- runs: success={s} failed={f} last_success={ls}".format(
                            s=int(agg.get("success") or 0),
                            f=int(agg.get("failed") or 0),
                            ls=_iso(agg.get("last_success_at")),
                        )
                    )
                    lines.append(
                        "- volume: items_fetched={f} items_kept={k} clusters_built={c}".format(
                            f=int(agg.get("items_fetched") or 0),
                            k=int(agg.get("items_kept") or 0),
                            c=int(agg.get("clusters_built") or 0),
                        )
                    )
                    lines.append(
                        "- extracted: startup_events_persisted={e} graph_edges_upserted={g} startups_onboarded global={og} turkey={ot}".format(
                            e=int(agg.get("events_persisted") or 0),
                            g=int(agg.get("graph_edges_upserted") or 0),
                            og=int(agg.get("onboarded_global") or 0),
                            ot=int(agg.get("onboarded_turkey") or 0),
                        )
                    )
                    lines.append("")
            except Exception as exc:
                lines.append("*News ingest (DB telemetry)*")
                lines.append(f"- unavailable: {exc}")
                lines.append("")

        # ---------------------------------------------------------------------
        # Startup onboarding
        # ---------------------------------------------------------------------
        try:
            stub_rows = await _fetch(
                conn,
                """
                SELECT id::text, name, slug, dataset_region, website, created_at
                FROM startups
                WHERE onboarding_status = 'stub'
                  AND created_at >= $1 AND created_at < $2
                ORDER BY created_at DESC
                LIMIT $3
                """,
                start_ts,
                end_ts,
                max_items,
            )
            stub_count = await conn.fetchval(
                """
                SELECT COUNT(*)
                FROM startups
                WHERE onboarding_status = 'stub'
                  AND created_at >= $1 AND created_at < $2
                """,
                start_ts,
                end_ts,
            )

            lines.append("*Startups onboarded (stubs)*")
            lines.append(f"- stubs_created: {int(stub_count or 0)}")

            if has_attempts:
                attempts = await _fetchrow(
                    conn,
                    """
                    SELECT
                      COUNT(*) AS total,
                      COUNT(*) FILTER (WHERE success) AS success,
                      COUNT(*) FILTER (WHERE NOT success) AS failed
                    FROM startup_onboarding_attempts
                    WHERE attempted_at >= $1 AND attempted_at < $2
                    """,
                    start_ts,
                    end_ts,
                )
                if attempts:
                    lines.append(
                        "- onboarding_attempts: total={t} success={s} failed={f}".format(
                            t=int(attempts.get("total") or 0),
                            s=int(attempts.get("success") or 0),
                            f=int(attempts.get("failed") or 0),
                        )
                    )

                    stages = await _fetch(
                        conn,
                        """
                        SELECT stage, COUNT(*) AS total
                        FROM startup_onboarding_attempts
                        WHERE attempted_at >= $1 AND attempted_at < $2
                        GROUP BY stage
                        ORDER BY total DESC
                        LIMIT 8
                        """,
                        start_ts,
                        end_ts,
                    )
                    if stages:
                        stage_part = ", ".join([f"{r.get('stage')}={int(r.get('total') or 0)}" for r in stages])
                        lines.append(f"- stages: {stage_part}")

            if stub_rows:
                lines.append("- stubs:")
                for r in stub_rows:
                    region = (r.get("dataset_region") or "global").strip()
                    name = (r.get("name") or "").strip()
                    slug = (r.get("slug") or "").strip()
                    website = (r.get("website") or "").strip()
                    created_at = _iso(r.get("created_at"))
                    website_part = f" {website}" if website else ""
                    slug_part = f" (`{slug}`)" if slug else ""
                    lines.append(f"  - [{region}] {name}{slug_part}{website_part} ({created_at})")
            lines.append("")
        except Exception as exc:
            lines.append("*Startups onboarded (stubs)*")
            lines.append(f"- unavailable: {exc}")
            lines.append("")

        # ---------------------------------------------------------------------
        # Investors
        # ---------------------------------------------------------------------
        try:
            inv_rows = await _fetch(
                conn,
                """
                SELECT id::text, name, type, website, created_at
                FROM investors
                WHERE created_at >= $1 AND created_at < $2
                ORDER BY created_at DESC
                LIMIT $3
                """,
                start_ts,
                end_ts,
                max_items,
            )
            inv_count = await conn.fetchval(
                "SELECT COUNT(*) FROM investors WHERE created_at >= $1 AND created_at < $2",
                start_ts,
                end_ts,
            )
            lines.append("*Investors added*")
            lines.append(f"- investors_created: {int(inv_count or 0)}")

            if has_investor_queue:
                q = await _fetchrow(
                    conn,
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE queued_at >= $1 AND queued_at < $2) AS queued_today,
                      COUNT(*) FILTER (WHERE started_at >= $1 AND started_at < $2) AS started_today,
                      COUNT(*) FILTER (WHERE completed_at >= $1 AND completed_at < $2) AS completed_today,
                      COUNT(*) FILTER (WHERE status='failed' AND completed_at >= $1 AND completed_at < $2) AS failed_today,
                      COUNT(*) FILTER (WHERE status='pending') AS pending_now,
                      COUNT(*) FILTER (WHERE status='processing') AS processing_now
                    FROM investor_onboarding_queue
                    """,
                    start_ts,
                    end_ts,
                )
                if q:
                    lines.append(
                        "- investor_onboarding_queue: queued_today={q} completed_today={c} failed_today={f} pending_now={p} processing_now={pr}".format(
                            q=int(q.get("queued_today") or 0),
                            c=int(q.get("completed_today") or 0),
                            f=int(q.get("failed_today") or 0),
                            p=int(q.get("pending_now") or 0),
                            pr=int(q.get("processing_now") or 0),
                        )
                    )

            if has_investor_profiles:
                prof = await _fetchrow(
                    conn,
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS created_today,
                      COUNT(*) FILTER (WHERE updated_at >= $1 AND updated_at < $2) AS updated_today
                    FROM investor_profiles
                    """,
                    start_ts,
                    end_ts,
                )
                if prof:
                    lines.append(
                        "- investor_profiles: created_today={c} updated_today={u}".format(
                            c=int(prof.get("created_today") or 0),
                            u=int(prof.get("updated_today") or 0),
                        )
                    )

            if inv_rows:
                lines.append("- investors:")
                for r in inv_rows:
                    name = (r.get("name") or "").strip()
                    inv_type = (r.get("type") or "").strip()
                    website = (r.get("website") or "").strip()
                    created_at = _iso(r.get("created_at"))
                    bits = [name]
                    if inv_type:
                        bits.append(f"type={inv_type}")
                    if website:
                        bits.append(website)
                    bits.append(created_at)
                    lines.append("  - " + " | ".join(bits))
            lines.append("")
        except Exception as exc:
            lines.append("*Investors added*")
            lines.append(f"- unavailable: {exc}")
            lines.append("")

        # ---------------------------------------------------------------------
        # Capital graph
        # ---------------------------------------------------------------------
        if has_graph:
            try:
                g = await _fetchrow(
                    conn,
                    """
                    SELECT
                      COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS created_today,
                      COUNT(*) FILTER (WHERE updated_at >= $1 AND updated_at < $2) AS updated_today
                    FROM capital_graph_edges
                    WHERE source = 'news_event'
                      AND created_by = 'news_ingest'
                    """,
                    start_ts,
                    end_ts,
                )
                lines.append("*Capital graph (news_event)*")
                if g:
                    lines.append(
                        "- edges: created_today={c} updated_today={u}".format(
                            c=int(g.get("created_today") or 0),
                            u=int(g.get("updated_today") or 0),
                        )
                    )

                edge_rows = await _fetch(
                    conn,
                    """
                    SELECT
                      e.updated_at,
                      e.region,
                      i.name AS investor_name,
                      s.slug AS startup_slug,
                      s.name AS startup_name
                    FROM capital_graph_edges e
                    JOIN investors i ON e.src_type='investor' AND e.src_id=i.id
                    JOIN startups s ON e.dst_type='startup' AND e.dst_id=s.id
                    WHERE e.edge_type='LEADS_ROUND'
                      AND e.source='news_event'
                      AND e.created_by='news_ingest'
                      AND e.updated_at >= $1 AND e.updated_at < $2
                    ORDER BY e.updated_at DESC
                    LIMIT $3
                    """,
                    start_ts,
                    end_ts,
                    max_items,
                )
                if edge_rows:
                    lines.append("- latest_edges:")
                    for r in edge_rows:
                        t = _iso(r.get("updated_at"))
                        region = (r.get("region") or "").strip() or "global"
                        inv = (r.get("investor_name") or "").strip()
                        slug = (r.get("startup_slug") or "").strip()
                        sname = (r.get("startup_name") or "").strip()
                        dst = f"{sname} (`{slug}`)" if slug else sname
                        lines.append(f"  - {inv} -> {dst} [{region}] ({t})")
                lines.append("")
            except Exception as exc:
                lines.append("*Capital graph (news_event)*")
                lines.append(f"- unavailable: {exc}")
                lines.append("")

        # ---------------------------------------------------------------------
        # News <> startup relationships
        # ---------------------------------------------------------------------
        if has_events:
            try:
                c = await _fetchrow(
                    conn,
                    """
                    SELECT
                      COUNT(*) AS total,
                      COUNT(*) FILTER (WHERE cluster_id IS NOT NULL) AS with_cluster,
                      COUNT(DISTINCT startup_id) FILTER (WHERE cluster_id IS NOT NULL AND startup_id IS NOT NULL) AS startups,
                      COUNT(DISTINCT cluster_id) FILTER (WHERE cluster_id IS NOT NULL) AS clusters
                    FROM startup_events
                    WHERE detected_at >= $1 AND detected_at < $2
                    """,
                    start_ts,
                    end_ts,
                )
                lines.append("*News <> startup relationships*")
                if c:
                    lines.append(
                        "- startup_events: total={t} from_news_clusters={n} startups={s} clusters={c}".format(
                            t=int(c.get("total") or 0),
                            n=int(c.get("with_cluster") or 0),
                            s=int(c.get("startups") or 0),
                            c=int(c.get("clusters") or 0),
                        )
                    )
                by_type = await _fetch(
                    conn,
                    """
                    SELECT event_type, COUNT(*) AS total
                    FROM startup_events
                    WHERE detected_at >= $1 AND detected_at < $2
                      AND cluster_id IS NOT NULL
                    GROUP BY event_type
                    ORDER BY total DESC
                    LIMIT 12
                    """,
                    start_ts,
                    end_ts,
                )
                if by_type:
                    parts = [f"{r.get('event_type')}={int(r.get('total') or 0)}" for r in by_type]
                    lines.append("- top_event_types: " + ", ".join(parts))

                if has_refresh_jobs:
                    jobs = await _fetch(
                        conn,
                        """
                        SELECT reason, COUNT(*) AS total
                        FROM startup_refresh_jobs
                        WHERE created_at >= $1 AND created_at < $2
                        GROUP BY reason
                        ORDER BY total DESC
                        LIMIT 12
                        """,
                        start_ts,
                        end_ts,
                    )
                    if jobs:
                        parts = [f"{r.get('reason')}={int(r.get('total') or 0)}" for r in jobs]
                        lines.append("- refresh_jobs_created: " + ", ".join(parts))
                lines.append("")
            except Exception as exc:
                lines.append("*News <> startup relationships*")
                lines.append(f"- unavailable: {exc}")
                lines.append("")

        # ---------------------------------------------------------------------
        # Memory / entity linking
        # ---------------------------------------------------------------------
        if _bool(has_item_extractions) or _bool(has_entity_facts):
            lines.append("*Memory gate linking*")
            if has_item_extractions:
                try:
                    ex = await _fetchrow(
                        conn,
                        """
                        SELECT
                          COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS created_today,
                          COUNT(*) FILTER (WHERE updated_at >= $1 AND updated_at < $2) AS updated_today
                        FROM news_item_extractions
                        """,
                        start_ts,
                        end_ts,
                    )
                    if ex:
                        lines.append(
                            "- news_item_extractions: created_today={c} updated_today={u}".format(
                                c=int(ex.get("created_today") or 0),
                                u=int(ex.get("updated_today") or 0),
                            )
                        )
                except Exception as exc:
                    lines.append(f"- news_item_extractions unavailable: {exc}")

            if has_entity_facts:
                try:
                    ef = await _fetchrow(
                        conn,
                        """
                        SELECT
                          COUNT(*) FILTER (WHERE linked_startup_id IS NOT NULL) AS linked_startups,
                          COUNT(*) FILTER (WHERE linked_investor_id IS NOT NULL) AS linked_investors
                        FROM news_entity_facts
                        WHERE is_current = TRUE
                          AND last_confirmed_at >= $1 AND last_confirmed_at < $2
                        """,
                        start_ts,
                        end_ts,
                    )
                    if ef:
                        lines.append(
                            "- news_entity_facts (current, confirmed_today): linked_startups={s} linked_investors={i}".format(
                                s=int(ef.get("linked_startups") or 0),
                                i=int(ef.get("linked_investors") or 0),
                            )
                        )
                except Exception as exc:
                    lines.append(f"- news_entity_facts unavailable: {exc}")
            lines.append("")

        print(_chunk(lines, max_chars=int(args.slack_max_chars)))
        return 0
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))

