"""Minimal X API client for trend ingest + automated posting.

Supports:
- Recent search (app/bearer auth)
- Tweet publish (OAuth 1.0a user context)
- Tweet metrics fetch (bearer auth)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional, Sequence
from urllib.parse import parse_qsl, quote, urlencode, urlparse, urlunparse

import httpx


def _pct(value: Any) -> str:
    return quote(str(value), safe="~-._")


def _normalized_params(params: Iterable[tuple[str, Any]]) -> str:
    encoded: list[tuple[str, str]] = [(_pct(k), _pct(v)) for k, v in params]
    encoded.sort(key=lambda x: (x[0], x[1]))
    return "&".join(f"{k}={v}" for k, v in encoded)


def _oauth_signature(
    *,
    method: str,
    url: str,
    oauth_params: Dict[str, Any],
    query_params: Optional[Dict[str, Any]] = None,
    body_form_params: Optional[Dict[str, Any]] = None,
    consumer_secret: str,
    token_secret: str,
) -> str:
    parsed = urlparse(url)
    base_url = urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "", ""))

    params: list[tuple[str, Any]] = []
    params.extend(parse_qsl(parsed.query, keep_blank_values=True))
    if query_params:
        params.extend(query_params.items())
    if body_form_params:
        params.extend(body_form_params.items())
    params.extend(oauth_params.items())

    normalized = _normalized_params(params)
    base_string = "&".join(
        [
            method.upper(),
            _pct(base_url),
            _pct(normalized),
        ]
    )
    key = f"{_pct(consumer_secret)}&{_pct(token_secret)}"
    digest = hmac.new(key.encode("utf-8"), base_string.encode("utf-8"), hashlib.sha1).digest()
    return base64.b64encode(digest).decode("ascii")


@dataclass
class XApiError(RuntimeError):
    message: str
    status_code: int = 0
    payload: Dict[str, Any] | None = None

    def __str__(self) -> str:
        if self.status_code:
            return f"{self.message} (http={self.status_code})"
        return self.message


class XClient:
    """X API helper with search + posting support."""

    def __init__(self):
        self.api_base = (os.getenv("X_API_BASE_URL", "https://api.x.com").rstrip("/") or "https://api.x.com")
        self.bearer_token = (os.getenv("X_API_BEARER_TOKEN", "") or "").strip()
        self.consumer_key = (os.getenv("X_API_KEY", "") or "").strip()
        self.consumer_secret = (os.getenv("X_API_SECRET", "") or "").strip()
        self.access_token = (os.getenv("X_ACCESS_TOKEN", "") or "").strip()
        self.access_token_secret = (os.getenv("X_ACCESS_TOKEN_SECRET", "") or "").strip()
        self.timeout_sec = max(5, int(os.getenv("X_API_TIMEOUT_SEC", "25")))

    @property
    def search_enabled(self) -> bool:
        return bool(self.bearer_token)

    @property
    def posting_enabled(self) -> bool:
        return bool(
            self.consumer_key
            and self.consumer_secret
            and self.access_token
            and self.access_token_secret
        )

    @staticmethod
    def _iso_utc(dt: datetime) -> str:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        else:
            dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

    def _oauth1_header(
        self,
        *,
        method: str,
        url: str,
        query_params: Optional[Dict[str, Any]] = None,
        body_form_params: Optional[Dict[str, Any]] = None,
    ) -> str:
        if not self.posting_enabled:
            raise XApiError("X posting credentials are not configured")

        oauth_params = {
            "oauth_consumer_key": self.consumer_key,
            "oauth_nonce": uuid.uuid4().hex,
            "oauth_signature_method": "HMAC-SHA1",
            "oauth_timestamp": str(int(time.time())),
            "oauth_token": self.access_token,
            "oauth_version": "1.0",
        }
        signature = _oauth_signature(
            method=method,
            url=url,
            oauth_params=oauth_params,
            query_params=query_params,
            body_form_params=body_form_params,
            consumer_secret=self.consumer_secret,
            token_secret=self.access_token_secret,
        )
        oauth_params["oauth_signature"] = signature

        parts = [f'{_pct(k)}="{_pct(v)}"' for k, v in sorted(oauth_params.items())]
        return "OAuth " + ", ".join(parts)

    def _bearer_headers(self) -> Dict[str, str]:
        if not self.search_enabled:
            raise XApiError("X_API_BEARER_TOKEN is not configured")
        return {"Authorization": f"Bearer {self.bearer_token}"}

    async def search_recent(
        self,
        *,
        client: httpx.AsyncClient,
        query: str,
        start_time: datetime,
        max_results: int = 25,
        next_token: str = "",
    ) -> Dict[str, Any]:
        """Call /2/tweets/search/recent."""
        if not self.search_enabled:
            return {}

        params: Dict[str, str] = {
            "query": query,
            "max_results": str(max(10, min(100, int(max_results)))),
            "start_time": self._iso_utc(start_time),
            "expansions": "author_id",
            "tweet.fields": "author_id,created_at,lang,public_metrics,source,entities",
            "user.fields": "username,name,verified,public_metrics",
        }
        if next_token:
            params["next_token"] = next_token

        url = f"{self.api_base}/2/tweets/search/recent"
        resp = await client.get(
            url,
            params=params,
            headers=self._bearer_headers(),
            timeout=self.timeout_sec,
        )
        if resp.status_code >= 400:
            payload: Dict[str, Any]
            try:
                payload = resp.json()
            except Exception:
                payload = {"text": resp.text[:300]}
            raise XApiError(
                "x_search_recent_failed",
                status_code=resp.status_code,
                payload=payload,
            )
        return resp.json() or {}

    async def post_tweet(
        self,
        *,
        text: str,
        reply_to_tweet_id: str = "",
        dry_run: bool = False,
        client: Optional[httpx.AsyncClient] = None,
    ) -> Dict[str, Any]:
        """Publish a tweet through /2/tweets."""
        body: Dict[str, Any] = {"text": (text or "").strip()}
        if reply_to_tweet_id:
            body["reply"] = {"in_reply_to_tweet_id": reply_to_tweet_id}

        if dry_run:
            return {"dry_run": True, "data": {"id": "dry-run", "text": body["text"]}}

        if not self.posting_enabled:
            raise XApiError("X posting credentials are not configured")

        url = f"{self.api_base}/2/tweets"
        auth_header = self._oauth1_header(method="POST", url=url)
        headers = {
            "Authorization": auth_header,
            "Content-Type": "application/json; charset=utf-8",
        }

        owns_client = client is None
        if client is None:
            client = httpx.AsyncClient(timeout=self.timeout_sec)
        try:
            resp = await client.post(url, headers=headers, json=body)
        finally:
            if owns_client:
                await client.aclose()

        if resp.status_code >= 400:
            payload: Dict[str, Any]
            try:
                payload = resp.json()
            except Exception:
                payload = {"text": resp.text[:300]}
            raise XApiError(
                "x_post_tweet_failed",
                status_code=resp.status_code,
                payload=payload,
            )
        return resp.json() or {}

    async def fetch_tweet_metrics(
        self,
        *,
        client: httpx.AsyncClient,
        tweet_ids: Sequence[str],
    ) -> Dict[str, Dict[str, Any]]:
        """Fetch public/non-public metrics for published tweets."""
        ids = [str(tid).strip() for tid in tweet_ids if str(tid).strip()]
        if not ids:
            return {}
        if not self.search_enabled:
            return {}

        out: Dict[str, Dict[str, Any]] = {}
        for idx in range(0, len(ids), 100):
            chunk = ids[idx: idx + 100]
            url = f"{self.api_base}/2/tweets"
            params = {
                "ids": ",".join(chunk),
                "tweet.fields": "created_at,public_metrics,organic_metrics,non_public_metrics",
            }
            resp = await client.get(
                url,
                params=params,
                headers=self._bearer_headers(),
                timeout=self.timeout_sec,
            )
            if resp.status_code >= 400:
                continue
            body = resp.json() or {}
            for row in body.get("data") or []:
                tid = str(row.get("id") or "")
                if not tid:
                    continue
                metrics: Dict[str, Any] = {}
                for key in ("public_metrics", "organic_metrics", "non_public_metrics"):
                    obj = row.get(key)
                    if isinstance(obj, dict):
                        metrics.update(obj)
                out[tid] = {
                    "id": tid,
                    "created_at": row.get("created_at"),
                    "metrics": metrics,
                }
        return out

    @staticmethod
    def build_post_url(post_id: str) -> str:
        pid = (post_id or "").strip()
        if not pid:
            return ""
        return f"https://x.com/i/web/status/{pid}"


def append_utm(url: str, *, source: str, medium: str, campaign: str) -> str:
    """Append UTM params to BuildAtlas links."""
    raw = (url or "").strip()
    if not raw:
        return raw
    parsed = urlparse(raw)
    query_items = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query_items["utm_source"] = source
    query_items["utm_medium"] = medium
    query_items["utm_campaign"] = campaign
    new_query = urlencode(query_items)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, new_query, parsed.fragment))
