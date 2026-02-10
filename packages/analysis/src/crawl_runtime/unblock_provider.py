"""Managed unblock/render provider abstractions."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

import httpx


BLOCK_MARKERS = [
    "cf-browser-verification",
    "cloudflare",
    "attention required",
    "captcha",
    "are you human",
    "access denied",
    "request unsuccessful",
    "verify you are human",
]


@dataclass
class UnblockRequest:
    url: str
    headers: Dict[str, str]
    timeout_ms: int = 45000
    wait_until: str = "domcontentloaded"


@dataclass
class UnblockResult:
    status_code: int
    final_url: str
    headers: Dict[str, str]
    html: str
    latency_ms: int
    provider: str
    blocked_detected: bool = False


class UnblockProvider:
    async def fetch(self, request: UnblockRequest) -> UnblockResult:  # pragma: no cover - interface
        raise NotImplementedError


def is_probably_blocked(status_code: int, html: str) -> bool:
    if status_code in {401, 403, 406, 409, 429, 451, 503}:
        return True
    lower = (html or "").lower()
    return any(marker in lower for marker in BLOCK_MARKERS)


def _normalize_endpoint(endpoint: str) -> str:
    endpoint = (endpoint or "").strip().rstrip("/")
    if not endpoint:
        return ""

    parsed = urlparse(endpoint)
    scheme = parsed.scheme
    if scheme == "wss":
        scheme = "https"
    elif scheme == "ws":
        scheme = "http"
    elif not scheme:
        scheme = "https"

    netloc = parsed.netloc or parsed.path
    path = parsed.path if parsed.netloc else ""
    if not path.endswith("/content"):
        path = f"{path.rstrip('/')}/content"

    return urlunparse((scheme, netloc, path, "", "", ""))


def _append_query(base_url: str, extra_params: Dict[str, str]) -> str:
    parsed = urlparse(base_url)
    existing = dict(parse_qsl(parsed.query, keep_blank_values=True))
    existing.update({k: v for k, v in extra_params.items() if v})
    query = urlencode(existing)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, parsed.params, query, parsed.fragment))


class BrowserlessUnblockProvider(UnblockProvider):
    """Browserless /content adapter.

    Expects endpoint in one of these forms:
    - https://production-sfo.browserless.io
    - https://production-sfo.browserless.io/content
    - wss://production-sfo.browserless.io (converted to https)
    """

    def __init__(self, endpoint: str, token: str = ""):
        self.endpoint = _normalize_endpoint(endpoint)
        self.token = (token or "").strip()

    @property
    def is_configured(self) -> bool:
        return bool(self.endpoint)

    async def fetch(self, request: UnblockRequest) -> UnblockResult:
        if not self.endpoint:
            raise RuntimeError("Browserless endpoint is not configured")

        url = self.endpoint
        if self.token:
            url = _append_query(url, {"token": self.token})

        payload: Dict[str, Any] = {
            "url": request.url,
            "gotoOptions": {
                "waitUntil": request.wait_until,
                "timeout": int(max(1000, request.timeout_ms)),
            },
            "setExtraHTTPHeaders": request.headers or {},
        }

        timeout = max(1.0, float(request.timeout_ms) / 1000.0)
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.post(url, json=payload)

        response_headers = {k: v for k, v in resp.headers.items()}
        html = resp.text or ""
        return UnblockResult(
            status_code=int(resp.status_code),
            final_url=str(resp.url),
            headers=response_headers,
            html=html,
            latency_ms=0,
            provider="browserless",
            blocked_detected=is_probably_blocked(int(resp.status_code), html),
        )


class StealthPlaywrightUnblockProvider(UnblockProvider):
    """Local Playwright + stealth patches for anti-bot evasion.

    Launches headless Chromium per-request with stealth evasion applied.
    Suitable for low-volume unblocking (~5-10 pages per batch) where
    Browserless is unavailable or unneeded.
    """

    def __init__(self, headless: bool = True, timeout_ms: int = 45000):
        self.headless = headless
        self.default_timeout_ms = timeout_ms

    @property
    def is_configured(self) -> bool:
        try:
            import playwright  # noqa: F401
            return True
        except ImportError:
            return False

    async def fetch(self, request: UnblockRequest) -> UnblockResult:
        import time
        from playwright.async_api import async_playwright

        try:
            from playwright_stealth import Stealth
        except ImportError:
            Stealth = None  # type: ignore[assignment,misc]

        start = time.monotonic()
        timeout_ms = max(5000, request.timeout_ms or self.default_timeout_ms)

        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=self.headless)
            context = await browser.new_context(
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/131.0.0.0 Safari/537.36"
                ),
                viewport={"width": 1920, "height": 1080},
                locale="en-US",
                timezone_id="America/New_York",
            )

            if Stealth is not None:
                stealth = Stealth(init_scripts_only=True)
                await stealth.apply_stealth_async(context)

            page = await context.new_page()

            if request.headers:
                await page.set_extra_http_headers(request.headers)

            status_code = 0
            try:
                response = await page.goto(
                    request.url,
                    wait_until=request.wait_until or "domcontentloaded",
                    timeout=timeout_ms,
                )
                status_code = response.status if response else 0
                await page.wait_for_timeout(1500)
            except Exception:
                pass

            html = await page.content()
            final_url = page.url

            await context.close()
            await browser.close()

        latency_ms = int((time.monotonic() - start) * 1000)
        return UnblockResult(
            status_code=status_code,
            final_url=final_url,
            headers={},
            html=html,
            latency_ms=latency_ms,
            provider="stealth",
            blocked_detected=is_probably_blocked(status_code, html),
        )


def build_unblock_provider(provider_name: str, endpoint: str = "", token: str = "") -> Optional[UnblockProvider]:
    name = (provider_name or "").strip().lower()
    if name == "stealth":
        provider = StealthPlaywrightUnblockProvider()
        return provider if provider.is_configured else None
    if name == "browserless":
        provider = BrowserlessUnblockProvider(endpoint=endpoint, token=token)
        return provider if provider.is_configured else None
    return None
