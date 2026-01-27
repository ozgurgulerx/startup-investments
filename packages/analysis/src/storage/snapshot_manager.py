"""Snapshot manager for context reconciliation and version tracking.

This module implements the CRITICAL content reconciliation workflow that ensures
we NEVER lose historical context when new data arrives. The principle is:
"Merge, Don't Replace" - OLD ANALYSIS + NEW CRAWL DATA = MERGED ANALYSIS.
"""

import hashlib
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from .blob_client import BlobStorageClient, ContainerName


@dataclass
class ContentDiff:
    """Represents the difference between old and new content."""
    is_new: bool = False  # First time seeing this content
    has_changes: bool = False  # Content has changed
    added: List[str] = field(default_factory=list)  # New content sections
    removed: List[str] = field(default_factory=list)  # Removed content sections
    modified: List[str] = field(default_factory=list)  # Changed content sections
    unchanged: List[str] = field(default_factory=list)  # Same content sections
    old_hash: Optional[str] = None
    new_hash: Optional[str] = None


@dataclass
class ReconciliationContext:
    """Context for content reconciliation containing all historical state."""
    slug: str
    current_date: datetime

    # Historical crawl data
    crawl_history: List[Dict[str, Any]] = field(default_factory=list)
    latest_crawl: Optional[Dict[str, Any]] = None

    # Historical analyses
    analysis_history: List[Dict[str, Any]] = field(default_factory=list)
    current_analysis: Optional[Dict[str, Any]] = None

    # Change tracking
    funding_changed: bool = False
    website_changed: bool = False
    description_changed: bool = False
    is_stale: bool = False  # 90+ days since last crawl
    trigger_reason: str = ""  # What triggered this reconciliation

    # Computed diffs
    content_diffs: Dict[str, ContentDiff] = field(default_factory=dict)


class SnapshotManager:
    """Manages snapshots and content reconciliation across blob storage."""

    def __init__(self, blob_client: Optional[BlobStorageClient] = None):
        """Initialize snapshot manager.

        Args:
            blob_client: Blob storage client (uses default if not provided)
        """
        from .blob_client import get_blob_client
        self.blob_client = blob_client or get_blob_client()

    # =========================================================================
    # Context building (Step 1: Load all historical state)
    # =========================================================================

    def build_reconciliation_context(
        self,
        slug: str,
        trigger_reason: str = "",
        funding_changed: bool = False,
        website_changed: bool = False,
        description_changed: bool = False,
    ) -> ReconciliationContext:
        """Build complete reconciliation context for a startup.

        This loads ALL historical state needed for smart merging:
        - All previous crawl snapshots
        - All previous analyses
        - Current analysis (latest.json)
        - Company evolution timeline

        Args:
            slug: Startup slug
            trigger_reason: What triggered this reconciliation
            funding_changed: Whether funding amount/stage changed
            website_changed: Whether website content hash changed
            description_changed: Whether description significantly changed

        Returns:
            ReconciliationContext with all historical data loaded
        """
        ctx = ReconciliationContext(
            slug=slug,
            current_date=datetime.now(timezone.utc),
            trigger_reason=trigger_reason,
            funding_changed=funding_changed,
            website_changed=website_changed,
            description_changed=description_changed,
        )

        # Load crawl history
        crawl_snapshots = self.blob_client.list_crawl_snapshots(slug)
        for snapshot_info in crawl_snapshots:
            snapshot_data = self.blob_client.get_crawl_snapshot(slug, snapshot_info["date"])
            if snapshot_data:
                ctx.crawl_history.append(snapshot_data)

        if ctx.crawl_history:
            ctx.latest_crawl = ctx.crawl_history[0]  # Already sorted by date desc

            # Check staleness (90+ days since last crawl)
            last_crawl_date = ctx.latest_crawl["date"]
            days_since_crawl = (ctx.current_date - last_crawl_date).days
            ctx.is_stale = days_since_crawl >= 90

        # Load analysis history
        analysis_snapshots = self.blob_client.list_analysis_snapshots(slug)
        for snapshot_info in analysis_snapshots:
            analysis_data = self.blob_client.get_analysis_snapshot(slug, snapshot_info["date"])
            if analysis_data:
                ctx.analysis_history.append(analysis_data)

        # Load current analysis (latest)
        ctx.current_analysis = self.blob_client.get_analysis_snapshot(slug)

        return ctx

    # =========================================================================
    # Diff computation (Step 2: Determine what changed)
    # =========================================================================

    def compute_content_diff(
        self,
        old_content: Optional[Dict[str, Any]],
        new_content: Dict[str, Any],
        content_type: str = "website",
    ) -> ContentDiff:
        """Compute diff between old and new content.

        Args:
            old_content: Previous content (None if first time)
            new_content: New crawled content
            content_type: Type of content (website, github, news)

        Returns:
            ContentDiff with detailed change information
        """
        diff = ContentDiff()

        if old_content is None:
            diff.is_new = True
            diff.has_changes = True
            diff.new_hash = self._compute_hash(new_content)
            return diff

        old_hash = self._compute_hash(old_content)
        new_hash = self._compute_hash(new_content)

        diff.old_hash = old_hash
        diff.new_hash = new_hash
        diff.has_changes = old_hash != new_hash

        if not diff.has_changes:
            diff.unchanged = list(new_content.keys()) if isinstance(new_content, dict) else []
            return diff

        # Compute detailed diff for dict content
        if isinstance(old_content, dict) and isinstance(new_content, dict):
            old_keys = set(old_content.keys())
            new_keys = set(new_content.keys())

            diff.added = list(new_keys - old_keys)
            diff.removed = list(old_keys - new_keys)

            for key in old_keys & new_keys:
                if self._compute_hash(old_content[key]) != self._compute_hash(new_content.get(key)):
                    diff.modified.append(key)
                else:
                    diff.unchanged.append(key)

        return diff

    def compute_all_diffs(
        self,
        ctx: ReconciliationContext,
        new_crawl: Dict[str, Any],
    ) -> ReconciliationContext:
        """Compute diffs for all content types.

        Args:
            ctx: Reconciliation context
            new_crawl: New crawl data

        Returns:
            Updated context with content_diffs populated
        """
        content_types = ["website", "github", "news", "jobs"]

        for content_type in content_types:
            old_content = None
            if ctx.latest_crawl:
                old_content = ctx.latest_crawl.get(content_type)

            new_content = new_crawl.get(content_type)
            if new_content is not None:
                ctx.content_diffs[content_type] = self.compute_content_diff(
                    old_content, new_content, content_type
                )

        return ctx

    # =========================================================================
    # Merge strategies (Step 3: Smart merging of old + new)
    # =========================================================================

    def prepare_merge_context(
        self,
        ctx: ReconciliationContext,
        new_crawl: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Prepare context for LLM merge analysis.

        This creates the input for the LLM that will merge old analysis
        with new findings while PRESERVING all historical insights.

        Args:
            ctx: Reconciliation context with all history
            new_crawl: New crawl data

        Returns:
            Dict ready to be sent to LLM for merge analysis
        """
        # Compute diffs
        ctx = self.compute_all_diffs(ctx, new_crawl)

        merge_context = {
            "slug": ctx.slug,
            "reconciliation_date": ctx.current_date.isoformat(),
            "trigger_reason": ctx.trigger_reason,

            # Change flags
            "changes": {
                "funding_changed": ctx.funding_changed,
                "website_changed": ctx.website_changed,
                "description_changed": ctx.description_changed,
                "is_stale_refresh": ctx.is_stale,
            },

            # Current analysis (MUST be preserved and extended)
            "current_analysis": ctx.current_analysis,

            # Analysis history for context
            "analysis_history": [
                {
                    "date": a.get("_snapshot_date") or a.get("analyzed_at"),
                    "key_findings": a.get("unique_findings", [])[:5],
                    "patterns": [p.get("name") for p in a.get("build_patterns", [])],
                }
                for a in ctx.analysis_history[:5]  # Last 5 analyses
            ],

            # New crawl data with diff markers
            "new_crawl": {
                content_type: {
                    "content": new_crawl.get(content_type),
                    "diff": {
                        "is_new": diff.is_new,
                        "has_changes": diff.has_changes,
                        "added_sections": diff.added,
                        "modified_sections": diff.modified,
                    } if (diff := ctx.content_diffs.get(content_type)) else None
                }
                for content_type in ["website", "github", "news", "jobs"]
                if new_crawl.get(content_type) is not None
            },

            # Crawl timeline
            "crawl_history": [
                {
                    "date": c["date"].isoformat() if isinstance(c["date"], datetime) else c["date"],
                    "content_hashes": c.get("manifest", {}).get("content_hashes", {}),
                }
                for c in ctx.crawl_history[:10]  # Last 10 crawls
            ],

            # Instructions for LLM
            "merge_instructions": self._get_merge_instructions(),
        }

        return merge_context

    def _get_merge_instructions(self) -> Dict[str, Any]:
        """Get merge instructions for LLM.

        Returns:
            Dict with field-level merge rules
        """
        return {
            "principle": "PRESERVE all historical insights. ADD new findings. NOTE evolution. Never remove information unless explicitly contradicted.",

            "field_rules": {
                "scalar_values": {
                    "rule": "UPDATE to latest",
                    "examples": ["funding_amount", "funding_stage", "website"],
                },
                "array_findings": {
                    "rule": "APPEND new, keep old",
                    "examples": ["unique_findings", "evidence_quotes"],
                },
                "array_angles": {
                    "rule": "ADD new, prune only if contradicted",
                    "examples": ["story_angles"],
                },
                "history_fields": {
                    "rule": "ALWAYS append, never remove",
                    "examples": ["funding_history", "crawl_dates"],
                },
                "evolution_notes": {
                    "rule": "ACCUMULATE changes",
                    "examples": ["Track pivots, growth, changes"],
                },
                "competitive_analysis": {
                    "rule": "MERGE intelligently, competitors may change",
                    "examples": ["competitors", "differentiation"],
                },
                "patterns": {
                    "rule": "RE-DETECT, compare to history, note evolution",
                    "examples": ["build_patterns"],
                },
            },

            "required_output_fields": [
                "unique_findings",  # Appended
                "story_angles",  # Added/updated
                "evidence_quotes",  # Appended
                "evolution_notes",  # New - track changes
                "funding_history",  # Appended
                "crawl_dates",  # Appended
                "last_updated",
                "update_reason",
            ],
        }

    def merge_analyses(
        self,
        old_analysis: Dict[str, Any],
        new_analysis: Dict[str, Any],
        ctx: ReconciliationContext,
    ) -> Dict[str, Any]:
        """Merge old analysis with new analysis results.

        This is called AFTER the LLM has generated a new analysis.
        It ensures we preserve historical data properly.

        Args:
            old_analysis: Previous analysis data
            new_analysis: New analysis from LLM
            ctx: Reconciliation context

        Returns:
            Merged analysis with preserved history
        """
        if old_analysis is None:
            # First analysis - just add metadata
            new_analysis["crawl_dates"] = [ctx.current_date.isoformat()]
            new_analysis["evolution_notes"] = []
            new_analysis["funding_history"] = []
            return new_analysis

        merged = dict(new_analysis)

        # Append unique findings (deduplicated)
        old_findings = set(old_analysis.get("unique_findings", []))
        new_findings = merged.get("unique_findings", [])
        merged["unique_findings"] = list(old_findings | set(new_findings))

        # Append evidence quotes (keep best ones, max 10)
        old_quotes = old_analysis.get("evidence_quotes", [])
        new_quotes = merged.get("evidence_quotes", [])
        all_quotes = old_quotes + [q for q in new_quotes if q not in old_quotes]
        merged["evidence_quotes"] = all_quotes[:10]

        # Merge story angles (keep unique by type)
        old_angles = {a.get("angle_type"): a for a in old_analysis.get("story_angles", [])}
        for angle in merged.get("story_angles", []):
            angle_type = angle.get("angle_type")
            if angle_type not in old_angles:
                old_angles[angle_type] = angle
            else:
                # Keep higher uniqueness score
                if angle.get("uniqueness_score", 0) > old_angles[angle_type].get("uniqueness_score", 0):
                    old_angles[angle_type] = angle
        merged["story_angles"] = list(old_angles.values())

        # Append crawl dates
        old_crawl_dates = old_analysis.get("crawl_dates", [])
        if ctx.current_date.isoformat() not in old_crawl_dates:
            merged["crawl_dates"] = old_crawl_dates + [ctx.current_date.isoformat()]
        else:
            merged["crawl_dates"] = old_crawl_dates

        # Append evolution notes
        old_notes = old_analysis.get("evolution_notes", [])
        new_notes = merged.get("evolution_notes", [])
        if isinstance(new_notes, str):
            new_notes = [new_notes] if new_notes else []
        merged["evolution_notes"] = old_notes + [n for n in new_notes if n not in old_notes]

        # Append funding history
        old_funding = old_analysis.get("funding_history", [])
        new_funding = merged.get("funding_history", [])
        # Deduplicate by stage+amount
        seen = {(f.get("stage"), f.get("amount")) for f in old_funding}
        merged["funding_history"] = old_funding + [
            f for f in new_funding
            if (f.get("stage"), f.get("amount")) not in seen
        ]

        # Preserve metadata
        merged["first_analyzed_at"] = old_analysis.get("first_analyzed_at") or old_analysis.get("analyzed_at")
        merged["last_updated"] = ctx.current_date.isoformat()
        merged["update_reason"] = ctx.trigger_reason
        merged["analysis_count"] = old_analysis.get("analysis_count", 1) + 1

        return merged

    # =========================================================================
    # Full reconciliation workflow (orchestration)
    # =========================================================================

    async def reconcile_startup(
        self,
        slug: str,
        new_crawl: Dict[str, Any],
        new_analysis: Dict[str, Any],
        trigger_reason: str = "manual",
        funding_changed: bool = False,
        website_changed: bool = False,
        description_changed: bool = False,
    ) -> Tuple[Dict[str, Any], Dict[str, Optional[str]]]:
        """Run full reconciliation workflow for a startup.

        This is the main entry point that:
        1. Builds reconciliation context
        2. Saves new crawl snapshot
        3. Merges old and new analyses
        4. Saves analysis snapshot
        5. Generates and saves brief

        Args:
            slug: Startup slug
            new_crawl: New crawl data
            new_analysis: New analysis from LLM
            trigger_reason: What triggered this reconciliation
            funding_changed: Whether funding changed
            website_changed: Whether website changed
            description_changed: Whether description changed

        Returns:
            Tuple of (merged_analysis, urls dict)
        """
        # Build context
        ctx = self.build_reconciliation_context(
            slug=slug,
            trigger_reason=trigger_reason,
            funding_changed=funding_changed,
            website_changed=website_changed,
            description_changed=description_changed,
        )

        urls: Dict[str, Optional[str]] = {}

        # Save crawl snapshot
        crawl_urls = self.blob_client.save_crawl_snapshot(
            slug=slug,
            website_content=new_crawl.get("website"),
            github_content=new_crawl.get("github"),
            news_content=new_crawl.get("news"),
            jobs_content=new_crawl.get("jobs"),
            manifest={
                "slug": slug,
                "crawled_at": ctx.current_date.isoformat(),
                "trigger_reason": trigger_reason,
                "content_hashes": {
                    k: self._compute_hash(v)
                    for k, v in new_crawl.items()
                    if v is not None
                },
            },
        )
        urls.update({f"crawl_{k}": v for k, v in crawl_urls.items()})

        # Merge analyses
        merged_analysis = self.merge_analyses(
            old_analysis=ctx.current_analysis,
            new_analysis=new_analysis,
            ctx=ctx,
        )

        # Save analysis snapshot
        analysis_urls = self.blob_client.save_analysis_snapshot(
            slug=slug,
            analysis=merged_analysis,
        )
        urls.update({f"analysis_{k}": v for k, v in analysis_urls.items()})

        return merged_analysis, urls

    # =========================================================================
    # Staleness detection
    # =========================================================================

    def get_stale_startups(
        self,
        max_days: int = 90,
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        """Get list of startups that need re-crawling due to staleness.

        Args:
            max_days: Days threshold for staleness
            limit: Maximum number to return

        Returns:
            List of stale startup info dicts
        """
        # List all analysis snapshots
        all_analyses = self.blob_client.list_blobs(
            ContainerName.ANALYSIS_SNAPSHOTS,
            prefix="",
        )

        # Extract unique slugs and their latest dates
        slug_dates: Dict[str, datetime] = {}
        for blob in all_analyses:
            parts = blob["name"].split("/")
            if len(parts) >= 2:
                slug = parts[0]
                filename = parts[1]

                if filename.endswith(".json") and filename != "latest.json":
                    date_str = filename[:-5]
                    try:
                        date = datetime.strptime(date_str, "%Y-%m-%d")
                        if slug not in slug_dates or date > slug_dates[slug]:
                            slug_dates[slug] = date
                    except ValueError:
                        continue

        # Find stale ones
        now = datetime.now(timezone.utc)
        stale = []

        for slug, last_date in slug_dates.items():
            days_since = (now - last_date.replace(tzinfo=timezone.utc)).days
            if days_since >= max_days:
                stale.append({
                    "slug": slug,
                    "last_analyzed": last_date.isoformat(),
                    "days_since": days_since,
                })

        # Sort by staleness
        stale.sort(key=lambda x: x["days_since"], reverse=True)
        return stale[:limit]

    # =========================================================================
    # Utility methods
    # =========================================================================

    def _compute_hash(self, data: Any) -> str:
        """Compute hash for change detection."""
        json_str = json.dumps(data, sort_keys=True, default=str)
        return hashlib.md5(json_str.encode()).hexdigest()[:12]
