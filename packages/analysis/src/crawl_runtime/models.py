"""Canonical crawl document types for modern runtime outputs."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional


@dataclass
class CrawledDocumentV2:
    """Normalized document used by crawler pipelines and downstream indexing."""

    url: str
    canonical_url: str
    domain: str
    page_type: str
    content_type: str
    clean_text: str
    clean_markdown: str
    title: Optional[str]
    content_hash: str
    html_hash: str
    etag: Optional[str]
    last_modified: Optional[str]
    fetch_method: str
    status_code: int
    response_time_ms: int
    crawled_at: str
    discovered_at: str
    quality_score: float = 0.0
    error_category: Optional[str] = None
    proxy_tier: str = "none"

    @classmethod
    def now_iso(cls) -> str:
        return datetime.now(timezone.utc).isoformat()


def estimate_quality_score(text: str, title: Optional[str] = None) -> float:
    """Heuristic quality score in [0, 1] for lightweight content ranking."""
    if not text:
        return 0.0

    length_score = min(len(text) / 3000, 1.0)
    line_break_bonus = 0.1 if "\n" in text else 0.0
    title_bonus = 0.1 if title else 0.0
    punctuation_bonus = 0.1 if text.count(".") >= 8 else 0.0

    return round(min(length_score + line_break_bonus + title_bonus + punctuation_bonus, 1.0), 3)
