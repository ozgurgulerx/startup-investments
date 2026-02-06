"""Content extraction helpers with Trafilatura-first strategy."""

from __future__ import annotations

import re
from typing import Optional, Tuple

from bs4 import BeautifulSoup

try:
    import trafilatura
    HAS_TRAFILATURA = True
except Exception:
    trafilatura = None
    HAS_TRAFILATURA = False


def extract_title(html: str) -> Optional[str]:
    if not html:
        return None

    soup = BeautifulSoup(html, "html.parser")
    title_tag = soup.find("title")
    if title_tag and title_tag.get_text(strip=True):
        return title_tag.get_text(strip=True)[:300]

    og = soup.find("meta", property="og:title")
    if og and og.get("content"):
        return str(og["content"]).strip()[:300]

    h1 = soup.find("h1")
    if h1:
        return h1.get_text(" ", strip=True)[:300]

    return None


def _extract_with_bs4(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for element in soup(["script", "style", "noscript", "iframe", "svg"]):
        element.decompose()

    for element in soup.find_all(class_=re.compile(r"nav|header|footer|sidebar|menu|cookie|banner|ad", re.I)):
        element.decompose()

    text = soup.get_text(separator=" ", strip=True)
    return " ".join(text.split())


def extract_main_content(html: str) -> Tuple[str, str]:
    """Return `(clean_text, clean_markdown)` from HTML."""
    if not html:
        return "", ""

    if HAS_TRAFILATURA:
        try:
            text = trafilatura.extract(
                html,
                include_tables=True,
                include_links=False,
                output_format="txt",
                favor_precision=True,
                deduplicate=True,
            ) or ""
            markdown = trafilatura.extract(
                html,
                include_tables=True,
                include_links=True,
                output_format="markdown",
                favor_precision=True,
                deduplicate=True,
            ) or ""
            if text:
                return " ".join(text.split()), markdown
        except Exception:
            pass

    # Fallback path: basic cleanup
    text = _extract_with_bs4(html)
    markdown = text
    return text, markdown
