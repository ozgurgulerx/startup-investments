"""Azure Blob Storage client with multi-container support.

This module provides a unified interface for all blob storage operations
supporting the following containers:
- startup-csvs: Input CSV files (incoming/processed/failed)
- crawl-snapshots: Raw crawl data with date-based versioning
- analysis-snapshots: LLM analysis outputs with versioning
- briefs: Generated markdown briefs with versioning
- periods: Period-based aggregations (monthly stats, indexes)

Authentication:
- Supports both connection string and Azure AD (DefaultAzureCredential)
- Azure AD auth is required when storage account has shared key access disabled
- In GitHub Actions, uses OIDC with Azure AD
"""

import os
import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Optional, List, Dict, Any, BinaryIO, Union
import hashlib

from azure.storage.blob import (
    BlobServiceClient,
    BlobClient,
    ContainerClient,
    ContentSettings,
)
from azure.core.exceptions import ResourceNotFoundError

# Try to import Azure Identity for AAD auth (optional)
try:
    from azure.identity import DefaultAzureCredential
    HAS_AZURE_IDENTITY = True
except ImportError:
    HAS_AZURE_IDENTITY = False
    DefaultAzureCredential = None


class ContainerName(str, Enum):
    """Available blob storage containers."""
    STARTUP_CSVS = "startup-csvs"
    CRAWL_SNAPSHOTS = "crawl-snapshots"
    ANALYSIS_SNAPSHOTS = "analysis-snapshots"
    BRIEFS = "briefs"
    PERIODS = "periods"


@dataclass
class StorageConfig:
    """Configuration for blob storage."""
    connection_string: str = field(default_factory=lambda: os.getenv("AZURE_STORAGE_CONNECTION_STRING", ""))
    account_name: str = field(default_factory=lambda: os.getenv("AZURE_STORAGE_ACCOUNT_NAME", "buildatlasstorage"))

    # Authentication mode: "connection_string", "aad", or "auto" (try both)
    auth_mode: str = field(default_factory=lambda: os.getenv("AZURE_STORAGE_AUTH_MODE", "auto"))

    # Container-specific prefixes
    csv_incoming_prefix: str = "incoming/"
    csv_processed_prefix: str = "processed/"
    csv_failed_prefix: str = "failed/"

    # Retention settings (in days, 0 = forever)
    crawl_retention_days: int = 0  # Keep all crawl snapshots
    analysis_retention_days: int = 0  # Keep all analysis snapshots
    brief_retention_days: int = 0  # Keep all briefs


class BlobStorageClient:
    """Client for Azure Blob Storage operations across multiple containers."""

    def __init__(self, config: Optional[StorageConfig] = None):
        """Initialize blob storage client.

        Args:
            config: Storage configuration. Uses environment variables if not provided.
        """
        self.config = config or StorageConfig()
        self._blob_service: Optional[BlobServiceClient] = None
        self._containers: Dict[str, ContainerClient] = {}
        # Last storage error captured (best-effort, for operational visibility and fail-open guards).
        self.last_error: str = ""

    @property
    def blob_service(self) -> Optional[BlobServiceClient]:
        """Lazy initialization of blob service client.

        Supports multiple authentication methods:
        - connection_string: Uses connection string (requires shared key access enabled)
        - aad: Uses Azure AD via DefaultAzureCredential
        - auto: Tries connection string first, falls back to AAD
        """
        if self._blob_service is not None:
            return self._blob_service

        auth_mode = self.config.auth_mode.lower()

        # Try connection string first (if configured and mode allows)
        if auth_mode in ("connection_string", "auto") and self.config.connection_string:
            try:
                self._blob_service = BlobServiceClient.from_connection_string(
                    self.config.connection_string
                )
                # Test the connection by listing containers (take first only)
                for _ in self._blob_service.list_containers():
                    break
                return self._blob_service
            except Exception as e:
                if auth_mode == "connection_string":
                    print(f"Error connecting with connection string: {e}")
                    return None
                # In auto mode, fall through to try AAD
                if "KeyBasedAuthenticationNotPermitted" not in str(e):
                    print(f"Connection string auth failed, trying Azure AD: {e}")

        # Try Azure AD authentication
        if auth_mode in ("aad", "auto") and HAS_AZURE_IDENTITY:
            try:
                account_url = f"https://{self.config.account_name}.blob.core.windows.net"
                credential = DefaultAzureCredential()
                self._blob_service = BlobServiceClient(
                    account_url=account_url,
                    credential=credential,
                )
                # Test the connection (take first only)
                for _ in self._blob_service.list_containers():
                    break
                return self._blob_service
            except Exception as e:
                print(f"Error connecting with Azure AD: {e}")
                return None

        return self._blob_service

    @property
    def is_configured(self) -> bool:
        """Check if blob storage is properly configured."""
        # Either connection string or AAD auth must be available
        has_conn_string = bool(self.config.connection_string)
        has_aad = HAS_AZURE_IDENTITY and bool(self.config.account_name)
        return has_conn_string or has_aad

    def get_container(self, container: ContainerName) -> Optional[ContainerClient]:
        """Get or create a container client.

        Args:
            container: The container to get

        Returns:
            ContainerClient if configured, None otherwise
        """
        if not self.blob_service:
            return None

        container_name = container.value
        if container_name not in self._containers:
            self._containers[container_name] = self.blob_service.get_container_client(container_name)
        return self._containers[container_name]

    async def ensure_containers_exist(self) -> Dict[str, bool]:
        """Ensure all required containers exist.

        Returns:
            Dict mapping container names to creation status (True if created, False if existed)
        """
        if not self.blob_service:
            return {}

        results = {}
        for container in ContainerName:
            try:
                container_client = self.blob_service.get_container_client(container.value)
                if not container_client.exists():
                    container_client.create_container()
                    results[container.value] = True
                else:
                    results[container.value] = False
            except Exception as e:
                print(f"Error creating container {container.value}: {e}")
                results[container.value] = False

        return results

    # =========================================================================
    # Generic blob operations
    # =========================================================================

    def upload_blob(
        self,
        container: ContainerName,
        blob_path: str,
        data: Union[str, bytes, BinaryIO],
        content_type: str = "application/octet-stream",
        metadata: Optional[Dict[str, str]] = None,
        overwrite: bool = True,
    ) -> Optional[str]:
        """Upload data to a blob.

        Args:
            container: Target container
            blob_path: Path within the container
            data: Data to upload (string, bytes, or file-like object)
            content_type: MIME content type
            metadata: Optional metadata to attach
            overwrite: Whether to overwrite existing blob

        Returns:
            Blob URL if successful, None otherwise
        """
        container_client = self.get_container(container)
        if not container_client:
            return None

        try:
            blob_client = container_client.get_blob_client(blob_path)

            # Convert string to bytes if needed
            if isinstance(data, str):
                data = data.encode("utf-8")

            content_settings = ContentSettings(content_type=content_type)

            blob_client.upload_blob(
                data,
                overwrite=overwrite,
                content_settings=content_settings,
                metadata=metadata,
            )

            self.last_error = ""
            return blob_client.url
        except Exception as e:
            self.last_error = str(e)
            print(f"Error uploading blob {blob_path}: {e}")
            return None

    def download_blob(
        self,
        container: ContainerName,
        blob_path: str,
        as_text: bool = True,
    ) -> Optional[Union[str, bytes]]:
        """Download blob content.

        Args:
            container: Source container
            blob_path: Path within the container
            as_text: If True, decode as UTF-8 string

        Returns:
            Blob content as string or bytes, None if not found
        """
        container_client = self.get_container(container)
        if not container_client:
            return None

        try:
            blob_client = container_client.get_blob_client(blob_path)
            data = blob_client.download_blob().readall()

            if as_text:
                return data.decode("utf-8")
            return data
        except ResourceNotFoundError:
            return None
        except Exception as e:
            print(f"Error downloading blob {blob_path}: {e}")
            return None

    def blob_exists(self, container: ContainerName, blob_path: str) -> bool:
        """Check if a blob exists.

        Args:
            container: Container to check
            blob_path: Path within the container

        Returns:
            True if blob exists
        """
        container_client = self.get_container(container)
        if not container_client:
            return False

        try:
            blob_client = container_client.get_blob_client(blob_path)
            return blob_client.exists()
        except Exception:
            return False

    def delete_blob(self, container: ContainerName, blob_path: str) -> bool:
        """Delete a blob.

        Args:
            container: Container containing the blob
            blob_path: Path within the container

        Returns:
            True if deleted successfully
        """
        container_client = self.get_container(container)
        if not container_client:
            return False

        try:
            blob_client = container_client.get_blob_client(blob_path)
            blob_client.delete_blob()
            return True
        except ResourceNotFoundError:
            return True  # Already deleted
        except Exception as e:
            print(f"Error deleting blob {blob_path}: {e}")
            return False

    def list_blobs(
        self,
        container: ContainerName,
        prefix: str = "",
        include_metadata: bool = False,
    ) -> List[Dict[str, Any]]:
        """List blobs in a container.

        Args:
            container: Container to list
            prefix: Optional prefix filter
            include_metadata: Include blob metadata in results

        Returns:
            List of blob info dicts with name, size, last_modified, etc.
        """
        container_client = self.get_container(container)
        if not container_client:
            return []

        try:
            blobs = container_client.list_blobs(
                name_starts_with=prefix if prefix else None,
                include=["metadata"] if include_metadata else None,
            )

            results = []
            for blob in blobs:
                info = {
                    "name": blob.name,
                    "size": blob.size,
                    "last_modified": blob.last_modified,
                    "content_type": blob.content_settings.content_type if blob.content_settings else None,
                    "etag": blob.etag,
                }
                if include_metadata and blob.metadata:
                    info["metadata"] = blob.metadata
                results.append(info)

            return results
        except Exception as e:
            print(f"Error listing blobs with prefix {prefix}: {e}")
            return []

    def copy_blob(
        self,
        container: ContainerName,
        source_path: str,
        dest_path: str,
        dest_container: Optional[ContainerName] = None,
    ) -> bool:
        """Copy a blob within or between containers.

        Args:
            container: Source container
            source_path: Source blob path
            dest_path: Destination blob path
            dest_container: Destination container (same as source if not specified)

        Returns:
            True if copied successfully
        """
        source_container = self.get_container(container)
        dest_container_client = self.get_container(dest_container or container)

        if not source_container or not dest_container_client:
            return False

        try:
            source_blob = source_container.get_blob_client(source_path)
            dest_blob = dest_container_client.get_blob_client(dest_path)

            dest_blob.start_copy_from_url(source_blob.url)
            return True
        except Exception as e:
            print(f"Error copying blob {source_path} to {dest_path}: {e}")
            return False

    def move_blob(
        self,
        container: ContainerName,
        source_path: str,
        dest_path: str,
        dest_container: Optional[ContainerName] = None,
    ) -> bool:
        """Move a blob (copy then delete source).

        Args:
            container: Source container
            source_path: Source blob path
            dest_path: Destination blob path
            dest_container: Destination container (same as source if not specified)

        Returns:
            True if moved successfully
        """
        if self.copy_blob(container, source_path, dest_path, dest_container):
            return self.delete_blob(container, source_path)
        return False

    # =========================================================================
    # JSON convenience methods
    # =========================================================================

    def upload_json(
        self,
        container: ContainerName,
        blob_path: str,
        data: Any,
        metadata: Optional[Dict[str, str]] = None,
    ) -> Optional[str]:
        """Upload data as JSON.

        Args:
            container: Target container
            blob_path: Path within the container
            data: Data to serialize as JSON
            metadata: Optional metadata

        Returns:
            Blob URL if successful
        """
        json_str = json.dumps(data, indent=2, default=str)
        return self.upload_blob(
            container=container,
            blob_path=blob_path,
            data=json_str,
            content_type="application/json",
            metadata=metadata,
        )

    def download_json(
        self,
        container: ContainerName,
        blob_path: str,
    ) -> Optional[Any]:
        """Download and parse JSON blob.

        Args:
            container: Source container
            blob_path: Path within the container

        Returns:
            Parsed JSON data, None if not found
        """
        content = self.download_blob(container, blob_path, as_text=True)
        if content:
            try:
                return json.loads(content)
            except json.JSONDecodeError as e:
                print(f"Error parsing JSON from {blob_path}: {e}")
        return None

    # =========================================================================
    # Crawl snapshot operations
    # =========================================================================

    def get_crawl_snapshot_path(self, slug: str, date: Optional[datetime] = None) -> str:
        """Get the blob path for a crawl snapshot.

        Args:
            slug: Startup slug
            date: Snapshot date (defaults to today)

        Returns:
            Blob path like "acme/2026-01-27/"
        """
        date = date or datetime.now(timezone.utc)
        return f"{slug}/{date.strftime('%Y-%m-%d')}/"

    def save_crawl_snapshot(
        self,
        slug: str,
        website_content: Optional[Dict] = None,
        github_content: Optional[Dict] = None,
        news_content: Optional[List[Dict]] = None,
        jobs_content: Optional[List[Dict]] = None,
        manifest: Optional[Dict] = None,
        date: Optional[datetime] = None,
    ) -> Dict[str, Optional[str]]:
        """Save a complete crawl snapshot.

        Args:
            slug: Startup slug
            website_content: Crawled website pages (markdown + URLs)
            github_content: GitHub API responses
            news_content: News articles found
            jobs_content: Job postings
            manifest: Crawl metadata and content hashes
            date: Snapshot date (defaults to today)

        Returns:
            Dict mapping file names to URLs (None if upload failed)
        """
        date = date or datetime.now(timezone.utc)
        base_path = self.get_crawl_snapshot_path(slug, date)

        results: Dict[str, Optional[str]] = {}

        # Create manifest if not provided
        if manifest is None:
            manifest = {
                "slug": slug,
                "crawled_at": date.isoformat(),
                "content_hashes": {},
            }

        # Upload each component
        if website_content is not None:
            results["website.json"] = self.upload_json(
                ContainerName.CRAWL_SNAPSHOTS,
                f"{base_path}website.json",
                website_content,
            )
            manifest["content_hashes"]["website"] = self._compute_hash(website_content)

        if github_content is not None:
            results["github.json"] = self.upload_json(
                ContainerName.CRAWL_SNAPSHOTS,
                f"{base_path}github.json",
                github_content,
            )
            manifest["content_hashes"]["github"] = self._compute_hash(github_content)

        if news_content is not None:
            results["news.json"] = self.upload_json(
                ContainerName.CRAWL_SNAPSHOTS,
                f"{base_path}news.json",
                news_content,
            )
            manifest["content_hashes"]["news"] = self._compute_hash(news_content)

        if jobs_content is not None:
            results["jobs.json"] = self.upload_json(
                ContainerName.CRAWL_SNAPSHOTS,
                f"{base_path}jobs.json",
                jobs_content,
            )
            manifest["content_hashes"]["jobs"] = self._compute_hash(jobs_content)

        # Always save manifest
        results["manifest.json"] = self.upload_json(
            ContainerName.CRAWL_SNAPSHOTS,
            f"{base_path}manifest.json",
            manifest,
        )

        return results

    def get_crawl_snapshot(
        self,
        slug: str,
        date: Optional[datetime] = None,
    ) -> Optional[Dict[str, Any]]:
        """Get a crawl snapshot for a startup.

        Args:
            slug: Startup slug
            date: Snapshot date (defaults to latest)

        Returns:
            Dict with all snapshot components, None if not found
        """
        if date is None:
            # Find the latest snapshot
            snapshots = self.list_crawl_snapshots(slug)
            if not snapshots:
                return None
            date = snapshots[0]["date"]  # Already sorted by date desc

        base_path = self.get_crawl_snapshot_path(slug, date)

        result = {
            "slug": slug,
            "date": date,
            "manifest": self.download_json(ContainerName.CRAWL_SNAPSHOTS, f"{base_path}manifest.json"),
            "website": self.download_json(ContainerName.CRAWL_SNAPSHOTS, f"{base_path}website.json"),
            "github": self.download_json(ContainerName.CRAWL_SNAPSHOTS, f"{base_path}github.json"),
            "news": self.download_json(ContainerName.CRAWL_SNAPSHOTS, f"{base_path}news.json"),
            "jobs": self.download_json(ContainerName.CRAWL_SNAPSHOTS, f"{base_path}jobs.json"),
        }

        # Return None if no manifest found
        if result["manifest"] is None:
            return None

        return result

    def list_crawl_snapshots(self, slug: str) -> List[Dict[str, Any]]:
        """List all crawl snapshots for a startup.

        Args:
            slug: Startup slug

        Returns:
            List of snapshots sorted by date descending
        """
        prefix = f"{slug}/"
        blobs = self.list_blobs(ContainerName.CRAWL_SNAPSHOTS, prefix=prefix)

        # Extract unique dates from blob paths
        dates = set()
        for blob in blobs:
            parts = blob["name"].split("/")
            if len(parts) >= 2:
                date_str = parts[1]
                try:
                    date = datetime.strptime(date_str, "%Y-%m-%d")
                    dates.add(date)
                except ValueError:
                    continue

        # Sort by date descending
        return [
            {"slug": slug, "date": d, "path": f"{slug}/{d.strftime('%Y-%m-%d')}/"}
            for d in sorted(dates, reverse=True)
        ]

    # =========================================================================
    # Analysis snapshot operations
    # =========================================================================

    def save_analysis_snapshot(
        self,
        slug: str,
        analysis: Dict[str, Any],
        date: Optional[datetime] = None,
        update_latest: bool = True,
    ) -> Dict[str, Optional[str]]:
        """Save an analysis snapshot.

        Args:
            slug: Startup slug
            analysis: Analysis data to save
            date: Snapshot date (defaults to today)
            update_latest: Also update latest.json

        Returns:
            Dict mapping file names to URLs
        """
        date = date or datetime.now(timezone.utc)
        date_str = date.strftime("%Y-%m-%d")

        results: Dict[str, Optional[str]] = {}

        # Add metadata
        analysis["_snapshot_date"] = date.isoformat()
        analysis["_slug"] = slug

        # Save dated version
        results[f"{date_str}.json"] = self.upload_json(
            ContainerName.ANALYSIS_SNAPSHOTS,
            f"{slug}/{date_str}.json",
            analysis,
        )

        # Update latest
        if update_latest:
            results["latest.json"] = self.upload_json(
                ContainerName.ANALYSIS_SNAPSHOTS,
                f"{slug}/latest.json",
                analysis,
            )

        return results

    def get_analysis_snapshot(
        self,
        slug: str,
        date: Optional[datetime] = None,
    ) -> Optional[Dict[str, Any]]:
        """Get an analysis snapshot.

        Args:
            slug: Startup slug
            date: Snapshot date (defaults to latest)

        Returns:
            Analysis data, None if not found
        """
        if date is None:
            return self.download_json(
                ContainerName.ANALYSIS_SNAPSHOTS,
                f"{slug}/latest.json",
            )

        date_str = date.strftime("%Y-%m-%d")
        return self.download_json(
            ContainerName.ANALYSIS_SNAPSHOTS,
            f"{slug}/{date_str}.json",
        )

    def list_analysis_snapshots(self, slug: str) -> List[Dict[str, Any]]:
        """List all analysis snapshots for a startup.

        Args:
            slug: Startup slug

        Returns:
            List of snapshots sorted by date descending
        """
        prefix = f"{slug}/"
        blobs = self.list_blobs(ContainerName.ANALYSIS_SNAPSHOTS, prefix=prefix)

        snapshots = []
        for blob in blobs:
            name = blob["name"].split("/")[-1]
            if name == "latest.json":
                continue

            # Extract date from filename
            if name.endswith(".json"):
                date_str = name[:-5]
                try:
                    date = datetime.strptime(date_str, "%Y-%m-%d")
                    snapshots.append({
                        "slug": slug,
                        "date": date,
                        "path": blob["name"],
                        "size": blob["size"],
                        "last_modified": blob["last_modified"],
                    })
                except ValueError:
                    continue

        return sorted(snapshots, key=lambda x: x["date"], reverse=True)

    # =========================================================================
    # Brief operations
    # =========================================================================

    def save_brief(
        self,
        slug: str,
        brief_content: str,
        date: Optional[datetime] = None,
        update_latest: bool = True,
    ) -> Dict[str, Optional[str]]:
        """Save a brief to blob storage.

        Args:
            slug: Startup slug
            brief_content: Markdown brief content
            date: Brief date (defaults to today)
            update_latest: Also update latest.md

        Returns:
            Dict mapping file names to URLs
        """
        date = date or datetime.now(timezone.utc)
        date_str = date.strftime("%Y-%m-%d")

        results: Dict[str, Optional[str]] = {}

        # Save dated version
        results[f"{date_str}.md"] = self.upload_blob(
            ContainerName.BRIEFS,
            f"{slug}/{date_str}.md",
            brief_content,
            content_type="text/markdown",
        )

        # Update latest
        if update_latest:
            results["latest.md"] = self.upload_blob(
                ContainerName.BRIEFS,
                f"{slug}/latest.md",
                brief_content,
                content_type="text/markdown",
            )

        return results

    def get_brief(
        self,
        slug: str,
        date: Optional[datetime] = None,
    ) -> Optional[str]:
        """Get a brief.

        Args:
            slug: Startup slug
            date: Brief date (defaults to latest)

        Returns:
            Brief content, None if not found
        """
        if date is None:
            return self.download_blob(
                ContainerName.BRIEFS,
                f"{slug}/latest.md",
                as_text=True,
            )

        date_str = date.strftime("%Y-%m-%d")
        return self.download_blob(
            ContainerName.BRIEFS,
            f"{slug}/{date_str}.md",
            as_text=True,
        )

    def list_briefs(self, slug: str) -> List[Dict[str, Any]]:
        """List all briefs for a startup.

        Args:
            slug: Startup slug

        Returns:
            List of briefs sorted by date descending
        """
        prefix = f"{slug}/"
        blobs = self.list_blobs(ContainerName.BRIEFS, prefix=prefix)

        briefs = []
        for blob in blobs:
            name = blob["name"].split("/")[-1]
            if name == "latest.md":
                continue

            if name.endswith(".md"):
                date_str = name[:-3]
                try:
                    date = datetime.strptime(date_str, "%Y-%m-%d")
                    briefs.append({
                        "slug": slug,
                        "date": date,
                        "path": blob["name"],
                        "size": blob["size"],
                        "last_modified": blob["last_modified"],
                    })
                except ValueError:
                    continue

        return sorted(briefs, key=lambda x: x["date"], reverse=True)

    # =========================================================================
    # Period operations
    # =========================================================================

    def save_period_data(
        self,
        period: str,
        data_type: str,
        content: Union[str, Dict, List],
        is_json: bool = True,
    ) -> Optional[str]:
        """Save period-based data.

        Args:
            period: Period string (YYYY-MM)
            data_type: Type of data (monthly_stats, newsletter, index)
            content: Content to save
            is_json: Whether content should be saved as JSON

        Returns:
            Blob URL if successful
        """
        ext = "json" if is_json else "md"
        blob_path = f"{period}/{data_type}.{ext}"

        if is_json:
            return self.upload_json(
                ContainerName.PERIODS,
                blob_path,
                content,
            )
        else:
            return self.upload_blob(
                ContainerName.PERIODS,
                blob_path,
                content if isinstance(content, str) else str(content),
                content_type="text/markdown",
            )

    def get_period_data(
        self,
        period: str,
        data_type: str,
        is_json: bool = True,
    ) -> Optional[Union[str, Dict, List]]:
        """Get period-based data.

        Args:
            period: Period string (YYYY-MM)
            data_type: Type of data
            is_json: Whether to parse as JSON

        Returns:
            Content, None if not found
        """
        ext = "json" if is_json else "md"
        blob_path = f"{period}/{data_type}.{ext}"

        if is_json:
            return self.download_json(ContainerName.PERIODS, blob_path)
        else:
            return self.download_blob(ContainerName.PERIODS, blob_path, as_text=True)

    def list_periods(self) -> List[str]:
        """List all periods with data.

        Returns:
            List of period strings sorted descending
        """
        blobs = self.list_blobs(ContainerName.PERIODS)

        periods = set()
        for blob in blobs:
            parts = blob["name"].split("/")
            if parts:
                period = parts[0]
                # Validate period format (YYYY-MM)
                if len(period) == 7 and period[4] == "-":
                    try:
                        datetime.strptime(period, "%Y-%m")
                        periods.add(period)
                    except ValueError:
                        continue

        return sorted(periods, reverse=True)

    # =========================================================================
    # Utility methods
    # =========================================================================

    def _compute_hash(self, data: Any) -> str:
        """Compute MD5 hash of data for change detection.

        Args:
            data: Data to hash

        Returns:
            First 12 characters of MD5 hash
        """
        json_str = json.dumps(data, sort_keys=True, default=str)
        return hashlib.md5(json_str.encode()).hexdigest()[:12]

    def compute_content_hash(self, content: Union[str, bytes, Dict, List]) -> str:
        """Compute content hash for change detection.

        Args:
            content: Content to hash

        Returns:
            First 12 characters of MD5 hash
        """
        if isinstance(content, (dict, list)):
            return self._compute_hash(content)

        if isinstance(content, str):
            content = content.encode("utf-8")

        return hashlib.md5(content).hexdigest()[:12]


# Singleton instance for convenience
_default_client: Optional[BlobStorageClient] = None


def get_blob_client() -> BlobStorageClient:
    """Get the default blob storage client.

    Returns:
        Configured BlobStorageClient instance
    """
    global _default_client
    if _default_client is None:
        _default_client = BlobStorageClient()
    return _default_client
