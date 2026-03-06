"""Persistent store for incremental startup analysis.

Design:
- All analyses are stored persistently in a JSON-based store
- When new startups are added to CSV, only the delta is processed
- Newsletter generation pulls from the complete store
- Supports versioning and history
"""

import hashlib
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from src.config import settings
from src.data.models import StartupInput, StartupAnalysis


class AnalysisStore:
    """Persistent store for startup analyses with incremental processing support."""

    def __init__(self, store_dir: Optional[Path] = None):
        self.store_dir = store_dir or (settings.data_output_dir / "analysis_store")
        self.store_dir.mkdir(parents=True, exist_ok=True)

        # Main index file
        self.index_file = self.store_dir / "index.json"
        self.progress_file = self.store_dir / "progress.json"

        # Subdirectories
        self.base_dir = self.store_dir / "base_analyses"
        self.viral_dir = self.store_dir / "viral_analyses"
        self.enrichment_dir = self.store_dir / "enrichment"

        for d in [self.base_dir, self.viral_dir, self.enrichment_dir]:
            d.mkdir(parents=True, exist_ok=True)

        # Load or create index
        self.index = self._load_index()

    def _load_index(self) -> Dict[str, Any]:
        """Load the store index and migrate if needed."""
        if self.index_file.exists():
            try:
                with open(self.index_file) as f:
                    index = json.load(f)
                index = self._migrate_index(index)
                return index
            except Exception:
                pass
        return {
            "version": 2,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "startups": {},  # name -> metadata
            "stats": self._default_stats(),
        }

    def _default_stats(self) -> Dict[str, Any]:
        return {
            "total_analyzed": 0,
            "last_updated": None,
        }

    def _migrate_index(self, index: Dict[str, Any]) -> Dict[str, Any]:
        """Migrate index from older versions."""
        version = index.get("version", 1)
        changed = False

        if not isinstance(index.get("stats"), dict):
            index["stats"] = self._default_stats()
            changed = True

        if version < 2:
            # v1 → v2: Normalize metadata field names (has_base_analysis → has_base)
            # and clear short hashes so they get recomputed on next delta check
            for _, meta in index.get("startups", {}).items():
                # Fix field name inconsistency from delta_processor
                if "has_base_analysis" in meta and "has_base" not in meta:
                    meta["has_base"] = meta.pop("has_base_analysis")
                    changed = True
                # Rename funding_amount → funding for consistency
                if "funding_amount" in meta and "funding" not in meta:
                    meta["funding"] = meta.pop("funding_amount")
                    changed = True
                # Clear short hashes (12-char) so they'll be recomputed as 16-char
                if meta.get("hash") and len(meta["hash"]) < 16:
                    meta["hash"] = ""  # Will trigger reprocessing
                    changed = True
                # Ensure required fields exist
                if "has_base" not in meta:
                    meta["has_base"] = False
                    changed = True
                if "has_viral" not in meta:
                    meta["has_viral"] = False
                    changed = True
                if "has_enrichment" not in meta:
                    meta["has_enrichment"] = False
                    changed = True
                if "description" not in meta:
                    meta["description"] = None
                    changed = True
                if "industries" not in meta:
                    meta["industries"] = []
                    changed = True
                if "lead_investors" not in meta:
                    meta["lead_investors"] = []
                    changed = True
                if "funding_stage" not in meta:
                    meta["funding_stage"] = None
                    changed = True

            index["version"] = 2
            changed = True

        # Defensive normalization even for already-migrated indexes
        for _, meta in index.get("startups", {}).items():
            if meta.get("hash") and len(meta["hash"]) < 16:
                meta["hash"] = ""
                changed = True
            if "description" not in meta:
                meta["description"] = None
                changed = True
            if "industries" not in meta:
                meta["industries"] = []
                changed = True
            if "lead_investors" not in meta:
                meta["lead_investors"] = []
                changed = True
            if "funding_stage" not in meta:
                meta["funding_stage"] = None
                changed = True

        if changed:
            # Save migrated index immediately
            self.index = index
            self._save_index()

        return index

    def _save_index(self):
        """Save the store index atomically (write-to-temp + rename)."""
        self.index["stats"]["last_updated"] = datetime.now(timezone.utc).isoformat()
        fd, tmp_path = tempfile.mkstemp(
            dir=str(self.store_dir), suffix=".index.tmp"
        )
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(self.index, f, indent=2, default=str)
            os.replace(tmp_path, str(self.index_file))
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def _get_startup_hash(self, startup: StartupInput) -> str:
        """Generate a hash for a startup to detect changes.
        Must match classifier._compute_hash() for consistent change detection.
        """
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

    def _get_slug(self, name: str) -> str:
        """Convert name to filesystem-safe slug, with collision detection.

        If two different company names produce the same slug (e.g. "AI & Co" and
        "AI and Co"), appends a numeric suffix (-2, -3, etc.) to avoid overwriting.
        """
        base_slug = name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")

        # Check if this slug is already used by a *different* company name
        for existing_name, meta in self.index.get("startups", {}).items():
            if meta.get("slug") == base_slug and existing_name != name:
                # Collision — find next available suffix
                counter = 2
                while True:
                    candidate = f"{base_slug}-{counter}"
                    taken = any(
                        m.get("slug") == candidate
                        for n, m in self.index["startups"].items()
                        if n != name
                    )
                    if not taken:
                        return candidate
                    counter += 1

        # Check if this name already has a slug assigned (return same one for stability)
        existing_meta = self.index.get("startups", {}).get(name)
        if existing_meta and existing_meta.get("slug"):
            return existing_meta["slug"]

        return base_slug

    def get_processed_names(self) -> Set[str]:
        """Get set of already processed startup names."""
        return set(self.index["startups"].keys())

    def count_base_analysis_files(self) -> int:
        """Count base-analysis artifacts on disk."""
        return sum(1 for path in self.base_dir.iterdir() if path.is_file() and path.suffix == ".json")

    def _read_saved_input_hash(self, file_path: Path) -> str:
        """Read the saved startup hash from a base-analysis artifact when available."""
        if not file_path.exists():
            return ""
        try:
            payload = json.loads(file_path.read_text(encoding="utf-8"))
        except Exception:
            return ""
        saved_hash = str(payload.get("input_hash") or "").strip()
        return saved_hash if len(saved_hash) >= 16 else ""

    def reconcile_startups(self, startups: List[StartupInput]) -> int:
        """Backfill index entries for startups that already have on-disk artifacts."""
        reconciled = 0

        for startup in startups:
            name = startup.name
            if name in self.index["startups"]:
                continue

            slug = self._get_slug(name)
            base_file = self.base_dir / f"{slug}.json"
            has_base = base_file.exists()
            has_viral = (self.viral_dir / f"{slug}.json").exists()
            has_enrichment = (self.enrichment_dir / f"{slug}.json").exists()

            # Base analysis is the durable source of truth for restart-safe reconciliation.
            # Viral/enrichment artifacts can exist only after or alongside base analysis.
            if not has_base:
                continue

            self.index["startups"][name] = {
                "slug": slug,
                "hash": self._read_saved_input_hash(base_file),
                "base_analysis_at": datetime.now(timezone.utc).isoformat() if has_base else None,
                "viral_analysis_at": datetime.now(timezone.utc).isoformat() if has_viral else None,
                "enrichment_at": datetime.now(timezone.utc).isoformat() if has_enrichment else None,
                "has_base": has_base,
                "has_viral": has_viral,
                "has_enrichment": has_enrichment,
                "website": startup.website,
                "funding": startup.funding_amount,
                "funding_stage": startup.funding_stage.value if startup.funding_stage else None,
                "description": startup.description,
                "industries": startup.industries or [],
                "lead_investors": startup.lead_investors or [],
            }
            reconciled += 1

        if reconciled:
            self.index["stats"]["total_analyzed"] = len(self.index["startups"])
            self._save_index()

        return reconciled

    def get_delta(self, startups: List[StartupInput]) -> List[StartupInput]:
        """Get startups that haven't been processed or have changed."""
        self.reconcile_startups(startups)

        delta = []
        for startup in startups:
            name = startup.name
            current_hash = self._get_startup_hash(startup)

            if name not in self.index["startups"]:
                # New startup
                delta.append(startup)
            elif self.index["startups"][name].get("hash") != current_hash:
                # Changed startup
                delta.append(startup)

        return delta

    def save_base_analysis(self, analysis: StartupAnalysis, startup: StartupInput):
        """Save a base analysis result."""
        slug = self._get_slug(analysis.company_name)
        file_path = self.base_dir / f"{slug}.json"
        startup_hash = self._get_startup_hash(startup)

        # Save analysis
        with open(file_path, "w") as f:
            payload = analysis.model_dump()
            payload["input_hash"] = startup_hash
            json.dump(payload, f, indent=2, default=str)

        # Update index
        self.index["startups"][analysis.company_name] = {
            "slug": slug,
            "hash": startup_hash,
            "base_analysis_at": datetime.now(timezone.utc).isoformat(),
            "has_base": True,
            "has_viral": False,
            "has_enrichment": False,
            "website": startup.website,
            "funding": startup.funding_amount,
            "funding_stage": startup.funding_stage.value if startup.funding_stage else None,
            "description": startup.description,
            "industries": startup.industries or [],
            "lead_investors": startup.lead_investors or [],
        }
        self.index["stats"]["total_analyzed"] = len(self.index["startups"])
        self._save_index()

    def save_viral_analysis(self, company_name: str, viral_data: Dict[str, Any]):
        """Save a viral analysis result."""
        slug = self._get_slug(company_name)
        file_path = self.viral_dir / f"{slug}.json"

        with open(file_path, "w") as f:
            json.dump(viral_data, f, indent=2, default=str)

        # Update index
        if company_name in self.index["startups"]:
            self.index["startups"][company_name]["has_viral"] = True
            self.index["startups"][company_name]["viral_analysis_at"] = datetime.now(timezone.utc).isoformat()
            self._save_index()

    def save_enrichment(self, company_name: str, enrichment_data: Dict[str, Any]):
        """Save enrichment data (jobs, HN, etc.)."""
        slug = self._get_slug(company_name)
        file_path = self.enrichment_dir / f"{slug}.json"

        with open(file_path, "w") as f:
            json.dump(enrichment_data, f, indent=2, default=str)

        # Update index
        if company_name in self.index["startups"]:
            self.index["startups"][company_name]["has_enrichment"] = True
            self.index["startups"][company_name]["enrichment_at"] = datetime.now(timezone.utc).isoformat()
            self._save_index()

    def write_progress_checkpoint(self, payload: Dict[str, Any]) -> None:
        """Persist a run-progress checkpoint atomically."""
        snapshot = dict(payload)
        snapshot["updated_at"] = datetime.now(timezone.utc).isoformat()

        fd, tmp_path = tempfile.mkstemp(
            dir=str(self.store_dir), suffix=".progress.tmp"
        )
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(snapshot, f, indent=2, default=str)
            os.replace(tmp_path, str(self.progress_file))
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def get_base_analysis(self, company_name: str) -> Optional[StartupAnalysis]:
        """Load a base analysis by company name."""
        slug = self._get_slug(company_name)
        file_path = self.base_dir / f"{slug}.json"

        if file_path.exists():
            try:
                with open(file_path) as f:
                    data = json.load(f)
                return StartupAnalysis(**data)
            except Exception as e:
                print(f"Error loading analysis for {company_name}: {e}")
        return None

    def get_viral_analysis(self, company_name: str) -> Optional[Dict[str, Any]]:
        """Load viral analysis by company name."""
        slug = self._get_slug(company_name)
        file_path = self.viral_dir / f"{slug}.json"

        if file_path.exists():
            try:
                with open(file_path) as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    def get_enrichment(self, company_name: str) -> Optional[Dict[str, Any]]:
        """Load enrichment data by company name."""
        slug = self._get_slug(company_name)
        file_path = self.enrichment_dir / f"{slug}.json"

        if file_path.exists():
            try:
                with open(file_path) as f:
                    return json.load(f)
            except Exception:
                pass
        return None

    def get_all_base_analyses(self) -> List[StartupAnalysis]:
        """Load all base analyses from the store."""
        analyses = []
        for name in self.index["startups"]:
            if self.index["startups"][name].get("has_base"):
                analysis = self.get_base_analysis(name)
                if analysis:
                    analyses.append(analysis)
        return analyses

    def get_all_viral_analyses(self) -> List[Dict[str, Any]]:
        """Load all viral analyses from the store."""
        viral_list = []
        for name in self.index["startups"]:
            if self.index["startups"][name].get("has_viral"):
                viral = self.get_viral_analysis(name)
                if viral:
                    viral_list.append(viral)
        return viral_list

    def get_newsletter_ready_data(self) -> Dict[str, Any]:
        """Get all data needed for newsletter generation."""
        return {
            "base_analyses": self.get_all_base_analyses(),
            "viral_analyses": self.get_all_viral_analyses(),
            "stats": self.index["stats"],
            "startup_count": len(self.index["startups"]),
        }

    def get_startups_missing_viral(self) -> List[str]:
        """Get list of startups that have base analysis but no viral analysis."""
        return [
            name for name, meta in self.index["startups"].items()
            if meta.get("has_base") and not meta.get("has_viral")
        ]

    def get_stats(self) -> Dict[str, Any]:
        """Get store statistics."""
        has_base = sum(1 for m in self.index["startups"].values() if m.get("has_base"))
        has_viral = sum(1 for m in self.index["startups"].values() if m.get("has_viral"))
        stats = self.index.get("stats") or self._default_stats()

        return {
            "total_startups": len(self.index["startups"]),
            "with_base_analysis": has_base,
            "with_viral_analysis": has_viral,
            "missing_viral": has_base - has_viral,
            "last_updated": stats.get("last_updated"),
        }

    def export_summary(self) -> str:
        """Export a summary of the store."""
        stats = self.get_stats()
        lines = [
            "# Analysis Store Summary",
            f"",
            f"**Total Startups:** {stats['total_startups']}",
            f"**With Base Analysis:** {stats['with_base_analysis']}",
            f"**With Viral Analysis:** {stats['with_viral_analysis']}",
            f"**Missing Viral:** {stats['missing_viral']}",
            f"**Last Updated:** {stats['last_updated']}",
            "",
            "## Startups in Store",
            "",
        ]

        for name, meta in sorted(self.index["startups"].items()):
            status = []
            if meta.get("has_base"):
                status.append("base")
            if meta.get("has_viral"):
                status.append("viral")
            if meta.get("has_enrichment"):
                status.append("enriched")

            funding = f"${meta.get('funding', 0):,.0f}" if meta.get('funding') else "N/A"
            lines.append(f"- **{name}** [{', '.join(status)}] - {funding}")

        return "\n".join(lines)
