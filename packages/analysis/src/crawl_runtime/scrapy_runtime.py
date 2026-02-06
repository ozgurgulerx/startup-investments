"""Adapter that runs Scrapy+Playwright crawler as an async subprocess."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.config import settings
from src.crawl_runtime.frontier import FrontierUrl, UrlFrontierStore, canonicalize_url, classify_page_type, extract_domain
from src.data.models import StartupInput


class ScrapyPlaywrightRuntime:
    """Modern crawler runtime with optional frontier persistence."""

    def __init__(self, frontier: Optional[UrlFrontierStore] = None):
        self.project_root = Path(__file__).resolve().parents[2]
        self.frontier = frontier or UrlFrontierStore(os.getenv("DATABASE_URL"))

    async def close(self):
        await self.frontier.close()

    @staticmethod
    def _slugify(name: str) -> str:
        return name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")

    @staticmethod
    def _seed_targets_from_urls(urls: List[str]) -> List[Dict[str, Any]]:
        targets: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for raw in urls:
            canonical = canonicalize_url(raw)
            if not canonical or canonical in seen:
                continue
            seen.add(canonical)
            targets.append(
                {
                    "url": canonical,
                    "page_type": classify_page_type(canonical),
                }
            )
        return targets

    @staticmethod
    def _seed_targets_from_frontier(leased: List[FrontierUrl]) -> List[Dict[str, Any]]:
        targets: List[Dict[str, Any]] = []
        for item in leased:
            headers: Dict[str, str] = {}
            if item.etag:
                headers["If-None-Match"] = item.etag
            if item.last_modified:
                headers["If-Modified-Since"] = item.last_modified

            target: Dict[str, Any] = {
                "url": item.url,
                "page_type": item.page_type or classify_page_type(item.url),
            }
            if headers:
                target["headers"] = headers
            targets.append(target)
        return targets

    async def _run_spider(
        self,
        *,
        startup_name: str,
        allowed_domain: str,
        seed_targets: List[Dict[str, Any]],
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        """Run subprocess spider and return `(documents, error)`.

        The subprocess isolation avoids Twisted/reactor conflicts with the main app.
        """
        if not seed_targets:
            return [], None

        with tempfile.TemporaryDirectory(prefix="scrapy_crawl_") as tmp_dir:
            out_file = Path(tmp_dir) / "crawl_output.json"
            cmd = [
                sys.executable,
                "-m",
                "src.crawl_runtime.run_spider",
                "--startup-name",
                startup_name,
                "--seed-targets",
                json.dumps(seed_targets),
                "--allowed-domain",
                allowed_domain,
                "--output-path",
                str(out_file),
                "--timeout-seconds",
                str(max(10, settings.crawler.timeout_ms // 1000)),
                "--download-delay",
                "0.35",
                "--concurrent-requests",
                str(max(4, settings.crawler.max_concurrent * 4)),
                "--depth-limit",
                str(max(1, settings.crawler.depth_limit)),
                "--max-pages",
                str(max(10, settings.crawler.max_pages_per_startup)),
            ]

            if settings.crawler.respect_robots_txt:
                cmd.append("--respect-robots")
            if settings.crawler.datacenter_proxy_url:
                cmd.extend(["--proxy-url", settings.crawler.datacenter_proxy_url])
            if settings.crawler.residential_proxy_url:
                cmd.extend(["--residential-proxy-url", settings.crawler.residential_proxy_url])

            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(self.project_root),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()

            if proc.returncode != 0:
                err = (stderr or stdout or b"crawler runtime failed").decode("utf-8", errors="ignore")
                return [], err[:4000]

            if not out_file.exists():
                return [], "crawler runtime produced no output"

            try:
                docs = json.loads(out_file.read_text(encoding="utf-8"))
            except Exception as exc:
                return [], f"failed to parse crawler output: {exc}"

        return docs, None

    @staticmethod
    def _doc_to_result(doc: Dict[str, Any]) -> Dict[str, Any]:
        clean_text = doc.get("clean_text") or ""
        canonical_url = doc.get("canonical_url") or canonicalize_url(doc.get("url", ""))
        page_type = doc.get("page_type") or classify_page_type(canonical_url or doc.get("url", ""))
        status_code = int(doc.get("status_code") or 0)

        return {
            "success": status_code < 500,
            "url": doc.get("url") or "",
            "canonical_url": canonical_url,
            "source_type": "docs" if page_type == "docs" else "website",
            "title": doc.get("title"),
            "content": clean_text,
            "content_hash": doc.get("content_hash"),
            "fetch_method": doc.get("fetch_method", "http"),
            "response_time_ms": int(doc.get("response_time_ms") or 0),
            "status_code": status_code,
            "etag": doc.get("etag"),
            "last_modified": doc.get("last_modified"),
            "page_type": page_type,
            "content_type": doc.get("content_type", "html"),
        }

    @staticmethod
    def _changed(previous_hash: Optional[str], status_code: int, new_hash: Optional[str]) -> bool:
        if status_code == 304:
            return False
        if not new_hash:
            return False
        if not previous_hash:
            return True
        return previous_hash != new_hash

    async def _mark_frontier_results(
        self,
        *,
        leased_by_canonical: Dict[str, FrontierUrl],
        docs: List[Dict[str, Any]],
        startup_slug: str,
    ) -> None:
        """Update queue state based on crawl output and discover new links."""
        if not self.frontier.enabled:
            return

        seen_leased: set[str] = set()
        discovered: List[str] = []

        for doc in docs:
            canonical = canonicalize_url(doc.get("canonical_url") or doc.get("url") or "")
            if not canonical:
                continue

            discovered.append(canonical)
            status_code = int(doc.get("status_code") or 0)
            content_hash = doc.get("content_hash")

            leased = leased_by_canonical.get(canonical)
            if leased is None:
                continue

            seen_leased.add(canonical)
            changed = self._changed(leased.content_hash, status_code, content_hash)

            await self.frontier.mark_crawled(
                canonical_url=canonical,
                status_code=status_code,
                content_hash=content_hash,
                etag=doc.get("etag"),
                last_modified=doc.get("last_modified"),
                changed=changed,
                response_time_ms=int(doc.get("response_time_ms") or 0),
            )

        for canonical, _item in leased_by_canonical.items():
            if canonical not in seen_leased:
                # Spider failed to emit this URL; retry with backoff.
                await self.frontier.requeue_failed(canonical, backoff_seconds=300)

        if discovered:
            await self.frontier.enqueue_urls(startup_slug, discovered)

    async def crawl_startup(self, startup: StartupInput, seed_urls: List[str]) -> List[Dict[str, Any]]:
        """Ad-hoc startup crawl used by existing DeltaProcessor/analysis pipeline."""
        if not startup.website:
            return []

        await self.frontier.connect()

        seed_targets = self._seed_targets_from_urls(seed_urls)
        if not seed_targets:
            canonical = canonicalize_url(startup.website)
            if canonical:
                seed_targets = [{"url": canonical, "page_type": classify_page_type(canonical)}]

        if not seed_targets:
            return []

        startup_slug = self._slugify(startup.name)
        if self.frontier.enabled:
            await self.frontier.enqueue_urls(startup_slug, [t["url"] for t in seed_targets])

        allowed_domain = extract_domain(startup.website)
        if not allowed_domain:
            return []

        docs, err = await self._run_spider(
            startup_name=startup.name,
            allowed_domain=allowed_domain,
            seed_targets=seed_targets,
        )

        if err:
            return [
                {
                    "success": False,
                    "url": startup.website,
                    "source_type": "website",
                    "error": err,
                }
            ]

        results = [self._doc_to_result(doc) for doc in docs]

        if self.frontier.enabled:
            # Treat as first-seen startup crawl; update all emitted URLs.
            now = datetime.now(timezone.utc)
            synthetic_leased = {
                canonicalize_url(r.get("canonical_url") or r.get("url") or ""): FrontierUrl(
                    startup_slug=startup_slug,
                    url=r.get("url") or "",
                    canonical_url=canonicalize_url(r.get("canonical_url") or r.get("url") or ""),
                    domain=extract_domain(r.get("url") or startup.website),
                    page_type=r.get("page_type") or "generic",
                    priority_score=40,
                    next_crawl_at=now,
                    content_hash=None,
                    etag=None,
                    last_modified=None,
                )
                for r in results
                if canonicalize_url(r.get("canonical_url") or r.get("url") or "")
            }
            # Update queue and metadata without needing prior lease.
            await self._mark_frontier_results(
                leased_by_canonical=synthetic_leased,
                docs=docs,
                startup_slug=startup_slug,
            )

        return results

    async def crawl_frontier_batch(self, worker_id: str, limit: Optional[int] = None) -> Dict[str, Any]:
        """Lease URLs from frontier and crawl them in grouped batches.

        Returns execution summary with per-run metrics and transformed results.
        """
        await self.frontier.connect()

        if not self.frontier.enabled:
            return {
                "worker_id": worker_id,
                "leased": 0,
                "processed": 0,
                "failed": 0,
                "recovered_leases": 0,
                "results": [],
                "errors": ["Frontier disabled: DATABASE_URL not configured"],
            }

        recovered = await self.frontier.recover_stale_leases(30)
        batch_limit = max(1, int(limit or settings.crawler.frontier_batch_size))
        leased = await self.frontier.lease_urls(batch_limit, worker_id)

        if not leased:
            return {
                "worker_id": worker_id,
                "leased": 0,
                "processed": 0,
                "failed": 0,
                "recovered_leases": recovered,
                "results": [],
                "errors": [],
            }

        grouped: Dict[Tuple[str, str], List[FrontierUrl]] = defaultdict(list)
        for item in leased:
            grouped[(item.startup_slug, item.domain)].append(item)

        all_results: List[Dict[str, Any]] = []
        errors: List[str] = []
        failed = 0

        for (startup_slug, domain), group_items in grouped.items():
            seed_targets = self._seed_targets_from_frontier(group_items)
            docs, err = await self._run_spider(
                startup_name=startup_slug,
                allowed_domain=domain,
                seed_targets=seed_targets,
            )

            if err:
                errors.append(err)
                failed += len(group_items)
                for item in group_items:
                    await self.frontier.requeue_failed(item.canonical_url, backoff_seconds=600)
                continue

            leased_map = {item.canonical_url: item for item in group_items}
            await self._mark_frontier_results(
                leased_by_canonical=leased_map,
                docs=docs,
                startup_slug=startup_slug,
            )

            all_results.extend(self._doc_to_result(doc) for doc in docs)

        processed = max(0, len(leased) - failed)
        return {
            "worker_id": worker_id,
            "leased": len(leased),
            "processed": processed,
            "failed": failed,
            "recovered_leases": recovered,
            "results": all_results,
            "errors": errors,
        }
