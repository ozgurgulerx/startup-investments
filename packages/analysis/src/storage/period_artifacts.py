"""Helpers for period-scoped dataset artifacts stored in Blob Storage."""

from __future__ import annotations

import mimetypes
import os
from pathlib import Path
from typing import Iterable, Optional

from src.storage.blob_client import BlobStorageClient, ContainerName


def normalize_region(value: str) -> str:
    raw = str(value or "global").strip().lower()
    if raw in {"tr", "turkey"}:
        return "turkey"
    return "global"


class PeriodArtifactStore:
    """Read/write the canonical period dataset tree from Azure Blob Storage."""

    def __init__(self, client: Optional[BlobStorageClient] = None):
        self.client = client or BlobStorageClient()

    def is_available(self) -> bool:
        return self.client.is_configured and self.client.get_container(ContainerName.PERIODS) is not None

    def period_prefix(self, period: str, region: str = "global") -> str:
        normalized_region = normalize_region(region)
        if normalized_region == "turkey":
            return f"tr/{period}".strip("/")
        return str(period).strip("/")

    def relative_blob_path(self, period: str, relative_path: str | Path, region: str = "global") -> str:
        rel = str(relative_path).strip().lstrip("/")
        return f"{self.period_prefix(period, region)}/{rel}"

    def list_periods(self, region: str = "global") -> list[str]:
        if not self.is_available():
            return []
        normalized_region = normalize_region(region)
        prefix = "tr/" if normalized_region == "turkey" else ""
        periods: set[str] = set()
        for blob in self.client.list_blobs(ContainerName.PERIODS, prefix=prefix):
            name = str(blob.get("name") or "")
            if not name:
                continue
            if normalized_region == "turkey":
                parts = name.split("/")
                if len(parts) >= 2:
                    candidate = parts[1]
                else:
                    continue
            else:
                candidate = name.split("/", 1)[0]
            if len(candidate) == 7 and candidate[4] == "-":
                periods.add(candidate)
        return sorted(periods, reverse=True)

    def latest_period(self, region: str = "global") -> str:
        periods = self.list_periods(region=region)
        return periods[0] if periods else ""

    def upload_file(self, period: str, local_path: Path, relative_path: str | Path, *, region: str = "global") -> None:
        if not local_path.exists():
            return
        blob_path = self.relative_blob_path(period, relative_path, region=region)
        content_type = mimetypes.guess_type(str(local_path))[0] or "application/octet-stream"
        self.client.upload_blob(
            ContainerName.PERIODS,
            blob_path,
            local_path.read_bytes(),
            content_type=content_type,
        )

    def upload_tree(
        self,
        period: str,
        source_root: Path,
        *,
        region: str = "global",
        include_prefixes: Optional[Iterable[str]] = None,
    ) -> int:
        if not source_root.exists():
            return 0
        normalized_prefixes = tuple(
            str(prefix).strip("/").replace("\\", "/")
            for prefix in (include_prefixes or ("input", "output"))
        )
        uploaded = 0
        for file_path in sorted(path for path in source_root.rglob("*") if path.is_file()):
            relative_path = file_path.relative_to(source_root).as_posix()
            if normalized_prefixes and not relative_path.startswith(normalized_prefixes):
                continue
            self.upload_file(period, file_path, relative_path, region=region)
            uploaded += 1
        return uploaded

    def download_tree(
        self,
        period: str,
        target_root: Path,
        *,
        region: str = "global",
        include_prefixes: Optional[Iterable[str]] = None,
    ) -> int:
        if not self.is_available():
            return 0
        target_root.mkdir(parents=True, exist_ok=True)
        normalized_prefixes = tuple(
            str(prefix).strip("/").replace("\\", "/")
            for prefix in (include_prefixes or ("input", "output"))
        )
        prefix = f"{self.period_prefix(period, region)}/"
        downloaded = 0
        for blob in self.client.list_blobs(ContainerName.PERIODS, prefix=prefix):
            blob_name = str(blob.get("name") or "")
            if not blob_name or blob_name.endswith("/"):
                continue
            relative_path = blob_name[len(prefix):]
            if normalized_prefixes and not relative_path.startswith(normalized_prefixes):
                continue
            data = self.client.download_blob(ContainerName.PERIODS, blob_name)
            if data is None:
                continue
            target_path = target_root / relative_path
            target_path.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(data, str):
                target_path.write_text(data, encoding="utf-8")
            else:
                target_path.write_bytes(data)
            downloaded += 1
        return downloaded

    def download_relative_file(
        self,
        period: str,
        relative_path: str | Path,
        target_path: Path,
        *,
        region: str = "global",
    ) -> bool:
        blob_path = self.relative_blob_path(period, relative_path, region=region)
        data = self.client.download_blob(ContainerName.PERIODS, blob_path)
        if data is None:
            return False
        target_path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(data, str):
            target_path.write_text(data, encoding="utf-8")
        else:
            target_path.write_bytes(data)
        return True

    def upload_analysis_store_file(
        self,
        period: str,
        relative_store_path: str | Path,
        local_path: Path,
        *,
        region: str = "global",
    ) -> None:
        self.upload_file(period, local_path, Path("output") / "analysis_store" / Path(relative_store_path), region=region)

    @classmethod
    def from_env(cls) -> Optional["PeriodArtifactStore"]:
        enabled = str(os.getenv("BUILDATLAS_ARTIFACT_BLOB_MIRROR", "")).strip().lower()
        if enabled not in {"1", "true", "yes", "on"}:
            return None
        store = cls()
        return store if store.is_available() else None
