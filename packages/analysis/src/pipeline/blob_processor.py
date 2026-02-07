"""Blob storage processor for automated CSV processing.

Handles:
- Downloading CSV from Azure Blob Storage
- Parsing and processing startups
- Moving blobs between folders (incoming -> processed/failed)
- Saving crawl and analysis snapshots to blob storage
"""

import os
import csv
import io
from dataclasses import dataclass
from typing import List, Optional, Dict, Any
from datetime import datetime, timezone
from pathlib import Path

from azure.storage.blob import BlobServiceClient, BlobClient

from src.config import settings
from src.data.models import StartupInput
from src.data.store import AnalysisStore
from src.storage import BlobStorageClient, SnapshotManager, ContainerName
from .delta_processor import DeltaProcessor, BatchResult


@dataclass
class BlobConfig:
    """Configuration for blob storage."""
    connection_string: str
    container_name: str = "startup-csvs"
    incoming_prefix: str = "incoming/"
    processed_prefix: str = "processed/"
    failed_prefix: str = "failed/"


@dataclass
class ProcessingReport:
    """Report of CSV processing."""
    blob_name: str
    blob_url: str
    status: str  # 'completed', 'failed'
    total_rows: int = 0
    new_startups: int = 0
    updated_startups: int = 0
    unchanged_startups: int = 0
    errors: int = 0
    error_message: Optional[str] = None
    processing_time_ms: int = 0
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class BlobProcessor:
    """Processes CSV files from Azure Blob Storage."""

    def __init__(
        self,
        config: Optional[BlobConfig] = None,
        store: Optional[AnalysisStore] = None,
        output_dir: Optional[Path] = None,
        storage_client: Optional[BlobStorageClient] = None,
    ):
        """Initialize blob processor.

        Args:
            config: Blob storage configuration (uses env vars if not provided)
            store: AnalysisStore instance
            output_dir: Output directory for results
            storage_client: BlobStorageClient for multi-container storage
        """
        self.config = config or BlobConfig(
            connection_string=os.getenv("AZURE_STORAGE_CONNECTION_STRING", ""),
            container_name=os.getenv("BLOB_CONTAINER_NAME", "startup-csvs")
        )

        self.blob_service = BlobServiceClient.from_connection_string(
            self.config.connection_string
        ) if self.config.connection_string else None

        self.store = store or AnalysisStore()
        self.output_dir = output_dir or settings.data_output_dir

        # Initialize new storage infrastructure
        self.storage_client = storage_client or BlobStorageClient()
        self.snapshot_manager = SnapshotManager(self.storage_client)

        self.delta_processor = DeltaProcessor(
            store=self.store,
            output_dir=self.output_dir,
            storage_client=self.storage_client,
            snapshot_manager=self.snapshot_manager,
        )

    async def process_blob(self, blob_name: str) -> ProcessingReport:
        """Process a single blob (CSV file).

        Args:
            blob_name: Name of the blob (e.g., "incoming/2026-01-funding.csv")

        Returns:
            ProcessingReport with results
        """
        report = ProcessingReport(
            blob_name=blob_name,
            blob_url=f"{self.config.container_name}/{blob_name}",
            status="pending",
            started_at=datetime.now(timezone.utc)
        )

        try:
            # 1. Download CSV content
            print(f"\n[BlobProcessor] Downloading {blob_name}...")
            csv_content = await self._download_blob(blob_name)

            # 2. Parse CSV to StartupInput objects
            print(f"[BlobProcessor] Parsing CSV...")
            startups = self._parse_csv(csv_content)
            report.total_rows = len(startups)
            print(f"[BlobProcessor] Found {len(startups)} startups")

            # 3. Process through delta processor
            print(f"[BlobProcessor] Processing startups...")
            batch_result: BatchResult = await self.delta_processor.process_csv_batch(
                startups,
                skip_crawl=False
            )

            # 4. Update report
            report.new_startups = batch_result.new_created
            report.updated_startups = batch_result.updated
            report.unchanged_startups = batch_result.skipped
            report.errors = batch_result.errors
            report.processing_time_ms = batch_result.processing_time_ms
            report.status = "completed"

            # 5. Move blob to processed folder
            await self._move_blob(
                blob_name,
                blob_name.replace(self.config.incoming_prefix, self.config.processed_prefix)
            )
            print(f"[BlobProcessor] Moved to processed/")

        except Exception as e:
            import traceback
            traceback.print_exc()
            report.status = "failed"
            report.error_message = str(e)

            # Move to failed folder
            try:
                await self._move_blob(
                    blob_name,
                    blob_name.replace(self.config.incoming_prefix, self.config.failed_prefix)
                )
            except Exception:
                pass  # Ignore move errors

        report.completed_at = datetime.now(timezone.utc)
        return report

    async def _download_blob(self, blob_name: str) -> str:
        """Download blob content as string.
        Uses asyncio.to_thread() to avoid blocking the event loop with sync Azure SDK calls.
        """
        import asyncio

        if not self.blob_service:
            raise ValueError("Blob service not configured")

        def _sync_download() -> str:
            container = self.blob_service.get_container_client(self.config.container_name)
            blob = container.get_blob_client(blob_name)
            download = blob.download_blob()
            return download.readall().decode("utf-8")

        return await asyncio.to_thread(_sync_download)

    async def _move_blob(self, source: str, destination: str):
        """Move blob from source to destination (copy-verify-delete).
        Uses asyncio.to_thread() for sync SDK calls and asyncio.sleep() instead of time.sleep().
        """
        import asyncio

        if not self.blob_service:
            return

        def _sync_copy_and_poll() -> None:
            container = self.blob_service.get_container_client(self.config.container_name)
            source_blob = container.get_blob_client(source)
            dest_blob = container.get_blob_client(destination)

            dest_blob.start_copy_from_url(source_blob.url)

            # Poll until copy completes
            import time
            max_wait = 60
            waited = 0
            while waited < max_wait:
                props = dest_blob.get_blob_properties()
                copy_status = props.copy.status if props.copy else None
                if copy_status == "success":
                    break
                elif copy_status in ("failed", "aborted"):
                    raise RuntimeError(f"Blob copy failed with status: {copy_status}")
                time.sleep(1)
                waited += 1

            if waited >= max_wait:
                raise RuntimeError(f"Blob copy timed out after {max_wait}s for {source} -> {destination}")

            # Verify destination size matches source before deleting
            source_props = source_blob.get_blob_properties()
            dest_props = dest_blob.get_blob_properties()
            if dest_props.size != source_props.size:
                raise RuntimeError(
                    f"Blob copy size mismatch: source={source_props.size}, dest={dest_props.size}"
                )

            # Only delete source after verified copy
            source_blob.delete_blob()

        await asyncio.to_thread(_sync_copy_and_poll)

    def _parse_csv(self, csv_content: str) -> List[StartupInput]:
        """Parse CSV content to StartupInput objects."""
        startups = []

        # Use csv reader
        reader = csv.DictReader(io.StringIO(csv_content))

        for row in reader:
            try:
                startup = StartupInput.from_csv_row(row)
                # Skip rows without name
                if startup.name and startup.name.strip():
                    startups.append(startup)
            except Exception as e:
                print(f"  Warning: Failed to parse row: {e}")
                continue

        return startups

    async def list_pending_blobs(self) -> List[str]:
        """List all blobs in the incoming folder."""
        import asyncio

        if not self.blob_service:
            return []

        def _sync_list() -> List[str]:
            container = self.blob_service.get_container_client(self.config.container_name)
            blobs = container.list_blobs(name_starts_with=self.config.incoming_prefix)
            return [blob.name for blob in blobs if blob.name.endswith(".csv")]

        return await asyncio.to_thread(_sync_list)

    async def process_all_pending(self) -> List[ProcessingReport]:
        """Process all pending blobs in incoming folder."""
        pending = await self.list_pending_blobs()
        print(f"\n[BlobProcessor] Found {len(pending)} pending CSVs")

        reports = []
        for blob_name in pending:
            report = await self.process_blob(blob_name)
            reports.append(report)

        return reports


# For local testing without blob storage
class LocalFileProcessor:
    """Processes local CSV files (for development/testing)."""

    def __init__(
        self,
        store: Optional[AnalysisStore] = None,
        output_dir: Optional[Path] = None
    ):
        self.store = store or AnalysisStore()
        self.output_dir = output_dir or settings.data_output_dir
        self.delta_processor = DeltaProcessor(
            store=self.store,
            output_dir=self.output_dir
        )

    async def process_csv_file(self, file_path: Path) -> ProcessingReport:
        """Process a local CSV file.

        Args:
            file_path: Path to CSV file

        Returns:
            ProcessingReport with results
        """
        report = ProcessingReport(
            blob_name=file_path.name,
            blob_url=str(file_path),
            status="pending",
            started_at=datetime.now(timezone.utc)
        )

        try:
            # 1. Read CSV
            print(f"\n[LocalFileProcessor] Reading {file_path}...")
            csv_content = file_path.read_text(encoding="utf-8")

            # 2. Parse CSV
            startups = self._parse_csv(csv_content)
            report.total_rows = len(startups)
            print(f"[LocalFileProcessor] Found {len(startups)} startups")

            # 3. Process
            batch_result = await self.delta_processor.process_csv_batch(
                startups,
                skip_crawl=False
            )

            # 4. Update report
            report.new_startups = batch_result.new_created
            report.updated_startups = batch_result.updated
            report.unchanged_startups = batch_result.skipped
            report.errors = batch_result.errors
            report.processing_time_ms = batch_result.processing_time_ms
            report.status = "completed"

        except Exception as e:
            import traceback
            traceback.print_exc()
            report.status = "failed"
            report.error_message = str(e)

        report.completed_at = datetime.now(timezone.utc)
        return report

    def _parse_csv(self, csv_content: str) -> List[StartupInput]:
        """Parse CSV content to StartupInput objects."""
        startups = []
        reader = csv.DictReader(io.StringIO(csv_content))

        for row in reader:
            try:
                startup = StartupInput.from_csv_row(row)
                if startup.name and startup.name.strip():
                    startups.append(startup)
            except Exception as e:
                print(f"  Warning: Failed to parse row: {e}")
                continue

        return startups
