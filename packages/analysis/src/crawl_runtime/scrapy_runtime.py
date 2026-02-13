"""Adapter that runs Scrapy+Playwright crawler as an async subprocess."""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import sys
import tempfile
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.config import settings
from src.crawl_runtime.capture import RawCaptureRecorder
from src.crawl_runtime.extraction import extract_main_content, extract_title
from src.crawl_runtime.frontier import (
    DomainPolicy,
    FrontierUrl,
    UrlFrontierStore,
    canonicalize_url,
    classify_page_type,
    extract_domain,
)
from src.crawl_runtime.models import estimate_quality_score
from src.crawl_runtime.unblock_provider import UnblockRequest, build_unblock_provider
from src.data.models import StartupInput

logger = logging.getLogger(__name__)


class ScrapyPlaywrightRuntime:
    """Modern crawler runtime with optional frontier persistence."""

    def __init__(self, frontier: Optional[UrlFrontierStore] = None, disable_frontier: bool = False):
        self.project_root = Path(__file__).resolve().parents[2]
        self.disable_frontier = disable_frontier
        if disable_frontier:
            self.frontier = UrlFrontierStore(None)  # disabled store
        else:
            self.frontier = frontier or UrlFrontierStore(os.getenv("DATABASE_URL"))
        self.capture_recorder = RawCaptureRecorder(self.frontier)
        self.unblock_provider = build_unblock_provider(
            provider_name=settings.crawler.unblock_provider,
            endpoint=settings.crawler.browserless_endpoint,
            token=settings.crawler.browserless_token,
        )
        self._startup_id_cache: Dict[str, Optional[str]] = {}

    async def close(self):
        await self.frontier.close()

    @staticmethod
    def _default_policy(domain: str) -> DomainPolicy:
        return DomainPolicy(
            domain=domain,
            respect_robots=settings.crawler.respect_robots_txt,
            proxy_tier=settings.crawler.default_proxy_tier,
            render_required=False,
        )

    @staticmethod
    def _slugify(name: str) -> str:
        import re
        slug = name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")
        # Strip any path traversal characters for safe filesystem use
        return re.sub(r'[^a-z0-9\-]', '', slug)

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
    def _seed_targets_from_frontier(leased: List[FrontierUrl], policy: DomainPolicy) -> List[Dict[str, Any]]:
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
                "proxy_tier": policy.proxy_tier,
                "render_required": bool(policy.render_required),
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
        respect_robots: bool,
        force_render: bool,
        default_proxy_tier: str,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        """Run subprocess spider and return `(documents, error)`.

        The subprocess isolation avoids Twisted/reactor conflicts with the main app.
        """
        if not seed_targets:
            return [], None

        with tempfile.TemporaryDirectory(prefix="scrapy_crawl_") as tmp_dir:
            out_file = Path(tmp_dir) / "crawl_output.json"
            # Write seed targets to a temp file to avoid shell arg length limits
            # and prevent command injection via startup_name or seed_targets.
            seed_file = Path(tmp_dir) / "seed_targets.json"
            seed_file.write_text(json.dumps(seed_targets), encoding="utf-8")

            cmd = [
                sys.executable,
                "-m",
                "src.crawl_runtime.run_spider",
                "--startup-name",
                startup_name,
                "--seed-targets-file",
                str(seed_file),
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

            if respect_robots:
                cmd.append("--respect-robots")
            if settings.crawler.datacenter_proxy_url:
                cmd.extend(["--proxy-url", settings.crawler.datacenter_proxy_url])
            if settings.crawler.residential_proxy_url:
                cmd.extend(["--residential-proxy-url", settings.crawler.residential_proxy_url])
            if force_render:
                cmd.append("--force-render")
            cmd.extend(["--default-proxy-tier", default_proxy_tier if default_proxy_tier in {"datacenter", "residential"} else "datacenter"])

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
            "quality_score": float(doc.get("quality_score") or 0.0),
            "error_category": doc.get("error_category"),
            "proxy_tier": doc.get("proxy_tier", "none"),
            "blocked_detected": bool(doc.get("blocked_detected", False)),
            "provider": doc.get("provider", "none"),
            "capture_id": doc.get("capture_id"),
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

    @staticmethod
    def _doc_error_category(doc: Dict[str, Any]) -> Optional[str]:
        status = int(doc.get("status_code") or 0)
        blocked = bool(doc.get("blocked_detected", False))
        if blocked or status in {401, 403, 429, 451, 503}:
            return "blocked"
        if status == 404:
            return "not_found"
        if status >= 500:
            return "transient"
        if status >= 400:
            return "permanent"
        return None

    @staticmethod
    def _crawl_log_status(*, status_code: int, blocked_detected: bool, error_category: Optional[str]) -> str:
        if blocked_detected or error_category == "blocked":
            return "blocked"
        if status_code == 304:
            return "success"
        if status_code <= 0:
            return "failed"
        if status_code >= 400:
            return "failed"
        return "success"

    async def _resolve_startup_id(self, startup_slug: str) -> Optional[str]:
        if startup_slug in self._startup_id_cache:
            return self._startup_id_cache[startup_slug]
        if not self.frontier.enabled or not getattr(self.frontier, "pool", None):
            self._startup_id_cache[startup_slug] = None
            return None

        startup_id: Optional[str] = None
        try:
            async with self.frontier.pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT id::text AS id FROM startups WHERE slug = $1 LIMIT 1",
                    startup_slug,
                )
            if row and row["id"]:
                startup_id = str(row["id"])
        except Exception as exc:
            logger.warning("Failed to resolve startup id for slug=%s: %s", startup_slug, exc)

        self._startup_id_cache[startup_slug] = startup_id
        return startup_id

    async def _log_crawl_attempt(
        self,
        *,
        startup_slug: str,
        doc: Dict[str, Any],
        error_category: Optional[str],
        capture_id: Optional[str],
    ) -> None:
        if not self.frontier.enabled or not getattr(self.frontier, "pool", None):
            return

        canonical_url = canonicalize_url(doc.get("canonical_url") or doc.get("url") or "")
        if not canonical_url:
            return

        startup_id = await self._resolve_startup_id(startup_slug)
        status_code = int(doc.get("status_code") or 0)
        blocked_detected = bool(doc.get("blocked_detected", False))
        status = self._crawl_log_status(
            status_code=status_code,
            blocked_detected=blocked_detected,
            error_category=error_category,
        )
        error_message = str(doc.get("error_message") or doc.get("error") or "").strip()
        if not error_message and status != "success":
            error_message = error_category or "crawl failed"
        content = str(doc.get("clean_text") or "")
        content_length = len(content.encode("utf-8", errors="ignore")) if content else None
        quality_score = float(doc.get("quality_score") or 0.0)
        safe_capture_id = capture_id if isinstance(capture_id, str) and len(capture_id) >= 32 else None

        try:
            async with self.frontier.pool.acquire() as conn:
                await conn.execute(
                    """
                    INSERT INTO crawl_logs (
                        startup_id,
                        source_type,
                        url,
                        status,
                        http_status,
                        error_message,
                        content_length,
                        duration_ms,
                        crawl_started_at,
                        crawl_completed_at,
                        canonical_url,
                        quality_score,
                        content_type,
                        error_category,
                        etag,
                        last_modified,
                        proxy_tier,
                        fetch_method,
                        capture_id
                    )
                    VALUES (
                        $1::uuid,
                        $2,
                        $3,
                        $4,
                        NULLIF($5, 0),
                        $6,
                        $7,
                        $8,
                        NOW(),
                        NOW(),
                        $9,
                        $10,
                        $11,
                        $12,
                        $13,
                        $14,
                        $15,
                        $16,
                        $17::uuid
                    )
                    """,
                    startup_id,
                    "docs" if str(doc.get("page_type") or "") == "docs" else "website",
                    str(doc.get("url") or canonical_url),
                    status,
                    status_code,
                    error_message[:2000] if error_message else None,
                    content_length,
                    int(doc.get("response_time_ms") or 0),
                    canonical_url,
                    max(0.0, min(quality_score, 1.0)),
                    str(doc.get("content_type") or "html"),
                    error_category,
                    doc.get("etag"),
                    doc.get("last_modified"),
                    str(doc.get("proxy_tier") or "none"),
                    str(doc.get("fetch_method") or "http"),
                    safe_capture_id,
                )
        except Exception as exc:
            logger.warning("Failed to write crawl log for %s: %s", canonical_url, exc)

    def _should_attempt_unblock(self, doc: Dict[str, Any], policy: DomainPolicy) -> bool:
        mode = (settings.crawler.unblock_mode or "auto").lower()
        if mode == "off":
            return False
        if self.unblock_provider is None:
            return False
        status = int(doc.get("status_code") or 0)
        blocked = bool(doc.get("blocked_detected", False))
        js_shell = bool(doc.get("js_shell_detected", False))
        low_content = len((doc.get("clean_text") or "").strip()) < 250
        if policy.render_required:
            return True
        return blocked or status in {403, 429, 503} or (js_shell and low_content)

    @staticmethod
    def _upgrade_doc_from_provider(
        original_doc: Dict[str, Any],
        provider_html: str,
        provider_name: str,
    ) -> Dict[str, Any]:
        upgraded = dict(original_doc)
        title = extract_title(provider_html) if provider_html else None
        clean_text, clean_markdown = extract_main_content(provider_html or "")
        upgraded["title"] = title
        upgraded["clean_text"] = clean_text
        upgraded["clean_markdown"] = clean_markdown
        upgraded["content_hash"] = hashlib.sha256((clean_text or "").lower().encode("utf-8", errors="ignore")).hexdigest()[:32]
        upgraded["html_hash"] = hashlib.sha256((provider_html or "").encode("utf-8", errors="ignore")).hexdigest()[:32]
        upgraded["fetch_method"] = f"provider_{provider_name}"
        upgraded["provider"] = provider_name
        upgraded["blocked_detected"] = False
        upgraded["error_category"] = None
        upgraded["quality_score"] = estimate_quality_score(clean_text, title=title)
        upgraded["raw_capture"] = {
            "request_method": "GET",
            "request_headers": {},
            "response_headers": {},
            "response_body": (provider_html or "")[: max(4096, int(settings.crawler.raw_capture_max_body_bytes))],
            "response_body_encoding": "utf-8",
        }
        return upgraded

    async def _maybe_apply_provider(
        self,
        docs: List[Dict[str, Any]],
        *,
        policy: DomainPolicy,
    ) -> List[Dict[str, Any]]:
        if not docs or self.unblock_provider is None:
            return docs

        updated: List[Dict[str, Any]] = []
        for doc in docs:
            error_category = self._doc_error_category(doc)
            doc["error_category"] = error_category
            if not self._should_attempt_unblock(doc, policy):
                updated.append(doc)
                continue

            request = UnblockRequest(
                url=str(doc.get("url") or doc.get("canonical_url") or ""),
                headers={},
                timeout_ms=max(5000, int(settings.crawler.timeout_ms)),
            )

            try:
                provider_result = await self.unblock_provider.fetch(request)
                upgraded = self._upgrade_doc_from_provider(
                    doc,
                    provider_html=provider_result.html,
                    provider_name=provider_result.provider,
                )
                upgraded["status_code"] = int(provider_result.status_code)
                updated.append(upgraded)
            except Exception:
                updated.append(doc)

        return updated

    async def _mark_frontier_results(
        self,
        *,
        leased_by_canonical: Dict[str, FrontierUrl],
        docs: List[Dict[str, Any]],
        startup_slug: str,
        policy: DomainPolicy,
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
            error_category = self._doc_error_category(doc)
            capture_id = await self.capture_recorder.save_from_doc(startup_slug=startup_slug, doc=doc)
            doc["capture_id"] = capture_id
            await self._log_crawl_attempt(
                startup_slug=startup_slug,
                doc=doc,
                error_category=error_category,
                capture_id=capture_id,
            )

            await self.frontier.mark_crawled(
                canonical_url=canonical,
                status_code=status_code,
                content_hash=content_hash,
                etag=doc.get("etag"),
                last_modified=doc.get("last_modified"),
                changed=changed,
                response_time_ms=int(doc.get("response_time_ms") or 0),
                quality_score=float(doc.get("quality_score") or 0.0),
                error_category=error_category,
                blocked_detected=bool(doc.get("blocked_detected", False)),
                fetch_method=str(doc.get("fetch_method") or "http"),
                proxy_tier=str(doc.get("proxy_tier") or policy.proxy_tier),
                capture_id=capture_id,
            )

        missing = 0
        for canonical, _item in leased_by_canonical.items():
            if canonical not in seen_leased:
                missing += 1
                # Spider failed to emit this URL; retry with backoff.
                await self.frontier.requeue_failed(canonical, backoff_seconds=300)

        # If the spider has an errback wired correctly, missing should be rare.
        # Do not spam crawl_logs with synthetic failures; it breaks run telemetry.
        if missing > 0:
            logger.warning(
                "Spider returned no document for %d/%d leased URLs (startup=%s domain=%s)",
                missing,
                len(leased_by_canonical),
                startup_slug,
                policy.domain,
            )

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
            try:
                await self.frontier.enqueue_urls(startup_slug, [t["url"] for t in seed_targets])
            except Exception as exc:
                import logging
                logging.getLogger(__name__).warning(
                    "Frontier enqueue failed for %s (non-fatal): %s", startup_slug, exc
                )

        allowed_domain = extract_domain(startup.website)
        if not allowed_domain:
            return []
        policy = self._default_policy(allowed_domain)

        docs, err = await self._run_spider(
            startup_name=startup.name,
            allowed_domain=allowed_domain,
            seed_targets=seed_targets,
            respect_robots=policy.respect_robots,
            force_render=policy.render_required,
            default_proxy_tier=policy.proxy_tier,
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

        docs = await self._maybe_apply_provider(docs, policy=policy)
        results = [self._doc_to_result(doc) for doc in docs]

        if self.frontier.enabled:
            try:
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
                    policy=policy,
                )
            except Exception as exc:
                import logging
                logging.getLogger(__name__).warning(
                    "Frontier mark_results failed for %s (non-fatal): %s", startup_slug, exc
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
            policy = self._default_policy(domain)
            get_policy = getattr(self.frontier, "get_domain_policy", None)
            if callable(get_policy):
                try:
                    maybe_policy = await get_policy(domain)
                    if isinstance(maybe_policy, DomainPolicy):
                        policy = maybe_policy
                except Exception:
                    policy = self._default_policy(domain)

            seed_targets = self._seed_targets_from_frontier(group_items, policy)
            docs, err = await self._run_spider(
                startup_name=startup_slug,
                allowed_domain=domain,
                seed_targets=seed_targets,
                respect_robots=policy.respect_robots,
                force_render=policy.render_required,
                default_proxy_tier=policy.proxy_tier,
            )

            if err:
                errors.append(err)
                failed += len(group_items)
                for item in group_items:
                    await self.frontier.requeue_failed(item.canonical_url, backoff_seconds=600)
                    await self._log_crawl_attempt(
                        startup_slug=startup_slug,
                        doc={
                            "url": item.url,
                            "canonical_url": item.canonical_url,
                            "page_type": item.page_type,
                            "status_code": 0,
                            "content_type": "html",
                            "fetch_method": "runtime_error",
                            "response_time_ms": 0,
                            "error_message": err[:500],
                        },
                        error_category="transient",
                        capture_id=None,
                    )
                continue

            docs = await self._maybe_apply_provider(docs, policy=policy)
            leased_map = {item.canonical_url: item for item in group_items}
            await self._mark_frontier_results(
                leased_by_canonical=leased_map,
                docs=docs,
                startup_slug=startup_slug,
                policy=policy,
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
