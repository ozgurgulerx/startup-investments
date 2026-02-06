"""Delta processor for smart startup updates.

Routes startups to appropriate processing based on classification:
- NEW: Full pipeline (crawl, analyze, brief)
- CHANGED: Smart delta (re-analyze, LLM merge, update brief)
- UNCHANGED: Skip (just update last_seen timestamp)

Now with blob storage integration for:
- Crawl snapshots (versioned raw data)
- Analysis snapshots (versioned with merge history)
- Brief storage (versioned markdown)
"""

import asyncio
from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional, TYPE_CHECKING
from datetime import datetime, timezone
from pathlib import Path

from src.config import settings
from src.data.models import StartupInput, StartupAnalysis
from src.data.store import AnalysisStore
from src.crawler.engine import StartupCrawler
from src.analysis.genai_detector import GenAIAnalyzer
from src.reports.generator import save_startup_brief, get_logo_path_for_company, generate_startup_brief

from .classifier import StartupClassifier, ClassifiedStartup, StartupStatus
from .llm_merger import LLMContextMerger

if TYPE_CHECKING:
    from src.storage import BlobStorageClient, SnapshotManager


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
        max_concurrent_updates: int = 5,
        storage_client: Optional["BlobStorageClient"] = None,
        snapshot_manager: Optional["SnapshotManager"] = None,
    ):
        """Initialize processor.

        Args:
            store: AnalysisStore for persistence
            output_dir: Output directory for briefs
            max_concurrent_new: Max concurrent new startup processing
            max_concurrent_updates: Max concurrent update processing
            storage_client: BlobStorageClient for multi-container storage
            snapshot_manager: SnapshotManager for reconciliation
        """
        self.store = store
        self.output_dir = output_dir or settings.data_output_dir
        self.max_concurrent_new = max_concurrent_new
        self.max_concurrent_updates = max_concurrent_updates

        # Initialize blob storage (lazy - may be None if not configured)
        self.storage_client = storage_client
        self.snapshot_manager = snapshot_manager

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
        if unchanged_startups:
            self.store._save_index()
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
            slug = StartupAnalysis.to_slug(startup.name)
            crawl_data: Dict[str, Any] = {}

            # 1. Crawl (unless skipped)
            if not skip_crawl:
                crawl_result = await self.crawler.crawl_startup(startup)
                # Collect crawl data for snapshot
                if crawl_result:
                    crawl_data = self._extract_crawl_data(crawl_result, startup.name)

            # 2. Analyze
            analysis = await self.analyzer.analyze_startup(startup)

            # 3. Generate brief with logo
            briefs_dir = self.output_dir / "briefs"
            briefs_dir.mkdir(parents=True, exist_ok=True)
            logo_path = get_logo_path_for_company(startup.name)
            save_startup_brief(analysis, startup, briefs_dir, logo_path)

            # 4. Save to store (local filesystem)
            self.store.save_base_analysis(analysis, startup)

            # 5. Save to blob storage (if configured)
            await self._save_to_blob_storage(
                slug=slug,
                crawl_data=crawl_data,
                analysis=analysis,
                startup=startup,
                trigger_reason="new_startup",
            )

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
        slug = classified.existing_slug or StartupAnalysis.to_slug(startup.name)
        crawl_data: Dict[str, Any] = {}

        try:
            change_type = f"{classified.change_significance}_update"
            print(f"  [{change_type.upper()}] {startup.name}...")

            # Determine trigger reason for blob storage
            trigger_reason = self._determine_trigger_reason(classified)

            # 1. Re-crawl if major change
            if classified.change_significance == "major" and not skip_crawl:
                crawl_result = await self.crawler.crawl_startup(startup)
                if crawl_result:
                    crawl_data = self._extract_crawl_data(crawl_result, startup.name)

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
            existing_brief = self._load_existing_brief(slug)

            # 5. Decide if brief needs regeneration
            should_regen, _ = await self.merger.should_regenerate_brief(
                changes=[{"field": c.field, "old_value": c.old_value, "new_value": c.new_value}
                         for c in classified.changes],
                existing_analysis=existing_analysis,
                new_analysis=merged_analysis
            )

            # 6. Update brief
            updated_brief_content: Optional[str] = None
            if existing_brief:
                update_type = "major" if should_regen else "minor"
                updated_brief_content = await self.merger.update_brief(
                    existing_brief=existing_brief,
                    new_analysis=merged_analysis,
                    changes=[{"field": c.field, "old_value": c.old_value, "new_value": c.new_value}
                             for c in classified.changes],
                    startup_input=startup,
                    update_type=update_type
                )
                # Save updated brief
                self._save_brief(slug, updated_brief_content)
            else:
                # Generate new brief if none exists
                briefs_dir = self.output_dir / "briefs"
                briefs_dir.mkdir(parents=True, exist_ok=True)
                logo_path = get_logo_path_for_company(startup.name)
                save_startup_brief(new_analysis, startup, briefs_dir, logo_path)
                # Also generate content for blob storage
                updated_brief_content = generate_startup_brief(new_analysis, startup, logo_path)

            # 7. Save merged analysis to store (local filesystem)
            self._save_merged_analysis(slug, merged_analysis, startup)

            # 8. Save to blob storage (if configured)
            # Determine what changed for reconciliation
            funding_changed = any(c.field in ("funding_amount", "funding_stage") for c in classified.changes)
            website_changed = any(c.field == "website_hash" for c in classified.changes)
            description_changed = any(c.field == "description" for c in classified.changes)

            await self._save_to_blob_storage(
                slug=slug,
                crawl_data=crawl_data,
                analysis=new_analysis,
                startup=startup,
                trigger_reason=trigger_reason,
                merged_analysis=merged_analysis,
                brief_content=updated_brief_content,
                funding_changed=funding_changed,
                website_changed=website_changed,
                description_changed=description_changed,
            )

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

        # Update index — use same schema as store.save_base_analysis() for consistency
        existing_meta = self.store.index["startups"].get(startup.name, {})
        self.store.index["startups"][startup.name] = {
            "slug": slug,
            "hash": self.store._get_startup_hash(startup),
            "base_analysis_at": datetime.now(timezone.utc).isoformat(),
            "has_base": True,
            "has_viral": existing_meta.get("has_viral", False),
            "has_enrichment": existing_meta.get("has_enrichment", False),
            "website": startup.website,
            "funding": startup.funding_amount,
            "funding_stage": startup.funding_stage.value if startup.funding_stage else None,
            "description": startup.description,
            "industries": startup.industries or [],
            "lead_investors": startup.lead_investors or [],
        }
        self.store._save_index()

    def _compute_hash(self, startup: StartupInput) -> str:
        """Compute hash for startup data.
        Must match store._get_startup_hash() for consistent change detection.
        """
        import hashlib
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

    def _update_last_seen(self, classified: ClassifiedStartup):
        """Update last_seen timestamp for unchanged startup."""
        if classified.startup_input.name in self.store.index["startups"]:
            self.store.index["startups"][classified.startup_input.name]["last_seen"] = (
                datetime.now(timezone.utc).isoformat()
            )

    # =========================================================================
    # Blob storage helper methods
    # =========================================================================

    def _extract_crawl_data(self, crawl_result: Any, startup_name: Optional[str] = None) -> Dict[str, Any]:
        """Extract crawl data from crawler result for blob storage.

        Args:
            crawl_result: Result from StartupCrawler
            startup_name: Startup name for cache lookups when needed

        Returns:
            Dict with website, github, news, jobs content
        """
        crawl_data: Dict[str, Any] = {}

        if crawl_result is None:
            return crawl_data

        # Modern/legacy list format: list[CrawledSource]
        if isinstance(crawl_result, list):
            website_pages = []
            github_items = []
            news_items = []
            jobs_items = []

            for source in crawl_result:
                url = getattr(source, "url", None) or (source.get("url") if isinstance(source, dict) else None)
                source_type = getattr(source, "source_type", None) or (
                    source.get("source_type") if isinstance(source, dict) else None
                )
                title = getattr(source, "title", None) or (source.get("title") if isinstance(source, dict) else None)
                success = getattr(source, "success", None)
                if success is None and isinstance(source, dict):
                    success = source.get("success", False)
                if not success:
                    continue

                content = ""
                if startup_name and url and hasattr(self.crawler, "get_cached_content"):
                    try:
                        content = self.crawler.get_cached_content(startup_name, url) or ""
                    except Exception:
                        content = ""

                record = {"url": url, "title": title, "content": content}

                if source_type in {"github"}:
                    github_items.append(record)
                elif source_type in {"news"}:
                    news_items.append(record)
                elif source_type in {"jobs", "careers"}:
                    jobs_items.append(record)
                else:
                    website_pages.append(record)

            if website_pages:
                crawl_data["website"] = {
                    "pages": website_pages,
                    "crawled_at": datetime.now(timezone.utc).isoformat(),
                }
            if github_items:
                crawl_data["github"] = {"items": github_items}
            if news_items:
                crawl_data["news"] = {"items": news_items}
            if jobs_items:
                crawl_data["jobs"] = {"items": jobs_items}

            return crawl_data

        # Object format with pages/github/news/jobs attributes
        if hasattr(crawl_result, "pages") and crawl_result.pages:
            crawl_data["website"] = {
                "pages": [
                    {
                        "url": p.url if hasattr(p, "url") else str(p),
                        "title": p.title if hasattr(p, "title") else None,
                        "content": p.content if hasattr(p, "content") else str(p),
                    }
                    for p in crawl_result.pages
                ],
                "crawled_at": datetime.now(timezone.utc).isoformat(),
            }

        # Extract GitHub content
        if hasattr(crawl_result, "github") and crawl_result.github:
            crawl_data["github"] = crawl_result.github

        # Extract news content
        if hasattr(crawl_result, "news") and crawl_result.news:
            crawl_data["news"] = crawl_result.news

        # Extract jobs content
        if hasattr(crawl_result, "jobs") and crawl_result.jobs:
            crawl_data["jobs"] = crawl_result.jobs

        return crawl_data

    def _determine_trigger_reason(self, classified: ClassifiedStartup) -> str:
        """Determine the trigger reason for reconciliation.

        Args:
            classified: ClassifiedStartup with change information

        Returns:
            Trigger reason string
        """
        if classified.status == StartupStatus.NEW:
            return "new_startup"

        # Check specific changes
        for change in classified.changes:
            if change.field in ("funding_amount", "funding_stage"):
                return "funding_changed"
            if change.field == "website_hash":
                return "website_changed"
            if change.field == "description":
                return "description_changed"

        return f"{classified.change_significance}_update"

    async def _save_to_blob_storage(
        self,
        slug: str,
        crawl_data: Dict[str, Any],
        analysis: StartupAnalysis,
        startup: StartupInput,
        trigger_reason: str,
        merged_analysis: Optional[Dict[str, Any]] = None,
        brief_content: Optional[str] = None,
        funding_changed: bool = False,
        website_changed: bool = False,
        description_changed: bool = False,
    ) -> Dict[str, Optional[str]]:
        """Save crawl, analysis, and brief snapshots to blob storage.

        Args:
            slug: Startup slug
            crawl_data: Crawl data to save
            analysis: StartupAnalysis object
            startup: StartupInput object
            trigger_reason: What triggered this save
            merged_analysis: Optional merged analysis dict
            brief_content: Optional brief markdown content
            funding_changed: Whether funding changed
            website_changed: Whether website changed
            description_changed: Whether description changed

        Returns:
            Dict mapping file types to blob URLs
        """
        if not self.storage_client or not self.snapshot_manager:
            return {}

        urls: Dict[str, Optional[str]] = {}

        try:
            # Prepare analysis data
            analysis_data = merged_analysis if merged_analysis else analysis.model_dump()

            # Use snapshot manager for full reconciliation if we have crawl data
            if crawl_data:
                _, snapshot_urls = await self.snapshot_manager.reconcile_startup(
                    slug=slug,
                    new_crawl=crawl_data,
                    new_analysis=analysis_data,
                    trigger_reason=trigger_reason,
                    funding_changed=funding_changed,
                    website_changed=website_changed,
                    description_changed=description_changed,
                )
                urls.update(snapshot_urls)
            else:
                # Just save analysis snapshot
                analysis_urls = self.storage_client.save_analysis_snapshot(
                    slug=slug,
                    analysis=analysis_data,
                )
                urls.update({f"analysis_{k}": v for k, v in analysis_urls.items()})

            # Save brief if provided
            if brief_content:
                brief_urls = self.storage_client.save_brief(
                    slug=slug,
                    brief_content=brief_content,
                )
                urls.update({f"brief_{k}": v for k, v in brief_urls.items()})
            else:
                # Generate and save brief
                logo_path = get_logo_path_for_company(startup.name)
                brief = generate_startup_brief(analysis, startup, logo_path)
                brief_urls = self.storage_client.save_brief(
                    slug=slug,
                    brief_content=brief,
                )
                urls.update({f"brief_{k}": v for k, v in brief_urls.items()})

            print(f"  [BLOB] Saved snapshots for {slug}: {list(urls.keys())}")

        except Exception as e:
            print(f"  [BLOB] Error saving snapshots for {slug}: {e}")

        return urls
