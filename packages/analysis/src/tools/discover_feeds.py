#!/usr/bin/env python3
"""Discover RSS/Atom feeds from a list of URLs.

This is a helper for curating low-cost sources (RSS/Atom only) without guessing
feed URLs by hand.

Usage:
  python packages/analysis/src/tools/discover_feeds.py https://a16z.com https://example.com/blog

Output:
  JSON to stdout with candidate feed URLs per input URL.
"""

from __future__ import annotations

import asyncio
import json
import re
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple
from urllib.parse import urljoin, urlparse

import httpx


FEED_HINT_PATHS = (
    "/feed",
    "/rss",
    "/rss.xml",
    "/atom.xml",
    "/feed.xml",
)


LINK_TAG_RE = re.compile(
    r"<link[^>]+rel=[\"']alternate[\"'][^>]+>",
    flags=re.IGNORECASE,
)
HREF_RE = re.compile(r"href=[\"']([^\"']+)[\"']", flags=re.IGNORECASE)
TYPE_RE = re.compile(r"type=[\"']([^\"']+)[\"']", flags=re.IGNORECASE)


@dataclass
class Candidate:
    url: str
    kind: str  # rss|atom|hint
    note: str = ""


def _is_http_url(url: str) -> bool:
    try:
        p = urlparse(url)
        return p.scheme in ("http", "https") and bool(p.netloc)
    except Exception:
        return False


def _guess_feed_urls(base_url: str) -> List[Candidate]:
    parsed = urlparse(base_url)
    root = f"{parsed.scheme}://{parsed.netloc}"
    out: List[Candidate] = []
    for suffix in FEED_HINT_PATHS:
        out.append(Candidate(url=urljoin(root, suffix), kind="hint", note=f"common {suffix}"))
    return out


def _extract_link_tag_feeds(html: str, base_url: str) -> List[Candidate]:
    out: List[Candidate] = []
    for m in LINK_TAG_RE.finditer(html or ""):
        tag = m.group(0)
        href_m = HREF_RE.search(tag)
        type_m = TYPE_RE.search(tag)
        if not href_m:
            continue
        href = href_m.group(1).strip()
        ctype = (type_m.group(1).strip().lower() if type_m else "")
        resolved = urljoin(base_url, href)
        if not _is_http_url(resolved):
            continue
        if "rss" in ctype:
            out.append(Candidate(url=resolved, kind="rss"))
        elif "atom" in ctype:
            out.append(Candidate(url=resolved, kind="atom"))
    return out


async def _probe_url(client: httpx.AsyncClient, url: str) -> Tuple[int, str, str]:
    try:
        resp = await client.get(url, follow_redirects=True)
        return resp.status_code, (resp.headers.get("content-type") or ""), (resp.text or "")
    except Exception as exc:
        return 0, "", f"ERROR: {exc}"


async def discover(urls: List[str]) -> Dict[str, object]:
    timeout = httpx.Timeout(12.0)
    results: Dict[str, object] = {}
    async with httpx.AsyncClient(timeout=timeout, headers={"User-Agent": "BuildAtlasFeedDiscovery/1.0"}) as client:
        for raw in urls:
            url = raw.strip()
            if not url:
                continue
            if not _is_http_url(url):
                results[url] = {"error": "invalid_url"}
                continue

            status, ctype, body = await _probe_url(client, url)
            if status == 0 and body.startswith("ERROR:"):
                results[url] = {"error": body}
                continue

            candidates: List[Candidate] = []
            # If it's already a feed, just return it.
            if "rss" in ctype.lower() or "atom" in ctype.lower() or body.lstrip().lower().startswith(("<rss", "<feed")):
                candidates.append(Candidate(url=url, kind="rss" if "rss" in ctype.lower() else "atom", note="input looks like a feed"))
            else:
                candidates.extend(_extract_link_tag_feeds(body, base_url=url))
                candidates.extend(_guess_feed_urls(url))

            # Probe candidates quickly to confirm which are feeds.
            confirmed: List[Dict[str, object]] = []
            seen: set[str] = set()
            for cand in candidates:
                if cand.url in seen:
                    continue
                seen.add(cand.url)
                st, ct, b = await _probe_url(client, cand.url)
                looks_feed = "rss" in ct.lower() or "atom" in ct.lower() or b.lstrip().lower().startswith(("<rss", "<feed"))
                if not looks_feed:
                    continue
                confirmed.append(
                    {
                        "url": cand.url,
                        "kind": cand.kind,
                        "note": cand.note,
                        "status": st,
                        "content_type": ct,
                    }
                )

            results[url] = {
                "status": status,
                "content_type": ctype,
                "feeds": confirmed,
            }

    return results


def main(argv: List[str]) -> int:
    urls = argv[1:]
    if not urls:
        print("Usage: discover_feeds.py <url> [<url> ...]", file=sys.stderr)
        return 2
    payload = asyncio.run(discover(urls))
    print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))

