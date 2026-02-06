"""Startup classification for delta processing.

Classifies startups from CSV as:
- NEW: Never seen before -> full pipeline
- CHANGED: Exists but data changed -> smart delta update
- UNCHANGED: Same data -> skip processing
"""

import hashlib
from enum import Enum
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from difflib import SequenceMatcher

from src.data.models import StartupInput
from src.data.store import AnalysisStore


class StartupStatus(Enum):
    """Classification status for a startup."""
    NEW = "new"              # Never seen before
    CHANGED = "changed"      # Exists but data changed
    UNCHANGED = "unchanged"  # No changes detected


@dataclass
class ChangeDetail:
    """Details about a specific field change."""
    field: str
    old_value: Any
    new_value: Any
    significance: str = "minor"  # 'major', 'minor', 'metadata'


@dataclass
class ClassifiedStartup:
    """A startup with its classification result."""
    startup_input: StartupInput
    status: StartupStatus
    existing_slug: Optional[str] = None      # Slug if exists in store
    existing_analysis: Optional[Dict] = None  # Previous analysis if exists
    changes: List[ChangeDetail] = field(default_factory=list)
    change_significance: str = "none"         # 'major', 'minor', 'metadata', 'none'


class StartupClassifier:
    """Classifies startups as new, changed, or unchanged.

    Uses strict matching (exact name or website) as configured.
    """

    def __init__(self, store: AnalysisStore):
        """Initialize with an analysis store.

        Args:
            store: AnalysisStore instance for looking up existing analyses
        """
        self.store = store
        self._build_lookup_index()

    def _build_lookup_index(self):
        """Build lookup indices for fast matching."""
        self.name_to_slug: Dict[str, str] = {}
        self.website_to_slug: Dict[str, str] = {}

        for name, metadata in self.store.index.get("startups", {}).items():
            slug = metadata.get("slug", self._to_slug(name))

            # Index by lowercase name
            self.name_to_slug[name.lower().strip()] = slug

            # Index by website (normalized)
            website = metadata.get("website")
            if website:
                normalized = self._normalize_website(website)
                self.website_to_slug[normalized] = slug

    def _to_slug(self, name: str) -> str:
        """Convert name to slug."""
        return name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")

    def _normalize_website(self, website: str) -> str:
        """Normalize website URL for comparison."""
        if not website:
            return ""
        website = website.lower().strip()
        # Remove protocol
        for prefix in ["https://", "http://", "www."]:
            if website.startswith(prefix):
                website = website[len(prefix):]
        # Remove trailing slash
        return website.rstrip("/")

    def _compute_hash(self, startup: StartupInput) -> str:
        """Compute hash of startup data for change detection."""
        key_data = "|".join([
            startup.name or "",
            startup.website or "",
            str(startup.funding_amount or ""),
            startup.description or "",
            ",".join(startup.industries or []),
            ",".join(startup.lead_investors or []),
            startup.funding_stage.value if startup.funding_stage else "",
        ])
        return hashlib.md5(key_data.encode()).hexdigest()[:16]

    def classify_batch(self, startups: List[StartupInput]) -> List[ClassifiedStartup]:
        """Classify a batch of startups.

        Args:
            startups: List of StartupInput from CSV

        Returns:
            List of ClassifiedStartup with status and change details
        """
        results = []
        for startup in startups:
            classified = self.classify_single(startup)
            results.append(classified)
        return results

    def classify_single(self, startup: StartupInput) -> ClassifiedStartup:
        """Classify a single startup.

        Uses strict matching: exact name OR exact website match.

        Args:
            startup: StartupInput from CSV

        Returns:
            ClassifiedStartup with status and change details
        """
        # Try to find existing startup
        existing_slug = self._find_existing(startup)

        if not existing_slug:
            # NEW: Never seen before
            return ClassifiedStartup(
                startup_input=startup,
                status=StartupStatus.NEW,
                existing_slug=None,
                existing_analysis=None,
                changes=[],
                change_significance="major"  # Full pipeline needed
            )

        # Load existing analysis
        existing_analysis = self._load_existing_analysis(existing_slug)
        existing_metadata = self.store.index["startups"].get(
            self._find_name_by_slug(existing_slug), {}
        )

        # Check if data changed
        current_hash = self._compute_hash(startup)
        stored_hash = existing_metadata.get("hash", "")

        if current_hash == stored_hash:
            # UNCHANGED: Same data
            return ClassifiedStartup(
                startup_input=startup,
                status=StartupStatus.UNCHANGED,
                existing_slug=existing_slug,
                existing_analysis=existing_analysis,
                changes=[],
                change_significance="none"
            )

        # CHANGED: Detect what changed
        changes = self._detect_changes(startup, existing_metadata, existing_analysis)
        significance = self._assess_significance(changes)

        return ClassifiedStartup(
            startup_input=startup,
            status=StartupStatus.CHANGED,
            existing_slug=existing_slug,
            existing_analysis=existing_analysis,
            changes=changes,
            change_significance=significance
        )

    def _find_existing(self, startup: StartupInput) -> Optional[str]:
        """Find existing startup by strict match (name or website).

        Returns slug if found, None otherwise.
        """
        # Try exact name match
        name_lower = startup.name.lower().strip()
        if name_lower in self.name_to_slug:
            return self.name_to_slug[name_lower]

        # Try exact website match
        if startup.website:
            normalized = self._normalize_website(startup.website)
            if normalized in self.website_to_slug:
                return self.website_to_slug[normalized]

        return None

    def _find_name_by_slug(self, slug: str) -> Optional[str]:
        """Find original name by slug."""
        for name, metadata in self.store.index.get("startups", {}).items():
            if metadata.get("slug") == slug or self._to_slug(name) == slug:
                return name
        return None

    def _load_existing_analysis(self, slug: str) -> Optional[Dict]:
        """Load existing analysis from store."""
        analysis_file = self.store.base_dir / f"{slug}.json"
        if analysis_file.exists():
            import json
            with open(analysis_file) as f:
                return json.load(f)
        return None

    def _detect_changes(
        self,
        new: StartupInput,
        existing_metadata: Dict,
        existing_analysis: Optional[Dict]
    ) -> List[ChangeDetail]:
        """Detect what changed between existing and new data."""
        changes = []

        def _as_set(value: Any) -> set:
            if not value:
                return set()
            if isinstance(value, str):
                return {v.strip() for v in value.split(",") if v.strip()}
            return set(value)

        # Website change (MAJOR)
        old_website = existing_metadata.get("website")
        new_website = new.website
        if old_website and new_website and old_website != new_website:
            changes.append(ChangeDetail(
                field="website_hash",
                old_value=old_website,
                new_value=new_website,
                significance="major"
            ))
        elif new_website and not old_website:
            changes.append(ChangeDetail(
                field="website_hash",
                old_value=None,
                new_value=new_website,
                significance="major"
            ))

        # Funding amount change (MAJOR)
        old_funding = existing_metadata.get("funding")
        if old_funding is None:
            old_funding = existing_metadata.get("funding_amount")
        new_funding = new.funding_amount
        if new_funding and old_funding and new_funding != old_funding:
            changes.append(ChangeDetail(
                field="funding_amount",
                old_value=old_funding,
                new_value=new_funding,
                significance="major"
            ))
        elif new_funding and not old_funding:
            changes.append(ChangeDetail(
                field="funding_amount",
                old_value=None,
                new_value=new_funding,
                significance="major"
            ))

        # Funding stage change (MAJOR)
        old_stage = existing_metadata.get("funding_stage")
        new_stage = new.funding_stage.value if new.funding_stage else None
        if new_stage and old_stage and new_stage != old_stage:
            changes.append(ChangeDetail(
                field="funding_stage",
                old_value=old_stage,
                new_value=new_stage,
                significance="major"
            ))

        # Description change (check similarity)
        old_desc = existing_metadata.get("description") or (existing_analysis or {}).get("description", "")
        new_desc = new.description or ""
        if old_desc and new_desc:
            similarity = SequenceMatcher(None, old_desc, new_desc).ratio()
            if similarity < 0.7:  # Significant change
                changes.append(ChangeDetail(
                    field="description",
                    old_value=f"(similarity: {similarity:.2f})",
                    new_value=new_desc[:100] + "...",
                    significance="major"
                ))
            elif similarity < 0.9:  # Minor change
                changes.append(ChangeDetail(
                    field="description",
                    old_value=f"(similarity: {similarity:.2f})",
                    new_value=new_desc[:100] + "...",
                    significance="minor"
                ))

        # Industries change (MINOR)
        old_industries = _as_set(existing_metadata.get("industries", []))
        new_industries = _as_set(new.industries or [])
        if old_industries != new_industries:
            changes.append(ChangeDetail(
                field="industries",
                old_value=list(old_industries),
                new_value=list(new_industries),
                significance="minor"
            ))

        # Lead investors change (MINOR)
        old_investors = _as_set(existing_metadata.get("lead_investors", []))
        new_investors = _as_set(new.lead_investors or [])
        if old_investors != new_investors:
            changes.append(ChangeDetail(
                field="lead_investors",
                old_value=list(old_investors),
                new_value=list(new_investors),
                significance="minor"
            ))

        return changes

    def _assess_significance(self, changes: List[ChangeDetail]) -> str:
        """Assess overall significance of changes.

        Returns: 'major', 'minor', 'metadata', or 'none'
        """
        if not changes:
            return "none"

        significances = [c.significance for c in changes]

        if "major" in significances:
            return "major"
        elif "minor" in significances:
            return "minor"
        else:
            return "metadata"

    def get_classification_summary(
        self,
        classified: List[ClassifiedStartup]
    ) -> Dict[str, Any]:
        """Get summary statistics of classification results."""
        summary = {
            "total": len(classified),
            "new": 0,
            "changed": 0,
            "unchanged": 0,
            "major_changes": 0,
            "minor_changes": 0,
            "change_details": []
        }

        for c in classified:
            if c.status == StartupStatus.NEW:
                summary["new"] += 1
            elif c.status == StartupStatus.CHANGED:
                summary["changed"] += 1
                if c.change_significance == "major":
                    summary["major_changes"] += 1
                else:
                    summary["minor_changes"] += 1
                summary["change_details"].append({
                    "name": c.startup_input.name,
                    "significance": c.change_significance,
                    "fields_changed": [ch.field for ch in c.changes]
                })
            else:
                summary["unchanged"] += 1

        return summary
