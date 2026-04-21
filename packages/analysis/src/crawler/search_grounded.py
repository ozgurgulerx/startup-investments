"""Search-grounded startup acquisition behind optional feature flags."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Dict, List, Optional, Protocol, Sequence
from urllib.parse import urlparse

try:
    from openai import AsyncAzureOpenAI
except Exception:  # pragma: no cover - optional dependency
    AsyncAzureOpenAI = None  # type: ignore[assignment]

try:
    from azure.identity import DefaultAzureCredential, get_bearer_token_provider
except Exception:  # pragma: no cover - optional dependency
    DefaultAzureCredential = None  # type: ignore[assignment]
    get_bearer_token_provider = None  # type: ignore[assignment]

from src.crawler.url_normalizer import canonicalize_url, extract_domain
from src.data.models import StartupInput
from src.intelligence.evidence_pipeline import CoverageSummary


DEFAULT_DENY_DOMAINS = {
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "x.com",
    "twitter.com",
    "tiktok.com",
}
DEFAULT_TRUSTED_EXTERNALS = {
    "github.com",
    "docs.github.com",
    "crunchbase.com",
    "techcrunch.com",
    "theinformation.com",
    "news.ycombinator.com",
}


@dataclass
class SearchCandidate:
    url: str
    title: str = ""
    snippet: str = ""
    source_domain: str = ""
    confidence: float = 0.0
    source_type: str = "search_grounded"
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class SearchAcquisition:
    url: str
    canonical_url: str
    title: str
    snippet: str
    content: str
    source_type: str = "search_grounded"
    confidence: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)


class SearchProvider(Protocol):
    async def search(self, query: str, max_sources: int) -> List[SearchCandidate]:
        ...


class AzureResponsesSearchProvider:
    """Optional Azure/OpenAI Responses web-search provider."""

    def __init__(self) -> None:
        self.enabled = bool(os.getenv("AZURE_OPENAI_ENDPOINT")) and AsyncAzureOpenAI is not None
        self._client: Optional[AsyncAzureOpenAI] = None
        self._model = (
            os.getenv("AZURE_OPENAI_FAST_DEPLOYMENT_NAME")
            or os.getenv("AZURE_OPENAI_DEPLOYMENT_NAME")
            or "gpt-5-nano"
        )
        self._endpoint = os.getenv("AZURE_OPENAI_ENDPOINT")
        self._api_key = os.getenv("AZURE_OPENAI_API_KEY")
        self._api_version = os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01")
        if self.enabled and self._endpoint:
            if DefaultAzureCredential is not None and get_bearer_token_provider is not None:
                try:
                    credential = DefaultAzureCredential()
                    token_provider = get_bearer_token_provider(
                        credential, "https://cognitiveservices.azure.com/.default"
                    )
                    self._client = AsyncAzureOpenAI(
                        azure_ad_token_provider=token_provider,
                        api_version=self._api_version,
                        azure_endpoint=self._endpoint,
                    )
                except Exception:
                    self._client = None
            if self._client is None and self._api_key:
                self._client = AsyncAzureOpenAI(
                    api_key=self._api_key,
                    api_version=self._api_version,
                    azure_endpoint=self._endpoint,
                )

    async def search(self, query: str, max_sources: int) -> List[SearchCandidate]:
        if not self._client:
            return []
        try:
            response = await self._client.responses.create(
                model=self._model,
                input=query,
                tools=[{"type": "web_search_preview"}],
            )
        except Exception:
            return []
        candidates: List[SearchCandidate] = []
        for item in getattr(response, "output", []) or []:
            for content in getattr(item, "content", []) or []:
                annotations = getattr(content, "annotations", []) or []
                for annotation in annotations:
                    url = getattr(annotation, "url", None)
                    if not url:
                        continue
                    title = getattr(annotation, "title", "") or ""
                    snippet = getattr(content, "text", "") or ""
                    candidates.append(
                        SearchCandidate(
                            url=url,
                            title=title,
                            snippet=str(snippet)[:320],
                            source_domain=extract_domain(url) or "",
                            confidence=0.75,
                            metadata={"provider": "azure_responses"},
                        )
                    )
                    if len(candidates) >= max_sources:
                        return candidates
        return candidates


class DuckDuckGoSearchProvider:
    """Compatibility adapter over the existing DDG HTML search client."""

    def __init__(self, search_fn: Callable[[str, int], Awaitable[List[Dict[str, Any]]]]) -> None:
        self._search_fn = search_fn

    async def search(self, query: str, max_sources: int) -> List[SearchCandidate]:
        rows = await self._search_fn(query, max_sources)
        candidates = []
        for row in rows:
            url = str(row.get("url") or "")
            if not url:
                continue
            candidates.append(
                SearchCandidate(
                    url=url,
                    title=str(row.get("title") or ""),
                    snippet=str(row.get("snippet") or ""),
                    source_domain=extract_domain(url) or "",
                    confidence=0.55,
                    metadata={"provider": "ddg_html"},
                )
            )
        return candidates


def env_flag(name: str, default: bool = False) -> bool:
    raw = str(os.getenv(name, "") or "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "on"}


def parse_domain_list(raw: str) -> set[str]:
    return {
        item.strip().lower()
        for item in str(raw or "").split(",")
        if item.strip()
    }


class SearchGroundedAcquirer:
    """Escalates to search-grounded evidence when site coverage stays weak."""

    def __init__(
        self,
        providers: Sequence[SearchProvider],
        *,
        max_sources: int = 4,
        compliance_mode: str = "balanced",
        allowed_external_domains: Optional[set[str]] = None,
        deny_domains: Optional[set[str]] = None,
    ) -> None:
        self.providers = list(providers)
        self.max_sources = max(1, int(max_sources))
        self.compliance_mode = str(compliance_mode or "balanced").strip().lower()
        self.allowed_external_domains = allowed_external_domains or set()
        self.deny_domains = deny_domains or set(DEFAULT_DENY_DOMAINS)
        self.last_stats: Dict[str, int] = {
            "provider_errors": 0,
            "empty_results": 0,
            "fetch_errors": 0,
            "candidates_considered": 0,
            "acquisitions": 0,
        }

    async def acquire(
        self,
        startup: StartupInput,
        coverage: CoverageSummary,
        fetch_url: Callable[[str], Awaitable[Dict[str, Any]]],
    ) -> List[SearchAcquisition]:
        self.last_stats = {
            "provider_errors": 0,
            "empty_results": 0,
            "fetch_errors": 0,
            "candidates_considered": 0,
            "acquisitions": 0,
        }
        queries = self._queries(startup, coverage)
        candidates: List[SearchCandidate] = []
        for provider in self.providers:
            for query in queries:
                try:
                    results = await provider.search(query, self.max_sources)
                except Exception:
                    self.last_stats["provider_errors"] += 1
                    continue
                if not isinstance(results, list):
                    self.last_stats["provider_errors"] += 1
                    continue
                if not results:
                    self.last_stats["empty_results"] += 1
                candidates.extend(results)
            if candidates:
                break

        ranked = self._rank_candidates(candidates, startup)[: self.max_sources]
        self.last_stats["candidates_considered"] = len(ranked)
        acquisitions: List[SearchAcquisition] = []
        for candidate in ranked:
            if not self._allowed(candidate, startup):
                continue
            try:
                result = await fetch_url(candidate.url)
            except Exception:
                self.last_stats["fetch_errors"] += 1
                continue
            if not result.get("success"):
                self.last_stats["fetch_errors"] += 1
                continue
            content = str(result.get("text") or result.get("html") or "")
            if not content.strip() and not str(candidate.snippet or "").strip():
                self.last_stats["fetch_errors"] += 1
                continue
            acquisitions.append(
                SearchAcquisition(
                    url=candidate.url,
                    canonical_url=canonicalize_url(candidate.url) or candidate.url,
                    title=candidate.title,
                    snippet=candidate.snippet,
                    content=content[:6000] if content else candidate.snippet,
                    confidence=max(candidate.confidence, 0.45 if content else 0.35),
                    metadata={
                        **candidate.metadata,
                        "content_hash": result.get("content_hash"),
                        "fetch_method": result.get("method"),
                    },
                )
            )
        self.last_stats["acquisitions"] = len(acquisitions)
        return acquisitions

    def _queries(self, startup: StartupInput, coverage: CoverageSummary) -> List[str]:
        missing = coverage.missing_fields[:4]
        base = [f"\"{startup.name}\" startup"]
        if startup.website:
            domain = extract_domain(startup.website)
            if domain:
                base.append(f"site:{domain} \"{startup.name}\"")
        if missing:
            base.append(f"\"{startup.name}\" {' '.join(missing)}")
        return list(dict.fromkeys(base))[:3]

    def _rank_candidates(self, candidates: Sequence[SearchCandidate], startup: StartupInput) -> List[SearchCandidate]:
        primary_domain = extract_domain(startup.website or "") or ""

        def _score(candidate: SearchCandidate) -> tuple[float, int]:
            domain = candidate.source_domain or extract_domain(candidate.url) or ""
            score = candidate.confidence
            if domain == primary_domain:
                score += 0.45
            if domain in DEFAULT_TRUSTED_EXTERNALS:
                score += 0.2
            if domain.endswith(".github.com") or domain == "github.com":
                score += 0.15
            return score, -len(candidate.url)

        deduped: Dict[str, SearchCandidate] = {}
        for candidate in candidates:
            canonical = canonicalize_url(candidate.url) or candidate.url
            if canonical not in deduped or _score(candidate) > _score(deduped[canonical]):
                deduped[canonical] = candidate
        return sorted(deduped.values(), key=_score, reverse=True)

    def _allowed(self, candidate: SearchCandidate, startup: StartupInput) -> bool:
        domain = (candidate.source_domain or extract_domain(candidate.url) or "").lower()
        if not domain:
            return False
        if domain in self.deny_domains:
            return False
        if self.allowed_external_domains and domain not in self.allowed_external_domains:
            primary = extract_domain(startup.website or "") or ""
            if domain != primary and not domain.endswith(f".{primary}"):
                return False
        if self.compliance_mode == "strict":
            primary = extract_domain(startup.website or "") or ""
            return domain == primary or domain.endswith(f".{primary}") or domain in DEFAULT_TRUSTED_EXTERNALS
        return True
