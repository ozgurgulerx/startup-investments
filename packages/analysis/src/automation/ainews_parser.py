"""Digest RSS HTML parser.

Parses newsletter/digest HTML content (AINews, Latent Space, etc.) into
individual NormalizedNewsItem objects. Each digest contains 20-40 curated
AI/startup stories organized by section.

Supports multiple digest sources via DigestParserConfig.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

try:
    from bs4 import BeautifulSoup, Tag
except Exception:  # pragma: no cover
    BeautifulSoup = None
    Tag = None  # type: ignore[assignment,misc]


@dataclass(frozen=True)
class DigestParserConfig:
    """Source metadata injected into every parsed item."""

    source_key: str = "ainews_digest"
    source_name: str = "AINews by swyx"
    source_type: str = "rss"
    source_weight: float = 0.88


def _strip_html(html: str) -> str:
    """Remove HTML tags and collapse whitespace."""
    text = re.sub(r"<[^>]+>", " ", html or "")
    return re.sub(r"\s+", " ", text).strip()


def _extract_twitter_handle(text: str) -> Optional[str]:
    """Extract @handle from text like '@swyx' or '(@gdb)'."""
    m = re.search(r"@(\w{1,15})", text)
    return m.group(1) if m else None


def _extract_activity_score(text: str) -> Optional[int]:
    """Extract 'Activity: 123' from reddit-style items."""
    m = re.search(r"Activity:\s*(\d[\d,]*)", text)
    if m:
        return int(m.group(1).replace(",", ""))
    return None


def _best_link(links: List[Dict[str, str]], fallback_url: str) -> str:
    """Pick the best URL from extracted links, preferring external sources."""
    for link in links:
        href = link.get("href", "")
        if not href or href.startswith("#"):
            continue
        # Prefer twitter, reddit, github links over newsletter internal links
        if any(d in href for d in ("twitter.com", "x.com", "reddit.com", "github.com", "arxiv.org")):
            return href
    # Fall back to first non-empty link
    for link in links:
        href = link.get("href", "")
        if href and not href.startswith("#"):
            return href
    return fallback_url


class AINewsDigestParser:
    """Parses digest newsletter HTML into individual news items."""

    # Section header patterns (case-insensitive)
    SECTION_PATTERNS = {
        "twitter": re.compile(r"twitter\s+recap", re.IGNORECASE),
        "reddit": re.compile(r"reddit\s+recap", re.IGNORECASE),
        "discord": re.compile(r"discord\s+recap", re.IGNORECASE),
    }

    def __init__(self, config: Optional[DigestParserConfig] = None) -> None:
        self._config = config or DigestParserConfig()

    def parse_digest(
        self,
        html: str,
        published_at: datetime,
        digest_url: str,
    ) -> list:
        """Parse newsletter HTML into individual NormalizedNewsItem objects.

        Args:
            html: Full HTML content from content:encoded RSS field.
            published_at: Publication datetime of the newsletter entry.
            digest_url: Permalink URL of this newsletter edition.

        Returns:
            List of NormalizedNewsItem, one per extracted story.
        """
        from .news_ingest import canonicalize_url, normalize_text

        if BeautifulSoup is None:
            return []

        soup = BeautifulSoup(html, "html.parser")
        items: List[NormalizedNewsItem] = []

        current_section = "general"
        current_theme = ""

        # Walk all top-level elements to detect sections and extract items.
        # AINews uses h1 for main sections, h2 for subsections, h3 for categories,
        # with nested ul/li for individual stories.
        for element in soup.children:
            if not isinstance(element, Tag):
                continue

            tag_name = element.name or ""

            # Detect section headers (h1 or h2)
            if tag_name in ("h1", "h2"):
                header_text = element.get_text(strip=True)
                for section_key, pattern in self.SECTION_PATTERNS.items():
                    if pattern.search(header_text):
                        current_section = section_key
                        current_theme = ""
                        break
                else:
                    # h2 that doesn't match a section pattern is a subsection/theme
                    if tag_name == "h2":
                        current_theme = header_text
                continue

            # h3 = category/theme header
            if tag_name == "h3":
                current_theme = element.get_text(strip=True)
                continue

            # Extract items from lists
            if tag_name == "ul":
                extracted = self._extract_items_from_list(
                    element, current_section, current_theme,
                    published_at, digest_url, normalize_text, canonicalize_url,
                )
                items.extend(extracted)

        return items

    def _extract_items_from_list(
        self,
        ul: "Tag",
        section: str,
        theme: str,
        published_at: datetime,
        digest_url: str,
        normalize_text,
        canonicalize_url,
    ) -> "List[NormalizedNewsItem]":
        """Extract NormalizedNewsItem objects from a <ul> element."""
        from .news_ingest import NormalizedNewsItem

        items: List[NormalizedNewsItem] = []

        for li in ul.find_all("li", recursive=False):
            try:
                item = self._parse_li_item(
                    li, section, theme, published_at, digest_url,
                    normalize_text, canonicalize_url,
                )
                if item:
                    items.append(item)
            except Exception:
                # Defensive: never crash on a single malformed item
                continue

            # Check for nested ul (sub-items under a theme heading)
            nested_ul = li.find("ul", recursive=False)
            if nested_ul:
                # The li text is the theme; extract children as items
                li_theme = theme
                strong = li.find("strong", recursive=False)
                if strong:
                    li_theme = strong.get_text(strip=True)
                nested = self._extract_items_from_list(
                    nested_ul, section, li_theme,
                    published_at, digest_url, normalize_text, canonicalize_url,
                )
                items.extend(nested)

        return items

    def _parse_li_item(
        self,
        li: "Tag",
        section: str,
        theme: str,
        published_at: datetime,
        digest_url: str,
        normalize_text,
        canonicalize_url,
    ) -> "Optional[NormalizedNewsItem]":
        """Parse a single <li> element into a NormalizedNewsItem."""
        from .news_ingest import NormalizedNewsItem

        # Skip items that are just theme headers (contain only a nested ul)
        children = [c for c in li.children if isinstance(c, Tag)]
        has_nested_ul = any(c.name == "ul" for c in children)
        text_content = li.get_text(strip=True)

        # If the li only has a strong + nested ul, it's a theme container, not a story
        if has_nested_ul and len(text_content.split()) < 8:
            return None

        # Extract all links
        links = []
        for a in li.find_all("a"):
            href = a.get("href", "")
            link_text = a.get_text(strip=True)
            if href:
                links.append({"href": href, "text": link_text})

        # Extract title: prefer bold/strong lead text
        title = ""
        strong = li.find("strong", recursive=False)
        if strong:
            # Check if the strong wraps an anchor (reddit-style)
            inner_a = strong.find("a")
            if inner_a:
                title = inner_a.get_text(strip=True)
                # Use the linked URL as primary
                link_href = inner_a.get("href", "")
                if link_href:
                    links.insert(0, {"href": link_href, "text": title})
            else:
                title = strong.get_text(strip=True)

        if not title:
            # Fall back to first ~100 chars of text
            plain = _strip_html(str(li))
            title = plain[:100].strip()
            if len(plain) > 100:
                title = title.rsplit(" ", 1)[0] + "..."

        if not title or len(title) < 5:
            return None

        # Extract summary: full text minus the title portion
        full_text = normalize_text(_strip_html(str(li)))
        summary = full_text
        if title in summary:
            summary = summary.replace(title, "", 1).strip()
        summary = re.sub(r"^[:\-–—,;.\s]+", "", summary)  # clean leading punctuation
        summary = summary[:500]

        # Determine best URL
        url = _best_link(links, digest_url)
        canonical = canonicalize_url(url)

        # Extract author based on section type
        author = None
        if section == "twitter":
            handle = _extract_twitter_handle(full_text)
            if handle:
                author = f"@{handle}"
                # If no good external link, construct twitter URL
                if url == digest_url:
                    url = f"https://twitter.com/{handle}"
                    canonical = canonicalize_url(url)
        elif section == "reddit":
            # Look for subreddit in links
            for link in links:
                href = link.get("href", "")
                m = re.search(r"reddit\.com/r/(\w+)", href)
                if m:
                    author = f"r/{m.group(1)}"
                    break

        # Extract engagement if available (reddit activity scores)
        engagement: Dict[str, Any] = {}
        activity = _extract_activity_score(full_text)
        if activity:
            engagement["activity"] = activity

        # Build payload with digest metadata
        payload: Dict[str, Any] = {
            "section_category": section,
            "digest_url": digest_url,
        }
        if theme:
            payload["section_title"] = theme

        item = NormalizedNewsItem(
            source_key=self._config.source_key,
            source_name=self._config.source_name,
            source_type=self._config.source_type,
            title=normalize_text(title)[:300],
            url=url,
            canonical_url=canonical,
            summary=summary,
            published_at=published_at,
            language="en",
            author=author,
            engagement=engagement,
            payload=payload,
            source_weight=self._config.source_weight,
        ).with_external_id()

        return item
