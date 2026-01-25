"""Delta processor for smart startup updates.

Routes startups to appropriate processing based on classification:
- NEW: Full pipeline (crawl, analyze, brief)
- CHANGED: Smart delta (re-analyze, LLM merge, update brief)
- UNCHANGED: Skip (just update last_seen timestamp)
"""

import asyncio
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from pathlib import Path

from src.config import settings
from src.data.models import StartupInput, StartupAnalysis
from src.data.store import AnalysisStore
from src.crawler.engine import StartupCrawler
from src.analysis.genai_detector import GenAIAnalyzer
from src.reports.generator import save_startup_brief, get_logo_path_for_company

from .classifier import StartupClassifier, ClassifiedStartup, StartupStatus
from .llm_merger import LLMContextMerger


@dataclass
class ProcessingResult:
    """Result of processing a single startup."""
    startup_name: str
    status: str  # 'created', 'updated', 'skipped', 'error'
    change_type: Optional[str] = None  # 'new', 'major_update', 'minor_update', None
    brief_updated: bool = False
    analysis_merged: bool = False
    error: Optional[str] = None
    processing_time_ms: int = 0


@dataclass
class BatchResult:
    """Result of processing a batch of startups."""
    total: int = 0
    new_created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
    results: List[ProcessingResult] = field(default_factory=list)
    processing_time_ms: int = 0


class DeltaProcessor:
    """Processes startups based on their classification."""

    def __init__(
        self,
        store: AnalysisStore,
        output_dir: Optional[Path] = None,
        max_concurrent_new: int = 3,
        max_concurrent_updates: int = 5
    ):
        """Initialize processor.

        Args:
            store: AnalysisStore for persistence
            output_dir: Output directory for briefs
            max_concurrent_new: Max concurrent new startup processing
            max_concurrent_updates: Max concurrent update processing
        """
        self.store = store
        self.output_dir = output_dir or settings.data_output_dir
        self.max_concurrent_new = max_concurrent_new
        self.max_concurrent_updates = max_concurrent_updates

        # Initialize components
        self.classifier = StartupClassifier(store)
        self.crawler = StartupCrawler()
        self.analyzer = GenAIAnalyzer()
        self.merger = LLMContextMerger()

    async def process_csv_batch(
        self,
        startups: List[StartupInput],
        skip_crawl: bool = False
    ) -> BatchResult:
        """Process a batch of startups from CSV.

        Args:
            startups: List of StartupInput from CSV
            skip_crawl: If True, skip crawling (use cached data)

        Returns:
            BatchResult with processing statistics
        """
        start_time = datetime.now(timezone.utc)
        batch_result = BatchResult(total=len(startups))

        # Step 1: Classify all startups
        print(f"\n[DeltaProcessor] Classifying {len(startups)} startups...")
        classified = self.classifier.classify_batch(startups)

        # Get summary
        summary = self.classifier.get_classification_summary(classified)
        print(f"  - New: {summary['new']}")
        print(f"  - Changed: {summary['changed']} (major: {summary['major_changes']}, minor: {summary['minor_changes']})")
        print(f"  - Unchanged: {summary['unchanged']}")

        # Step 2: Group by status
        new_startups = [c for c in classified if c.status == StartupStatus.NEW]
        changed_startups = [c for c in classified if c.status == StartupStatus.CHANGED]
        unchanged_startups = [c for c in classified if c.status == StartupStatus.UNCHANGED]

        # Step 3: Process NEW startups (full pipeline)
        if new_startups:
            print(f"\n[DeltaProcessor] Processing {len(new_startups)} NEW startups...")
            new_results = await self._process_new_batch(new_startups, skip_crawl)
            batch_result.results.extend(new_results)
            batch_result.new_created = sum(1 for r in new_results if r.status == "created")
            batch_result.errors += sum(1 for r in new_results if r.status == "error")

        # Step 4: Process CHANGED startups (smart delta)
        if changed_startups:
            print(f"\n[DeltaProcessor] Processing {len(changed_startups)} CHANGED startups...")
            changed_results = await self._process_changed_batch(changed_startups, skip_crawl)
            batch_result.results.extend(changed_results)
            batch_result.updated = sum(1 for r in changed_results if r.status == "updated")
            batch_result.errors += sum(1 for r in changed_results if r.status == "error")

        # Step 5: Update timestamps for UNCHANGED
        for c in unchanged_startups:
            self._update_last_seen(c)
            batch_result.results.append(ProcessingResult(
                startup_name=c.startup_input.name,
                status="skipped",
                change_type=None
            ))
        batch_result.skipped = len(unchanged_startups)

        # Calculate total time
        end_time = datetime.now(timezone.utc)
        batch_result.processing_time_ms = int((end_time - start_time).total_seconds() * 1000)

        print(f"\n[DeltaProcessor] Batch complete in {batch_result.processing_time_ms}ms")
        print(f"  - Created: {batch_result.new_created}")
        print(f"  - Updated: {batch_result.updated}")
        print(f"  - Skipped: {batch_result.skipped}")
        print(f"  - Errors: {batch_result.errors}")

        return batch_result

    async def _process_new_batch(
        self,
        classified: List[ClassifiedStartup],
        skip_crawl: bool
    ) -> List[ProcessingResult]:
        """Process batch of new startups with concurrency control."""
        semaphore = asyncio.Semaphore(self.max_concurrent_new)
        results = []

        async def process_with_semaphore(c: ClassifiedStartup):
            async with semaphore:
                return await self._process_new_startup(c, skip_crawl)

        tasks = [process_with_semaphore(c) for c in classified]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to error results
        processed_results = []
        for c, r in zip(classified, results):
            if isinstance(r, Exception):
                processed_results.append(ProcessingResult(
                    startup_name=c.startup_input.name,
                    status="error",
                    error=str(r)
                ))
            else:
                processed_results.append(r)

        return processed_results

    async def _process_new_startup(
        self,
        classified: ClassifiedStartup,
        skip_crawl: bool
    ) -> ProcessingResult:
        """Full pipeline for a new startup."""
        start_time = datetime.now(timezone.utc)
        startup = classified.startup_input

        try:
            print(f"  [NEW] {startup.name}...")

            # 1. Crawl (unless skipped)
            if not skip_crawl:
                await self.crawler.crawl_startup(startup)

            # 2. Analyze
            analysis = await self.analyzer.analyze_startup(startup)

            # 3. Generate brief with logo
            briefs_dir = self.output_dir / "briefs"
            briefs_dir.mkdir(parents=True, exist_ok=True)
            logo_path = get_logo_path_for_company(startup.name)
            save_startup_brief(analysis, startup, briefs_dir, logo_path)

            # 4. Save to store
            self.store.save_base_analysis(analysis, startup)

            end_time = datetime.now(timezone.utc)
            return ProcessingResult(
                startup_name=startup.name,
                status="created",
                change_type="new",
                brief_updated=True,
                processing_time_ms=int((end_time - start_time).total_seconds() * 1000)
            )

        except Exception as e:
            return ProcessingResult(
                startup_name=startup.name,
                status="error",
                error=str(e)
            )

    async def _process_changed_batch(
        self,
        classified: List[ClassifiedStartup],
        skip_crawl: bool
    ) -> List[ProcessingResult]:
        """Process batch of changed startups."""
        semaphore = asyncio.Semaphore(self.max_concurrent_updates)
        results = []

        async def process_with_semaphore(c: ClassifiedStartup):
            async with semaphore:
                return await self._process_changed_startup(c, skip_crawl)

        tasks = [process_with_semaphore(c) for c in classified]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Convert exceptions to error results
        processed_results = []
        for c, r in zip(classified, results):
            if isinstance(r, Exception):
                processed_results.append(ProcessingResult(
                    startup_name=c.startup_input.name,
                    status="error",
                    error=str(r)
                ))
            else:
                processed_results.append(r)

        return processed_results

    async def _process_changed_startup(
        self,
        classified: ClassifiedStartup,
        skip_crawl: bool
    ) -> ProcessingResult:
        """Smart delta processing for a changed startup."""
        start_time = datetime.now(timezone.utc)
        startup = classified.startup_input
        existing_analysis = classified.existing_analysis or {}

        try:
            change_type = f"{classified.change_significance}_update"
            print(f"  [{change_type.upper()}] {startup.name}...")

            # 1. Re-crawl if major change
            if classified.change_significance == "major" and not skip_crawl:
                await self.crawler.crawl_startup(startup)

            # 2. Re-analyze
            new_analysis = await self.analyzer.analyze_startup(startup)

            # 3. Merge analyses using LLM
            merged_analysis = await self.merger.merge_analyses(
                existing_analysis=existing_analysis,
                new_analysis=new_analysis.model_dump(),
                changes=[{"field": c.field, "old_value": c.old_value, "new_value": c.new_value}
                         for c in classified.changes],
                startup_input=startup
            )

            # 4. Load existing brief
            existing_brief = self._load_existing_brief(classified.existing_slug)

            # 5. Decide if brief needs regeneration
            should_regen, reason = await self.merger.should_regenerate_brief(
                changes=[{"field": c.field, "old_value": c.old_value, "new_value": c.new_value}
                         for c in classified.changes],
                existing_analysis=existing_analysis,
                new_analysis=merged_analysis
            )

            # 6. Update brief
            if existing_brief:
                update_type = "major" if should_regen else "minor"
                updated_brief = await self.merger.update_brief(
                    existing_brief=existing_brief,
                    new_analysis=merged_analysis,
                    changes=[{"field": c.field, "old_value": c.old_value, "new_value": c.new_value}
                             for c in classified.changes],
                    startup_input=startup,
                    update_type=update_type
                )
                # Save updated brief
                self._save_brief(classified.existing_slug, updated_brief)
            else:
                # Generate new brief if none exists
                briefs_dir = self.output_dir / "briefs"
                briefs_dir.mkdir(parents=True, exist_ok=True)
                # Create a temporary StartupAnalysis from merged data
                logo_path = get_logo_path_for_company(startup.name)
                save_startup_brief(new_analysis, startup, briefs_dir, logo_path)

            # 7. Save merged analysis to store
            # Update the store with merged analysis
            self._save_merged_analysis(classified.existing_slug, merged_analysis, startup)

            end_time = datetime.now(timezone.utc)
            return ProcessingResult(
                startup_name=startup.name,
                status="updated",
                change_type=change_type,
                brief_updated=True,
                analysis_merged=True,
                processing_time_ms=int((end_time - start_time).total_seconds() * 1000)
            )

        except Exception as e:
            import traceback
            traceback.print_exc()
            return ProcessingResult(
                startup_name=startup.name,
                status="error",
                error=str(e)
            )

    def _load_existing_brief(self, slug: Optional[str]) -> Optional[str]:
        """Load existing brief from disk."""
        if not slug:
            return None
        brief_path = self.output_dir / "briefs" / f"{slug}_brief.md"
        if brief_path.exists():
            return brief_path.read_text()
        return None

    def _save_brief(self, slug: str, content: str):
        """Save brief to disk."""
        briefs_dir = self.output_dir / "briefs"
        briefs_dir.mkdir(parents=True, exist_ok=True)
        brief_path = briefs_dir / f"{slug}_brief.md"
        brief_path.write_text(content)

    def _save_merged_analysis(self, slug: str, merged: Dict[str, Any], startup: StartupInput):
        """Save merged analysis to store."""
        import json
        analysis_path = self.store.base_dir / f"{slug}.json"
        with open(analysis_path, "w") as f:
            json.dump(merged, f, indent=2, default=str)

        # Update index
        self.store.index["startups"][startup.name] = {
            "slug": slug,
            "website": startup.website,
            "funding_amount": startup.funding_amount,
            "funding_stage": startup.funding_stage.value if startup.funding_stage else None,
            "description": startup.description,
            "industries": startup.industries,
            "lead_investors": startup.lead_investors,
            "hash": self._compute_hash(startup),
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "has_base_analysis": True,
        }
        self.store._save_index()

    def _compute_hash(self, startup: StartupInput) -> str:
        """Compute hash for startup data."""
        import hashlib
        key_data = "|".join([
            startup.name or "",
            startup.website or "",
            str(startup.funding_amount or ""),
            startup.description or "",
        ])
        return hashlib.md5(key_data.encode()).hexdigest()[:16]

    def _update_last_seen(self, classified: ClassifiedStartup):
        """Update last_seen timestamp for unchanged startup."""
        if classified.startup_input.name in self.store.index["startups"]:
            self.store.index["startups"][classified.startup_input.name]["last_seen"] = (
                datetime.now(timezone.utc).isoformat()
            )
            self.store._save_index()
