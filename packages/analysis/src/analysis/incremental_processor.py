"""Incremental processor - only processes new/changed startups."""

import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime

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
            "delta_processed": 0,
            "errors": [],
            "new_base_analyses": 0,
            "new_viral_analyses": 0,
        }

        # Determine delta
        if force_reprocess:
            delta = all_startups
        else:
            delta = self.store.get_delta(all_startups)

        results["already_processed"] = len(all_startups) - len(delta)

        if not delta:
            print(f"No new startups to process. {results['already_processed']} already in store.")
            return results

        print(f"\nProcessing {len(delta)} new/changed startups (skipping {results['already_processed']} already processed)")

        # Initialize components
        crawler = StartupCrawler()
        analyzer = GenAIAnalyzer() if run_base else None
        viral_analyzer = ViralContentAnalyzer() if run_viral else None

        semaphore = asyncio.Semaphore(max_concurrent)

        async def process_one(startup: StartupInput):
            async with semaphore:
                try:
                    print(f"\n[{startup.name}]")

                    # Ensure content is crawled
                    content = crawler.get_all_cached_content(startup.name)
                    if not content or len(content) < 500:
                        print(f"  Crawling...")
                        await crawler.crawl_startup(startup)
                        crawler.save_raw_content(startup.name)
                        content = crawler.get_all_cached_content(startup.name)

                    if not content:
                        return {"name": startup.name, "error": "No content"}

                    # Base analysis
                    base_analysis = None
                    if run_base and analyzer:
                        print(f"  Base analysis...")
                        base_analysis = await analyzer.analyze_startup(startup)
                        self.store.save_base_analysis(base_analysis, startup)
                        results["new_base_analyses"] += 1
                    else:
                        # Try to load existing
                        base_analysis = self.store.get_base_analysis(startup.name)

                    # Viral analysis
                    if run_viral and viral_analyzer and base_analysis:
                        print(f"  Viral analysis...")
                        try:
                            viral_result = await viral_analyzer.analyze_for_viral_content(
                                startup, base_analysis, content
                            )
                            self.store.save_viral_analysis(startup.name, viral_result)
                            results["new_viral_analyses"] += 1
                        except Exception as e:
                            print(f"  Viral analysis error: {e}")

                    results["delta_processed"] += 1
                    return {"name": startup.name, "success": True}

                except Exception as e:
                    error = {"name": startup.name, "error": str(e)}
                    results["errors"].append(error)
                    return error

        # Process all delta startups
        tasks = [process_one(s) for s in delta]
        await asyncio.gather(*tasks)

        # Cleanup
        await crawler.close()
        if viral_analyzer:
            await viral_analyzer.close()

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
