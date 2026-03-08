"""Incremental processor - only processes new/changed startups."""

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set

from rich.progress import (
    Progress,
    BarColumn,
    MofNCompleteColumn,
    SpinnerColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)

from src.data.models import StartupInput, StartupAnalysis
from src.data.store import AnalysisStore
from src.config import settings


class IncrementalProcessor:
    """Processes only delta startups, stores results persistently."""

    @staticmethod
    def _normalize_startup_name(name: str) -> str:
        return str(name or "").strip().lower()

    def __init__(
        self,
        store: Optional[AnalysisStore] = None,
        raw_content_dir: Optional[Path] = None,
        crawler_factory: Optional[Callable[..., Any]] = None,
        analyzer_factory: Optional[Callable[[], Any]] = None,
        viral_analyzer_factory: Optional[Callable[[], Any]] = None,
    ):
        self.store = store or AnalysisStore()
        self.raw_content_dir = raw_content_dir or (self.store.store_dir.parent / "raw_content")
        self.raw_content_dir.mkdir(parents=True, exist_ok=True)
        self._crawler_factory = crawler_factory
        self._analyzer_factory = analyzer_factory
        self._viral_analyzer_factory = viral_analyzer_factory

    async def process_incremental(
        self,
        all_startups: List[StartupInput],
        run_base: bool = True,
        run_viral: bool = True,
        max_concurrent: int = 3,
        force_reprocess: bool = False,
        max_startups: Optional[int] = None,
        startup_allowlist: Optional[Set[str]] = None,
    ) -> Dict[str, Any]:
        """Process only new/changed startups.

        Args:
            all_startups: Complete list of startups from CSV
            run_base: Whether to run base analysis
            run_viral: Whether to run viral analysis
            max_concurrent: Max concurrent API calls
            force_reprocess: If True, reprocess all startups

        Returns:
            Summary of what was processed
        """
        from src.crawler.engine import StartupCrawler
        from src.analysis.genai_detector import GenAIAnalyzer
        from src.analysis.viral_analyzer import ViralContentAnalyzer

        normalized_allowlist = {
            self._normalize_startup_name(name)
            for name in (startup_allowlist or set())
            if str(name or "").strip()
        }

        results = {
            "total_in_csv": len(all_startups),
            "already_processed": 0,
            "delta_total": 0,
            "completed": 0,
            "delta_processed": 0,
            "errors": [],
            "new_base_analyses": 0,
            "new_viral_analyses": 0,
            "filtered_out": 0,
        }

        run_started_at = datetime.now(timezone.utc)

        # Determine delta
        if force_reprocess:
            delta = all_startups
        else:
            delta = self.store.get_delta(all_startups)

        raw_delta_count = len(delta)
        if normalized_allowlist:
            delta = [
                startup
                for startup in delta
                if self._normalize_startup_name(startup.name) in normalized_allowlist
            ]
            results["filtered_out"] = raw_delta_count - len(delta)
        if max_startups is not None and max_startups >= 0:
            delta = delta[:max_startups]
            results["filtered_out"] = raw_delta_count - len(delta)

        results["already_processed"] = len(all_startups) - raw_delta_count
        results["delta_total"] = len(delta)

        if not delta:
            self.store.write_progress_checkpoint(
                {
                    "status": "complete",
                    "run_started_at": run_started_at.isoformat(),
                    "total_in_csv": len(all_startups),
                    "already_processed": results["already_processed"],
                    "delta_total": 0,
                    "completed": 0,
                    "successful": 0,
                    "error_count": 0,
                    "base_analysis_files": self.store.count_base_analysis_files(),
                }
            )
            print(f"No new startups to process. {results['already_processed']} already in store.")
            return results

        print(f"\nProcessing {len(delta)} new/changed startups (skipping {results['already_processed']} already processed)")
        if results["filtered_out"]:
            print(f"Filtered out {results['filtered_out']} delta startups via allowlist/max-startups")
        print(f"Progress checkpoint file: {self.store.progress_file}")

        # Initialize components
        crawler_factory = self._crawler_factory or StartupCrawler
        analyzer_factory = self._analyzer_factory or GenAIAnalyzer
        viral_analyzer_factory = self._viral_analyzer_factory or ViralContentAnalyzer

        crawler = crawler_factory(raw_content_dir=self.raw_content_dir, disable_frontier=True)
        analyzer = analyzer_factory() if run_base else None
        viral_analyzer = viral_analyzer_factory() if run_viral else None

        semaphore = asyncio.Semaphore(max_concurrent)
        results_lock = asyncio.Lock()

        progress = Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
            TimeElapsedColumn(),
            TimeRemainingColumn(),
            disable=not sys.stdout.isatty(),
        )
        progress.start()
        progress_task = progress.add_task("Processing startups...", total=len(delta))

        def build_checkpoint_payload(
            latest_startup: Optional[str],
            latest_stage: str,
            stage_started_at: Optional[datetime] = None,
            latest_error: Optional[str] = None,
        ) -> Dict[str, Any]:
            elapsed_sec = int((datetime.now(timezone.utc) - run_started_at).total_seconds())
            completed = results["completed"]
            successful = results["delta_processed"]
            error_count = len(results["errors"])
            remaining = max(0, len(delta) - completed)
            avg_per_item = (elapsed_sec / completed) if completed else None
            eta_sec = int(avg_per_item * remaining) if avg_per_item is not None else None
            latest_stage_started_at = stage_started_at.isoformat() if stage_started_at else None
            latest_stage_elapsed_sec = (
                int((datetime.now(timezone.utc) - stage_started_at).total_seconds())
                if stage_started_at
                else None
            )

            return {
                "status": "running",
                "run_started_at": run_started_at.isoformat(),
                "total_in_csv": len(all_startups),
                "already_processed": results["already_processed"],
                "delta_total": len(delta),
                "completed": completed,
                "successful": successful,
                "error_count": error_count,
                "remaining": remaining,
                "elapsed_sec": elapsed_sec,
                "eta_sec": eta_sec,
                "base_analysis_files": self.store.count_base_analysis_files(),
                "latest_startup": latest_startup,
                "latest_stage": latest_stage,
                "latest_status": latest_stage,
                "latest_stage_started_at": latest_stage_started_at,
                "latest_stage_elapsed_sec": latest_stage_elapsed_sec,
                "latest_error": latest_error,
            }

        async def checkpoint_stage(
            startup: StartupInput,
            stage: str,
            stage_started_at: datetime,
            previous_stage: Optional[str] = None,
            previous_stage_started_at: Optional[datetime] = None,
            error_message: Optional[str] = None,
        ) -> None:
            async with results_lock:
                payload = build_checkpoint_payload(
                    latest_startup=startup.name,
                    latest_stage=stage,
                    stage_started_at=stage_started_at,
                    latest_error=error_message,
                )
                self.store.write_progress_checkpoint(payload)
                if previous_stage and previous_stage_started_at:
                    previous_elapsed = int(
                        (stage_started_at - previous_stage_started_at).total_seconds()
                    )
                    print(
                        f'Stage transition: startup="{startup.name}"'
                        f" completed_stage={previous_stage}"
                        f" duration_sec={previous_elapsed}"
                        f" next_stage={stage}",
                        flush=True,
                    )
                else:
                    print(
                        f'Stage transition: startup="{startup.name}"'
                        f" next_stage={stage}",
                        flush=True,
                    )

        async def record_completion(
            startup: StartupInput,
            *,
            success: bool,
            last_stage: str,
            last_stage_started_at: datetime,
            error_message: Optional[str] = None,
        ) -> None:
            async with results_lock:
                results["completed"] += 1
                if success:
                    results["delta_processed"] += 1
                else:
                    results["errors"].append({"name": startup.name, "error": error_message or "unknown"})

                payload = build_checkpoint_payload(
                    latest_startup=startup.name,
                    latest_stage="complete" if success else "error",
                    stage_started_at=last_stage_started_at,
                    latest_error=error_message,
                )
                self.store.write_progress_checkpoint(payload)
                stage_elapsed = int(
                    (datetime.now(timezone.utc) - last_stage_started_at).total_seconds()
                )
                print(
                    "Progress:"
                    f" completed={payload['completed']}/{payload['delta_total']}"
                    f" successful={payload['successful']}"
                    f" errors={payload['error_count']}"
                    f" remaining={payload['remaining']}"
                    f" base_files={payload['base_analysis_files']}"
                    f" latest_stage={payload['latest_stage']}"
                    f' latest_startup="{startup.name}"'
                    f" stage_duration_sec={stage_elapsed}"
                    + (
                        f' latest_error="{error_message}"'
                        if error_message
                        else ""
                    ),
                    flush=True,
                )

        self.store.write_progress_checkpoint(
            {
                "status": "running",
                "run_started_at": run_started_at.isoformat(),
                "total_in_csv": len(all_startups),
                "already_processed": results["already_processed"],
                "delta_total": len(delta),
                "completed": 0,
                "successful": 0,
                "error_count": 0,
                "remaining": len(delta),
                "elapsed_sec": 0,
                "eta_sec": None,
                "base_analysis_files": self.store.count_base_analysis_files(),
                "latest_startup": None,
                "latest_stage": "starting",
                "latest_status": "starting",
                "latest_stage_started_at": run_started_at.isoformat(),
                "latest_stage_elapsed_sec": 0,
                "latest_error": None,
            }
        )

        STARTUP_TIMEOUT_SEC = 600  # 10 minutes per startup

        async def _do_process(startup: StartupInput, stage_state: Dict[str, Any]):
            """Inner work for a single startup (crawl + analyze + save).

            stage_state is a mutable dict shared with process_one so the
            timeout handler can read the stage that was active when the
            timeout fired.
            """
            current_stage = "claiming"
            current_stage_started_at = datetime.now(timezone.utc)
            stage_state["stage"] = current_stage
            stage_state["stage_started_at"] = current_stage_started_at
            await checkpoint_stage(startup, current_stage, current_stage_started_at)
            try:
                # Ensure content is crawled
                next_stage_started_at = datetime.now(timezone.utc)
                await checkpoint_stage(
                    startup,
                    "crawling",
                    next_stage_started_at,
                    previous_stage=current_stage,
                    previous_stage_started_at=current_stage_started_at,
                )
                current_stage = "crawling"
                current_stage_started_at = next_stage_started_at
                stage_state["stage"] = current_stage
                stage_state["stage_started_at"] = current_stage_started_at
                progress.update(progress_task, description=f"Crawling {startup.name}")
                content = crawler.get_all_cached_content(startup.name)
                if not content or len(content) < 500:
                    await crawler.crawl_startup(startup)
                    crawler.save_raw_content(startup.name)
                    content = crawler.get_all_cached_content(startup.name)

                if not content:
                    progress.update(progress_task, advance=1, description=f"No content: {startup.name}")
                    await record_completion(
                        startup,
                        success=False,
                        last_stage=current_stage,
                        last_stage_started_at=current_stage_started_at,
                        error_message="No content",
                    )
                    return {"name": startup.name, "error": "No content"}

                next_stage_started_at = datetime.now(timezone.utc)
                await checkpoint_stage(
                    startup,
                    "analyzing",
                    next_stage_started_at,
                    previous_stage=current_stage,
                    previous_stage_started_at=current_stage_started_at,
                )
                current_stage = "analyzing"
                current_stage_started_at = next_stage_started_at
                stage_state["stage"] = current_stage
                stage_state["stage_started_at"] = current_stage_started_at

                # Base analysis
                base_analysis = None
                if run_base and analyzer:
                    progress.update(progress_task, description=f"Analyzing {startup.name}")
                    base_analysis = await analyzer.analyze_startup(startup)
                else:
                    # Try to load existing
                    base_analysis = self.store.get_base_analysis(startup.name)

                saving_started_at = datetime.now(timezone.utc)
                await checkpoint_stage(
                    startup,
                    "saving",
                    saving_started_at,
                    previous_stage=current_stage,
                    previous_stage_started_at=current_stage_started_at,
                )
                current_stage = "saving"
                current_stage_started_at = saving_started_at
                stage_state["stage"] = current_stage
                stage_state["stage_started_at"] = current_stage_started_at

                if base_analysis:
                    self.store.save_base_analysis(base_analysis, startup)
                    async with results_lock:
                        results["new_base_analyses"] += 1

                # Viral analysis
                if run_viral and viral_analyzer and base_analysis:
                    progress.update(progress_task, description=f"Viral: {startup.name}")
                    try:
                        viral_result = await viral_analyzer.analyze_for_viral_content(
                            startup, base_analysis, content
                        )
                        self.store.save_viral_analysis(startup.name, viral_result)
                        async with results_lock:
                            results["new_viral_analyses"] += 1
                    except Exception as e:
                        print(f"  Viral analysis error for {startup.name}: {e}")

                progress.update(progress_task, advance=1, description=f"Done: {startup.name}")
                await record_completion(
                    startup,
                    success=True,
                    last_stage=current_stage,
                    last_stage_started_at=current_stage_started_at,
                )
                return {"name": startup.name, "success": True}

            except asyncio.TimeoutError:
                raise  # Let process_one's timeout handler deal with it

            except Exception as e:
                progress.update(progress_task, advance=1, description=f"Error: {startup.name}")
                await record_completion(
                    startup,
                    success=False,
                    last_stage=current_stage,
                    last_stage_started_at=current_stage_started_at,
                    error_message=str(e),
                )
                return {"name": startup.name, "error": str(e)}

        async def process_one(startup: StartupInput):
            async with semaphore:
                stage_state: Dict[str, Any] = {
                    "stage": "claiming",
                    "stage_started_at": datetime.now(timezone.utc),
                }
                try:
                    return await asyncio.wait_for(
                        _do_process(startup, stage_state),
                        timeout=STARTUP_TIMEOUT_SEC,
                    )
                except asyncio.TimeoutError:
                    error_msg = f"Timed out after {STARTUP_TIMEOUT_SEC}s"
                    progress.update(progress_task, advance=1, description=f"Timeout: {startup.name}")
                    await record_completion(
                        startup,
                        success=False,
                        last_stage=stage_state["stage"],
                        last_stage_started_at=stage_state["stage_started_at"],
                        error_message=error_msg,
                    )
                    return {"name": startup.name, "error": error_msg}

        # Process all delta startups
        tasks = [process_one(s) for s in delta]
        await asyncio.gather(*tasks)

        progress.stop()

        # Cleanup
        await crawler.close()
        if analyzer and hasattr(analyzer, "close"):
            await analyzer.close()
        if viral_analyzer:
            await viral_analyzer.close()

        self.store.write_progress_checkpoint(
            {
                **build_checkpoint_payload(
                    latest_startup=None,
                    latest_stage="complete",
                    stage_started_at=datetime.now(timezone.utc),
                    latest_error=None,
                ),
                "status": "complete",
            }
        )

        return results

    def generate_newsletter_from_store(self, output_path=None) -> str:
        """Generate newsletter using ALL data in the store (not just delta)."""
        from src.reports.newsletter_generator import generate_viral_newsletter

        output_path = output_path or settings.data_output_dir

        # Get all viral analyses from store
        all_viral = self.store.get_all_viral_analyses()

        if not all_viral:
            # Fall back to generating from base analyses
            print("No viral analyses in store. Run with --viral flag first.")
            return ""

        print(f"Generating newsletter from {len(all_viral)} analyzed startups...")

        # Generate newsletter
        newsletter_path = generate_viral_newsletter(all_viral, output_path)

        return str(newsletter_path)

    def get_store_summary(self) -> str:
        """Get a summary of what's in the store."""
        return self.store.export_summary()


async def run_incremental_analysis(
    startups: List[StartupInput],
    run_viral: bool = True,
    max_concurrent: int = 3,
    max_startups: Optional[int] = None,
    startup_allowlist: Optional[Set[str]] = None,
) -> Dict[str, Any]:
    """Convenience function for incremental processing."""
    processor = IncrementalProcessor()
    return await processor.process_incremental(
        startups,
        run_base=True,
        run_viral=run_viral,
        max_concurrent=max_concurrent,
        max_startups=max_startups,
        startup_allowlist=startup_allowlist,
    )
