"""Extract queryable startup state from analysis_data JSONB.

Pure extraction — no LLM calls. Parses structured fields from the monolithic
analysis_data column into the startup_state_snapshot table for cross-startup
comparison queries.
"""

import json
import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


class StateExtractor:
    """Extract queryable startup state from analysis_data JSONB."""

    def __init__(self, differ=None, embedding_service=None):
        """
        Args:
            differ: Optional StateDiffer instance for computing diffs after snapshot.
            embedding_service: Optional EmbeddingService for Phase 5 state embedding.
        """
        self._differ = differ
        self._embedding_service = embedding_service

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def extract_snapshot(
        self,
        conn,
        startup_id: str,
        analysis_data: dict,
        period: str,
        source: str = "analysis",
    ) -> Optional[dict]:
        """Extract structured state from analysis_data and upsert into startup_state_snapshot.

        Returns the extracted snapshot dict, or None if analysis_data is empty.
        """
        if not analysis_data:
            return None

        snapshot = self._parse_analysis_data(analysis_data)
        snapshot["startup_id"] = startup_id
        snapshot["analysis_period"] = period
        snapshot["source"] = source

        # Upsert into startup_state_snapshot
        await conn.execute(
            """INSERT INTO startup_state_snapshot (
                   startup_id, funding_stage, vertical, sub_vertical,
                   market_type, target_market, genai_intensity,
                   build_patterns, discovered_patterns,
                   tech_stack_models, tech_stack_frameworks, tech_stack_vector_dbs,
                   pricing_model, gtm_motion,
                   engineering_quality_score, confidence_score, implementation_maturity,
                   moat_type, snapshot_at, analysis_period, source
               ) VALUES (
                   $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                   $11, $12, $13, $14, $15, $16, $17, $18, NOW(), $19, $20
               )
               ON CONFLICT (startup_id, analysis_period) DO UPDATE SET
                   funding_stage = EXCLUDED.funding_stage,
                   vertical = EXCLUDED.vertical,
                   sub_vertical = EXCLUDED.sub_vertical,
                   market_type = EXCLUDED.market_type,
                   target_market = EXCLUDED.target_market,
                   genai_intensity = EXCLUDED.genai_intensity,
                   build_patterns = EXCLUDED.build_patterns,
                   discovered_patterns = EXCLUDED.discovered_patterns,
                   tech_stack_models = EXCLUDED.tech_stack_models,
                   tech_stack_frameworks = EXCLUDED.tech_stack_frameworks,
                   tech_stack_vector_dbs = EXCLUDED.tech_stack_vector_dbs,
                   pricing_model = EXCLUDED.pricing_model,
                   gtm_motion = EXCLUDED.gtm_motion,
                   engineering_quality_score = EXCLUDED.engineering_quality_score,
                   confidence_score = EXCLUDED.confidence_score,
                   implementation_maturity = EXCLUDED.implementation_maturity,
                   moat_type = EXCLUDED.moat_type,
                   snapshot_at = NOW(),
                   source = EXCLUDED.source""",
            startup_id,
            snapshot.get("funding_stage"),
            snapshot.get("vertical"),
            snapshot.get("sub_vertical"),
            snapshot.get("market_type"),
            snapshot.get("target_market"),
            snapshot.get("genai_intensity"),
            snapshot.get("build_patterns", []),
            snapshot.get("discovered_patterns", []),
            snapshot.get("tech_stack_models", []),
            snapshot.get("tech_stack_frameworks", []),
            snapshot.get("tech_stack_vector_dbs", []),
            snapshot.get("pricing_model"),
            snapshot.get("gtm_motion"),
            snapshot.get("engineering_quality_score"),
            snapshot.get("confidence_score"),
            snapshot.get("implementation_maturity"),
            snapshot.get("moat_type"),
            period,
            source,
        )

        # Phase 2: Diff against previous snapshot if differ is available
        if self._differ:
            await self._differ.diff_and_record(conn, startup_id, snapshot, period)

        # Phase 5: Generate state embedding if service is available
        if self._embedding_service:
            await self._embed_snapshot(conn, startup_id, snapshot, period)

        return snapshot

    async def backfill_all(
        self,
        conn,
        period: Optional[str] = None,
    ) -> Dict[str, int]:
        """Backfill state snapshots from all startups with analysis_data.

        Args:
            conn: asyncpg connection
            period: Optional period filter. If None, backfills all.

        Returns:
            Dict with counts: extracted, skipped, errors
        """
        query = """
            SELECT s.id::text AS startup_id, s.analysis_data, s.period
            FROM startups s
            WHERE s.analysis_data IS NOT NULL
        """
        params: list = []

        if period:
            query += " AND s.period = $1"
            params.append(period)

        rows = await conn.fetch(query, *params)

        stats = {"extracted": 0, "skipped": 0, "errors": 0}

        for row in rows:
            try:
                ad = row["analysis_data"]
                if isinstance(ad, str):
                    ad = json.loads(ad)
                if not ad:
                    stats["skipped"] += 1
                    continue

                row_period = row.get("period") or period or "unknown"
                await self.extract_snapshot(
                    conn,
                    row["startup_id"],
                    ad,
                    row_period,
                    source="analysis",
                )
                stats["extracted"] += 1
            except Exception as exc:
                logger.warning(
                    "Failed to extract snapshot for startup %s: %s",
                    row["startup_id"],
                    exc,
                )
                stats["errors"] += 1

        logger.info(
            "Backfill complete: %d extracted, %d skipped, %d errors",
            stats["extracted"],
            stats["skipped"],
            stats["errors"],
        )
        return stats

    # ------------------------------------------------------------------
    # Extraction helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_analysis_data(data: dict) -> dict:
        """Parse analysis_data JSONB into flat snapshot fields."""
        snapshot: Dict[str, Any] = {}

        # Classification
        snapshot["funding_stage"] = data.get("funding_stage")
        snapshot["vertical"] = data.get("vertical")
        snapshot["sub_vertical"] = data.get("sub_vertical")
        snapshot["market_type"] = data.get("market_type")
        snapshot["target_market"] = data.get("target_market")
        snapshot["genai_intensity"] = data.get("genai_intensity")

        # Build patterns → TEXT[] of pattern names
        build_patterns = data.get("build_patterns", [])
        if isinstance(build_patterns, list):
            snapshot["build_patterns"] = [
                p.get("name", p) if isinstance(p, dict) else str(p)
                for p in build_patterns
                if p
            ]
        else:
            snapshot["build_patterns"] = []

        # Discovered patterns → TEXT[] of pattern_name
        discovered = data.get("discovered_patterns", [])
        if isinstance(discovered, list):
            snapshot["discovered_patterns"] = [
                p.get("pattern_name", p) if isinstance(p, dict) else str(p)
                for p in discovered
                if p
            ]
        else:
            snapshot["discovered_patterns"] = []

        # Tech stack → separate arrays
        tech_stack = data.get("tech_stack", {})
        if isinstance(tech_stack, dict):
            snapshot["tech_stack_models"] = _safe_list(tech_stack.get("llm_models"))
            snapshot["tech_stack_frameworks"] = _safe_list(tech_stack.get("frameworks"))
            snapshot["tech_stack_vector_dbs"] = _safe_list(tech_stack.get("vector_databases"))
        else:
            snapshot["tech_stack_models"] = []
            snapshot["tech_stack_frameworks"] = []
            snapshot["tech_stack_vector_dbs"] = []

        # GTM state
        biz = data.get("business_model", {})
        if isinstance(biz, dict):
            pricing = biz.get("pricing_model", {})
            if isinstance(pricing, dict):
                snapshot["pricing_model"] = pricing.get("type")
            else:
                snapshot["pricing_model"] = str(pricing) if pricing else None

            gtm = biz.get("gtm_strategy", {})
            if isinstance(gtm, dict):
                snapshot["gtm_motion"] = gtm.get("primary_channel")
            else:
                snapshot["gtm_motion"] = str(gtm) if gtm else None
        else:
            snapshot["pricing_model"] = None
            snapshot["gtm_motion"] = None

        # Scores
        eq = data.get("engineering_quality", {})
        if isinstance(eq, dict):
            score = eq.get("score")
            snapshot["engineering_quality_score"] = float(score) if score is not None else None
        else:
            snapshot["engineering_quality_score"] = None

        snapshot["confidence_score"] = _safe_float(data.get("confidence_score"))
        snapshot["implementation_maturity"] = data.get("implementation_maturity")

        # Competitive moat
        comp = data.get("competitive_analysis", {})
        if isinstance(comp, dict):
            moat_types = comp.get("moat_types", [])
            if isinstance(moat_types, list) and moat_types:
                # Take the first moat type as primary
                first = moat_types[0]
                snapshot["moat_type"] = first if isinstance(first, str) else str(first)
            else:
                snapshot["moat_type"] = None
        else:
            snapshot["moat_type"] = None

        return snapshot

    # ------------------------------------------------------------------
    # Phase 5: State embedding
    # ------------------------------------------------------------------

    async def _embed_snapshot(
        self,
        conn,
        startup_id: str,
        snapshot: dict,
        period: str,
    ) -> None:
        """Serialize snapshot to text, embed it, and store the vector."""
        text = self._snapshot_to_text(snapshot)
        if not text:
            return

        try:
            embeddings = await self._embedding_service.embed_texts([text])
            if embeddings and embeddings[0]:
                vec_str = "[" + ",".join(str(v) for v in embeddings[0]) + "]"
                await conn.execute(
                    """UPDATE startup_state_snapshot
                       SET state_embedding = $1::vector, embedded_at = NOW()
                       WHERE startup_id = $2 AND analysis_period = $3""",
                    vec_str,
                    startup_id,
                    period,
                )
        except Exception as exc:
            logger.warning("Failed to embed snapshot for %s: %s", startup_id, exc)

    @staticmethod
    def _snapshot_to_text(snapshot: dict) -> str:
        """Serialize snapshot to a text representation for embedding."""
        parts: List[str] = []

        if snapshot.get("funding_stage"):
            parts.append(f"Stage: {snapshot['funding_stage']}")
        if snapshot.get("vertical"):
            parts.append(f"Vertical: {snapshot['vertical']}")
        if snapshot.get("sub_vertical"):
            parts.append(f"Sub-vertical: {snapshot['sub_vertical']}")
        if snapshot.get("genai_intensity"):
            parts.append(f"GenAI: {snapshot['genai_intensity']}")

        bp = snapshot.get("build_patterns", [])
        if bp:
            parts.append(f"Patterns: {', '.join(bp)}")

        dp = snapshot.get("discovered_patterns", [])
        if dp:
            parts.append(f"Discovered: {', '.join(dp[:10])}")

        models = snapshot.get("tech_stack_models", [])
        if models:
            parts.append(f"Models: {', '.join(models)}")

        frameworks = snapshot.get("tech_stack_frameworks", [])
        if frameworks:
            parts.append(f"Frameworks: {', '.join(frameworks)}")

        if snapshot.get("gtm_motion"):
            parts.append(f"GTM: {snapshot['gtm_motion']}")
        if snapshot.get("pricing_model"):
            parts.append(f"Pricing: {snapshot['pricing_model']}")
        if snapshot.get("target_market"):
            parts.append(f"Market: {snapshot['target_market']}")
        if snapshot.get("implementation_maturity"):
            parts.append(f"Maturity: {snapshot['implementation_maturity']}")
        if snapshot.get("moat_type"):
            parts.append(f"Moat: {snapshot['moat_type']}")

        return " | ".join(parts)


# ------------------------------------------------------------------
# Module-level helpers
# ------------------------------------------------------------------


def _safe_list(val) -> List[str]:
    """Convert value to a list of strings, handling None/non-list gracefully."""
    if not val:
        return []
    if isinstance(val, list):
        return [str(v) for v in val if v]
    return []


def _safe_float(val) -> Optional[float]:
    """Convert value to float, returning None on failure."""
    if val is None:
        return None
    try:
        return float(val)
    except (ValueError, TypeError):
        return None
