"""RSS Feed Consumer.

Processes RSS feeds from tech news sources (TechCrunch, etc.)
to detect funding announcements and startup mentions.
"""

import asyncio
import logging
import re
from typing import Dict, Any, List, Optional, Set
from datetime import datetime, timezone, timedelta
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx
import feedparser

from .db import DatabaseConnection

logger = logging.getLogger(__name__)


# RSS feed sources for startup/funding news
RSS_FEEDS = [
    {
        "name": "TechCrunch",
        "url": "https://techcrunch.com/feed/",
        "source_id": "techcrunch_rss",
        "category": "funding_news"
    },
    {
        "name": "TechCrunch Startups",
        "url": "https://techcrunch.com/category/startups/feed/",
        "source_id": "techcrunch_startups_rss",
        "category": "funding_news"
    },
    {
        "name": "VentureBeat",
        "url": "https://venturebeat.com/feed/",
        "source_id": "venturebeat_rss",
        "category": "funding_news"
    },
    {
        "name": "Hacker News",
        "url": "https://hnrss.org/newest?q=startup+funding",
        "source_id": "hackernews_rss",
        "category": "hackernews_mention"
    },
]

# Keywords that indicate funding news
FUNDING_KEYWORDS = [
    "raises", "raised", "funding", "series a", "series b", "series c",
    "seed round", "pre-seed", "venture", "investment", "million",
    "announces", "secures", "closes", "valued at", "valuation"
]


@dataclass
class FeedItem:
    """Parsed RSS feed item."""
    title: str
    url: str
    published: datetime
    summary: str
    source_id: str
    category: str


@dataclass
class ConsumerResult:
    """Result of consuming RSS feeds."""
    feed_name: str
    feed_url: str
    success: bool
    items_fetched: int = 0
    items_matched: int = 0
    events_created: int = 0
    error: Optional[str] = None


class RSSFeedConsumer:
    """Consumes RSS feeds to detect funding news and startup mentions."""

    def __init__(
        self,
        db: Optional[DatabaseConnection] = None,
        feeds: Optional[List[Dict[str, str]]] = None,
        lookback_hours: int = 24
    ):
        self.db = db or DatabaseConnection()
        self.feeds = feeds or RSS_FEEDS
        self.lookback_hours = lookback_hours
        self._processed_urls: Set[str] = set()

    async def consume_feeds(self) -> List[ConsumerResult]:
        """Consume all configured RSS feeds."""
        results = []

        try:
            await self.db.connect()

            # Load recently processed URLs to avoid duplicates
            await self._load_recent_event_urls()

            async with httpx.AsyncClient(timeout=30.0) as client:
                for feed_config in self.feeds:
                    result = await self._consume_feed(client, feed_config)
                    results.append(result)

            return results

        finally:
            await self.db.close()

    async def _consume_feed(
        self,
        client: httpx.AsyncClient,
        feed_config: Dict[str, str]
    ) -> ConsumerResult:
        """Consume a single RSS feed."""
        feed_name = feed_config["name"]
        feed_url = feed_config["url"]
        source_id = feed_config["source_id"]
        category = feed_config["category"]

        logger.info(f"Consuming feed: {feed_name}")

        try:
            # Fetch feed
            response = await client.get(feed_url)
            response.raise_for_status()

            # Parse feed
            feed = feedparser.parse(response.text)

            if feed.bozo:
                logger.warning(f"Feed parse warning for {feed_name}: {feed.bozo_exception}")

            items_fetched = len(feed.entries)
            items_matched = 0
            events_created = 0

            # Process entries
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=self.lookback_hours)

            for entry in feed.entries:
                # Parse item
                item = self._parse_entry(entry, source_id, category)

                if not item:
                    continue

                # Skip old items
                if item.published < cutoff_time:
                    continue

                # Skip already processed
                if item.url in self._processed_urls:
                    continue

                # Check if it mentions a tracked startup
                matched_startup = await self._match_startup(item)

                if matched_startup:
                    items_matched += 1

                    # Create event
                    created = await self._create_event(item, matched_startup)
                    if created:
                        events_created += 1
                        self._processed_urls.add(item.url)

            logger.info(f"Feed {feed_name}: {items_fetched} items, {items_matched} matched, {events_created} events")

            return ConsumerResult(
                feed_name=feed_name,
                feed_url=feed_url,
                success=True,
                items_fetched=items_fetched,
                items_matched=items_matched,
                events_created=events_created
            )

        except Exception as e:
            logger.error(f"Error consuming feed {feed_name}: {e}")
            return ConsumerResult(
                feed_name=feed_name,
                feed_url=feed_url,
                success=False,
                error=str(e)
            )

    def _parse_entry(
        self,
        entry: Any,
        source_id: str,
        category: str
    ) -> Optional[FeedItem]:
        """Parse a feedparser entry into a FeedItem."""
        try:
            # Get title
            title = entry.get("title", "").strip()
            if not title:
                return None

            # Get URL
            url = entry.get("link", "")
            if not url:
                return None

            # Get published date
            published = None
            if entry.get("published_parsed"):
                published = datetime(*entry.published_parsed[:6], tzinfo=timezone.utc)
            elif entry.get("updated_parsed"):
                published = datetime(*entry.updated_parsed[:6], tzinfo=timezone.utc)
            else:
                published = datetime.now(timezone.utc)

            # Get summary
            summary = entry.get("summary", entry.get("description", ""))
            # Strip HTML tags
            summary = re.sub(r'<[^>]+>', '', summary).strip()[:1000]

            return FeedItem(
                title=title,
                url=url,
                published=published,
                summary=summary,
                source_id=source_id,
                category=category
            )

        except Exception as e:
            logger.debug(f"Error parsing entry: {e}")
            return None

    async def _match_startup(self, item: FeedItem) -> Optional[Dict[str, Any]]:
        """Check if the feed item mentions a tracked startup."""
        text = f"{item.title} {item.summary}".lower()

        # First check if it's likely funding news
        is_funding_news = any(kw in text for kw in FUNDING_KEYWORDS)

        if not is_funding_news and item.category == "funding_news":
            return None

        # Try to extract company name from title
        # Common patterns: "CompanyName raises $X", "CompanyName announces..."
        patterns = [
            r'^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)*)\s+(?:raises|raised|announces|secures|closes)',
            r'^([A-Z][a-zA-Z0-9]+(?:\s[A-Z][a-zA-Z0-9]+)*),?\s+(?:the|a|an)',
        ]

        company_name = None
        for pattern in patterns:
            match = re.search(pattern, item.title)
            if match:
                company_name = match.group(1).strip()
                break

        if company_name:
            # Look up in database
            startup = await self.db.find_startup_by_name(company_name)
            if startup:
                return startup

        # If we couldn't extract a name, do a broader search
        # This is more expensive so we only do it for high-signal items
        if is_funding_news:
            # Could implement fuzzy matching here
            pass

        return None

    async def _create_event(
        self,
        item: FeedItem,
        startup: Dict[str, Any]
    ) -> bool:
        """Create a startup event from a feed item."""
        try:
            await self.db.create_startup_event(
                startup_id=str(startup["id"]),
                event_type=item.category,
                event_source=item.source_id,
                event_title=item.title,
                event_url=item.url,
                event_content=item.summary,
                event_date=item.published
            )

            logger.info(f"Created event for {startup['name']}: {item.title[:50]}...")
            return True

        except Exception as e:
            logger.error(f"Error creating event: {e}")
            return False

    async def _load_recent_event_urls(self):
        """Load recently processed URLs to avoid duplicates."""
        try:
            rows = await self.db.fetch("""
                SELECT event_url FROM startup_events
                WHERE detected_at > NOW() - INTERVAL '7 days'
                AND event_url IS NOT NULL
            """)
            self._processed_urls = {row["event_url"] for row in rows}
            logger.debug(f"Loaded {len(self._processed_urls)} recent event URLs")
        except Exception as e:
            logger.warning(f"Could not load recent URLs: {e}")


async def run_rss_consumer(lookback_hours: int = 24) -> List[ConsumerResult]:
    """Run the RSS feed consumer."""
    consumer = RSSFeedConsumer(lookback_hours=lookback_hours)
    results = await consumer.consume_feeds()

    total_fetched = sum(r.items_fetched for r in results)
    total_matched = sum(r.items_matched for r in results)
    total_events = sum(r.events_created for r in results)
    success_count = sum(1 for r in results if r.success)

    logger.info(
        f"RSS consumption complete: {success_count}/{len(results)} feeds, "
        f"{total_fetched} items fetched, {total_matched} matched, {total_events} events created"
    )

    return results
