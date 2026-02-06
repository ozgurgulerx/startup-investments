"""Subprocess entrypoint: Scrapy + Playwright crawl for startup websites."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# Ensure local src imports resolve when run as `python -m src.crawl_runtime.run_spider`
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

try:
    import scrapy
    from scrapy.crawler import CrawlerProcess
except Exception as exc:  # pragma: no cover
    print(json.dumps({"error": f"scrapy import failed: {exc}"}))
    sys.exit(2)

from src.crawl_runtime.extraction import extract_main_content, extract_title
from src.crawl_runtime.frontier import canonicalize_url, extract_domain, classify_page_type
from src.crawl_runtime.pdf_parser import extract_pdf_text


def is_same_site(url1: str, url2: str) -> bool:
    d1 = extract_domain(url1)
    d2 = extract_domain(url2)
    if not d1 or not d2:
        return False
    if d1 == d2:
        return True
    p1 = d1.split(".")
    p2 = d2.split(".")
    if len(p1) >= 2 and len(p2) >= 2:
        return ".".join(p1[-2:]) == ".".join(p2[-2:])
    return False


JS_SHELL_MARKERS = [
    "enable javascript",
    "javascript is required",
    "please enable javascript",
    "you need to enable javascript",
]


def detect_js_shell(html: str) -> bool:
    if not html:
        return True

    lower = html.lower()
    if any(marker in lower for marker in JS_SHELL_MARKERS):
        return True

    script_bytes = sum(len(m.group(0)) for m in re.finditer(r"<script[\\s\\S]*?</script>", lower))
    text_bytes = len(re.sub(r"<[^>]+>", " ", lower))
    if text_bytes < 250 and script_bytes > text_bytes * 2:
        return True

    return False


class StartupSpider(scrapy.Spider):
    name = "startup_spider"

    def __init__(
        self,
        startup_name: str,
        seed_targets: str,
        allowed_domain: str,
        output_path: str,
        max_pages: int = 80,
        use_playwright: bool = True,
        proxy_url: str = "",
        residential_proxy_url: str = "",
        *args,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self.startup_name = startup_name
        self.allowed_domain = allowed_domain
        self.output_path = output_path
        self.max_pages = int(max_pages)
        self.use_playwright = bool(use_playwright)
        self.proxy_url = proxy_url
        self.residential_proxy_url = residential_proxy_url

        raw_targets = json.loads(seed_targets)
        self.seed_targets: List[Dict[str, Any]] = []
        for item in raw_targets:
            if isinstance(item, str):
                self.seed_targets.append({"url": item})
            elif isinstance(item, dict) and item.get("url"):
                self.seed_targets.append(item)
        self.seen: set[str] = set()
        self.documents: List[Dict[str, Any]] = []

    def _build_meta(self, rendered: bool = False) -> Dict[str, Any]:
        meta: Dict[str, Any] = {"rendered": rendered}
        if self.proxy_url:
            meta["proxy"] = self.proxy_url
        if rendered and self.residential_proxy_url:
            meta["proxy"] = self.residential_proxy_url
        if rendered and self.use_playwright:
            meta["playwright"] = True
            meta["playwright_include_page"] = False
        return meta

    def start_requests(self):
        for target in self.seed_targets:
            url = str(target.get("url", "")).strip()
            if not url:
                continue
            canonical = canonicalize_url(url)
            if not canonical or canonical in self.seen:
                continue
            self.seen.add(canonical)
            headers = target.get("headers") or {}
            page_type = target.get("page_type") or classify_page_type(url)
            meta = self._build_meta(rendered=False)
            meta["seed_page_type"] = page_type
            yield scrapy.Request(
                url=url,
                callback=self.parse,
                headers=headers,
                meta=meta,
                dont_filter=True,
            )

    def _record_doc(
        self,
        *,
        url: str,
        status: int,
        html: str,
        clean_text: str,
        clean_markdown: str,
        fetch_method: str,
        response_time_ms: int,
        page_type: str = "generic",
        content_type: str = "html",
        etag: Optional[str] = None,
        last_modified: Optional[str] = None,
    ):
        canonical = canonicalize_url(url)
        if not canonical:
            canonical = url

        title = extract_title(html) if html else None
        html_hash = hashlib.sha256((html or "").encode("utf-8", errors="ignore")).hexdigest()[:32]
        content_hash = hashlib.sha256((clean_text or "").lower().encode("utf-8", errors="ignore")).hexdigest()[:32]

        self.documents.append(
            {
                "url": url,
                "canonical_url": canonical,
                "domain": extract_domain(canonical),
                "page_type": page_type,
                "content_type": content_type,
                "title": title,
                "clean_text": clean_text,
                "clean_markdown": clean_markdown,
                "content_hash": content_hash,
                "html_hash": html_hash,
                "etag": etag,
                "last_modified": last_modified,
                "fetch_method": fetch_method,
                "status_code": status,
                "response_time_ms": response_time_ms,
                "crawled_at": datetime.now(timezone.utc).isoformat(),
                "discovered_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    def parse(self, response: scrapy.http.Response):
        start_ts = time.monotonic()
        rendered = bool(response.meta.get("rendered"))
        current_page_type = response.meta.get("seed_page_type") or classify_page_type(response.url)

        if response.status == 304:
            self._record_doc(
                url=response.url,
                status=response.status,
                html="",
                clean_text="",
                clean_markdown="",
                fetch_method="browser" if rendered else "http",
                response_time_ms=int((time.monotonic() - start_ts) * 1000),
                page_type=current_page_type,
                etag=response.headers.get("ETag", b"").decode("utf-8", errors="ignore") or None,
                last_modified=response.headers.get("Last-Modified", b"").decode("utf-8", errors="ignore") or None,
            )
            return

        ctype = (response.headers.get("Content-Type") or b"").decode("utf-8", errors="ignore").lower()
        if "application/pdf" in ctype or response.url.lower().endswith(".pdf"):
            text = extract_pdf_text(bytes(response.body)) or ""
            self._record_doc(
                url=response.url,
                status=response.status,
                html="",
                clean_text=text,
                clean_markdown=text,
                fetch_method="browser" if rendered else "http",
                response_time_ms=int((time.monotonic() - start_ts) * 1000),
                page_type=current_page_type,
                content_type="pdf",
                etag=response.headers.get("ETag", b"").decode("utf-8", errors="ignore") or None,
                last_modified=response.headers.get("Last-Modified", b"").decode("utf-8", errors="ignore") or None,
            )
            return

        html = response.text or ""
        if not rendered and self.use_playwright and detect_js_shell(html):
            # Escalate to browser rendering only when static fetch appears insufficient.
            yield scrapy.Request(
                url=response.url,
                callback=self.parse,
                meta=self._build_meta(rendered=True),
                dont_filter=True,
            )
            return

        clean_text, clean_markdown = extract_main_content(html)
        self._record_doc(
            url=response.url,
            status=response.status,
            html=html,
            clean_text=clean_text,
            clean_markdown=clean_markdown,
            fetch_method="browser" if rendered else "http",
            response_time_ms=int((time.monotonic() - start_ts) * 1000),
            page_type=current_page_type,
            etag=response.headers.get("ETag", b"").decode("utf-8", errors="ignore") or None,
            last_modified=response.headers.get("Last-Modified", b"").decode("utf-8", errors="ignore") or None,
        )

        if len(self.seen) >= self.max_pages:
            return

        for href in response.css("a::attr(href)").getall():
            if len(self.seen) >= self.max_pages:
                break

            abs_url = response.urljoin(href)
            canonical = canonicalize_url(abs_url)
            if not canonical:
                continue
            if canonical in self.seen:
                continue
            if self.allowed_domain and not is_same_site(canonical, f"https://{self.allowed_domain}"):
                continue

            self.seen.add(canonical)
            meta = self._build_meta(rendered=False)
            meta["seed_page_type"] = classify_page_type(canonical)
            yield scrapy.Request(url=abs_url, callback=self.parse, meta=meta)

    def closed(self, reason: str):  # pragma: no cover - scrapy callback
        out = Path(self.output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as f:
            json.dump(self.documents, f, indent=2, ensure_ascii=True)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run startup crawl spider")
    parser.add_argument("--startup-name", required=True)
    parser.add_argument("--seed-targets", default="", help="JSON array of objects: [{url, headers?, page_type?}]")
    parser.add_argument("--seed-urls", default="", help="Backward compatible JSON array of URLs")
    parser.add_argument("--allowed-domain", required=True)
    parser.add_argument("--output-path", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=30)
    parser.add_argument("--download-delay", type=float, default=0.35)
    parser.add_argument("--concurrent-requests", type=int, default=12)
    parser.add_argument("--depth-limit", type=int, default=2)
    parser.add_argument("--max-pages", type=int, default=80)
    parser.add_argument("--respect-robots", action="store_true")
    parser.add_argument("--no-playwright", action="store_true")
    parser.add_argument("--proxy-url", default="")
    parser.add_argument("--residential-proxy-url", default="")
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    seed_targets = args.seed_targets
    if not seed_targets:
        if args.seed_urls:
            try:
                urls = json.loads(args.seed_urls)
            except Exception:
                urls = []
            seed_targets = json.dumps([{"url": u} for u in urls if u])
        else:
            print(json.dumps({"error": "No seed targets provided"}))
            return 2

    use_playwright = not args.no_playwright
    if use_playwright:
        try:
            import scrapy_playwright.handler  # noqa: F401
        except Exception:
            use_playwright = False

    settings: Dict[str, Any] = {
        "LOG_ENABLED": False,
        "TELNETCONSOLE_ENABLED": False,
        "COOKIES_ENABLED": True,
        "ROBOTSTXT_OBEY": bool(args.respect_robots),
        "DOWNLOAD_TIMEOUT": int(args.timeout_seconds),
        "DOWNLOAD_DELAY": float(args.download_delay),
        "CONCURRENT_REQUESTS": int(args.concurrent_requests),
        "RETRY_ENABLED": True,
        "RETRY_TIMES": 2,
        "DEPTH_LIMIT": int(args.depth_limit),
        "HTTPERROR_ALLOW_ALL": True,
        "USER_AGENT": "Mozilla/5.0 (compatible; StartupIntelCrawler/2026)",
        "REQUEST_FINGERPRINTER_IMPLEMENTATION": "2.7",
    }

    if use_playwright:
        settings.update(
            {
                "TWISTED_REACTOR": "twisted.internet.asyncioreactor.AsyncioSelectorReactor",
                "DOWNLOAD_HANDLERS": {
                    "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
                    "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
                },
                "PLAYWRIGHT_BROWSER_TYPE": "chromium",
                "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": int(args.timeout_seconds) * 1000,
                "PLAYWRIGHT_LAUNCH_OPTIONS": {"headless": True},
            }
        )

    process = CrawlerProcess(settings=settings)
    process.crawl(
        StartupSpider,
        startup_name=args.startup_name,
        seed_targets=seed_targets,
        allowed_domain=args.allowed_domain,
        output_path=args.output_path,
        max_pages=args.max_pages,
        use_playwright=use_playwright,
        proxy_url=args.proxy_url,
        residential_proxy_url=args.residential_proxy_url,
    )
    process.start(stop_after_crawl=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
