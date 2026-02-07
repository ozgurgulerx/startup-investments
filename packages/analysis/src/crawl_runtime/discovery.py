"""Feed/sitemap-first URL discovery helpers for frontier seeding."""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Set
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


@dataclass
class DiscoveryResult:
    urls: List[str]
    robots_url: str = ""
    sitemap_url: str = ""


def _parse_sitemap_xml(xml_text: str, max_urls: int = 200) -> List[str]:
    if not xml_text:
        return []

    try:
        root = ET.fromstring(xml_text)
    except Exception:
        return []

    urls: List[str] = []
    # Namespaced and non-namespaced loc tags
    for elem in root.iter():
        tag = elem.tag.lower()
        if tag.endswith("loc") and elem.text:
            value = elem.text.strip()
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

        for sitemap_url in sitemap_candidates[:3]:
            try:
                sresp = await client.get(sitemap_url)
                if sresp.status_code >= 400:
                    continue
                discovered = _parse_sitemap_xml(sresp.text, max_urls=max_urls * 5)
            except Exception:
                discovered = []

            for raw in discovered:
                canonical = canonicalize_url(raw)
                if not canonical:
                    continue
                if domain and extract_domain(canonical) != domain:
                    continue
                seen.add(canonical)
                if len(seen) >= max_urls:
                    return DiscoveryResult(urls=sorted(seen), robots_url=robots_url, sitemap_url=sitemap_url)

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
            except Exception:
                continue
            if len(seen) >= max_urls:
                break

    return DiscoveryResult(urls=sorted(seen), robots_url=f"{base}/robots.txt", sitemap_url=f"{base}/sitemap.xml")
