"""VC / investor content sources for the news ingestion pipeline.

Cost goals:
- RSS/Atom only (no scraping, no paid social APIs).
- Keep the list small and high-signal; expand incrementally after validating feeds.

This module intentionally does NOT import `news_ingest.py` to avoid circular imports.
Call `make_vc_sources(SourceDefinition)` from `news_ingest.py`.
"""

from __future__ import annotations

import os
from typing import Any, List


VC_SOURCE_PREFIX = "vc_"


def _src(
    SourceDefinition: Any,
    *,
    key: str,
    name: str,
    url: str,
    credibility: float = 0.78,
) -> Any:
    safe_key = key if key.startswith(VC_SOURCE_PREFIX) else f"{VC_SOURCE_PREFIX}{key}"
    return SourceDefinition(
        safe_key,
        name,
        "rss",
        url,
        region="global",
        fetch_mode="rss",
        credibility_weight=float(credibility),
        legal_mode="headline_snippet",
    )


def make_vc_sources(SourceDefinition: Any) -> List[Any]:
    """Return VC/investor RSS sources as `SourceDefinition` instances.

    Notes:
    - Feed URLs are best-effort defaults; validate before enabling in production.
    - Keep this list curated; too many sources increase hourly runtime linearly
      because RSS fetches are currently sequential.
    """

    extra_sources = _parse_extra_sources(SourceDefinition)

    sources = [
        # VC firms / platforms
        _src(SourceDefinition, key="a16z_blog", name="a16z (Andreessen Horowitz)", url="https://a16z.com/feed/", credibility=0.84),

        # AI-focused newsletters / analysts (RSS where supported)
        _src(SourceDefinition, key="state_of_ai", name="State of AI (newsletter)", url="https://www.stateof.ai/rss/", credibility=0.82),
        _src(SourceDefinition, key="no_priors", name="No Priors (podcast feed)", url="https://feeds.simplecast.com/54nAGcIl", credibility=0.80),
        _src(SourceDefinition, key="deeplearning_batch", name="The Batch (DeepLearning.AI)", url="https://www.deeplearning.ai/the-batch/feed/", credibility=0.80),

        # Market maps / data/AI commentary
        _src(SourceDefinition, key="matt_turck", name="Matt Turck", url="https://mattturck.com/feed/", credibility=0.78),
        _src(SourceDefinition, key="benedict_evans", name="Benedict Evans", url="https://www.ben-evans.com/benedictevans?format=rss", credibility=0.80),
    ]

    sources.extend(extra_sources)

    # De-duplicate by source_key
    out: List[Any] = []
    seen: set[str] = set()
    for s in sources:
        k = str(getattr(s, "source_key", "") or "")
        if not k or k in seen:
            continue
        seen.add(k)
        out.append(s)

    return out


def _parse_extra_sources(SourceDefinition: Any) -> List[Any]:
    """Parse additional VC RSS sources from env.

    Format:
      NEWS_VC_EXTRA_SOURCES is newline-separated entries:
        source_key|Display Name|https://feed.url|0.82
    Notes:
    - `source_key` may omit the `vc_` prefix.
    - credibility is optional and defaults to 0.78.
    """
    raw = (os.getenv("NEWS_VC_EXTRA_SOURCES") or "").strip()
    if not raw:
        return []

    out: List[Any] = []
    for line in raw.splitlines():
        text = line.strip()
        if not text or text.startswith("#"):
            continue
        parts = [p.strip() for p in text.split("|")]
        if len(parts) < 3:
            continue
        key, name, url = parts[0], parts[1], parts[2]
        cred = 0.78
        if len(parts) >= 4 and parts[3]:
            try:
                cred = float(parts[3])
            except Exception:
                cred = 0.78
        if not key or not name or not url:
            continue
        out.append(_src(SourceDefinition, key=key, name=name, url=url, credibility=cred))

    return out
