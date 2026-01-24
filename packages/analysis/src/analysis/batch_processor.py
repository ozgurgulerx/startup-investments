"""Batch processor for analyzing 300+ startups efficiently."""

import asyncio
from typing import List, Dict, Any, Optional
from concurrent.futures import ThreadPoolExecutor
import json
from pathlib import Path
from datetime import datetime

from src.data.models import StartupInput, StartupAnalysis
from src.config import settings


class BatchProcessor:
    """Processes large batches of startups with parallelization and caching."""

    def __init__(
        self,
        max_concurrent_crawl: int = 5,
        max_concurrent_analysis: int = 3,
        max_concurrent_viral: int = 2,
        checkpoint_every: int = 10,
    ):
        self.max_concurrent_crawl = max_concurrent_crawl
        self.max_concurrent_analysis = max_concurrent_analysis
        self.max_concurrent_viral = max_concurrent_viral
        self.checkpoint_every = checkpoint_every
        self.checkpoint_dir = settings.data_output_dir / "checkpoints"
        self.checkpoint_dir.mkdir(parents=True, exist_ok=True)

    async def process_batch(
        self,
        startups: List[StartupInput],
        skip_crawl: bool = False,
        skip_viral: bool = False,
        resume_from: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Process a large batch of startups efficiently.

        Strategy:
        1. Crawl in parallel (I/O bound) - max 5 concurrent
        2. Base analysis in parallel (API bound) - max 3 concurrent
        3. Viral analysis in parallel (API bound) - max 2 concurrent
        4. Checkpoint every N startups to allow resume
        """
        from src.crawler.engine import StartupCrawler
        from src.analysis.genai_detector import GenAIAnalyzer
        from src.analysis.viral_analyzer import ViralContentAnalyzer

        results = {
            "base_analyses": [],
            "viral_analyses": [],
            "errors": [],
            "skipped": [],
        }

        # Load checkpoint if resuming
        processed_names = set()
        if resume_from:
            checkpoint_data = self._load_checkpoint(resume_from)
            if checkpoint_data:
                results = checkpoint_data.get("results", results)
                processed_names = set(checkpoint_data.get("processed", []))
                print(f"Resuming from checkpoint: {len(processed_names)} already processed")

        # Filter out already processed
        remaining = [s for s in startups if s.name not in processed_names]
        print(f"Processing {len(remaining)} startups ({len(processed_names)} already done)")

        # Phase 1: Parallel crawling
        if not skip_crawl:
            print(f"\n[Phase 1] Crawling {len(remaining)} startups (max {self.max_concurrent_crawl} concurrent)...")
            crawler = StartupCrawler()
            crawl_semaphore = asyncio.Semaphore(self.max_concurrent_crawl)

            async def crawl_one(startup: StartupInput):
                async with crawl_semaphore:
                    try:
                        # Check if already has content
                        existing = crawler.get_all_cached_content(startup.name)
                        if existing and len(existing) > 1000:
                            return startup.name, "cached"
                        await crawler.crawl_startup(startup)
                        crawler.save_raw_content(startup.name)
                        return startup.name, "crawled"
                    except Exception as e:
                        return startup.name, f"error: {e}"

            crawl_tasks = [crawl_one(s) for s in remaining]
            crawl_results = await asyncio.gather(*crawl_tasks)

            for name, status in crawl_results:
                print(f"  {name}: {status}")

            await crawler.close()

        # Phase 2: Parallel base analysis
        print(f"\n[Phase 2] Base analysis (max {self.max_concurrent_analysis} concurrent)...")
        analyzer = GenAIAnalyzer()
        analysis_semaphore = asyncio.Semaphore(self.max_concurrent_analysis)

        async def analyze_one(startup: StartupInput) -> Optional[StartupAnalysis]:
            async with analysis_semaphore:
                try:
                    analysis = await analyzer.analyze_startup(startup)
                    return analysis
                except Exception as e:
                    print(f"  {startup.name}: analysis error - {e}")
                    results["errors"].append({"name": startup.name, "phase": "analysis", "error": str(e)})
                    return None

        # Process in batches for checkpointing
        for i in range(0, len(remaining), self.checkpoint_every):
            batch = remaining[i:i + self.checkpoint_every]
            print(f"  Batch {i // self.checkpoint_every + 1}: analyzing {len(batch)} startups...")

            analysis_tasks = [analyze_one(s) for s in batch]
            batch_results = await asyncio.gather(*analysis_tasks)

            for startup, analysis in zip(batch, batch_results):
                if analysis:
                    results["base_analyses"].append(analysis)
                    processed_names.add(startup.name)

            # Checkpoint
            self._save_checkpoint(results, list(processed_names))
            print(f"  Checkpoint saved ({len(processed_names)} total)")

        # Phase 3: Parallel viral analysis (if not skipped)
        if not skip_viral:
            print(f"\n[Phase 3] Viral content analysis (max {self.max_concurrent_viral} concurrent)...")
            viral_analyzer = ViralContentAnalyzer()
            viral_semaphore = asyncio.Semaphore(self.max_concurrent_viral)
            crawler = StartupCrawler()

            async def viral_one(startup: StartupInput, base_analysis: StartupAnalysis) -> Optional[Dict]:
                async with viral_semaphore:
                    try:
                        content = crawler.get_all_cached_content(startup.name)
                        if not content:
                            return None
                        viral = await viral_analyzer.analyze_for_viral_content(
                            startup, base_analysis, content
                        )
                        return viral
                    except Exception as e:
                        print(f"  {startup.name}: viral error - {e}")
                        results["errors"].append({"name": startup.name, "phase": "viral", "error": str(e)})
                        return None

            # Match startups with their base analyses
            analysis_map = {a.company_name: a for a in results["base_analyses"]}

            for i in range(0, len(remaining), self.checkpoint_every):
                batch = remaining[i:i + self.checkpoint_every]
                batch_with_analysis = [
                    (s, analysis_map.get(s.name))
                    for s in batch
                    if s.name in analysis_map
                ]

                if not batch_with_analysis:
                    continue

                print(f"  Batch {i // self.checkpoint_every + 1}: viral analysis for {len(batch_with_analysis)} startups...")

                viral_tasks = [viral_one(s, a) for s, a in batch_with_analysis]
                batch_viral = await asyncio.gather(*viral_tasks)

                for viral in batch_viral:
                    if viral:
                        results["viral_analyses"].append(viral)

                # Checkpoint
                self._save_checkpoint(results, list(processed_names))

            await viral_analyzer.close()

        return results

    def _save_checkpoint(self, results: Dict[str, Any], processed: List[str]):
        """Save checkpoint for resume capability."""
        checkpoint = {
            "timestamp": datetime.now().isoformat(),
            "processed": processed,
            "results": {
                "base_analyses": [a.model_dump() for a in results.get("base_analyses", [])],
                "viral_analyses": results.get("viral_analyses", []),
                "errors": results.get("errors", []),
                "skipped": results.get("skipped", []),
            }
        }
        checkpoint_file = self.checkpoint_dir / "latest_checkpoint.json"
        with open(checkpoint_file, "w") as f:
            json.dump(checkpoint, f, default=str)

    def _load_checkpoint(self, checkpoint_id: str) -> Optional[Dict[str, Any]]:
        """Load checkpoint for resume."""
        checkpoint_file = self.checkpoint_dir / f"{checkpoint_id}.json"
        if not checkpoint_file.exists():
            checkpoint_file = self.checkpoint_dir / "latest_checkpoint.json"

        if checkpoint_file.exists():
            try:
                with open(checkpoint_file) as f:
                    data = json.load(f)
                # Reconstruct StartupAnalysis objects
                from src.data.models import StartupAnalysis
                data["results"]["base_analyses"] = [
                    StartupAnalysis(**a) for a in data["results"].get("base_analyses", [])
                ]
                return data
            except Exception as e:
                print(f"Could not load checkpoint: {e}")
        return None


async def process_large_batch(
    startups: List[StartupInput],
    skip_crawl: bool = False,
    skip_viral: bool = False,
    resume: bool = False,
) -> Dict[str, Any]:
    """Convenience function for processing large batches."""
    processor = BatchProcessor()
    return await processor.process_batch(
        startups,
        skip_crawl=skip_crawl,
        skip_viral=skip_viral,
        resume_from="latest" if resume else None,
    )
