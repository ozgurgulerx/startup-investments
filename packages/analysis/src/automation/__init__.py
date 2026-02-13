"""Automation components for scheduled and event-driven processing.

IMPORTANT: Keep this package import-light.

Cron jobs frequently import submodules under `src.automation.*`. If this
`__init__` eagerly imports heavy/optional dependencies (e.g. `openai`), it can
take down unrelated jobs (like `event-processor`) when those optional deps are
missing or broken.
"""

from __future__ import annotations

import importlib
from typing import Any, Dict, Tuple

_LAZY_EXPORTS: Dict[str, Tuple[str, str]] = {
    "DeepResearchConsumer": ("src.automation.deep_research_consumer", "DeepResearchConsumer"),
    "StartupEventProcessor": ("src.automation.event_processor", "StartupEventProcessor"),
    "WebsiteContentMonitor": ("src.automation.website_monitor", "WebsiteContentMonitor"),
    "RSSFeedConsumer": ("src.automation.rss_consumer", "RSSFeedConsumer"),
    "PatternCorrelator": ("src.automation.pattern_correlator", "PatternCorrelator"),
    "DatabaseConnection": ("src.automation.db", "DatabaseConnection"),
    "DailyNewsIngestor": ("src.automation.news_ingest", "DailyNewsIngestor"),
    "XClient": ("src.automation.x_client", "XClient"),
    "generate_x_posts": ("src.automation.x_posting", "generate_x_posts"),
    "publish_x_posts": ("src.automation.x_posting", "publish_x_posts"),
    "sync_x_post_metrics": ("src.automation.x_posting", "sync_x_post_metrics"),
}

__all__ = list(_LAZY_EXPORTS.keys())


def __getattr__(name: str) -> Any:
    spec = _LAZY_EXPORTS.get(name)
    if spec is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    module_name, attr_name = spec
    module = importlib.import_module(module_name)
    value = getattr(module, attr_name)
    # Cache for subsequent lookups.
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(list(globals().keys()) + list(_LAZY_EXPORTS.keys())))
