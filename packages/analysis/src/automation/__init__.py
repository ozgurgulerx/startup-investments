"""Automation components for scheduled and event-driven processing."""

from .deep_research_consumer import DeepResearchConsumer
from .event_processor import StartupEventProcessor
from .website_monitor import WebsiteContentMonitor
from .rss_consumer import RSSFeedConsumer
from .pattern_correlator import PatternCorrelator
from .db import DatabaseConnection
from .news_ingest import DailyNewsIngestor
from .x_client import XClient
from .x_posting import generate_x_posts, publish_x_posts, sync_x_post_metrics

__all__ = [
    "DeepResearchConsumer",
    "StartupEventProcessor",
    "WebsiteContentMonitor",
    "RSSFeedConsumer",
    "PatternCorrelator",
    "DatabaseConnection",
    "DailyNewsIngestor",
    "XClient",
    "generate_x_posts",
    "publish_x_posts",
    "sync_x_post_metrics",
]
