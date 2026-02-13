"""WARC-lite raw capture recorder (blob body + DB envelope metadata)."""

from __future__ import annotations

import base64
import gzip
import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from src.config import settings
from src.storage.blob_client import BlobStorageClient, ContainerName


@dataclass
class RawCaptureRecord:
    startup_slug: str
    canonical_url: str
    domain: str
    request_method: str
    request_headers: Dict[str, str]
    response_headers: Dict[str, str]
    status_code: int
    final_url: str
    content_type: str
    content_length: int
    fetch_method: str
    provider: str
    proxy_tier: str
    blocked_detected: bool
    error_category: Optional[str]
    latency_ms: int


class RawCaptureRecorder:
    def __init__(self, frontier):
        self.frontier = frontier
        self.blob_client = BlobStorageClient()
        self._blob_upload_disabled = False
        self._blob_upload_disabled_reason: Optional[str] = None

    @property
    def enabled(self) -> bool:
        return bool(settings.crawler.raw_capture_enabled)

    @staticmethod
    def _decode_body(body: str, encoding: str) -> bytes:
        if not body:
            return b""
        if encoding == "base64":
            try:
                return base64.b64decode(body)
            except Exception:
                return b""
        return body.encode("utf-8", errors="ignore")

    def _upload_body(self, domain: str, body: bytes, metadata: Dict[str, str]) -> Optional[str]:
        if not body:
            return None
        if self._blob_upload_disabled:
            return None

        now = datetime.now(timezone.utc)
        sha256 = hashlib.sha256(body).hexdigest()
        blob_path = (
            f"raw-captures/{now.strftime('%Y/%m/%d')}/{domain}/{sha256}.bin.gz"
        )
        payload = gzip.compress(body)

        url = self.blob_client.upload_blob(
            container=ContainerName.CRAWL_SNAPSHOTS,
            blob_path=blob_path,
            data=payload,
            content_type="application/gzip",
            metadata=metadata,
            overwrite=False,
        )
        if url:
            return blob_path

        # Fail-open behavior: if blob auth is broken, keep crawl metadata flowing
        # and suppress repeated noisy upload errors for the rest of the worker run.
        last_error = str(getattr(self.blob_client, "last_error", "") or "")
        if last_error and any(
            token in last_error
            for token in (
                "AuthorizationFailure",
                "AuthorizationPermissionMismatch",
                "AuthenticationFailed",
                "KeyBasedAuthenticationNotPermitted",
            )
        ):
            if not self._blob_upload_disabled:
                self._blob_upload_disabled = True
                self._blob_upload_disabled_reason = last_error[:240]
                print(
                    "[raw-capture] disabling blob upload for this run due to auth error: "
                    f"{self._blob_upload_disabled_reason}"
                )
        return None

    async def save_from_doc(self, startup_slug: str, doc: Dict[str, Any]) -> Optional[str]:
        if not self.enabled:
            return None
        if not self.frontier.enabled or not getattr(self.frontier, "pool", None):
            return None

        raw = doc.get("raw_capture") or {}
        body_text = raw.get("response_body") or ""
        encoding = raw.get("response_body_encoding") or "utf-8"
        body_bytes = self._decode_body(body_text, encoding)
        max_bytes = max(0, int(settings.crawler.raw_capture_max_body_bytes))
        if max_bytes > 0 and len(body_bytes) > max_bytes:
            body_bytes = body_bytes[:max_bytes]

        domain = str(doc.get("domain") or "")
        canonical_url = str(doc.get("canonical_url") or doc.get("url") or "")

        body_sha256 = hashlib.sha256(body_bytes).hexdigest() if body_bytes else None
        blob_metadata = {
            "canonical_url": canonical_url[:512],
            "domain": domain[:255],
            "fetch_method": str(doc.get("fetch_method") or "http")[:64],
        }
        blob_path = self._upload_body(domain=domain or "unknown", body=body_bytes, metadata=blob_metadata)

        record = RawCaptureRecord(
            startup_slug=startup_slug,
            canonical_url=canonical_url,
            domain=domain,
            request_method=str(raw.get("request_method") or "GET"),
            request_headers=raw.get("request_headers") or {},
            response_headers=raw.get("response_headers") or {},
            status_code=int(doc.get("status_code") or 0),
            final_url=str(doc.get("url") or canonical_url),
            content_type=str(doc.get("content_type") or "html"),
            content_length=len(body_bytes),
            fetch_method=str(doc.get("fetch_method") or "http"),
            provider=str(doc.get("provider") or "none"),
            proxy_tier=str(doc.get("proxy_tier") or "none"),
            blocked_detected=bool(doc.get("blocked_detected", False)),
            error_category=doc.get("error_category"),
            latency_ms=int(doc.get("response_time_ms") or 0),
        )

        async with self.frontier.pool.acquire() as conn:
            capture_id = await conn.fetchval(
                """
                INSERT INTO crawl_raw_captures (
                    startup_slug,
                    canonical_url,
                    domain,
                    request_method,
                    request_headers_json,
                    response_headers_json,
                    status_code,
                    final_url,
                    content_type,
                    content_length,
                    body_blob_path,
                    body_sha256,
                    fetch_method,
                    provider,
                    proxy_tier,
                    blocked_detected,
                    error_category,
                    latency_ms,
                    captured_at
                )
                VALUES (
                    $1, $2, $3, $4,
                    $5::jsonb,
                    $6::jsonb,
                    $7, $8, $9, $10,
                    $11, $12, $13, $14, $15,
                    $16, $17, $18, NOW()
                )
                RETURNING id
                """,
                record.startup_slug,
                record.canonical_url,
                record.domain,
                record.request_method,
                json.dumps(record.request_headers),
                json.dumps(record.response_headers),
                record.status_code,
                record.final_url,
                record.content_type,
                record.content_length,
                blob_path,
                body_sha256,
                record.fetch_method,
                record.provider,
                record.proxy_tier,
                record.blocked_detected,
                record.error_category,
                record.latency_ms,
            )

        return str(capture_id) if capture_id else None
