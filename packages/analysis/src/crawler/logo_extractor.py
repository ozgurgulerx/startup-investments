"""Logo extraction and download for startups.

Extracts company logos from:
- Favicon
- Open Graph images (og:image)
- Twitter card images
- Logo tags in HTML
- Clearbit Logo API (fallback)

Supports PostgreSQL storage for serving via API.
"""

import os
import re
import asyncio
from pathlib import Path
from typing import Optional, List, Tuple
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup

from src.config import settings


class LogoExtractor:
    """Extracts and downloads company logos to PostgreSQL or local storage."""

    def __init__(
        self,
        output_dir: Optional[Path] = None,
        use_database: bool = True,
        database_url: Optional[str] = None,
    ):
        """Initialize logo extractor.

        Args:
            output_dir: Directory to save logos locally (fallback)
            use_database: If True, save to PostgreSQL database
            database_url: PostgreSQL connection string
        """
        self.output_dir = output_dir or settings.data_output_dir / "logos"
        self.output_dir.mkdir(parents=True, exist_ok=True)

        self.use_database = use_database
        self.database_url = database_url or os.getenv("DATABASE_URL", "")

        # Database connection (lazy init)
        self._db_pool = None

        self.client = httpx.AsyncClient(
            timeout=30.0,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; StartupAnalyzer/1.0)"}
        )

    async def _get_db_pool(self):
        """Get or create database connection pool."""
        if self._db_pool is None and self.use_database and self.database_url:
            try:
                import asyncpg
                self._db_pool = await asyncpg.create_pool(
                    self.database_url,
                    min_size=1,
                    max_size=5
                )
            except ImportError:
                print("Warning: asyncpg not installed. Falling back to local storage.")
                self.use_database = False
            except Exception as e:
                print(f"Warning: Database connection failed: {e}. Falling back to local storage.")
                self.use_database = False
        return self._db_pool

    async def extract_and_save(
        self,
        company_name: str,
        website: Optional[str],
        html_content: Optional[str] = None
    ) -> Optional[str]:
        """Extract logo and save to storage.

        Args:
            company_name: Company name for filename
            website: Company website URL
            html_content: Optional pre-crawled HTML content

        Returns:
            URL to access the logo (API endpoint or local path), or None if not found
        """
        slug = self._to_slug(company_name)

        # Check if logo already exists
        existing = await self._find_existing_logo(slug)
        if existing:
            return existing

        # Try to extract logo URL
        logo_url = await self._find_logo_url(website, html_content)

        if logo_url:
            saved_url = await self._download_and_save(logo_url, slug, company_name)
            if saved_url:
                return saved_url

        # Fallback: Try Clearbit Logo API (free, no API key needed)
        if website:
            clearbit_url = await self._try_clearbit(website, slug, company_name)
            if clearbit_url:
                return clearbit_url

        return None

    async def _find_existing_logo(self, slug: str) -> Optional[str]:
        """Check if logo already exists."""
        if self.use_database:
            pool = await self._get_db_pool()
            if pool:
                async with pool.acquire() as conn:
                    row = await conn.fetchrow(
                        "SELECT logo_data FROM startups WHERE slug = $1 AND logo_data IS NOT NULL",
                        slug
                    )
                    if row and row['logo_data']:
                        return f"/api/startups/{slug}/logo"

        # Check local storage
        for ext in [".png", ".jpg", ".svg", ".webp", ".gif", ".ico"]:
            path = self.output_dir / f"{slug}{ext}"
            if path.exists():
                return str(path)
        return None

    async def _find_logo_url(
        self,
        website: Optional[str],
        html_content: Optional[str] = None
    ) -> Optional[str]:
        """Find logo URL from website.

        Tries multiple strategies in order of preference.
        """
        if not website:
            return None

        # Ensure website has protocol
        if not website.startswith(("http://", "https://")):
            website = f"https://{website}"

        # Fetch HTML if not provided
        if not html_content:
            try:
                response = await self.client.get(website)
                if response.status_code == 200:
                    html_content = response.text
            except Exception:
                pass

        if not html_content:
            return None

        soup = BeautifulSoup(html_content, "html.parser")

        # Strategy 1: Open Graph image (og:image) - often high quality
        og_image = soup.find("meta", property="og:image")
        if og_image and og_image.get("content"):
            url = self._resolve_url(str(og_image["content"]), website)
            if await self._is_valid_image(url):
                return url

        # Strategy 2: Twitter card image
        twitter_image = soup.find("meta", attrs={"name": "twitter:image"})
        if twitter_image and twitter_image.get("content"):
            url = self._resolve_url(str(twitter_image["content"]), website)
            if await self._is_valid_image(url):
                return url

        # Strategy 3: Look for logo in common patterns
        logo_patterns = [
            # By class/id containing "logo"
            soup.find("img", class_=re.compile(r"logo", re.I)),
            soup.find("img", id=re.compile(r"logo", re.I)),
            # By src containing "logo"
            soup.find("img", src=re.compile(r"logo", re.I)),
            # By alt containing company name or "logo"
            soup.find("img", alt=re.compile(r"logo", re.I)),
            # In header/nav
            soup.select_one("header img"),
            soup.select_one("nav img"),
            soup.select_one(".navbar img"),
            soup.select_one(".header img"),
        ]

        for img in logo_patterns:
            if img and img.get("src"):
                url = self._resolve_url(str(img["src"]), website)
                if await self._is_valid_image(url):
                    return url

        # Strategy 4: Apple touch icon (usually high quality)
        apple_icon = soup.find("link", rel="apple-touch-icon")
        if apple_icon and apple_icon.get("href"):
            url = self._resolve_url(str(apple_icon["href"]), website)
            if await self._is_valid_image(url):
                return url

        # Strategy 5: Favicon (last resort, usually small)
        favicon = soup.find("link", rel=re.compile(r"icon", re.I))
        if favicon and favicon.get("href"):
            url = self._resolve_url(str(favicon["href"]), website)
            # Only use favicon if it's SVG or large enough
            if url.endswith(".svg") or await self._is_valid_image(url, min_size=1000):
                return url

        return None

    async def _try_clearbit(self, website: str, slug: str, company_name: str) -> Optional[str]:
        """Try Clearbit Logo API as fallback.

        Clearbit provides free logo lookup by domain.
        """
        try:
            # Extract domain
            parsed = urlparse(website if "://" in website else f"https://{website}")
            domain = parsed.netloc or parsed.path
            domain = domain.replace("www.", "")

            # Clearbit Logo API
            clearbit_url = f"https://logo.clearbit.com/{domain}"

            response = await self.client.get(clearbit_url)
            if response.status_code == 200 and len(response.content) > 1000:
                # Save the logo
                content_type = response.headers.get("content-type", "image/png")
                ext = self._get_extension_from_content_type(content_type)
                return await self._save_content(response.content, slug, company_name, content_type)

        except Exception as e:
            print(f"Clearbit logo fetch failed: {e}")

        return None

    async def _download_and_save(self, url: str, slug: str, company_name: str) -> Optional[str]:
        """Download image and save to storage.

        Args:
            url: Image URL
            slug: Company slug for filename
            company_name: Company name for database lookup

        Returns:
            URL/path to saved file, or None if failed
        """
        try:
            response = await self.client.get(url)
            if response.status_code != 200:
                return None

            content = response.content
            if len(content) < 500:  # Too small, probably not a real logo
                return None

            content_type = response.headers.get("content-type", "image/png")
            return await self._save_content(content, slug, company_name, content_type)

        except Exception as e:
            print(f"Logo download failed for {url}: {e}")
            return None

    async def _save_content(
        self,
        content: bytes,
        slug: str,
        company_name: str,
        content_type: str
    ) -> Optional[str]:
        """Save content to storage (database or local).

        Args:
            content: Image content bytes
            slug: Company slug for filename
            company_name: Company name for database lookup
            content_type: MIME type of the image

        Returns:
            URL/path to saved file
        """
        # Normalize content type
        if "svg" in content_type:
            content_type = "image/svg+xml"
        elif "png" in content_type:
            content_type = "image/png"
        elif "jpeg" in content_type or "jpg" in content_type:
            content_type = "image/jpeg"
        elif "webp" in content_type:
            content_type = "image/webp"
        elif "gif" in content_type:
            content_type = "image/gif"
        else:
            content_type = "image/png"

        if self.use_database:
            pool = await self._get_db_pool()
            if pool:
                try:
                    async with pool.acquire() as conn:
                        # Update or insert logo data
                        result = await conn.execute("""
                            UPDATE startups
                            SET logo_data = $1,
                                logo_content_type = $2,
                                logo_updated_at = NOW()
                            WHERE slug = $3 OR LOWER(name) = LOWER($4)
                        """, content, content_type, slug, company_name)

                        # Check if any row was updated
                        if result and result != "UPDATE 0":
                            return f"/api/startups/{slug}/logo"

                        # If no row updated, might need to create startup first
                        # For now, fall back to local storage
                        print(f"No startup found for slug={slug} or name={company_name}")
                except Exception as e:
                    print(f"Database save failed: {e}")

        # Save locally as fallback
        ext = self._get_extension_from_content_type(content_type)
        filename = f"{slug}{ext}"
        filepath = self.output_dir / filename
        filepath.write_bytes(content)
        return str(filepath)

    async def _is_valid_image(self, url: str, min_size: int = 500) -> bool:
        """Check if URL points to a valid image.

        Args:
            url: Image URL
            min_size: Minimum file size in bytes

        Returns:
            True if valid image
        """
        try:
            response = await self.client.head(url)
            if response.status_code != 200:
                return False

            content_type = response.headers.get("content-type", "")
            content_length = int(response.headers.get("content-length", 0))

            # Check content type
            if not any(t in content_type.lower() for t in ["image", "svg"]):
                return False

            # Check size (if provided)
            if content_length > 0 and content_length < min_size:
                return False

            return True

        except Exception:
            return False

    def _resolve_url(self, url: str, base_url: str) -> str:
        """Resolve relative URL to absolute."""
        if url.startswith(("http://", "https://", "//")):
            if url.startswith("//"):
                return f"https:{url}"
            return url
        return urljoin(base_url, url)

    def _get_extension_from_content_type(self, content_type: str) -> str:
        """Get file extension from content type."""
        content_type = content_type.lower()
        if "svg" in content_type:
            return ".svg"
        elif "png" in content_type:
            return ".png"
        elif "jpeg" in content_type or "jpg" in content_type:
            return ".jpg"
        elif "webp" in content_type:
            return ".webp"
        elif "gif" in content_type:
            return ".gif"
        elif "ico" in content_type:
            return ".ico"
        return ".png"

    def _to_slug(self, name: str) -> str:
        """Convert company name to filesystem-safe slug."""
        return name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")

    def get_logo_url(self, company_name: str) -> str:
        """Get URL to logo for a company.

        Args:
            company_name: Company name

        Returns:
            API URL to logo
        """
        slug = self._to_slug(company_name)
        return f"/api/startups/{slug}/logo"

    async def close(self):
        """Close HTTP client and database pool."""
        await self.client.aclose()
        if self._db_pool:
            await self._db_pool.close()


async def extract_logos_for_existing_startups(
    use_database: bool = True,
    max_concurrent: int = 5
) -> dict:
    """Extract logos for all existing startups in the database.

    Args:
        use_database: If True, save to PostgreSQL database
        max_concurrent: Maximum concurrent extractions

    Returns:
        Dict with results: {success: [...], failed: [...], skipped: [...]}
    """
    import asyncpg

    database_url = os.getenv("DATABASE_URL", "")
    if not database_url:
        print("ERROR: DATABASE_URL not set")
        return {"success": [], "failed": [], "skipped": []}

    extractor = LogoExtractor(use_database=use_database, database_url=database_url)

    results = {"success": [], "failed": [], "skipped": []}
    semaphore = asyncio.Semaphore(max_concurrent)

    # Get all startups from the database
    pool = await asyncpg.create_pool(database_url, min_size=1, max_size=5)

    async with pool.acquire() as conn:
        startups = await conn.fetch("""
            SELECT name, website, slug, logo_data IS NOT NULL as has_logo
            FROM startups
            ORDER BY name
        """)

    total = len(startups)
    print(f"Extracting logos for {total} startups...")
    print(f"Storage: PostgreSQL database")

    async def process_startup(row):
        async with semaphore:
            name = row['name']
            website = row['website']
            has_logo = row['has_logo']

            if has_logo:
                results["skipped"].append({"name": name, "reason": "Already has logo"})
                print(f"  [SKIP] {name}: Already has logo")
                return

            if not website:
                results["skipped"].append({"name": name, "reason": "No website"})
                print(f"  [SKIP] {name}: No website")
                return

            try:
                logo_url = await extractor.extract_and_save(name, website)
                if logo_url:
                    results["success"].append({"name": name, "logo_url": logo_url})
                    print(f"  [OK] {name}: {logo_url}")
                else:
                    results["failed"].append({"name": name, "reason": "No logo found"})
                    print(f"  [--] {name}: No logo found")
            except Exception as e:
                results["failed"].append({"name": name, "reason": str(e)})
                print(f"  [ERR] {name}: {e}")

    tasks = [process_startup(row) for row in startups]
    await asyncio.gather(*tasks)

    await extractor.close()
    await pool.close()

    print(f"\nResults:")
    print(f"  Success: {len(results['success'])}")
    print(f"  Failed: {len(results['failed'])}")
    print(f"  Skipped: {len(results['skipped'])}")

    return results
