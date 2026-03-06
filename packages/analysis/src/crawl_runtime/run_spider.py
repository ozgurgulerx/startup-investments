"""Subprocess entrypoint: Scrapy + Playwright crawl for startup websites."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
import sys
import time
from urllib.parse import urlparse, urljoin
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

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
from src.crawl_runtime.models import estimate_quality_score
from src.crawl_runtime.pdf_parser import extract_pdf_text
from src.crawl_runtime.unblock_provider import is_probably_blocked
from bs4 import BeautifulSoup


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


MAX_RAW_BODY_BYTES = max(4096, int(os.getenv("CRAWLER_RAW_CAPTURE_MAX_BODY_BYTES", "1048576")))

PRIORITY_PAGE_TYPES = {"docs", "pricing", "changelog", "security"}
SECONDARY_PAGE_TYPES = {"blog", "news"}
DISCOVERY_DENY_PATTERNS = [
    re.compile(r"/(login|logout|signup|sign-up|register|account|cart|checkout)(/|$)", re.I),
    re.compile(r"/(privacy|terms|cookie)(/|$)", re.I),
    re.compile(r"/(tag|author|category)/", re.I),
    re.compile(r"/(calendar|events)/\d{4}(/\d{1,2})?/?", re.I),
    re.compile(r"/wp-json/", re.I),
]


def headers_to_dict(headers: Any) -> Dict[str, str]:
    result: Dict[str, str] = {}
    if not headers:
        return result
    try:
        items = headers.items()
    except Exception:
        items = []
    for key, value in items:
        k = key.decode("utf-8", errors="ignore") if isinstance(key, (bytes, bytearray)) else str(key)
        v = value.decode("utf-8", errors="ignore") if isinstance(value, (bytes, bytearray)) else str(value)
        if k:
            result[k] = v
    return result


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


def _bucket_for_url(url: str, page_type: str) -> str:
    if page_type in PRIORITY_PAGE_TYPES:
        return "priority"
    if page_type in SECONDARY_PAGE_TYPES or any(x in url.lower() for x in ["/product", "/platform", "/features"]):
        return "secondary"
    return "generic"


def _score_discovered_url(url: str, page_type: str) -> int:
    base_scores = {
        "pricing": 100,
        "docs": 95,
        "changelog": 90,
        "security": 85,
        "blog": 70,
        "news": 65,
        "careers": 50,
        "generic": 40,
    }
    score = base_scores.get(page_type, 40)
    lower = url.lower()
    if "/api" in lower or "/reference" in lower or "/developer" in lower:
        score = max(score, 92)
    if "/product" in lower or "/platform" in lower:
        score = max(score, 72)
    depth = max(1, len([segment for segment in urlparse(url).path.split("/") if segment]))
    score -= min(10, depth)
    return score


def _is_denied_discovery_url(url: str) -> bool:
    lower = url.lower()
    parsed = urlparse(lower)
    path = parsed.path or "/"
    query = parsed.query or ""
    if any(p.search(path) for p in DISCOVERY_DENY_PATTERNS):
        return True
    if "sort=" in query or "filter=" in query or "sessionid=" in query:
        return True
    return False


def _extract_structured_metadata(html: str, current_url: str) -> Dict[str, Any]:
    if not html:
        return {
            "canonical_tag": None,
            "meta_description": None,
            "h1": None,
            "lang": None,
            "jsonld_types": [],
            "published_at_hint": None,
            "outbound_links_sample": [],
        }

    soup = BeautifulSoup(html, "html.parser")

    canonical_tag = None
    canonical_link = soup.find("link", rel=lambda v: v and "canonical" in str(v).lower())
    if canonical_link and canonical_link.get("href"):
        href = str(canonical_link.get("href")).strip()
        canonical_tag = canonicalize_url(href if href.startswith(("http://", "https://")) else urljoin(current_url, href))

    meta_description = None
    meta_desc = soup.find("meta", attrs={"name": re.compile(r"^description$", re.I)})
    if meta_desc and meta_desc.get("content"):
        meta_description = str(meta_desc.get("content")).strip()[:400]

    h1 = None
    h1_tag = soup.find("h1")
    if h1_tag:
        h1 = h1_tag.get_text(" ", strip=True)[:300]

    html_tag = soup.find("html")
    lang = str((html_tag.attrs or {}).get("lang", "")).strip()[:32] if html_tag else ""
    lang = lang or None

    published_at_hint = None
    for key in ["article:published_time", "og:published_time", "pubdate", "publishdate", "date"]:
        meta_tag = soup.find("meta", attrs={"property": key}) or soup.find("meta", attrs={"name": key})
        if meta_tag and meta_tag.get("content"):
            published_at_hint = str(meta_tag.get("content")).strip()[:100]
            break
    if published_at_hint is None:
        time_tag = soup.find("time")
        if time_tag and (time_tag.get("datetime") or time_tag.get_text(strip=True)):
            published_at_hint = str(time_tag.get("datetime") or time_tag.get_text(strip=True)).strip()[:100]

    jsonld_types: Set[str] = set()
    for script in soup.find_all("script", attrs={"type": re.compile(r"application/ld\+json", re.I)}):
        body = script.string or script.get_text() or ""
        if not body.strip():
            continue
        try:
            data = json.loads(body)
        except Exception:
            continue
        stack: List[Any] = [data]
        while stack:
            item = stack.pop()
            if isinstance(item, list):
                stack.extend(item)
                continue
            if not isinstance(item, dict):
                continue
            raw_type = item.get("@type")
            if isinstance(raw_type, str) and raw_type.strip():
                jsonld_types.add(raw_type.strip())
            elif isinstance(raw_type, list):
                for t in raw_type:
                    if isinstance(t, str) and t.strip():
                        jsonld_types.add(t.strip())
            stack.extend(item.values())

    current_domain = extract_domain(current_url)
    outbound_links: List[str] = []
    seen: Set[str] = set()
    for tag in soup.find_all("a", href=True):
        href = str(tag.get("href") or "").strip()
        if not href:
            continue
        if href.startswith(("#", "mailto:", "tel:", "javascript:")):
            continue
        absolute = canonicalize_url(href if href.startswith(("http://", "https://")) else urljoin(current_url, href))
        if not absolute:
            continue
        domain = extract_domain(absolute)
        if not domain or domain == current_domain:
            continue
        if absolute in seen:
            continue
        seen.add(absolute)
        outbound_links.append(absolute)
        if len(outbound_links) >= 20:
            break

    return {
        "canonical_tag": canonical_tag,
        "meta_description": meta_description,
        "h1": h1,
        "lang": lang,
        "jsonld_types": sorted(jsonld_types)[:20],
        "published_at_hint": published_at_hint,
        "outbound_links_sample": outbound_links,
    }


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
        force_render: bool = False,
        default_proxy_tier: str = "datacenter",
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
        self.force_render = bool(force_render)
        self.default_proxy_tier = default_proxy_tier if default_proxy_tier in {"datacenter", "residential"} else "datacenter"

        raw_targets = json.loads(seed_targets)
        self.seed_targets: List[Dict[str, Any]] = []
        for item in raw_targets:
            if isinstance(item, str):
                self.seed_targets.append({"url": item})
            elif isinstance(item, dict) and item.get("url"):
                self.seed_targets.append(item)
        self.seen: set[str] = set()
        self.documents: List[Dict[str, Any]] = []
        self.bucket_limits = {
            "priority": max(1, int(self.max_pages * 0.5)),
            "secondary": max(1, int(self.max_pages * 0.3)),
        }
        self.bucket_limits["generic"] = max(1, self.max_pages - self.bucket_limits["priority"] - self.bucket_limits["secondary"])
        self.bucket_counts = {"priority": 0, "secondary": 0, "generic": 0}

    def _reserve_bucket(self, url: str, page_type: str) -> bool:
        bucket = _bucket_for_url(url, page_type)
        used = sum(self.bucket_counts.values())
        if used >= self.max_pages:
            return False
        if self.bucket_counts[bucket] < self.bucket_limits[bucket]:
            self.bucket_counts[bucket] += 1
            return True
        # Soft quotas: never strand remaining crawl budget when the URL mix is skewed
        # toward one bucket (e.g., docs/pricing heavy websites).
        self.bucket_counts[bucket] += 1
        return True

    def _build_meta(self, rendered: bool = False, proxy_tier: Optional[str] = None) -> Dict[str, Any]:
        selected_proxy_tier = proxy_tier or self.default_proxy_tier
        meta: Dict[str, Any] = {"rendered": rendered, "proxy_tier": selected_proxy_tier}

        proxy = ""
        if selected_proxy_tier == "residential" and self.residential_proxy_url:
            proxy = self.residential_proxy_url
        elif self.proxy_url:
            proxy = self.proxy_url
        elif self.residential_proxy_url:
            proxy = self.residential_proxy_url
        if rendered and self.residential_proxy_url:
            # Browser lane prefers residential proxy when available.
            proxy = self.residential_proxy_url
            meta["proxy_tier"] = "residential"
        if proxy:
            meta["proxy"] = proxy
        if rendered and self.use_playwright:
            meta["playwright"] = True
            meta["playwright_include_page"] = False
        return meta

    def start_requests(self):
        ordered_targets = sorted(
            self.seed_targets,
            key=lambda target: -_score_discovered_url(
                canonicalize_url(str(target.get("url", "")).strip()) or "",
                str(target.get("page_type") or classify_page_type(str(target.get("url", "")).strip())),
            ),
        )
        for target in ordered_targets:
            url = str(target.get("url", "")).strip()
            if not url:
                continue
            canonical = canonicalize_url(url)
            if not canonical or canonical in self.seen:
                continue
            page_type = target.get("page_type") or classify_page_type(url)
            if not self._reserve_bucket(canonical, str(page_type)):
                continue
            self.seen.add(canonical)
            headers = target.get("headers") or {}
            proxy_tier = target.get("proxy_tier") or self.default_proxy_tier
            render_required = bool(target.get("render_required", False) or self.force_render)
            meta = self._build_meta(rendered=render_required, proxy_tier=proxy_tier)
            meta["seed_page_type"] = page_type
            # Preserve the original requested URL across redirects so the runtime can
            # match spider output back to the leased frontier canonical.
            meta["requested_url"] = url
            yield scrapy.Request(
                url=url,
                callback=self.parse,
                headers=headers,
                meta=meta,
                errback=self.errback,
                dont_filter=True,
            )

    def _record_doc(
        self,
        *,
        url: str,
        requested_url: Optional[str] = None,
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
        blocked_detected: bool = False,
        js_shell_detected: bool = False,
        error_message: Optional[str] = None,
        request_headers: Optional[Dict[str, str]] = None,
        response_headers: Optional[Dict[str, str]] = None,
        raw_body: str = "",
        raw_body_encoding: str = "utf-8",
        proxy_tier: str = "none",
        provider: str = "none",
        canonical_tag: Optional[str] = None,
        meta_description: Optional[str] = None,
        h1: Optional[str] = None,
        lang: Optional[str] = None,
        jsonld_types: Optional[List[str]] = None,
        published_at_hint: Optional[str] = None,
        outbound_links_sample: Optional[List[str]] = None,
        discovered_urls: Optional[List[str]] = None,
    ):
        canonical = canonicalize_url(url)
        if not canonical:
            canonical = url

        title = extract_title(html) if html else None
        html_hash = hashlib.sha256((html or "").encode("utf-8", errors="ignore")).hexdigest()[:32]
        content_hash = hashlib.sha256((clean_text or "").lower().encode("utf-8", errors="ignore")).hexdigest()[:32]
        quality_score = estimate_quality_score(clean_text, title=title)
        rendered = fetch_method == "browser"

        self.documents.append(
            {
                "url": url,
                "requested_url": requested_url,
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
                "quality_score": quality_score,
                "blocked_detected": blocked_detected,
                "js_shell_detected": js_shell_detected,
                "error_message": error_message,
                "proxy_tier": proxy_tier,
                "provider": provider,
                "canonical_tag": canonical_tag,
                "meta_description": meta_description,
                "h1": h1,
                "lang": lang,
                "jsonld_types": jsonld_types or [],
                "published_at_hint": published_at_hint,
                "outbound_links_sample": outbound_links_sample or [],
                "discovered_urls": discovered_urls or [],
                "rendered": rendered,
                "extraction_meta": {
                    "canonical_tag": canonical_tag,
                    "meta_description": meta_description,
                    "h1": h1,
                    "lang": lang,
                    "jsonld_types": jsonld_types or [],
                    "published_at_hint": published_at_hint,
                    "outbound_links_sample": outbound_links_sample or [],
                    "discovered_urls": discovered_urls or [],
                    "rendered": rendered,
                    "js_shell_detected": js_shell_detected,
                },
                "raw_capture": {
                    "request_method": "GET",
                    "request_headers": request_headers or {},
                    "response_headers": response_headers or {},
                    "response_body": raw_body,
                    "response_body_encoding": raw_body_encoding,
                },
                "crawled_at": datetime.now(timezone.utc).isoformat(),
                "discovered_at": datetime.now(timezone.utc).isoformat(),
            }
        )

    def errback(self, failure):  # pragma: no cover - twisted transport paths
        request = getattr(failure, "request", None)
        url = str(getattr(request, "url", "") or "")
        meta = getattr(request, "meta", {}) or {}
        requested_url = str(meta.get("requested_url") or url)

        rendered = bool(meta.get("rendered"))
        proxy_tier = str(meta.get("proxy_tier") or "none")
        page_type = meta.get("seed_page_type") or classify_page_type(url)

        err_type = getattr(getattr(failure, "type", None), "__name__", None) or failure.__class__.__name__
        err_msg = str(getattr(failure, "value", None) or failure)
        error_message = f"{err_type}: {err_msg}".strip()
        if len(error_message) > 1000:
            error_message = error_message[:997] + "..."

        self._record_doc(
            url=url,
            requested_url=requested_url,
            status=599,
            html="",
            clean_text="",
            clean_markdown="",
            fetch_method="browser" if rendered else "http",
            response_time_ms=0,
            page_type=page_type,
            content_type="html",
            blocked_detected=False,
            js_shell_detected=bool(meta.get("escalated_js_shell", False)),
            error_message=error_message,
            request_headers=headers_to_dict(getattr(request, "headers", {})) if request else {},
            response_headers={},
            raw_body="",
            raw_body_encoding="utf-8",
            proxy_tier=proxy_tier,
        )

    def parse(self, response: scrapy.http.Response):
        start_ts = time.monotonic()
        rendered = bool(response.meta.get("rendered"))
        proxy_tier = str(response.meta.get("proxy_tier") or "none")
        current_page_type = response.meta.get("seed_page_type") or classify_page_type(response.url)
        requested_url = str(
            response.meta.get("requested_url") or getattr(getattr(response, "request", None), "url", "") or ""
        )
        request_headers = headers_to_dict(getattr(response.request, "headers", {}))
        response_headers = headers_to_dict(response.headers)
        try:
            if response.status == 304:
                self._record_doc(
                    url=response.url,
                    requested_url=requested_url,
                    status=response.status,
                    html="",
                    clean_text="",
                    clean_markdown="",
                    fetch_method="browser" if rendered else "http",
                    response_time_ms=int((time.monotonic() - start_ts) * 1000),
                    page_type=current_page_type,
                    etag=response.headers.get("ETag", b"").decode("utf-8", errors="ignore") or None,
                    last_modified=response.headers.get("Last-Modified", b"").decode("utf-8", errors="ignore") or None,
                    blocked_detected=False,
                    request_headers=request_headers,
                    response_headers=response_headers,
                    proxy_tier=proxy_tier,
                )
                return

            ctype = (response.headers.get("Content-Type") or b"").decode("utf-8", errors="ignore").lower()
            if "application/pdf" in ctype or response.url.lower().endswith(".pdf"):
                body_bytes = bytes(response.body)
                text = extract_pdf_text(body_bytes) or ""
                clipped = body_bytes[:MAX_RAW_BODY_BYTES]
                self._record_doc(
                    url=response.url,
                    requested_url=requested_url,
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
                    blocked_detected=is_probably_blocked(int(response.status), ""),
                    request_headers=request_headers,
                    response_headers=response_headers,
                    raw_body=base64.b64encode(clipped).decode("ascii"),
                    raw_body_encoding="base64",
                    proxy_tier=proxy_tier,
                )
                return

            html = response.text or ""
            js_shell_detected = detect_js_shell(html)
            if not rendered and self.use_playwright and js_shell_detected:
                # Escalate to browser rendering only when static fetch appears insufficient.
                meta = self._build_meta(rendered=True, proxy_tier="residential")
                meta["seed_page_type"] = current_page_type
                meta["escalated_js_shell"] = True
                yield scrapy.Request(
                    url=response.url,
                    callback=self.parse,
                    meta=meta,
                    errback=self.errback,
                    dont_filter=True,
                )
                return

            clean_text, clean_markdown = extract_main_content(html)
            blocked_detected = is_probably_blocked(int(response.status), html)
            structured = _extract_structured_metadata(html, response.url)
            clipped_html = html[:MAX_RAW_BODY_BYTES]
            discovered_urls: List[str] = []
            candidates: List[Tuple[int, str, str]] = []
            if len(self.seen) < self.max_pages:
                for href in response.css("a::attr(href)").getall():
                    href = str(href or "").strip()
                    if not href:
                        continue
                    if href.startswith(("#", "mailto:", "tel:", "javascript:")):
                        continue
                    abs_url = response.urljoin(href)
                    canonical = canonicalize_url(abs_url)
                    if not canonical:
                        continue
                    if canonical in self.seen:
                        continue
                    if self.allowed_domain and not is_same_site(canonical, f"https://{self.allowed_domain}"):
                        continue
                    if _is_denied_discovery_url(canonical):
                        continue
                    candidate_type = classify_page_type(canonical)
                    score = _score_discovered_url(canonical, candidate_type)
                    candidates.append((score, canonical, candidate_type))

                candidates.sort(key=lambda item: (-item[0], len(item[1]), item[1]))
                for _score, canonical, candidate_type in candidates:
                    if len(self.seen) >= self.max_pages:
                        break
                    if canonical in self.seen:
                        continue
                    if not self._reserve_bucket(canonical, candidate_type):
                        continue
                    self.seen.add(canonical)
                    discovered_urls.append(canonical)
                    meta = self._build_meta(rendered=self.force_render, proxy_tier=self.default_proxy_tier)
                    meta["seed_page_type"] = candidate_type
                    meta["requested_url"] = canonical
                    yield scrapy.Request(url=canonical, callback=self.parse, meta=meta, errback=self.errback)

            self._record_doc(
                url=response.url,
                requested_url=requested_url,
                status=response.status,
                html=html,
                clean_text=clean_text,
                clean_markdown=clean_markdown,
                fetch_method="browser" if rendered else "http",
                response_time_ms=int((time.monotonic() - start_ts) * 1000),
                page_type=current_page_type,
                etag=response.headers.get("ETag", b"").decode("utf-8", errors="ignore") or None,
                last_modified=response.headers.get("Last-Modified", b"").decode("utf-8", errors="ignore") or None,
                blocked_detected=blocked_detected,
                js_shell_detected=js_shell_detected,
                request_headers=request_headers,
                response_headers=response_headers,
                raw_body=clipped_html,
                raw_body_encoding="utf-8",
                proxy_tier=proxy_tier,
                canonical_tag=structured.get("canonical_tag"),
                meta_description=structured.get("meta_description"),
                h1=structured.get("h1"),
                lang=structured.get("lang"),
                jsonld_types=structured.get("jsonld_types"),
                published_at_hint=structured.get("published_at_hint"),
                outbound_links_sample=structured.get("outbound_links_sample"),
                discovered_urls=discovered_urls,
            )
        except Exception as exc:  # pragma: no cover - defensive extraction
            http_status = int(getattr(response, "status", 0) or 0)
            err = f"ParseError (http_status={http_status}): {exc.__class__.__name__}: {exc}".strip()
            if len(err) > 1000:
                err = err[:997] + "..."

            # `response.text` can itself raise (encoding issues). Use bytes with ignore.
            raw_body = ""
            try:
                body = bytes(getattr(response, "body", b"") or b"")
                raw_body = body[:MAX_RAW_BODY_BYTES].decode("utf-8", errors="ignore")
            except Exception:
                raw_body = ""

            self._record_doc(
                url=str(getattr(response, "url", "") or ""),
                requested_url=requested_url,
                status=599,
                html="",
                clean_text="",
                clean_markdown="",
                fetch_method="browser" if rendered else "http",
                response_time_ms=int((time.monotonic() - start_ts) * 1000),
                page_type=current_page_type,
                content_type="html",
                etag=response.headers.get("ETag", b"").decode("utf-8", errors="ignore") or None,
                last_modified=response.headers.get("Last-Modified", b"").decode("utf-8", errors="ignore") or None,
                blocked_detected=is_probably_blocked(http_status, raw_body),
                js_shell_detected=False,
                error_message=err,
                request_headers=request_headers,
                response_headers=response_headers,
                raw_body=raw_body,
                raw_body_encoding="utf-8",
                proxy_tier=proxy_tier,
            )
            return

    def closed(self, reason: str):  # pragma: no cover - scrapy callback
        out = Path(self.output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as f:
            json.dump(self.documents, f, indent=2, ensure_ascii=True)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run startup crawl spider")
    parser.add_argument("--startup-name", required=True)
    parser.add_argument("--seed-targets", default="", help="JSON array of objects: [{url, headers?, page_type?}]")
    parser.add_argument("--seed-targets-file", default="", help="Path to JSON file containing seed targets (preferred over --seed-targets)")
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
    parser.add_argument("--force-render", action="store_true")
    parser.add_argument("--default-proxy-tier", default="datacenter", choices=["datacenter", "residential"])
    return parser.parse_args()


def main() -> int:
    args = _parse_args()
    seed_targets = args.seed_targets
    # Prefer file-based seed targets (avoids shell argument length/injection issues)
    if args.seed_targets_file:
        try:
            seed_targets = Path(args.seed_targets_file).read_text(encoding="utf-8")
        except Exception as exc:
            print(json.dumps({"error": f"Failed to read seed targets file: {exc}"}))
            return 2
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
        "CLOSESPIDER_TIMEOUT": int(args.timeout_seconds) * int(args.max_pages) + 30,
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
        force_render=args.force_render,
        default_proxy_tier=args.default_proxy_tier,
    )
    process.start(stop_after_crawl=True)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
