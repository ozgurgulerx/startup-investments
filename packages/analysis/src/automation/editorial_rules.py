"""Editorial Rule Engine — loads admin-curated and auto-generated rules to filter noise from the pipeline.

Rules are stored in ``news_editorial_rules`` and loaded once per ingest run.
Three filter stages:

1. **Pre-clustering** — ``should_exclude_item()``: drop raw items matching keyword / domain / title-pattern rules.
2. **Source weighting** — ``adjust_source_weight()``: multiply credibility by source-downweight rules.
3. **Post-gating** — ``should_exclude_cluster()``: force-drop clusters matching topic / entity exclusions.

Auto-rule generation (``generate_rule_suggestions``) examines recent editorial actions and proposes
new rules when recurring rejection patterns are detected. Suggested rules require admin approval
before taking effect.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Dict, List, Optional
from urllib.parse import urlparse

if TYPE_CHECKING:
    import asyncpg

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------

@dataclass
class _Rule:
    id: str
    rule_type: str
    region: str
    rule_value: str
    rule_weight: float = 1.0


# ---------------------------------------------------------------------------
# EditorialRuleEngine
# ---------------------------------------------------------------------------

class EditorialRuleEngine:
    """Loads active approved rules and applies them as pre/post filters during ingest."""

    def __init__(self) -> None:
        self._keyword_excludes: List[_Rule] = []
        self._domain_excludes: List[_Rule] = []
        self._title_pattern_excludes: List[_Rule] = []
        self._source_downweights: Dict[str, float] = {}  # source_key -> weight multiplier
        self._topic_excludes: List[_Rule] = []
        self._entity_excludes: List[_Rule] = []
        self._loaded = False
        self._region = "global"

    @property
    def loaded(self) -> bool:
        return self._loaded

    async def load(
        self,
        conn: "asyncpg.Connection",
        region: str = "global",
    ) -> None:
        """Load active approved rules for the given region (always includes global)."""
        self._region = region
        try:
            rows = await conn.fetch(
                """
                SELECT id::text, rule_type, region, rule_value, rule_weight
                FROM news_editorial_rules
                WHERE is_active = true
                  AND approved_at IS NOT NULL
                  AND (expires_at IS NULL OR expires_at > now())
                  AND (region = 'global' OR region = $1)
                """,
                region,
            )
            for row in rows:
                rule = _Rule(
                    id=row["id"],
                    rule_type=row["rule_type"],
                    region=row["region"],
                    rule_value=row["rule_value"],
                    rule_weight=float(row["rule_weight"] or 1.0),
                )
                if rule.rule_type == "keyword_exclude":
                    self._keyword_excludes.append(rule)
                elif rule.rule_type == "domain_exclude":
                    self._domain_excludes.append(rule)
                elif rule.rule_type == "title_pattern_exclude":
                    self._title_pattern_excludes.append(rule)
                elif rule.rule_type == "source_downweight":
                    self._source_downweights[rule.rule_value] = rule.rule_weight
                elif rule.rule_type == "topic_exclude":
                    self._topic_excludes.append(rule)
                elif rule.rule_type == "entity_exclude":
                    self._entity_excludes.append(rule)

            self._loaded = True
            total = len(rows)
            logger.info(
                "[editorial] loaded %d rules (kw=%d, dom=%d, pat=%d, src=%d, topic=%d, ent=%d, region=%s)",
                total,
                len(self._keyword_excludes),
                len(self._domain_excludes),
                len(self._title_pattern_excludes),
                len(self._source_downweights),
                len(self._topic_excludes),
                len(self._entity_excludes),
                region,
            )
        except Exception as exc:
            logger.warning("[editorial] failed to load rules (table may not exist): %s", exc)
            self._loaded = False

    # ------------------------------------------------------------------
    # Pre-clustering filter
    # ------------------------------------------------------------------

    def should_exclude_item(self, item: Any) -> Optional[str]:
        """Return a reason string if this raw item should be excluded, else None.

        Checks keyword_exclude (title+summary), domain_exclude (URL), title_pattern_exclude (regex).
        """
        if not self._loaded:
            return None

        title = getattr(item, "title", "") or ""
        summary = getattr(item, "summary", "") or ""
        url = getattr(item, "url", "") or getattr(item, "canonical_url", "") or ""
        text_lower = f"{title} {summary}".lower()

        # Keyword excludes
        for rule in self._keyword_excludes:
            if rule.rule_value.lower() in text_lower:
                return f"keyword_exclude: {rule.rule_value}"

        # Domain excludes
        if url:
            try:
                domain = urlparse(url).netloc.lower().lstrip("www.")
            except Exception:
                domain = ""
            for rule in self._domain_excludes:
                if rule.rule_value.lower() == domain or domain.endswith("." + rule.rule_value.lower()):
                    return f"domain_exclude: {rule.rule_value}"

        # Title pattern excludes (regex)
        for rule in self._title_pattern_excludes:
            try:
                if re.search(rule.rule_value, title, re.IGNORECASE):
                    return f"title_pattern_exclude: {rule.rule_value}"
            except re.error:
                pass  # skip invalid regex

        return None

    # ------------------------------------------------------------------
    # Source weight adjustment
    # ------------------------------------------------------------------

    def adjust_source_weight(self, source_key: str) -> float:
        """Return multiplier for source credibility weight. Default 1.0 (no change)."""
        return self._source_downweights.get(source_key, 1.0)

    # ------------------------------------------------------------------
    # Post-gating filter
    # ------------------------------------------------------------------

    def should_exclude_cluster(self, cluster: Any) -> Optional[str]:
        """Return a reason string if this cluster should be force-dropped, else None.

        Checks topic_exclude and entity_exclude against cluster's topic_tags and entities.
        """
        if not self._loaded:
            return None

        topic_tags = getattr(cluster, "topic_tags", []) or []
        entities = getattr(cluster, "entities", []) or []

        tags_lower = {t.lower().strip() for t in topic_tags if t}
        for rule in self._topic_excludes:
            if rule.rule_value.lower() in tags_lower:
                return f"topic_exclude: {rule.rule_value}"

        entities_lower = {e.lower().strip() for e in entities if e}
        for rule in self._entity_excludes:
            if rule.rule_value.lower() in entities_lower:
                return f"entity_exclude: {rule.rule_value}"

        return None


# ---------------------------------------------------------------------------
# Auto-rule generation
# ---------------------------------------------------------------------------

async def generate_rule_suggestions(
    conn: "asyncpg.Connection",
    *,
    region: str = "global",
) -> List[Dict[str, Any]]:
    """Examine recent editorial rejections and suggest new rules.

    Thresholds:
    - 3+ rejections with same keyword in title_keywords → keyword_exclude
    - 3+ rejections from same source_key (7d) → source_downweight (0.5)
    - 5+ rejections from same source (14d) → source_downweight (0.3)
    - 2+ rejections from same URL domain → domain_exclude
    - 3+ rejections with same topic tag + same reason → topic_exclude
    - 3+ rejections with same entity → entity_exclude

    Returns list of newly suggested rules (inserted into DB with approved_at=NULL).
    """
    suggestions: List[Dict[str, Any]] = []

    try:
        # --- Keyword patterns (7d) ---
        kw_rows = await conn.fetch(
            """
            SELECT kw, array_agg(DISTINCT a.id) AS action_ids, count(*) AS cnt
            FROM news_editorial_actions a, unnest(a.title_keywords) AS kw
            WHERE a.action = 'reject'
              AND a.created_at > now() - interval '7 days'
              AND (a.region = $1 OR a.region = 'global')
            GROUP BY kw
            HAVING count(*) >= 3
            """,
            region,
        )
        for row in kw_rows:
            suggestions.append(await _upsert_suggestion(
                conn,
                rule_type="keyword_exclude",
                region=region,
                rule_value=row["kw"],
                action_ids=list(row["action_ids"]),
                count=int(row["cnt"]),
                confidence=min(1.0, int(row["cnt"]) / 10.0),
            ))

        # --- Source patterns (7d → 0.5 weight, 14d → 0.3 weight) ---
        src_rows_7d = await conn.fetch(
            """
            SELECT source_key, array_agg(DISTINCT id) AS action_ids, count(*) AS cnt
            FROM news_editorial_actions
            WHERE action = 'reject'
              AND source_key IS NOT NULL
              AND created_at > now() - interval '7 days'
              AND (region = $1 OR region = 'global')
            GROUP BY source_key
            HAVING count(*) >= 3
            """,
            region,
        )
        for row in src_rows_7d:
            cnt = int(row["cnt"])
            weight = 0.3 if cnt >= 5 else 0.5
            suggestions.append(await _upsert_suggestion(
                conn,
                rule_type="source_downweight",
                region=region,
                rule_value=row["source_key"],
                rule_weight=weight,
                action_ids=list(row["action_ids"]),
                count=cnt,
                confidence=min(1.0, cnt / 8.0),
            ))

        # --- Domain patterns (14d) ---
        domain_rows = await conn.fetch(
            """
            SELECT domain, array_agg(DISTINCT a.id) AS action_ids, count(*) AS cnt
            FROM (
                SELECT id,
                       regexp_replace(
                           regexp_replace(
                               split_part(
                                   split_part(
                                       (SELECT url FROM news_clusters c WHERE c.id = a2.cluster_id LIMIT 1),
                                   '://', 2),
                               '/', 1),
                           '^www\\.', ''),
                       ':.*$', '') AS domain
                FROM news_editorial_actions a2
                WHERE a2.action = 'reject'
                  AND a2.created_at > now() - interval '14 days'
                  AND (a2.region = $1 OR a2.region = 'global')
            ) a
            WHERE domain IS NOT NULL AND domain != ''
            GROUP BY domain
            HAVING count(*) >= 2
            """,
            region,
        )
        for row in domain_rows:
            if row["domain"]:
                suggestions.append(await _upsert_suggestion(
                    conn,
                    rule_type="domain_exclude",
                    region=region,
                    rule_value=row["domain"],
                    action_ids=list(row["action_ids"]),
                    count=int(row["cnt"]),
                    confidence=min(1.0, int(row["cnt"]) / 5.0),
                ))

        # --- Topic + reason patterns (14d) ---
        topic_rows = await conn.fetch(
            """
            SELECT tag, array_agg(DISTINCT a.id) AS action_ids, count(*) AS cnt
            FROM news_editorial_actions a, unnest(a.topic_tags) AS tag
            WHERE a.action = 'reject'
              AND a.reason_category IS NOT NULL
              AND a.created_at > now() - interval '14 days'
              AND (a.region = $1 OR a.region = 'global')
            GROUP BY tag, a.reason_category
            HAVING count(*) >= 3
            """,
            region,
        )
        for row in topic_rows:
            suggestions.append(await _upsert_suggestion(
                conn,
                rule_type="topic_exclude",
                region=region,
                rule_value=row["tag"],
                action_ids=list(row["action_ids"]),
                count=int(row["cnt"]),
                confidence=min(1.0, int(row["cnt"]) / 8.0),
            ))

        # --- Entity patterns (14d) ---
        ent_rows = await conn.fetch(
            """
            SELECT ent, array_agg(DISTINCT a.id) AS action_ids, count(*) AS cnt
            FROM news_editorial_actions a, unnest(a.entities) AS ent
            WHERE a.action = 'reject'
              AND a.created_at > now() - interval '14 days'
              AND (a.region = $1 OR a.region = 'global')
            GROUP BY ent
            HAVING count(*) >= 3
            """,
            region,
        )
        for row in ent_rows:
            suggestions.append(await _upsert_suggestion(
                conn,
                rule_type="entity_exclude",
                region=region,
                rule_value=row["ent"],
                action_ids=list(row["action_ids"]),
                count=int(row["cnt"]),
                confidence=min(1.0, int(row["cnt"]) / 8.0),
            ))

    except Exception as exc:
        logger.warning("[editorial] failed to generate rule suggestions: %s", exc)

    created = [s for s in suggestions if s.get("created")]
    if created:
        logger.info("[editorial] generated %d new rule suggestions for region=%s", len(created), region)
    return suggestions


async def _upsert_suggestion(
    conn: "asyncpg.Connection",
    *,
    rule_type: str,
    region: str,
    rule_value: str,
    action_ids: List[str],
    count: int,
    confidence: float,
    rule_weight: float = 1.0,
) -> Dict[str, Any]:
    """Insert or update an auto-generated rule suggestion."""
    sample_ids = action_ids[:5]  # keep at most 5 sample IDs
    existing = await conn.fetchrow(
        """
        SELECT id::text, supporting_action_count, approved_at
        FROM news_editorial_rules
        WHERE rule_type = $1 AND region = $2 AND rule_value = $3 AND is_active = true
        """,
        rule_type, region, rule_value,
    )
    if existing:
        # Update supporting count if not yet approved
        if existing["approved_at"] is None:
            await conn.execute(
                """
                UPDATE news_editorial_rules
                SET supporting_action_count = $2, confidence = $3, sample_action_ids = $4::uuid[]
                WHERE id = $1::uuid
                """,
                existing["id"], count, confidence, sample_ids,
            )
        return {"rule_type": rule_type, "rule_value": rule_value, "created": False, "updated": True}

    await conn.execute(
        """
        INSERT INTO news_editorial_rules
            (rule_type, region, rule_value, rule_weight, is_active, is_auto_generated,
             supporting_action_count, sample_action_ids, confidence)
        VALUES ($1, $2, $3, $4, true, true, $5, $6::uuid[], $7)
        """,
        rule_type, region, rule_value, rule_weight, count, sample_ids, confidence,
    )
    return {"rule_type": rule_type, "rule_value": rule_value, "created": True, "updated": False}


# ---------------------------------------------------------------------------
# Helpers for loading rejected cluster IDs (used in edition building)
# ---------------------------------------------------------------------------

async def load_rejected_cluster_ids(
    conn: "asyncpg.Connection",
    region: str = "global",
    *,
    lookback_hours: int = 48,
) -> set:
    """Return set of cluster_id strings that have been rejected by admin in the lookback window."""
    try:
        rows = await conn.fetch(
            """
            SELECT DISTINCT cluster_id::text
            FROM news_editorial_actions
            WHERE action = 'reject'
              AND created_at > now() - make_interval(hours => $1)
              AND (region = $2 OR region = 'global')
            """,
            lookback_hours, region,
        )
        return {r["cluster_id"] for r in rows}
    except Exception as exc:
        logger.warning("[editorial] failed to load rejected cluster IDs: %s", exc)
        return set()
