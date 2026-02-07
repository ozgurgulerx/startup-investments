"""Configuration management - loads environment variables and provides settings."""

import os
from pathlib import Path
from datetime import datetime
from typing import Optional
from dotenv import load_dotenv
from pydantic import BaseModel, Field


# Load environment variables
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)


class AzureOpenAIConfig(BaseModel):
    """Azure OpenAI configuration."""
    api_key: str = Field(default_factory=lambda: os.getenv("AZURE_OPENAI_API_KEY", ""))
    endpoint: str = Field(default_factory=lambda: os.getenv("AZURE_OPENAI_ENDPOINT", ""))
    api_version: str = Field(default_factory=lambda: os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01"))

    # Deployment names - use gpt-4.1 as the default since gpt-5-nano/mini don't exist
    fast_model: str = Field(default_factory=lambda: os.getenv("AZURE_OPENAI_VISION_DEPLOYMENT_NAME", "gpt-4.1"))
    reasoning_model: str = Field(default_factory=lambda: os.getenv("AZURE_OPENAI_VISION_DEPLOYMENT_NAME", "gpt-4.1"))
    embedding_model: str = Field(default_factory=lambda: os.getenv("AZURE_TEXT_EMBEDDING_DEPLOYMENT_NAME", "text-embedding-3-small"))


class CrawlerConfig(BaseModel):
    """Crawler configuration."""
    runtime: str = Field(default_factory=lambda: os.getenv("CRAWLER_RUNTIME", "scrapy"))
    headless: bool = True
    timeout_ms: int = 60000  # Increased from 30s to 60s for slow pages
    rate_limit_delay: float = 2.0  # seconds between requests
    max_concurrent: int = 3
    cache_dir: str = Field(default_factory=lambda: str(Path(__file__).parent.parent / "data" / "crawl_cache"))
    respect_robots_txt: bool = Field(default_factory=lambda: os.getenv("CRAWLER_RESPECT_ROBOTS", "true").lower() == "true")
    depth_limit: int = Field(default_factory=lambda: int(os.getenv("CRAWLER_DEPTH_LIMIT", "2")))
    max_pages_per_startup: int = Field(default_factory=lambda: int(os.getenv("CRAWLER_MAX_PAGES_PER_STARTUP", "80")))
    frontier_batch_size: int = Field(default_factory=lambda: int(os.getenv("CRAWLER_FRONTIER_BATCH_SIZE", "50")))

    # Proxy strategy (lean by default: datacenter first, optional residential fallback)
    datacenter_proxy_url: str = Field(default_factory=lambda: os.getenv("CRAWLER_PROXY_URL", ""))
    residential_proxy_url: str = Field(default_factory=lambda: os.getenv("CRAWLER_RESIDENTIAL_PROXY_URL", ""))
    default_proxy_tier: str = Field(default_factory=lambda: os.getenv("CRAWLER_DEFAULT_PROXY_TIER", "datacenter"))

    # Managed unblock lane (provider-based render/unblock)
    unblock_mode: str = Field(default_factory=lambda: os.getenv("CRAWLER_UNBLOCK_MODE", "auto"))  # off|auto|provider_only
    unblock_provider: str = Field(default_factory=lambda: os.getenv("CRAWLER_UNBLOCK_PROVIDER", "browserless"))
    browserless_endpoint: str = Field(default_factory=lambda: os.getenv("BROWSERLESS_ENDPOINT", ""))
    browserless_token: str = Field(default_factory=lambda: os.getenv("BROWSERLESS_TOKEN", ""))
    ai_blocking_assumed: bool = Field(default_factory=lambda: os.getenv("CRAWLER_AI_BLOCKING_ASSUMED", "true").lower() == "true")

    # Raw replay capture (WARC-lite)
    raw_capture_enabled: bool = Field(default_factory=lambda: os.getenv("CRAWLER_RAW_CAPTURE_ENABLED", "true").lower() == "true")
    raw_capture_retention_days: int = Field(default_factory=lambda: int(os.getenv("CRAWLER_RAW_CAPTURE_RETENTION_DAYS", "90")))
    raw_capture_max_body_bytes: int = Field(default_factory=lambda: int(os.getenv("CRAWLER_RAW_CAPTURE_MAX_BODY_BYTES", "1048576")))

    # Feed/sitemap-first discovery
    feed_discovery_enabled: bool = Field(default_factory=lambda: os.getenv("CRAWLER_FEED_DISCOVERY_ENABLED", "true").lower() == "true")
    feed_discovery_max_urls_per_startup: int = Field(default_factory=lambda: int(os.getenv("CRAWLER_FEED_DISCOVERY_MAX_URLS", "20")))
    feed_discovery_timeout_seconds: float = Field(default_factory=lambda: float(os.getenv("CRAWLER_FEED_DISCOVERY_TIMEOUT_SECONDS", "6")))

    # Data enrichment sources
    enable_web_search: bool = True
    enable_github: bool = True
    enable_news: bool = True
    web_search_results: int = 5  # Number of search results to fetch
    news_days_back: int = 90  # How many days of news to search

    # GitHub settings
    github_token: str = Field(default_factory=lambda: os.getenv("GITHUB_TOKEN", ""))


class AnalysisConfig(BaseModel):
    """Analysis configuration."""
    max_content_length: int = 50000  # max chars to send to LLM
    confidence_threshold: float = 0.7


class IntelligenceConfig(BaseModel):
    """External intelligence collection configuration."""
    # Startup Providers
    enable_crunchbase: bool = True
    crunchbase_api_key: str = Field(default_factory=lambda: os.getenv("CRUNCHBASE_API_KEY", ""))
    enable_cbinsights: bool = True
    enable_pitchbook: bool = True
    enable_tracxn: bool = True
    enable_dealroom: bool = True

    # Tech Programs
    enable_tech_programs: bool = True
    check_google_programs: bool = True
    check_aws_programs: bool = True
    check_microsoft_programs: bool = True
    check_nvidia_programs: bool = True
    check_meta_programs: bool = True
    check_salesforce_programs: bool = True
    check_intel_programs: bool = True

    # Accelerators
    enable_accelerators: bool = True
    accelerator_list: list = Field(default_factory=lambda: [
        "yc", "techstars", "500global", "endeavor", "plugandplay",
        "antler", "seedcamp", "stationf", "foundersfactory"
    ])

    # VC Resources
    enable_vc_resources: bool = True
    vc_firms: list = Field(default_factory=lambda: [
        "sequoia", "a16z", "greylock", "firstround", "yc",
        "nfx", "bessemer", "pointnine", "openview", "battery"
    ])

    # Rate limiting
    intelligence_rate_limit: float = 1.5  # seconds between requests


class Settings(BaseModel):
    """Main settings container."""
    azure_openai: AzureOpenAIConfig = Field(default_factory=AzureOpenAIConfig)
    crawler: CrawlerConfig = Field(default_factory=CrawlerConfig)
    analysis: AnalysisConfig = Field(default_factory=AnalysisConfig)
    intelligence: IntelligenceConfig = Field(default_factory=IntelligenceConfig)

    # Paths
    project_root: Path = Field(default_factory=lambda: Path(__file__).parent.parent)
    # Legacy paths (for backward compatibility)
    data_input_dir: Path = Field(default_factory=lambda: Path(__file__).parent.parent / "data" / "input")
    data_output_dir: Path = Field(default_factory=lambda: Path(__file__).parent.parent / "data" / "output")

    def get_current_period(self) -> str:
        """Get current period in YYYY-MM format."""
        return datetime.now().strftime("%Y-%m")

    def get_period_dir(self, period: Optional[str] = None) -> Path:
        """Get the data directory for a specific period.

        Args:
            period: Period string like '2026-01'. Defaults to current month.

        Returns:
            Path to the period directory (e.g., data/2026-01/)
        """
        p = period or self.get_current_period()
        return self.project_root / "data" / p

    def get_input_dir(self, period: Optional[str] = None) -> Path:
        """Get input directory for a specific period.

        Args:
            period: Period string like '2026-01'. Defaults to current month.

        Returns:
            Path to input directory (e.g., data/2026-01/input/)
        """
        return self.get_period_dir(period) / "input"

    def get_output_dir(self, period: Optional[str] = None) -> Path:
        """Get output directory for a specific period.

        Args:
            period: Period string like '2026-01'. Defaults to current month.

        Returns:
            Path to output directory (e.g., data/2026-01/output/)
        """
        return self.get_period_dir(period) / "output"

    def ensure_period_dirs(self, period: Optional[str] = None):
        """Ensure all required directories exist for a period."""
        self.get_input_dir(period).mkdir(parents=True, exist_ok=True)
        self.get_output_dir(period).mkdir(parents=True, exist_ok=True)
        Path(self.crawler.cache_dir).mkdir(parents=True, exist_ok=True)

    def ensure_dirs(self):
        """Ensure all required directories exist (legacy method)."""
        # Keep crawl_cache at top level (shared across periods)
        Path(self.crawler.cache_dir).mkdir(parents=True, exist_ok=True)

    def extract_period_from_path(self, path: Path) -> Optional[str]:
        """Extract period from a file path if it follows the convention.

        Examples:
            data/2026-01/input/startups.csv -> '2026-01'
            data/2026-01/output/... -> '2026-01'

        Args:
            path: Path to examine

        Returns:
            Period string if found, None otherwise
        """
        path = Path(path)
        parts = path.parts

        for part in parts:
            # Check if part matches YYYY-MM format
            if len(part) == 7 and part[4] == '-':
                try:
                    # Validate it's a valid date
                    datetime.strptime(part, "%Y-%m")
                    return part
                except ValueError:
                    continue

        return None


# Global settings instance
settings = Settings()
settings.ensure_dirs()
