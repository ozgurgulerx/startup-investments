"""Website Content Monitor.

Scheduled job that checks website content hashes for changes
and creates startup_events when significant changes are detected.
"""

import asyncio
import hashlib
import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from dataclasses import dataclass

import httpx
from bs4 import BeautifulSoup

from .db import DatabaseConnection

logger = logging.getLogger(__name__)


@dataclass
class MonitorResult:
    """Result of monitoring a single startup website."""
    startup_id: str
    startup_name: str
    website: str
    success: bool
    content_changed: bool = False
    old_hash: Optional[str] = None
    new_hash: Optional[str] = None
    event_created: bool = False
    error: Optional[str] = None


class WebsiteContentMonitor:
    """Monitors startup websites for content changes."""

    def __init__(
        self,
        db: Optional[DatabaseConnection] = None,
        timeout: float = 15.0,
        max_concurrent: int = 5
    ):
        self.db = db or DatabaseConnection()
        self.timeout = timeout
        self.max_concurrent = max_concurrent
        self.user_agent = "Mozilla/5.0 (compatible; BuildAtlasMonitor/1.0)"

    async def monitor_websites(self, limit: int = 100) -> List[MonitorResult]:
        """Monitor a batch of startup websites for changes."""
        results = []

        try:
            await self.db.connect()

            # Get startups to monitor (ordered by last_crawl_at)
            startups = await self.db.get_startups_for_monitoring(limit=limit)
            logger.info(f"Monitoring {len(startups)} websites")

            if not startups:
                return results

            # Process with concurrency control
            semaphore = asyncio.Semaphore(self.max_concurrent)

            async with httpx.AsyncClient(timeout=self.timeout) as client:
                async def monitor_with_semaphore(startup: Dict[str, Any]) -> MonitorResult:
                    async with semaphore:
                        return await self._monitor_startup(client, startup)

                tasks = [monitor_with_semaphore(s) for s in startups]
                results = await asyncio.gather(*tasks, return_exceptions=True)

            # Convert exceptions to error results
            processed_results = []
            for startup, result in zip(startups, results):
                if isinstance(result, Exception):
                    processed_results.append(MonitorResult(
                        startup_id=str(startup["id"]),
                        startup_name=startup.get("name", "Unknown"),
                        website=startup.get("website", ""),
                        success=False,
                        error=str(result)
                    ))
                else:
                    processed_results.append(result)

            return processed_results

        finally:
            await self.db.close()

    async def _monitor_startup(
        self,
        client: httpx.AsyncClient,
        startup: Dict[str, Any]
    ) -> MonitorResult:
        """Monitor a single startup website."""
        startup_id = str(startup["id"])
        startup_name = startup.get("name", "Unknown")
        website = startup.get("website")
        old_hash = startup.get("content_hash")

        if not website:
            return MonitorResult(
                startup_id=startup_id,
                startup_name=startup_name,
                website="",
                success=False,
                error="No website URL"
            )

        logger.debug(f"Monitoring {startup_name}: {website}")

        try:
            # Fetch website content
            response = await client.get(
                website,
                headers={"User-Agent": self.user_agent},
                follow_redirects=True
            )
            response.raise_for_status()

            # Extract and hash content
            new_hash = self._compute_content_hash(response.text)

            # Check for change
            content_changed = old_hash is not None and old_hash != new_hash

            # Update database
            await self.db.update_startup_content_hash(
                startup_id=startup_id,
                content_hash=new_hash,
                crawl_success=True
            )

            # Create event if changed
            event_created = False
            if content_changed:
                logger.info(f"Content change detected for {startup_name}")
                await self.db.create_startup_event(
                    startup_id=startup_id,
                    event_type="website_change",
                    event_source="website_monitor",
                    event_title=f"Website content changed for {startup_name}",
                    event_url=website,
                    event_content=f"Content hash changed from {old_hash} to {new_hash}"
                )
                event_created = True

            # Log the crawl
            await self.db.log_crawl(
                startup_id=startup_id,
                source_type="website",
                url=website,
                status="success",
                http_status=response.status_code,
                content_length=len(response.text)
            )

            return MonitorResult(
                startup_id=startup_id,
                startup_name=startup_name,
                website=website,
                success=True,
                content_changed=content_changed,
                old_hash=old_hash,
                new_hash=new_hash,
                event_created=event_created
            )

        except httpx.HTTPStatusError as e:
            logger.warning(f"HTTP error for {startup_name}: {e.response.status_code}")

            await self.db.update_startup_content_hash(
                startup_id=startup_id,
                content_hash=old_hash or "",
                crawl_success=False
            )

            await self.db.log_crawl(
                startup_id=startup_id,
                source_type="website",
                url=website,
                status="failed",
                http_status=e.response.status_code,
                error_message=str(e)
            )

            return MonitorResult(
                startup_id=startup_id,
                startup_name=startup_name,
                website=website,
                success=False,
                error=f"HTTP {e.response.status_code}"
            )

        except Exception as e:
            logger.error(f"Error monitoring {startup_name}: {e}")

            await self.db.log_crawl(
                startup_id=startup_id,
                source_type="website",
                url=website,
                status="failed",
                error_message=str(e)
            )

            return MonitorResult(
                startup_id=startup_id,
                startup_name=startup_name,
                website=website,
                success=False,
                error=str(e)
            )

    def _compute_content_hash(self, html: str) -> str:
        """Compute a normalized content hash from HTML.

        Normalizes the content to reduce false positives from:
        - Dynamic timestamps
        - Session IDs
        - Minor whitespace changes
        - Ads/tracking changes
        """
        try:
            soup = BeautifulSoup(html, "html.parser")

            # Remove script and style elements
            for element in soup(["script", "style", "noscript", "iframe"]):
                element.decompose()

            # Remove common dynamic elements
            for element in soup.find_all(class_=lambda x: x and any(
                kw in str(x).lower() for kw in ["ad", "track", "analytics", "cookie"]
            )):
                element.decompose()

            # Get text content
            text = soup.get_text(separator=" ", strip=True)

            # Normalize whitespace
            text = " ".join(text.split())

            # Remove common dynamic patterns
            import re
            # Remove timestamps
            text = re.sub(r'\d{4}-\d{2}-\d{2}', '', text)
            text = re.sub(r'\d{2}:\d{2}:\d{2}', '', text)
            # Remove UUIDs
            text = re.sub(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '', text, flags=re.I)

            # Compute hash
            return hashlib.sha256(text.encode()).hexdigest()[:32]

        except Exception:
            # Fallback to raw HTML hash
            return hashlib.sha256(html.encode()).hexdigest()[:32]


async def run_website_monitor(limit: int = 100, max_concurrent: int = 5) -> List[MonitorResult]:
    """Run the website content monitor."""
    monitor = WebsiteContentMonitor(max_concurrent=max_concurrent)
    results = await monitor.monitor_websites(limit=limit)

    success = sum(1 for r in results if r.success)
    changed = sum(1 for r in results if r.content_changed)
    events = sum(1 for r in results if r.event_created)

    logger.info(f"Website monitoring complete: {success}/{len(results)} success, {changed} changed, {events} events created")

    return results
