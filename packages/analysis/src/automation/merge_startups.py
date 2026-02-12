"""
Startup merge/dedup — transactional merge of duplicate startups.

Moves all FK references from a FROM startup to a TO startup,
creates aliases for the old identifiers, and marks FROM as merged.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict, Optional

import asyncpg

logger = logging.getLogger(__name__)

# Tables with unique constraints that need conflict-delete before update.
# Each entry: (table, fk_col, conflict_delete_sql, update_sql)
# We handle these individually due to differing constraint shapes.

_DOMAIN_RE = re.compile(r"^(?:https?://)?(?:www\.)?([^/:]+)")


def _extract_domain(url: str) -> Optional[str]:
    """Extract bare domain from a URL."""
    m = _DOMAIN_RE.match(url.strip())
    return m.group(1).lower() if m else None


async def merge_startups(
    conn: asyncpg.Connection,
    from_id: str,
    to_id: str,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Merge startup FROM into TO inside a single transaction.

    All FK rows referencing FROM are re-pointed to TO.
    Old name/slug/domain become aliases on TO.
    FROM is marked as merged.

    If dry_run is True, all changes are rolled back via SAVEPOINT.

    Returns dict with per-table stats: {table: {moved: N, deleted: N}}.
    """
    if from_id == to_id:
        raise ValueError("Cannot merge a startup into itself")

    stats: Dict[str, Dict[str, int]] = {}

    sp = None

    async with conn.transaction():
        if dry_run:
            sp = conn.transaction()
            await sp.start()

        try:
            # 0. Advisory lock to serialise concurrent merges
            await conn.execute(
                "SELECT pg_advisory_xact_lock(hashtext('merge_startups'))"
            )

            # 1. Validate both exist and neither is already merged
            from_row = await conn.fetchrow(
                "SELECT id, name, slug, website, dataset_region, onboarding_status "
                "FROM startups WHERE id = $1",
                from_id,
            )
            to_row = await conn.fetchrow(
                "SELECT id, name, slug, website, dataset_region, onboarding_status "
                "FROM startups WHERE id = $1",
                to_id,
            )
            if not from_row:
                raise ValueError(f"FROM startup {from_id} not found")
            if not to_row:
                raise ValueError(f"TO startup {to_id} not found")

            from_status = from_row.get("onboarding_status") or "verified"
            to_status = to_row.get("onboarding_status") or "verified"
            if from_status == "merged":
                raise ValueError(f"FROM startup {from_id} is already merged")
            if to_status == "merged":
                raise ValueError(f"TO startup {to_id} is already merged")

            # ------------------------------------------------------------------
            # 2. High-risk tables (conflict-delete + update)
            # ------------------------------------------------------------------

            # funding_rounds — UNIQUE (startup_id, round_type, announced_date)
            del_fr = await conn.execute("""
                DELETE FROM funding_rounds fr
                USING funding_rounds fr2
                WHERE fr.startup_id = $1 AND fr2.startup_id = $2
                  AND fr.round_type = fr2.round_type
                  AND fr.announced_date IS NOT DISTINCT FROM fr2.announced_date
            """, from_id, to_id)
            upd_fr = await conn.execute(
                "UPDATE funding_rounds SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["funding_rounds"] = {
                "deleted": _cmd_count(del_fr),
                "moved": _cmd_count(upd_fr),
            }

            # startup_snapshots — UNIQUE (startup_id, period)
            del_ss = await conn.execute("""
                DELETE FROM startup_snapshots s
                USING startup_snapshots s2
                WHERE s.startup_id = $1 AND s2.startup_id = $2
                  AND s.period = s2.period
            """, from_id, to_id)
            upd_ss = await conn.execute(
                "UPDATE startup_snapshots SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["startup_snapshots"] = {
                "deleted": _cmd_count(del_ss),
                "moved": _cmd_count(upd_ss),
            }

            # startup_state_snapshot — UNIQUE (startup_id, analysis_period)
            del_sss = await conn.execute("""
                DELETE FROM startup_state_snapshot ss
                USING startup_state_snapshot ss2
                WHERE ss.startup_id = $1 AND ss2.startup_id = $2
                  AND ss.analysis_period = ss2.analysis_period
            """, from_id, to_id)
            upd_sss = await conn.execute(
                "UPDATE startup_state_snapshot SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["startup_state_snapshot"] = {
                "deleted": _cmd_count(del_sss),
                "moved": _cmd_count(upd_sss),
            }

            # startup_events — partial UNIQUE (cluster_id, startup_id, event_type, event_key)
            del_se = await conn.execute("""
                DELETE FROM startup_events e
                USING startup_events e2
                WHERE e.startup_id = $1 AND e2.startup_id = $2
                  AND e.cluster_id IS NOT NULL AND e2.cluster_id = e.cluster_id
                  AND e2.event_type = e.event_type AND e2.event_key = e.event_key
            """, from_id, to_id)
            upd_se = await conn.execute(
                "UPDATE startup_events SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["startup_events"] = {
                "deleted": _cmd_count(del_se),
                "moved": _cmd_count(upd_se),
            }

            # user_watchlists — UNIQUE (user_id, startup_id)
            del_uw = await conn.execute("""
                DELETE FROM user_watchlists uw
                USING user_watchlists uw2
                WHERE uw.startup_id = $1 AND uw2.startup_id = $2
                  AND uw.user_id = uw2.user_id
            """, from_id, to_id)
            upd_uw = await conn.execute(
                "UPDATE user_watchlists SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["user_watchlists"] = {
                "deleted": _cmd_count(del_uw),
                "moved": _cmd_count(upd_uw),
            }

            # competitor_links — UNIQUE (startup_id, competitor_id) + CHECK startup_id != competitor_id
            # Safe 6-step sequence to avoid unique violations and self-loops:
            #   A) Pre-delete competitor-side conflicts
            #   B) Update competitor_id FROM→TO
            #   C) Delete rows that would become self-loop: (FROM, TO) → (TO, TO)
            #   D) Delete startup-side conflicts
            #   E) Update startup_id FROM→TO
            #   F) Defensive self-loop cleanup

            # A) Pre-delete rows that would collide when competitor_id FROM → TO
            #    e.g. (X, FROM) and (X, TO) both exist → updating first creates duplicate
            del_cl_comp_conflicts = await conn.execute("""
                DELETE FROM competitor_links c
                USING competitor_links c2
                WHERE c.competitor_id = $1
                  AND c2.competitor_id = $2
                  AND c.startup_id = c2.startup_id
            """, from_id, to_id)

            # B) Move competitor_id references (now safe — no duplicates)
            upd_cl_comp = await conn.execute(
                "UPDATE competitor_links SET competitor_id = $2 WHERE competitor_id = $1",
                from_id, to_id,
            )

            # C) Delete rows that would become self-loop after startup_id update:
            #    (FROM, TO) would become (TO, TO), violating CHECK constraint
            del_cl_preloop = await conn.execute(
                "DELETE FROM competitor_links WHERE startup_id = $1 AND competitor_id = $2",
                from_id, to_id,
            )

            # D) Delete startup_id-side conflicts (FROM rows duplicating existing TO rows)
            del_cl = await conn.execute("""
                DELETE FROM competitor_links c
                USING competitor_links c2
                WHERE c.startup_id = $1 AND c2.startup_id = $2
                  AND c.competitor_id = c2.competitor_id
            """, from_id, to_id)

            # E) Move startup_id references (now safe)
            upd_cl = await conn.execute(
                "UPDATE competitor_links SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )

            # F) Defensive self-loop cleanup (should be no-op if above is correct)
            del_cl_self = await conn.execute(
                "DELETE FROM competitor_links WHERE startup_id = competitor_id"
            )
            stats["competitor_links"] = {
                "deleted": (
                    _cmd_count(del_cl_comp_conflicts)
                    + _cmd_count(del_cl_preloop)
                    + _cmd_count(del_cl)
                    + _cmd_count(del_cl_self)
                ),
                "moved": _cmd_count(upd_cl) + _cmd_count(upd_cl_comp),
            }

            # startup_refresh_jobs — partial UNIQUE (startup_id) WHERE status IN (...)
            upd_srj_complete = await conn.execute("""
                UPDATE startup_refresh_jobs
                SET status = 'completed', completed_at = NOW(),
                    error_message = COALESCE(error_message, '') || ' | merged'
                WHERE startup_id = $1 AND status IN ('pending', 'processing')
                  AND EXISTS (
                    SELECT 1 FROM startup_refresh_jobs j2
                    WHERE j2.startup_id = $2 AND j2.status IN ('pending', 'processing')
                  )
            """, from_id, to_id)
            upd_srj = await conn.execute(
                "UPDATE startup_refresh_jobs SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["startup_refresh_jobs"] = {
                "deleted": 0,
                "completed_active": _cmd_count(upd_srj_complete),
                "moved": _cmd_count(upd_srj),
            }

            # startup_architecture_history — UNIQUE (startup_id, domain, pattern_name, detected_at)
            del_sah = await conn.execute("""
                DELETE FROM startup_architecture_history ah
                USING startup_architecture_history ah2
                WHERE ah.startup_id = $1 AND ah2.startup_id = $2
                  AND ah.domain = ah2.domain AND ah.pattern_name = ah2.pattern_name
                  AND ah.detected_at = ah2.detected_at
            """, from_id, to_id)
            upd_sah = await conn.execute(
                "UPDATE startup_architecture_history SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["startup_architecture_history"] = {
                "deleted": _cmd_count(del_sah),
                "moved": _cmd_count(upd_sah),
            }

            # startup_briefs — UNIQUE (startup_id, version)
            del_sb = await conn.execute("""
                DELETE FROM startup_briefs sb
                USING startup_briefs sb2
                WHERE sb.startup_id = $1 AND sb2.startup_id = $2
                  AND sb.version = sb2.version
            """, from_id, to_id)
            upd_sb = await conn.execute(
                "UPDATE startup_briefs SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["startup_briefs"] = {
                "deleted": _cmd_count(del_sb),
                "moved": _cmd_count(upd_sb),
            }

            # deep_research_queue — partial UNIQUE (startup_id, status) WHERE status IN (...)
            upd_drq_complete = await conn.execute("""
                UPDATE deep_research_queue
                SET status = 'completed', completed_at = NOW()
                WHERE startup_id = $1 AND status IN ('pending', 'processing')
                  AND EXISTS (
                    SELECT 1 FROM deep_research_queue d2
                    WHERE d2.startup_id = $2 AND d2.status IN ('pending', 'processing')
                  )
            """, from_id, to_id)
            upd_drq = await conn.execute(
                "UPDATE deep_research_queue SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["deep_research_queue"] = {
                "deleted": 0,
                "completed_active": _cmd_count(upd_drq_complete),
                "moved": _cmd_count(upd_drq),
            }

            # investor_startup_links — UNIQUE (investor_id, startup_id)
            del_isl = await conn.execute("""
                DELETE FROM investor_startup_links isl
                USING investor_startup_links isl2
                WHERE isl.startup_id = $1 AND isl2.startup_id = $2
                  AND isl.investor_id = isl2.investor_id
            """, from_id, to_id)
            upd_isl = await conn.execute(
                "UPDATE investor_startup_links SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["investor_startup_links"] = {
                "deleted": _cmd_count(del_isl),
                "moved": _cmd_count(upd_isl),
            }

            # ------------------------------------------------------------------
            # 3. Lower-risk (straight update, no unique constraints)
            # ------------------------------------------------------------------

            upd_cl_logs = await conn.execute(
                "UPDATE crawl_logs SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["crawl_logs"] = {"moved": _cmd_count(upd_cl_logs)}

            upd_un = await conn.execute(
                "UPDATE user_notifications SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["user_notifications"] = {"moved": _cmd_count(upd_un)}

            # ------------------------------------------------------------------
            # 4. SET NULL FK tables
            # ------------------------------------------------------------------

            upd_nef = await conn.execute(
                "UPDATE news_entity_facts SET linked_startup_id = $2 WHERE linked_startup_id = $1",
                from_id, to_id,
            )
            stats["news_entity_facts"] = {"moved": _cmd_count(upd_nef)}

            upd_sev = await conn.execute(
                "UPDATE signal_evidence SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["signal_evidence"] = {"moved": _cmd_count(upd_sev)}

            # ------------------------------------------------------------------
            # 5. Create aliases from FROM's identifiers
            # ------------------------------------------------------------------

            from_name = (from_row["name"] or "").strip()
            from_slug = (from_row["slug"] or "").strip()
            from_website = (from_row["website"] or "").strip()

            aliases_created = 0
            if from_name:
                try:
                    await conn.execute(
                        "INSERT INTO startup_aliases (alias, startup_id, alias_type) "
                        "VALUES ($1, $2, 'name') ON CONFLICT (alias) DO NOTHING",
                        from_name.lower(), to_id,
                    )
                    aliases_created += 1
                except Exception:
                    pass  # alias already exists

            if from_slug:
                try:
                    await conn.execute(
                        "INSERT INTO startup_aliases (alias, startup_id, alias_type) "
                        "VALUES ($1, $2, 'slug') ON CONFLICT (alias) DO NOTHING",
                        from_slug.lower(), to_id,
                    )
                    aliases_created += 1
                except Exception:
                    pass

            if from_website:
                domain = _extract_domain(from_website)
                if domain:
                    try:
                        await conn.execute(
                            "INSERT INTO startup_aliases (alias, startup_id, alias_type) "
                            "VALUES ($1, $2, 'domain') ON CONFLICT (alias) DO NOTHING",
                            domain, to_id,
                        )
                        aliases_created += 1
                    except Exception:
                        pass

            # Move any existing aliases from FROM → TO
            upd_aliases = await conn.execute(
                "UPDATE startup_aliases SET startup_id = $2 WHERE startup_id = $1",
                from_id, to_id,
            )
            stats["aliases"] = {
                "created": aliases_created,
                "moved": _cmd_count(upd_aliases),
            }

            # ------------------------------------------------------------------
            # 6. Mark FROM as merged
            # ------------------------------------------------------------------

            await conn.execute(
                "UPDATE startups SET onboarding_status = 'merged', "
                "merged_into_startup_id = $2 WHERE id = $1",
                from_id, to_id,
            )

            # ------------------------------------------------------------------
            # 7. Recompute TO's money_raised_usd
            # ------------------------------------------------------------------

            await conn.execute("""
                UPDATE startups SET money_raised_usd = COALESCE(
                    (SELECT SUM(amount_usd) FROM funding_rounds
                     WHERE startup_id = $1 AND amount_usd IS NOT NULL), 0
                ) WHERE id = $1
            """, to_id)

            logger.info(
                "Merged startup %s (%s) → %s (%s)%s",
                from_id, from_name, to_id, to_row["name"],
                " [DRY RUN]" if dry_run else "",
            )

        finally:
            if dry_run and sp is not None:
                await sp.rollback()

    return {
        "from_id": from_id,
        "from_name": from_row["name"] if from_row else None,
        "to_id": to_id,
        "to_name": to_row["name"] if to_row else None,
        "dry_run": dry_run,
        "tables": stats,
    }


def _cmd_count(result: str) -> int:
    """Extract row count from asyncpg command status like 'UPDATE 3' or 'DELETE 1'."""
    if not result:
        return 0
    parts = str(result).split()
    if parts and parts[-1].isdigit():
        return int(parts[-1])
    return 0
