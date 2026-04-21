"""Field-driven evidence extraction, coverage scoring, and change detection."""

from __future__ import annotations

import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

from pydantic import BaseModel, Field

from src.crawler.url_normalizer import canonicalize_url, extract_domain
from src.data.models import StartupInput, company_slug, company_slug_variants


EXTRACTOR_VERSION = "schema-v1"
KNOWN_PAGE_TYPES = {
    "homepage",
    "pricing",
    "docs",
    "api",
    "about",
    "team",
    "careers",
    "security",
    "customers",
    "case_studies",
    "blog",
    "changelog",
    "integrations",
    "github",
    "news",
    "youtube",
    "search_grounded",
    "unknown",
}
CHANGE_RELEVANT_FIELDS = {
    "one_line_summary",
    "detailed_product_summary",
    "category_vertical",
    "icp_buyer",
    "team",
    "hq_geography",
    "founded_year",
    "pricing_presence",
    "pricing_plan_details",
    "funding_total",
    "latest_round",
    "funding_stage",
    "investors",
    "docs_api_presence",
    "integrations_ecosystem_signals",
    "security_compliance_signals",
    "hiring_signals",
    "tech_stack_signals",
    "recent_change_signals",
}
PROMOTION_KEY_FIELDS = {
    "one_line_summary",
    "detailed_product_summary",
    "category_vertical",
    "icp_buyer",
    "team",
    "pricing_presence",
    "pricing_plan_details",
    "docs_api_presence",
    "integrations_ecosystem_signals",
    "security_compliance_signals",
    "tech_stack_signals",
}
FIRST_PARTY_SOURCE_TYPES = {"website", "docs", "api", "github", "startup_record"}
LOW_QUALITY_EXTERNAL_SOURCE_TYPES = {"search_grounded", "news", "unknown", "youtube"}
SOURCE_TYPE_TTLS_DAYS: Dict[str, int] = {
    "website": 14,
    "docs": 7,
    "api": 7,
    "blog": 3,
    "changelog": 2,
    "github": 7,
    "news": 2,
    "search_grounded": 7,
    "youtube": 14,
    "unknown": 14,
}
INTEGRATION_HINTS = {
    "slack",
    "salesforce",
    "hubspot",
    "zapier",
    "snowflake",
    "github",
    "jira",
    "notion",
    "shopify",
    "segment",
    "bigquery",
}
TECH_STACK_HINTS = {
    "python",
    "typescript",
    "javascript",
    "react",
    "next.js",
    "postgres",
    "kubernetes",
    "docker",
    "graphql",
    "rest api",
    "sdk",
    "terraform",
    "spark",
    "airflow",
}
SECURITY_HINTS = {
    "soc 2",
    "iso 27001",
    "hipaa",
    "gdpr",
    "sso",
    "saml",
    "audit log",
    "encryption",
    "pentest",
    "vanta",
}
HIRING_HINTS = {
    "engineer",
    "developer",
    "product manager",
    "designer",
    "sales",
    "solutions engineer",
    "machine learning",
    "research scientist",
    "account executive",
}
BUYER_ROLE_HINTS = {
    "developer",
    "engineer",
    "security team",
    "revenue team",
    "finance team",
    "legal team",
    "marketing team",
    "operations team",
    "sales team",
    "data team",
    "it team",
}


def _slugify(name: str) -> str:
    return company_slug(name)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _short_text(value: str, limit: int = 320) -> str:
    cleaned = " ".join(str(value or "").split())
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[: limit - 3].rstrip() + "..."


def _sentence_candidates(text: str) -> List[str]:
    normalized = re.sub(r"\s+", " ", str(text or "")).strip()
    if not normalized:
        return []
    parts = re.split(r"(?<=[.!?])\s+", normalized)
    return [part.strip() for part in parts if len(part.strip()) >= 24]


def _line_candidates(text: str) -> List[str]:
    return [line.strip(" -*") for line in str(text or "").splitlines() if len(line.strip(" -*")) >= 3]


def _first_matching_sentence(text: str, patterns: Sequence[str]) -> Optional[str]:
    lowered_patterns = [pattern.lower() for pattern in patterns]
    for sentence in _sentence_candidates(text):
        lowered = sentence.lower()
        if any(pattern in lowered for pattern in lowered_patterns):
            return _short_text(sentence, 360)
    return None


def _normalize_value(value: Any) -> str:
    if isinstance(value, list):
        return "|".join(sorted(str(item).strip().lower() for item in value if str(item).strip()))
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    return str(value or "").strip().lower()


class RequiredFieldDefinition(BaseModel):
    field_name: str
    weight: float = 1.0
    discoverable: bool = True


class SourceDocument(BaseModel):
    source_url: str
    canonical_url: str
    source_type: str = "website"
    page_type: str = "unknown"
    title: str = ""
    content: str = ""
    snippet: str = ""
    fetched_at: Optional[datetime] = None
    content_hash: Optional[str] = None
    extractor_type: str = "crawler"
    extractor_version: str = EXTRACTOR_VERSION
    confidence: float = 0.0
    locator: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class FieldObservation(BaseModel):
    field_name: str
    value: Any
    source_url: str
    canonical_url: str
    source_type: str
    page_type: str
    fetched_at: Optional[datetime] = None
    content_hash: Optional[str] = None
    snippet: str = ""
    extractor_type: str = "deterministic"
    extractor_version: str = EXTRACTOR_VERSION
    confidence: float = 0.0
    locator: Dict[str, Any] = Field(default_factory=dict)
    metadata: Dict[str, Any] = Field(default_factory=dict)

    @property
    def normalized_value(self) -> str:
        return _normalize_value(self.value)


class ClaimEvidence(BaseModel):
    source_url: str
    canonical_url: str
    source_type: str
    page_type: str
    fetched_at: Optional[datetime] = None
    content_hash: Optional[str] = None
    snippet: str = ""
    extractor_type: str = "deterministic"
    extractor_version: str = EXTRACTOR_VERSION
    confidence: float = 0.0


class StartupClaim(BaseModel):
    claim_type: str
    value: Any
    normalized_value: str = ""
    confidence: float = 0.0
    thesis: str = ""
    contradiction_state: str = "none"
    evidence: List[ClaimEvidence] = Field(default_factory=list)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class FieldCoverageStatus(BaseModel):
    field_name: str
    covered: bool
    confidence: float = 0.0
    evidence_count: int = 0
    value: Any = None
    discoverable: bool = True
    reason: str = ""
    evidence_urls: List[str] = Field(default_factory=list)


class CoverageSummary(BaseModel):
    covered_fields: int = 0
    total_fields: int = 0
    field_coverage_score: float = 0.0
    evidence_quality_score: float = 0.0
    coverage_score: float = 0.0
    threshold: float = 0.72
    meets_threshold: bool = False
    missing_fields: List[str] = Field(default_factory=list)
    statuses: Dict[str, FieldCoverageStatus] = Field(default_factory=dict)


class StartupEvidenceBundle(BaseModel):
    startup_name: str
    startup_slug: str
    documents: List[SourceDocument] = Field(default_factory=list)
    observations: List[FieldObservation] = Field(default_factory=list)
    claims: List[StartupClaim] = Field(default_factory=list)
    coverage: CoverageSummary = Field(default_factory=CoverageSummary)
    analysis_context: str = ""
    open_questions: List[str] = Field(default_factory=list)
    contradictions: List[str] = Field(default_factory=list)
    needs_search_grounded_fallback: bool = False
    needs_agentic_fallback: bool = False
    source_type_counts: Dict[str, int] = Field(default_factory=dict)
    page_type_counts: Dict[str, int] = Field(default_factory=dict)


class DocumentChange(BaseModel):
    canonical_url: str
    change_type: str
    previous_hash: Optional[str] = None
    current_hash: Optional[str] = None


class ChangeDetectionResult(BaseModel):
    document_changes: List[DocumentChange] = Field(default_factory=list)
    field_changes: List[str] = Field(default_factory=list)
    stale_source_types: List[str] = Field(default_factory=list)
    requires_reanalysis: bool = False


class ResearchCitation(BaseModel):
    source_url: str
    source_type: str
    page_type: str
    snippet: str


class ResearchClaim(BaseModel):
    claim_type: str
    statement: str
    confidence: float
    citations: List[ResearchCitation] = Field(default_factory=list)


class StructuredResearchOutput(BaseModel):
    thesis: str
    key_claims: List[ResearchClaim] = Field(default_factory=list)
    supporting_evidence: List[ResearchCitation] = Field(default_factory=list)
    contradictions: List[str] = Field(default_factory=list)
    confidence: float = 0.0
    open_questions: List[str] = Field(default_factory=list)
    citations: List[ResearchCitation] = Field(default_factory=list)
    research_output_markdown: str = ""


REQUIRED_FIELDS: List[RequiredFieldDefinition] = [
    RequiredFieldDefinition(field_name="canonical_name", weight=0.6, discoverable=True),
    RequiredFieldDefinition(field_name="website", weight=0.6, discoverable=True),
    RequiredFieldDefinition(field_name="one_line_summary", weight=1.1, discoverable=True),
    RequiredFieldDefinition(field_name="detailed_product_summary", weight=1.3, discoverable=True),
    RequiredFieldDefinition(field_name="category_vertical", weight=1.0, discoverable=True),
    RequiredFieldDefinition(field_name="icp_buyer", weight=0.9, discoverable=True),
    RequiredFieldDefinition(field_name="team", weight=0.7, discoverable=True),
    RequiredFieldDefinition(field_name="hq_geography", weight=0.5, discoverable=True),
    RequiredFieldDefinition(field_name="founded_year", weight=0.4, discoverable=True),
    RequiredFieldDefinition(field_name="pricing_presence", weight=0.6, discoverable=True),
    RequiredFieldDefinition(field_name="pricing_plan_details", weight=0.6, discoverable=True),
    RequiredFieldDefinition(field_name="funding_total", weight=0.5, discoverable=True),
    RequiredFieldDefinition(field_name="latest_round", weight=0.5, discoverable=True),
    RequiredFieldDefinition(field_name="funding_stage", weight=0.5, discoverable=True),
    RequiredFieldDefinition(field_name="investors", weight=0.5, discoverable=True),
    RequiredFieldDefinition(field_name="docs_api_presence", weight=0.8, discoverable=True),
    RequiredFieldDefinition(field_name="integrations_ecosystem_signals", weight=0.7, discoverable=True),
    RequiredFieldDefinition(field_name="security_compliance_signals", weight=0.7, discoverable=True),
    RequiredFieldDefinition(field_name="hiring_signals", weight=0.5, discoverable=True),
    RequiredFieldDefinition(field_name="tech_stack_signals", weight=0.8, discoverable=True),
    RequiredFieldDefinition(field_name="recent_change_signals", weight=0.6, discoverable=True),
]


def classify_page_type(
    *,
    url: str,
    title: str = "",
    content: str = "",
    source_type: str = "website",
) -> str:
    """Classify a page into the known extraction buckets."""
    source_type = (source_type or "website").strip().lower()
    if source_type in {"github", "news", "youtube", "search_grounded"}:
        return source_type
    if source_type == "docs":
        lowered_url = str(url or "").lower()
        if "/api" in lowered_url or "graphql" in str(title or "").lower():
            return "api"
        return "docs"
    normalized_url = str(url or "").lower()
    path = normalized_url.split("://", 1)[-1]
    path = path.split("/", 1)[1] if "/" in path else ""
    candidate = f"{path} {title}".lower()

    mapping = [
        ("pricing", ("pricing", "plans", "contact sales", "per month", "per seat")),
        ("security", ("security", "compliance", "soc 2", "iso 27001", "trust center")),
        ("integrations", ("integration", "integrates with", "marketplace", "ecosystem")),
        ("careers", ("careers", "jobs", "hiring", "open roles", "join our team")),
        ("team", ("team", "founder", "leadership", "executive")),
        ("about", ("about", "mission", "company", "our story")),
        ("customers", ("customers", "customer stories", "trusted by")),
        ("case_studies", ("case studies", "case-study", "success stories")),
        ("blog", ("blog", "engineering blog", "insights", "resources")),
        ("changelog", ("changelog", "release notes", "what's new", "product updates")),
        ("docs", ("docs", "documentation", "developer guide", "sdk")),
        ("api", ("api", "reference", "graphql", "rest api", "developer platform")),
    ]
    for page_type, patterns in mapping:
        if any(pattern in candidate for pattern in patterns):
            return page_type
    if not path or path in {"", "/"}:
        return "homepage"
    content_candidate = content[:400].lower()
    for page_type, patterns in mapping:
        if any(pattern in content_candidate for pattern in patterns):
            return page_type
    return "unknown"


def load_cached_documents(company_name: str, cache_dir: Path) -> List[SourceDocument]:
    """Load cached crawl documents for a startup."""
    documents: List[SourceDocument] = []
    seen_paths = set()
    for cache_slug in company_slug_variants(company_name):
        for cache_file in sorted(cache_dir.glob(f"{cache_slug}_*.json")):
            if cache_file in seen_paths:
                continue
            seen_paths.add(cache_file)
            try:
                payload = json.loads(cache_file.read_text(encoding="utf-8"))
            except Exception:
                continue
            result = payload.get("result") or {}
            content = str(result.get("content") or "")
            if not content.strip():
                continue
            source_url = str(result.get("url") or payload.get("url") or "")
            canonical_url = canonicalize_url(source_url) or source_url
            source_type = str(result.get("source_type") or _infer_source_type_from_url(source_url))
            title = str(result.get("title") or "")
            documents.append(
                SourceDocument(
                    source_url=source_url,
                    canonical_url=canonical_url,
                    source_type=source_type,
                    page_type=classify_page_type(
                        url=canonical_url,
                        title=title,
                        content=content,
                        source_type=source_type,
                    ),
                    title=title,
                    content=content,
                    snippet=_short_text(content, 320),
                    fetched_at=_coerce_dt(result.get("crawled_at")),
                    content_hash=result.get("content_hash"),
                    extractor_type="crawler",
                    confidence=0.75 if source_type in {"website", "docs", "api", "github"} else 0.55,
                    metadata={
                        "cache_file": str(cache_file),
                        "fetch_method": result.get("fetch_method"),
                        "response_time_ms": result.get("response_time_ms"),
                    },
                )
            )
    return documents


def build_startup_evidence_bundle(
    startup: StartupInput,
    *,
    cache_dir: Path,
    threshold: Optional[float] = None,
) -> StartupEvidenceBundle:
    """Build a field-driven evidence bundle from cached crawl docs and startup metadata."""
    documents = load_cached_documents(startup.name, cache_dir)
    seeded_documents = list(documents)
    observations: List[FieldObservation] = _seed_observations_from_startup(startup)
    for document in seeded_documents:
        observations.extend(extract_observations(document, startup))

    claims = consolidate_claims(observations)
    coverage = score_field_coverage(observations, threshold=threshold)
    page_type_counts = dict(Counter(document.page_type for document in seeded_documents))
    source_type_counts = dict(Counter(document.source_type for document in seeded_documents))
    contradictions = detect_contradictions(observations)
    open_questions = build_open_questions(coverage, documents, contradictions)
    analysis_context = compose_pruned_analysis_context(startup, seeded_documents, observations, claims)

    needs_search_grounded_fallback = (
        coverage.coverage_score < coverage.threshold
        and not any(doc.source_type in {"search_grounded", "news"} for doc in seeded_documents)
        and (
            not startup.website
            or sum(1 for doc in seeded_documents if doc.source_type in {"website", "docs", "api"}) < 3
            or _is_thin_site(seeded_documents)
        )
    )
    needs_agentic_fallback = (
        coverage.coverage_score < coverage.threshold
        and bool(startup.website)
        and not needs_search_grounded_fallback
        and _looks_js_heavy(seeded_documents)
    )

    return StartupEvidenceBundle(
        startup_name=startup.name,
        startup_slug=_slugify(startup.name),
        documents=seeded_documents,
        observations=observations,
        claims=claims,
        coverage=coverage,
        analysis_context=analysis_context,
        open_questions=open_questions,
        contradictions=contradictions,
        needs_search_grounded_fallback=needs_search_grounded_fallback,
        needs_agentic_fallback=needs_agentic_fallback,
        source_type_counts=source_type_counts,
        page_type_counts=page_type_counts,
    )


def extract_observations(document: SourceDocument, startup: StartupInput) -> List[FieldObservation]:
    """Deterministically extract field observations from a document."""
    observations: List[FieldObservation] = []
    base = {
        "source_url": document.source_url,
        "canonical_url": document.canonical_url,
        "source_type": document.source_type,
        "page_type": document.page_type,
        "fetched_at": document.fetched_at,
        "content_hash": document.content_hash,
        "extractor_type": "deterministic",
        "extractor_version": EXTRACTOR_VERSION,
    }
    content = document.content
    lowered = content.lower()

    if document.page_type in {"homepage", "about", "team"}:
        summary = _summary_from_document(document, startup)
        if summary:
            observations.append(FieldObservation(field_name="one_line_summary", value=summary, snippet=summary, confidence=0.78, **base))
        detailed = _detailed_summary_from_document(document, startup)
        if detailed:
            observations.append(
                FieldObservation(
                    field_name="detailed_product_summary",
                    value=detailed,
                    snippet=_short_text(detailed, 280),
                    confidence=0.72,
                    **base,
                )
            )
        geography = _extract_geography(content)
        if geography:
            observations.append(FieldObservation(field_name="hq_geography", value=geography, snippet=geography, confidence=0.66, **base))
        founded_year = _extract_founded_year(content)
        if founded_year:
            observations.append(FieldObservation(field_name="founded_year", value=founded_year, snippet=str(founded_year), confidence=0.7, **base))
        category = _extract_category(content, startup)
        if category:
            observations.append(FieldObservation(field_name="category_vertical", value=category, snippet=category, confidence=0.64, **base))
        buyer = _extract_icp(content)
        if buyer:
            observations.append(FieldObservation(field_name="icp_buyer", value=buyer, snippet=buyer, confidence=0.6, **base))

    if document.page_type in {"team", "about", "homepage"}:
        team = _extract_team(content)
        if team:
            observations.append(FieldObservation(field_name="team", value=team, snippet=_short_text(", ".join(team), 200), confidence=0.72, **base))

    if document.page_type == "pricing":
        pricing_details = _extract_pricing_details(content)
        if pricing_details:
            observations.append(FieldObservation(field_name="pricing_presence", value=True, snippet="Pricing page detected", confidence=0.95, **base))
            observations.append(FieldObservation(field_name="pricing_plan_details", value=pricing_details, snippet=_short_text("; ".join(pricing_details), 240), confidence=0.88, **base))

    if document.page_type in {"docs", "api"}:
        docs_signal = _extract_docs_signal(content, document.page_type)
        if docs_signal:
            observations.append(FieldObservation(field_name="docs_api_presence", value=docs_signal, snippet=_short_text(docs_signal, 220), confidence=0.92, **base))

    if document.page_type == "integrations":
        integrations = _extract_integrations(content)
        if integrations:
            observations.append(FieldObservation(field_name="integrations_ecosystem_signals", value=integrations, snippet=_short_text(", ".join(integrations), 220), confidence=0.82, **base))

    if document.page_type == "security":
        security = _extract_security_signals(content)
        if security:
            observations.append(FieldObservation(field_name="security_compliance_signals", value=security, snippet=_short_text(", ".join(security), 220), confidence=0.84, **base))

    if document.page_type == "careers":
        hiring = _extract_hiring_signals(content)
        if hiring:
            observations.append(FieldObservation(field_name="hiring_signals", value=hiring, snippet=_short_text(", ".join(hiring), 220), confidence=0.8, **base))

    if document.page_type in {"github", "docs", "api"}:
        tech_stack = _extract_tech_stack(content)
        if tech_stack:
            observations.append(FieldObservation(field_name="tech_stack_signals", value=tech_stack, snippet=_short_text(", ".join(tech_stack), 220), confidence=0.78, **base))

    if document.page_type in {"blog", "changelog", "news"}:
        recent_changes = _extract_recent_change_signals(content)
        if recent_changes:
            observations.append(FieldObservation(field_name="recent_change_signals", value=recent_changes, snippet=_short_text("; ".join(recent_changes), 220), confidence=0.68, **base))

    if document.page_type in {"customers", "case_studies", "homepage"}:
        buyer = _extract_icp(content)
        if buyer:
            observations.append(FieldObservation(field_name="icp_buyer", value=buyer, snippet=buyer, confidence=0.65, **base))

    if document.source_type in {"github", "search_grounded"}:
        evidence_urls = [document.source_url]
        observations.append(FieldObservation(field_name="evidence_urls", value=evidence_urls, snippet=document.source_url, confidence=0.9, **base))

    if "api" in lowered or "sdk" in lowered:
        observations.append(FieldObservation(field_name="docs_api_presence", value="API or SDK references detected", snippet=_first_matching_sentence(content, ("api", "sdk")) or "API/SDK", confidence=0.72, **base))

    return _dedupe_observations(observations)


def consolidate_claims(observations: Sequence[FieldObservation]) -> List[StartupClaim]:
    grouped: Dict[str, List[FieldObservation]] = defaultdict(list)
    for observation in observations:
        grouped[observation.field_name].append(observation)

    claims: List[StartupClaim] = []
    for field_name, items in grouped.items():
        ranked = sorted(items, key=lambda item: (item.confidence, len(str(item.value))), reverse=True)
        best = ranked[0]
        evidence = [
            ClaimEvidence(
                source_url=item.source_url,
                canonical_url=item.canonical_url,
                source_type=item.source_type,
                page_type=item.page_type,
                fetched_at=item.fetched_at,
                content_hash=item.content_hash,
                snippet=item.snippet,
                extractor_type=item.extractor_type,
                extractor_version=item.extractor_version,
                confidence=item.confidence,
            )
            for item in ranked[:5]
        ]
        claims.append(
            StartupClaim(
                claim_type=field_name,
                value=best.value,
                normalized_value=best.normalized_value,
                confidence=round(sum(item.confidence for item in ranked[:3]) / max(min(len(ranked), 3), 1), 3),
                thesis=_claim_thesis(field_name, best.value),
                contradiction_state="possible" if len({_normalize_value(item.value) for item in ranked[:3]}) > 1 else "none",
                evidence=evidence,
                metadata={"source_count": len(ranked)},
            )
        )
    return claims


def score_field_coverage(
    observations: Sequence[FieldObservation],
    *,
    threshold: Optional[float] = None,
) -> CoverageSummary:
    """Score required-field coverage from observations."""
    threshold_value = threshold
    if threshold_value is None:
        threshold_value = float(os.getenv("INTELLIGENCE_REQUIRED_FIELD_THRESHOLD", "0.72"))

    grouped: Dict[str, List[FieldObservation]] = defaultdict(list)
    for observation in observations:
        grouped[observation.field_name].append(observation)

    total_weight = sum(item.weight for item in REQUIRED_FIELDS)
    covered_weight = 0.0
    evidence_quality_weighted = 0.0
    statuses: Dict[str, FieldCoverageStatus] = {}

    for field_def in REQUIRED_FIELDS:
        items = sorted(grouped.get(field_def.field_name, []), key=lambda item: item.confidence, reverse=True)
        if items:
            best = items[0]
            covered = _observation_has_meaningful_value(best)
            confidence = round(best.confidence, 3)
            evidence_count = len(items)
            evidence_urls = list(dict.fromkeys(item.source_url for item in items if item.source_url))
            if covered:
                covered_weight += field_def.weight
                diversity = min(1.0, len({_normalize_value(item.source_url) for item in items}) / 3.0)
                evidence_quality_weighted += field_def.weight * min(1.0, (confidence * 0.7) + (diversity * 0.3))
            statuses[field_def.field_name] = FieldCoverageStatus(
                field_name=field_def.field_name,
                covered=covered,
                confidence=confidence,
                evidence_count=evidence_count,
                value=best.value,
                discoverable=field_def.discoverable,
                reason="" if covered else "Observation value was empty or weak.",
                evidence_urls=evidence_urls,
            )
        else:
            statuses[field_def.field_name] = FieldCoverageStatus(
                field_name=field_def.field_name,
                covered=False,
                confidence=0.0,
                evidence_count=0,
                discoverable=field_def.discoverable,
                reason="No observation available.",
            )

    field_score = round(covered_weight / max(total_weight, 1.0), 3)
    evidence_quality_score = round(evidence_quality_weighted / max(total_weight, 1.0), 3)
    coverage_score = round((field_score * 0.8) + (evidence_quality_score * 0.2), 3)
    missing_fields = [name for name, status in statuses.items() if not status.covered]
    return CoverageSummary(
        covered_fields=sum(1 for status in statuses.values() if status.covered),
        total_fields=len(REQUIRED_FIELDS),
        field_coverage_score=field_score,
        evidence_quality_score=evidence_quality_score,
        coverage_score=coverage_score,
        threshold=threshold_value,
        meets_threshold=coverage_score >= threshold_value,
        missing_fields=missing_fields,
        statuses=statuses,
    )


def build_intelligence_page_profile(
    startup: StartupInput,
    bundle: StartupEvidenceBundle,
    analysis: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Build an intelligence-page profile from structured observations."""
    claim_map = {claim.claim_type: claim for claim in bundle.claims}
    analysis = analysis or {}

    def claim_value(field_name: str, default: Any = None) -> Any:
        claim = claim_map.get(field_name)
        if claim and claim.value not in (None, "", [], {}):
            return claim.value
        return default

    def ensure_list(value: Any) -> List[Any]:
        if value in (None, ""):
            return []
        if isinstance(value, list):
            return value
        return [value]

    evidence_urls = []
    for claim in bundle.claims:
        for citation in claim.evidence:
            if citation.source_url:
                evidence_urls.append(citation.source_url)
    evidence_urls = list(dict.fromkeys(evidence_urls))
    promotion_quality = summarize_promotion_quality(bundle)

    return {
        "canonical_name": startup.name,
        "website": startup.website,
        "one_line_summary": claim_value("one_line_summary", startup.description),
        "detailed_product_summary": claim_value("detailed_product_summary", startup.description),
        "category_vertical": claim_value("category_vertical", analysis.get("vertical") if isinstance(analysis, dict) else None),
        "icp_buyer": claim_value("icp_buyer"),
        "founders_team": ensure_list(claim_value("team")),
        "hq_geography": claim_value("hq_geography", startup.location),
        "founded_year": claim_value("founded_year"),
        "pricing_presence": claim_value("pricing_presence", False),
        "pricing_plan_details": ensure_list(claim_value("pricing_plan_details", [])),
        "funding_total": claim_value("funding_total", startup.funding_amount),
        "latest_round": claim_value("latest_round", startup.funding_type),
        "funding_stage": claim_value("funding_stage", getattr(startup.funding_stage, "value", startup.funding_stage)),
        "investors": ensure_list(claim_value("investors", startup.lead_investors)),
        "docs_api_presence": claim_value("docs_api_presence"),
        "integrations_ecosystem_signals": ensure_list(claim_value("integrations_ecosystem_signals", [])),
        "security_compliance_signals": ensure_list(claim_value("security_compliance_signals", [])),
        "hiring_signals": ensure_list(claim_value("hiring_signals", [])),
        "tech_stack_signals": ensure_list(claim_value("tech_stack_signals", [])),
        "recent_change_signals": ensure_list(claim_value("recent_change_signals", [])),
        "evidence_urls": evidence_urls[:24],
        "confidence": bundle.coverage.coverage_score,
        "coverage": bundle.coverage.model_dump(mode="json"),
        "promotion_quality": promotion_quality,
        "open_questions": bundle.open_questions,
        "contradictions": bundle.contradictions,
    }


def summarize_promotion_quality(bundle: StartupEvidenceBundle) -> Dict[str, Any]:
    """Summarize evidence quality gates used by the promotion worker."""
    distinct_support = {
        (document.source_type or "unknown", document.page_type or "unknown")
        for document in bundle.documents
        if (document.source_type or document.page_type)
    }
    first_party_key_fields = {
        observation.field_name
        for observation in bundle.observations
        if observation.field_name in PROMOTION_KEY_FIELDS and observation.source_type in FIRST_PARTY_SOURCE_TYPES
    }
    low_quality_key_fields = {
        observation.field_name
        for observation in bundle.observations
        if observation.field_name in PROMOTION_KEY_FIELDS and observation.source_type in LOW_QUALITY_EXTERNAL_SOURCE_TYPES
    }
    key_fields_supported = {
        field_name
        for field_name, status in bundle.coverage.statuses.items()
        if field_name in PROMOTION_KEY_FIELDS and status.covered
    }
    return {
        "evidence_diversity": len(distinct_support),
        "source_type_count": len(bundle.source_type_counts),
        "page_type_count": len(bundle.page_type_counts),
        "contradiction_count": len(bundle.contradictions),
        "key_field_support_count": len(key_fields_supported),
        "first_party_key_field_support_count": len(first_party_key_fields),
        "low_quality_key_field_support_count": len(low_quality_key_fields),
        "low_quality_external_only": bool(low_quality_key_fields) and not bool(first_party_key_fields),
        "covered_key_fields": sorted(key_fields_supported),
        "first_party_key_fields": sorted(first_party_key_fields),
        "low_quality_key_fields": sorted(low_quality_key_fields),
    }


def detect_meaningful_changes(
    previous_bundle: StartupEvidenceBundle,
    current_bundle: StartupEvidenceBundle,
) -> ChangeDetectionResult:
    """Detect field-level and page-level changes that should trigger re-analysis."""
    previous_docs = {doc.canonical_url: doc for doc in previous_bundle.documents}
    current_docs = {doc.canonical_url: doc for doc in current_bundle.documents}
    document_changes: List[DocumentChange] = []

    for url in sorted(set(previous_docs) | set(current_docs)):
        prev = previous_docs.get(url)
        curr = current_docs.get(url)
        if prev and not curr:
            document_changes.append(DocumentChange(canonical_url=url, change_type="removed", previous_hash=prev.content_hash))
        elif curr and not prev:
            document_changes.append(DocumentChange(canonical_url=url, change_type="added", current_hash=curr.content_hash))
        elif prev and curr and prev.content_hash != curr.content_hash:
            document_changes.append(
                DocumentChange(
                    canonical_url=url,
                    change_type="changed",
                    previous_hash=prev.content_hash,
                    current_hash=curr.content_hash,
                )
            )

    field_changes: List[str] = []
    previous_claims = {claim.claim_type: claim for claim in previous_bundle.claims}
    current_claims = {claim.claim_type: claim for claim in current_bundle.claims}
    for field_name in sorted(CHANGE_RELEVANT_FIELDS):
        prev = previous_claims.get(field_name)
        curr = current_claims.get(field_name)
        if (prev is None) != (curr is None):
            field_changes.append(field_name)
            continue
        if prev and curr and prev.normalized_value != curr.normalized_value:
            field_changes.append(field_name)

    stale_source_types = sorted(_stale_source_types(current_bundle.documents))
    return ChangeDetectionResult(
        document_changes=document_changes,
        field_changes=field_changes,
        stale_source_types=stale_source_types,
        requires_reanalysis=bool(field_changes or stale_source_types),
    )


def compose_pruned_analysis_context(
    startup: StartupInput,
    documents: Sequence[SourceDocument],
    observations: Sequence[FieldObservation],
    claims: Sequence[StartupClaim],
) -> str:
    """Build a focused analysis context from the extracted evidence."""
    sections: List[str] = [
        f"# Evidence Brief: {startup.name}",
        f"Website: {startup.website or 'unknown'}",
        f"Startup description: {startup.description or 'unknown'}",
    ]
    claim_map = {claim.claim_type: claim for claim in claims}
    ordered_fields = [
        "one_line_summary",
        "detailed_product_summary",
        "category_vertical",
        "icp_buyer",
        "team",
        "pricing_plan_details",
        "docs_api_presence",
        "integrations_ecosystem_signals",
        "security_compliance_signals",
        "hiring_signals",
        "tech_stack_signals",
        "recent_change_signals",
    ]
    sections.append("## Extracted facts")
    for field_name in ordered_fields:
        claim = claim_map.get(field_name)
        if not claim:
            continue
        sections.append(f"- {field_name}: {claim.value}")

    grouped_docs: Dict[str, List[SourceDocument]] = defaultdict(list)
    for document in documents:
        grouped_docs[document.page_type].append(document)

    for page_type in ("homepage", "about", "pricing", "docs", "api", "integrations", "security", "careers", "blog", "changelog", "github", "search_grounded", "news"):
        docs = grouped_docs.get(page_type, [])
        if not docs:
            continue
        sections.append(f"## {page_type}")
        for document in docs[:2]:
            sections.append(f"- {document.title or document.source_url}")
            sections.append(f"  url: {document.source_url}")
            sections.append(f"  snippet: {_short_text(document.snippet or document.content, 320)}")
    return "\n".join(sections)[:18000]


def build_open_questions(
    coverage: CoverageSummary,
    documents: Sequence[SourceDocument],
    contradictions: Sequence[str],
) -> List[str]:
    questions = []
    if not coverage.statuses["pricing_presence"].covered:
        questions.append("Does the startup expose pricing or require sales-led qualification?")
    if not coverage.statuses["docs_api_presence"].covered:
        questions.append("Are there public docs or API references that clarify implementation details?")
    if not coverage.statuses["team"].covered:
        questions.append("Who are the founders or technical leaders?")
    if not coverage.statuses["recent_change_signals"].covered:
        questions.append("What changed recently in the product or go-to-market motion?")
    if not any(document.page_type in {"security", "docs"} for document in documents):
        questions.append("Is there a security or trust center page we should acquire?")
    for contradiction in contradictions[:2]:
        questions.append(f"Resolve contradiction: {contradiction}")
    return questions


def detect_contradictions(observations: Sequence[FieldObservation]) -> List[str]:
    grouped: Dict[str, List[FieldObservation]] = defaultdict(list)
    for observation in observations:
        if observation.field_name in CHANGE_RELEVANT_FIELDS:
            grouped[observation.field_name].append(observation)
    contradictions: List[str] = []
    for field_name, items in grouped.items():
        unique_values = sorted({_normalize_value(item.value) for item in items if _normalize_value(item.value)})
        if len(unique_values) > 1:
            contradictions.append(f"{field_name} has conflicting values: {', '.join(unique_values[:3])}")
    return contradictions


def _seed_observations_from_startup(startup: StartupInput) -> List[FieldObservation]:
    fetched_at = _now()
    base = {
        "source_url": startup.website or f"startup://{_slugify(startup.name)}",
        "canonical_url": canonicalize_url(startup.website or "") or (startup.website or f"startup://{_slugify(startup.name)}"),
        "source_type": "startup_record",
        "page_type": "homepage",
        "fetched_at": fetched_at,
        "content_hash": None,
        "extractor_type": "startup_input",
        "extractor_version": EXTRACTOR_VERSION,
    }
    observations = [
        FieldObservation(field_name="canonical_name", value=startup.name, snippet=startup.name, confidence=1.0, **base),
    ]
    if startup.website:
        observations.append(FieldObservation(field_name="website", value=startup.website, snippet=startup.website, confidence=1.0, **base))
    if startup.description:
        observations.append(FieldObservation(field_name="one_line_summary", value=_short_text(startup.description, 180), snippet=_short_text(startup.description, 180), confidence=0.82, **base))
        observations.append(FieldObservation(field_name="detailed_product_summary", value=_short_text(startup.description, 360), snippet=_short_text(startup.description, 240), confidence=0.74, **base))
    if startup.location:
        observations.append(FieldObservation(field_name="hq_geography", value=startup.location, snippet=startup.location, confidence=0.88, **base))
    if startup.funding_amount is not None:
        observations.append(FieldObservation(field_name="funding_total", value=startup.funding_amount, snippet=str(startup.funding_amount), confidence=0.92, **base))
    if startup.funding_type:
        observations.append(FieldObservation(field_name="latest_round", value=startup.funding_type, snippet=startup.funding_type, confidence=0.9, **base))
    if startup.funding_stage:
        observations.append(FieldObservation(field_name="funding_stage", value=getattr(startup.funding_stage, "value", startup.funding_stage), snippet=str(startup.funding_stage), confidence=0.9, **base))
    if startup.lead_investors:
        observations.append(FieldObservation(field_name="investors", value=startup.lead_investors, snippet=", ".join(startup.lead_investors), confidence=0.9, **base))
    if startup.industries:
        observations.append(FieldObservation(field_name="category_vertical", value=", ".join(startup.industries), snippet=", ".join(startup.industries), confidence=0.62, **base))
    return observations


def _summary_from_document(document: SourceDocument, startup: StartupInput) -> Optional[str]:
    for sentence in _sentence_candidates(document.content):
        lowered = sentence.lower()
        if any(token in lowered for token in ("platform", "software", "helps", "build", "ai", "automation", "tool", "agent", "workspace")):
            return _short_text(sentence, 180)
    if startup.description:
        return _short_text(startup.description, 180)
    return None


def _detailed_summary_from_document(document: SourceDocument, startup: StartupInput) -> Optional[str]:
    sentences = _sentence_candidates(document.content)
    if len(sentences) >= 2:
        return _short_text(" ".join(sentences[:2]), 360)
    if sentences:
        return _short_text(sentences[0], 320)
    if startup.description:
        return _short_text(startup.description, 320)
    return None


def _extract_pricing_details(content: str) -> List[str]:
    matches = re.findall(
        r"([A-Z][A-Za-z0-9 +/_-]{1,24})\s+(?:plan|tier)?\s*(?:-|:)?\s*(\$[0-9]+(?:\.[0-9]{2})?(?:/[a-z]+)?)",
        content,
        flags=re.I,
    )
    plans = [f"{plan.strip()} {price.strip()}" for plan, price in matches]
    if plans:
        return list(dict.fromkeys(plans))[:6]
    lines = [line for line in _line_candidates(content) if "$" in line or "contact sales" in line.lower()]
    return lines[:6]


def _extract_docs_signal(content: str, page_type: str) -> Optional[str]:
    sentence = _first_matching_sentence(content, ("api", "sdk", "docs", "developer"))
    if sentence:
        return sentence
    if page_type == "api":
        return "API reference or developer platform detected."
    if page_type == "docs":
        return "Documentation detected."
    return None


def _extract_integrations(content: str) -> List[str]:
    lowered = content.lower()
    found = [hint for hint in sorted(INTEGRATION_HINTS) if hint in lowered]
    if found:
        return found[:12]
    lines = [line for line in _line_candidates(content) if "integrat" in line.lower()]
    return lines[:6]


def _extract_security_signals(content: str) -> List[str]:
    lowered = content.lower()
    found = [hint.upper() if hint.startswith("iso") else hint.title() for hint in sorted(SECURITY_HINTS) if hint in lowered]
    if found:
        return found[:10]
    lines = [line for line in _line_candidates(content) if any(token in line.lower() for token in ("security", "compliance", "trust", "privacy"))]
    return lines[:6]


def _extract_hiring_signals(content: str) -> List[str]:
    lines = [line for line in _line_candidates(content) if any(token in line.lower() for token in HIRING_HINTS)]
    return lines[:8]


def _extract_tech_stack(content: str) -> List[str]:
    lowered = content.lower()
    found = [hint for hint in sorted(TECH_STACK_HINTS) if hint in lowered]
    if found:
        return found[:12]
    lines = [line for line in _line_candidates(content) if any(token in line.lower() for token in ("built with", "powered by", "stack", "sdk", "api"))]
    return lines[:6]


def _extract_recent_change_signals(content: str) -> List[str]:
    lines = [line for line in _line_candidates(content) if any(token in line.lower() for token in ("launched", "released", "introduced", "new", "updated", "changelog", "release"))]
    return lines[:8]


def _extract_team(content: str) -> List[str]:
    patterns = [
        r"([A-Z][a-z]+(?: [A-Z][a-z]+){0,2}),?\s+(?:co-?founder|founder|ceo|cto|chief technology officer|chief executive officer)",
        r"(?:co-?founder|founder|ceo|cto|chief technology officer|chief executive officer)\s*[:\-]\s*([A-Z][a-z]+(?: [A-Z][a-z]+){0,2})",
        r"([A-Z][a-z]+(?: [A-Z][a-z]+){1,2}),\s*(?:ceo|cto|coo|cpo|chief [a-z ]+ officer)",
    ]
    names: List[str] = []
    for pattern in patterns:
        for match in re.findall(pattern, content, flags=re.I):
            candidate = _short_text(match, 80)
            if candidate and candidate not in names:
                names.append(candidate)
    return names[:8]


def _extract_geography(content: str) -> Optional[str]:
    patterns = [
        r"(?:based in|headquartered in|hq in)\s+([A-Z][A-Za-z .,'-]{2,60})",
        r"([A-Z][A-Za-z .,'-]{2,60}),\s*(?:USA|United States|UK|United Kingdom|Canada|Germany|France|Turkey|Netherlands|India|Singapore)",
    ]
    for pattern in patterns:
        match = re.search(pattern, content, flags=re.I)
        if match:
            return _short_text(match.group(1), 120)
    return None


def _extract_founded_year(content: str) -> Optional[int]:
    match = re.search(r"(?:founded|launched|started)\s+(?:in\s+)?(20[01][0-9]|199[0-9])", content, flags=re.I)
    if match:
        return int(match.group(1))
    return None


def _extract_category(content: str, startup: StartupInput) -> Optional[str]:
    if startup.industries:
        return ", ".join(startup.industries[:3])
    sentence = _first_matching_sentence(content, ("platform", "software", "marketplace", "infrastructure", "security", "workflow", "assistant"))
    return sentence


def _extract_icp(content: str) -> Optional[str]:
    for role in BUYER_ROLE_HINTS:
        if role in content.lower():
            return role
    match = re.search(r"(?:for|built for|used by)\s+([A-Za-z0-9 ,/&-]{4,80})", content, flags=re.I)
    if match:
        return _short_text(match.group(1), 120)
    return None


def _observation_has_meaningful_value(observation: FieldObservation) -> bool:
    value = observation.value
    if value in (None, "", [], {}):
        return False
    if isinstance(value, str) and len(value.strip()) < 2:
        return False
    return observation.confidence >= 0.45 or observation.field_name in {"canonical_name", "website"}


def _claim_thesis(field_name: str, value: Any) -> str:
    if field_name == "pricing_plan_details":
        return f"Pricing evidence suggests: {value}"
    if field_name == "docs_api_presence":
        return "Developer-facing docs or APIs are publicly discoverable."
    if field_name == "security_compliance_signals":
        return f"Security/compliance signals found: {value}"
    return f"{field_name} -> {value}"


def _dedupe_observations(observations: Sequence[FieldObservation]) -> List[FieldObservation]:
    seen = set()
    deduped: List[FieldObservation] = []
    for observation in observations:
        key = (
            observation.field_name,
            observation.normalized_value,
            observation.canonical_url,
            observation.extractor_type,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(observation)
    return deduped


def _infer_source_type_from_url(url: str) -> str:
    lowered = str(url or "").lower()
    if lowered.startswith("news://"):
        return "news"
    if lowered.startswith("youtube://") or "youtube.com" in lowered:
        return "youtube"
    if lowered.startswith("websearch://"):
        return "search_grounded"
    if "github.com" in lowered:
        return "github"
    if any(token in lowered for token in ("/docs", "docs.", "/developer", "/api")):
        return "docs"
    return "website"


def _is_thin_site(documents: Sequence[SourceDocument]) -> bool:
    website_chars = sum(len(document.content or "") for document in documents if document.source_type in {"website", "docs", "api"})
    return website_chars < 2500


def _looks_js_heavy(documents: Sequence[SourceDocument]) -> bool:
    if not documents:
        return False
    total_chars = sum(len(document.content or "") for document in documents if document.source_type in {"website", "docs", "api"})
    titles = " ".join(document.title.lower() for document in documents)
    return total_chars < 1800 and any(token in titles for token in ("enable javascript", "loading", "app"))


def _coerce_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _stale_source_types(documents: Sequence[SourceDocument]) -> List[str]:
    now = _now()
    stale: set[str] = set()
    for document in documents:
        ttl_days = SOURCE_TYPE_TTLS_DAYS.get(document.source_type, SOURCE_TYPE_TTLS_DAYS["unknown"])
        fetched_at = document.fetched_at or now
        if fetched_at + timedelta(days=ttl_days) < now:
            stale.add(document.source_type)
    return sorted(stale)
