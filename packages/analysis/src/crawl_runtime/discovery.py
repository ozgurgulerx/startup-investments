"""Feed/sitemap-first URL discovery helpers for frontier seeding."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Set, Tuple
from urllib.parse import urljoin
import xml.etree.ElementTree as ET

import httpx

from src.crawl_runtime.frontier import canonicalize_url, extract_domain


FEED_HINTS = [
    "/feed",
    "/blog/feed",
    "/news/feed",
    "/changelog/feed",
    "/rss.xml",
    "/atom.xml",
]

MAX_SITEMAP_FILES = 10
MAX_SITEMAP_CANDIDATE_URLS = 2000


@dataclass
class DiscoveryResult:
    urls: List[str]
    robots_url: str = ""
    sitemap_url: str = ""


def _parse_sitemap_xml_nodes(
    xml_text: str,
    max_urls: int = 200,
    max_sitemaps: int = 100,
) -> Tuple[List[str], List[str]]:
    if not xml_text:
        return [], []

    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return [], []

    urls: List[str] = []
    sitemaps: List[str] = []
    lower_root = root.tag.lower()
    is_urlset = lower_root.endswith("urlset")
    is_sitemapindex = lower_root.endswith("sitemapindex")

    for elem in root.iter():
        tag = elem.tag.lower()
        if not tag.endswith("loc") or not elem.text:
            continue
        value = elem.text.strip()
        if not value:
            continue

        if is_sitemapindex:
            sitemaps.append(value)
            if len(sitemaps) >= max_sitemaps:
                break
            continue
        if is_urlset:
            urls.append(value)
            if len(urls) >= max_urls:
                break
            continue

        # Heuristic fallback when root tags are unexpected.
        if value.lower().endswith(".xml"):
            sitemaps.append(value)
            if len(sitemaps) >= max_sitemaps:
                break
        else:
            urls.append(value)
            if len(urls) >= max_urls:
                break
    return urls, sitemaps


def _parse_sitemap_xml(xml_text: str, max_urls: int = 200) -> List[str]:
    urls, _ = _parse_sitemap_xml_nodes(xml_text, max_urls=max_urls)
    return urls


def _parse_feed_entry_urls(xml_text: str, max_urls: int = 200) -> List[str]:
    if not xml_text:
        return []
    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return []

    urls: List[str] = []
    for elem in root.iter():
        tag = elem.tag.lower()
        value = ""
        # RSS item/link
        if tag.endswith("item"):
            for child in list(elem):
                if child.tag.lower().endswith("link") and child.text:
                    value = child.text.strip()
                    break
        # Atom entry/link href
        elif tag.endswith("entry"):
            for child in list(elem):
                if child.tag.lower().endswith("link"):
                    href = (child.attrib or {}).get("href", "").strip()
                    if href:
                        value = href
                        break
                    if child.text:
                        value = child.text.strip()
                        break
        if value:
            urls.append(value)
            if len(urls) >= max_urls:
                break
    return urls


def _extract_sitemap_from_robots(robots_text: str) -> List[str]:
    urls: List[str] = []
    for line in (robots_text or "").splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if key.strip().lower() == "sitemap":
            candidate = value.strip()
            if candidate:
                urls.append(candidate)
    return urls


async def discover_seed_urls(
    website: str,
    timeout_seconds: float = 6.0,
    max_urls: int = 20,
) -> DiscoveryResult:
    base = canonicalize_url(website)
    if not base:
        return DiscoveryResult(urls=[])

    if base.endswith("/"):
        base = base[:-1]

    domain = extract_domain(base)
    seen: Set[str] = set()
    max_urls = max(1, int(max_urls))
    max_candidates = max(max_urls, MAX_SITEMAP_CANDIDATE_URLS)

    async with httpx.AsyncClient(timeout=max(1.0, timeout_seconds), follow_redirects=True) as client:
        robots_url = f"{base}/robots.txt"
        robots_body = ""
        try:
            robots_resp = await client.get(robots_url)
            robots_body = robots_resp.text if robots_resp.status_code < 500 else ""
        except Exception:
            robots_body = ""

        sitemap_candidates = _extract_sitemap_from_robots(robots_body)
        if not sitemap_candidates:
            sitemap_candidates.append(f"{base}/sitemap.xml")

        sitemap_queue = [canonicalize_url(url) for url in sitemap_candidates if canonicalize_url(url)]
        seen_sitemaps: Set[str] = set()
        sitemap_selected = ""

        while sitemap_queue and len(seen_sitemaps) < MAX_SITEMAP_FILES and len(seen) < max_urls:
            sitemap_url = sitemap_queue.pop(0)
            if not sitemap_url or sitemap_url in seen_sitemaps:
                continue
            seen_sitemaps.add(sitemap_url)
            if domain and extract_domain(sitemap_url) != domain:
                continue
            try:
                sresp = await client.get(sitemap_url)
                if sresp.status_code >= 400:
                    continue
                discovered, child_sitemaps = _parse_sitemap_xml_nodes(
                    sresp.text,
                    max_urls=max_candidates,
                    max_sitemaps=MAX_SITEMAP_CANDIDATE_URLS,
                )
                if not sitemap_selected:
                    sitemap_selected = sitemap_url
            except Exception:
                discovered, child_sitemaps = [], []

            for child in child_sitemaps:
                canonical_child = canonicalize_url(child)
                if not canonical_child:
                    continue
                if domain and extract_domain(canonical_child) != domain:
                    continue
                if canonical_child in seen_sitemaps:
                    continue
                sitemap_queue.append(canonical_child)
                if len(sitemap_queue) >= MAX_SITEMAP_CANDIDATE_URLS:
                    break

            for raw in discovered:
                canonical = canonicalize_url(raw)
                if not canonical:
                    continue
                if domain and extract_domain(canonical) != domain:
                    continue
                seen.add(canonical)
                if len(seen) >= max_urls:
                    return DiscoveryResult(
                        urls=sorted(seen),
                        robots_url=robots_url,
                        sitemap_url=sitemap_selected or f"{base}/sitemap.xml",
                    )

        for suffix in FEED_HINTS:
            candidate = canonicalize_url(urljoin(f"{base}/", suffix.lstrip("/")))
            if not candidate:
                continue
            try:
                fresp = await client.get(candidate)
                ctype = (fresp.headers.get("content-type") or "").lower()
                looks_feed = any(x in ctype for x in ["xml", "rss", "atom"]) or "<rss" in fresp.text[:500].lower() or "<feed" in fresp.text[:500].lower()
                if fresp.status_code < 400 and looks_feed:
                    seen.add(candidate)
                    for entry_url in _parse_feed_entry_urls(fresp.text, max_urls=max_candidates):
                        canonical_entry = canonicalize_url(entry_url)
                        if not canonical_entry:
                            continue
                        if domain and extract_domain(canonical_entry) != domain:
                            continue
                        seen.add(canonical_entry)
                        if len(seen) >= max_urls:
                            break
            except Exception:
                continue
            if len(seen) >= max_urls:
                break

    return DiscoveryResult(
        urls=sorted(seen)[:max_urls],
        robots_url=f"{base}/robots.txt",
        sitemap_url=f"{base}/sitemap.xml",
    )
