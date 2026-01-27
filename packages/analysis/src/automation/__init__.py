"""Automation components for scheduled and event-driven processing."""

from .deep_research_consumer import DeepResearchConsumer
from .event_processor import StartupEventProcessor
from .website_monitor import WebsiteContentMonitor
from .rss_consumer import RSSFeedConsumer
from .pattern_correlator import PatternCorrelator
from .db import DatabaseConnection

__all__ = [
    "DeepResearchConsumer",
    "StartupEventProcessor",
    "WebsiteContentMonitor",
    "RSSFeedConsumer",
    "PatternCorrelator",
    "DatabaseConnection",
]
