"""Durable runtime state helpers for pipeline jobs.

The VM implementation used local files under `/var/lib/buildatlas`. That does
not survive pod restarts or AKS CronJob scheduling, so migrated jobs use this
module to keep small cursor/checkpoint payloads in Postgres and optionally
mirror them to Blob Storage.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Optional

import psycopg2
from psycopg2.extras import Json

from src.storage.blob_client import BlobStorageClient, ContainerName


class RuntimeStateBackend(str, Enum):
    DATABASE = "database"
    FILE = "file"
    NONE = "none"


def _normalize_scope(scope: str) -> str:
    normalized = str(scope or "global").strip().lower()
    return normalized or "global"


def _json_default(value: Any) -> Any:
    if isinstance(value, Path):
        return str(value)
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


@dataclass
class RuntimeStateStore:
    """Small JSON state store for recurring jobs."""

    backend: RuntimeStateBackend = RuntimeStateBackend.DATABASE
    database_url: str = ""
    blob_client: BlobStorageClient | None = None
    mirror_to_blob: bool = False
    fallback_dir: Path | None = None

    def __init__(
        self,
        *,
        backend: RuntimeStateBackend | str | None = None,
        database_url: Optional[str] = None,
        blob_client: Optional[BlobStorageClient] = None,
        mirror_to_blob: Optional[bool] = None,
        fallback_dir: Optional[Path] = None,
    ) -> None:
        raw_backend = str(
            backend
            or os.getenv("PIPELINE_RUNTIME_STATE_BACKEND")
            or RuntimeStateBackend.DATABASE.value
        ).strip().lower()
        if raw_backend not in {member.value for member in RuntimeStateBackend}:
            raw_backend = RuntimeStateBackend.DATABASE.value
        self.backend = RuntimeStateBackend(raw_backend)
        self.database_url = str(database_url or os.getenv("DATABASE_URL") or "").strip()
        self.blob_client = blob_client
        self.mirror_to_blob = (
            bool(mirror_to_blob)
            if mirror_to_blob is not None
            else str(os.getenv("PIPELINE_RUNTIME_STATE_BLOB_MIRROR", "")).strip().lower()
            in {"1", "true", "yes", "on"}
        )
        fallback_root = fallback_dir or Path(os.getenv("BUILDATLAS_STATE_DIR", "/tmp/buildatlas-runtime"))
        self.fallback_dir = fallback_root

    def load(self, job_name: str, *, scope: str = "global", state_key: str = "default") -> Optional[dict[str, Any]]:
        """Load runtime state, returning `None` when no persisted state exists."""
        normalized_scope = _normalize_scope(scope)
        state = None
        if self.backend == RuntimeStateBackend.DATABASE:
            state = self._load_from_database(job_name, normalized_scope, state_key)
        elif self.backend == RuntimeStateBackend.FILE:
            state = self._load_from_file(job_name, normalized_scope, state_key)

        if state is None and self.mirror_to_blob:
            state = self._load_from_blob(job_name, normalized_scope, state_key)

        if state is None and self.backend != RuntimeStateBackend.FILE:
            state = self._load_from_file(job_name, normalized_scope, state_key)
        return state

    def save(
        self,
        job_name: str,
        payload: dict[str, Any],
        *,
        scope: str = "global",
        state_key: str = "default",
    ) -> RuntimeStateBackend:
        """Persist state and return the backend that succeeded."""
        normalized_scope = _normalize_scope(scope)
        saved_backend = RuntimeStateBackend.NONE
        if self.backend == RuntimeStateBackend.DATABASE:
            saved_backend = self._save_to_database(job_name, normalized_scope, state_key, payload)
        if saved_backend == RuntimeStateBackend.NONE:
            saved_backend = self._save_to_file(job_name, normalized_scope, state_key, payload)
        if self.mirror_to_blob:
            self._save_to_blob(job_name, normalized_scope, state_key, payload)
        return saved_backend

    def delete(self, job_name: str, *, scope: str = "global", state_key: str = "default") -> None:
        normalized_scope = _normalize_scope(scope)
        if self.backend == RuntimeStateBackend.DATABASE and self.database_url:
            try:
                with psycopg2.connect(self.database_url) as conn:
                    with conn.cursor() as cur:
                        cur.execute(
                            """
                            DELETE FROM pipeline_runtime_state
                            WHERE job_name = %s AND scope = %s AND state_key = %s
                            """,
                            (job_name, normalized_scope, state_key),
                        )
            except Exception:
                pass
        file_path = self._fallback_path(job_name, normalized_scope, state_key)
        try:
            file_path.unlink(missing_ok=True)
        except Exception:
            pass

    def _blob_path(self, job_name: str, scope: str, state_key: str) -> str:
        return f"runtime-state/{job_name}/{scope}/{state_key}.json"

    def _fallback_path(self, job_name: str, scope: str, state_key: str) -> Path:
        fallback_dir = self.fallback_dir or Path("/tmp/buildatlas-runtime")
        return fallback_dir / job_name / scope / f"{state_key}.json"

    def _load_from_database(self, job_name: str, scope: str, state_key: str) -> Optional[dict[str, Any]]:
        if not self.database_url:
            return None
        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        SELECT state_json
                        FROM pipeline_runtime_state
                        WHERE job_name = %s AND scope = %s AND state_key = %s
                        """,
                        (job_name, scope, state_key),
                    )
                    row = cur.fetchone()
        except Exception:
            return None

        if not row:
            return None
        state = row[0]
        if isinstance(state, str):
            try:
                return json.loads(state)
            except Exception:
                return None
        if isinstance(state, dict):
            return state
        return None

    def _save_to_database(
        self,
        job_name: str,
        scope: str,
        state_key: str,
        payload: dict[str, Any],
    ) -> RuntimeStateBackend:
        if not self.database_url:
            return RuntimeStateBackend.NONE
        try:
            with psycopg2.connect(self.database_url) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO pipeline_runtime_state (job_name, scope, state_key, state_json, updated_at)
                        VALUES (%s, %s, %s, %s, NOW())
                        ON CONFLICT (job_name, scope, state_key)
                        DO UPDATE SET state_json = EXCLUDED.state_json, updated_at = NOW()
                        """,
                        (job_name, scope, state_key, Json(payload, dumps=lambda value: json.dumps(value, default=_json_default))),
                    )
            return RuntimeStateBackend.DATABASE
        except Exception:
            return RuntimeStateBackend.NONE

    def _load_from_file(self, job_name: str, scope: str, state_key: str) -> Optional[dict[str, Any]]:
        file_path = self._fallback_path(job_name, scope, state_key)
        if not file_path.exists():
            return None
        try:
            return json.loads(file_path.read_text(encoding="utf-8"))
        except Exception:
            return None

    def _save_to_file(
        self,
        job_name: str,
        scope: str,
        state_key: str,
        payload: dict[str, Any],
    ) -> RuntimeStateBackend:
        file_path = self._fallback_path(job_name, scope, state_key)
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.write_text(
                json.dumps(payload, indent=2, default=_json_default) + "\n",
                encoding="utf-8",
            )
            return RuntimeStateBackend.FILE
        except Exception:
            return RuntimeStateBackend.NONE

    def _load_from_blob(self, job_name: str, scope: str, state_key: str) -> Optional[dict[str, Any]]:
        client = self.blob_client or BlobStorageClient()
        if not client.is_configured:
            return None
        return client.download_json(
            ContainerName.PERIODS,
            self._blob_path(job_name, scope, state_key),
        )

    def _save_to_blob(self, job_name: str, scope: str, state_key: str, payload: dict[str, Any]) -> None:
        client = self.blob_client or BlobStorageClient()
        if not client.is_configured:
            return
        try:
            client.upload_json(
                ContainerName.PERIODS,
                self._blob_path(job_name, scope, state_key),
                payload,
            )
        except Exception:
            pass
