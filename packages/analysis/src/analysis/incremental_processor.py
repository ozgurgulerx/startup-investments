"""Incremental processor - only processes new/changed startups."""

import asyncio
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

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

    def __init__(self, store: Optional[AnalysisStore] = None):
        self.store = store or AnalysisStore()

    async def process_incremental(
        self,
        all_startups: List[StartupInput],
        run_base: bool = True,
        run_viral: bool = True,
        max_concurrent: int = 3,
        force_reprocess: bool = False,
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

        results = {
            "total_in_csv": len(all_startups),
            "already_processed": 0,
            "delta_total": 0,
            "completed": 0,
            "delta_processed": 0,
            "errors": [],
            "new_base_analyses": 0,
            "new_viral_analyses": 0,
        }

        run_started_at = datetime.now(timezone.utc)

        # Determine delta
        if force_reprocess:
            delta = all_startups
        else:
            delta = self.store.get_delta(all_startups)

        results["already_processed"] = len(all_startups) - len(delta)
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
        print(f"Progress checkpoint file: {self.store.progress_file}")

        # Initialize components
        crawler = StartupCrawler()
        analyzer = GenAIAnalyzer() if run_base else None
        viral_analyzer = ViralContentAnalyzer() if run_viral else None

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
            latest_status: str,
            latest_error: Optional[str] = None,
        ) -> Dict[str, Any]:
            elapsed_sec = int((datetime.now(timezone.utc) - run_started_at).total_seconds())
            completed = results["completed"]
            successful = results["delta_processed"]
            error_count = len(results["errors"])
            remaining = max(0, len(delta) - completed)
            avg_per_item = (elapsed_sec / completed) if completed else None
            eta_sec = int(avg_per_item * remaining) if avg_per_item is not None else None

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
                "latest_status": latest_status,
                "latest_error": latest_error,
            }

        async def record_completion(
            startup: StartupInput,
            *,
            success: bool,
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
                    latest_status="success" if success else "error",
                    latest_error=error_message,
                )
                self.store.write_progress_checkpoint(payload)
                print(
                    "Progress:"
                    f" completed={payload['completed']}/{payload['delta_total']}"
                    f" successful={payload['successful']}"
                    f" errors={payload['error_count']}"
                    f" remaining={payload['remaining']}"
                    f" base_files={payload['base_analysis_files']}"
                    f" latest_status={payload['latest_status']}"
                    f' latest_startup="{startup.name}"'
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
                "latest_status": "starting",
                "latest_error": None,
            }
        )

        async def process_one(startup: StartupInput):
            async with semaphore:
                try:
                    # Ensure content is crawled
                    content = crawler.get_all_cached_content(startup.name)
                    if not content or len(content) < 500:
                        progress.update(progress_task, description=f"Crawling {startup.name}")
                        await crawler.crawl_startup(startup)
                        crawler.save_raw_content(startup.name)
                        content = crawler.get_all_cached_content(startup.name)

                    if not content:
                        progress.update(progress_task, advance=1, description=f"No content: {startup.name}")
                        await record_completion(startup, success=False, error_message="No content")
                        return {"name": startup.name, "error": "No content"}

                    # Base analysis
                    base_analysis = None
                    if run_base and analyzer:
                        progress.update(progress_task, description=f"Analyzing {startup.name}")
                        base_analysis = await analyzer.analyze_startup(startup)
                        self.store.save_base_analysis(base_analysis, startup)
                        results["new_base_analyses"] += 1
                    else:
                        # Try to load existing
                        base_analysis = self.store.get_base_analysis(startup.name)

                    # Viral analysis
                    if run_viral and viral_analyzer and base_analysis:
                        progress.update(progress_task, description=f"Viral: {startup.name}")
                        try:
                            viral_result = await viral_analyzer.analyze_for_viral_content(
                                startup, base_analysis, content
                            )
                            self.store.save_viral_analysis(startup.name, viral_result)
                            results["new_viral_analyses"] += 1
                        except Exception as e:
                            print(f"  Viral analysis error for {startup.name}: {e}")

                    progress.update(progress_task, advance=1, description=f"Done: {startup.name}")
                    await record_completion(startup, success=True)
                    return {"name": startup.name, "success": True}

                except Exception as e:
                    progress.update(progress_task, advance=1, description=f"Error: {startup.name}")
                    await record_completion(startup, success=False, error_message=str(e))
                    return {"name": startup.name, "error": str(e)}

        # Process all delta startups
        tasks = [process_one(s) for s in delta]
        await asyncio.gather(*tasks)

        progress.stop()

        # Cleanup
        await crawler.close()
        if viral_analyzer:
            await viral_analyzer.close()

        self.store.write_progress_checkpoint(
            {
                **build_checkpoint_payload(
                    latest_startup=None,
                    latest_status="complete",
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
) -> Dict[str, Any]:
    """Convenience function for incremental processing."""
    processor = IncrementalProcessor()
    return await processor.process_incremental(
        startups,
        run_base=True,
        run_viral=run_viral,
        max_concurrent=max_concurrent,
    )
