"""Structured, citation-first deep research workflow."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from src.config import llm_kwargs
from src.intelligence.evidence_pipeline import (
    ResearchCitation,
    ResearchClaim,
    StructuredResearchOutput,
)


def build_structured_research_output(
    *,
    startup_name: str,
    focus_areas: Sequence[str],
    evidence_context: Dict[str, Any],
    research_context: Dict[str, Any],
) -> StructuredResearchOutput:
    """Deterministically build a structured research object from claims and evidence."""
    claims: List[ResearchClaim] = []
    citations: List[ResearchCitation] = []
    contradictions: List[str] = []
    open_questions: List[str] = []

    for claim_row in (evidence_context.get("claims") or [])[:8]:
        claim_citations = [
            ResearchCitation(
                source_url=str(citation.get("source_url") or ""),
                source_type=str(citation.get("source_type") or "unknown"),
                page_type=str(citation.get("page_type") or "unknown"),
                snippet=str(citation.get("snippet") or "")[:320],
            )
            for citation in (claim_row.get("citations") or [])
            if citation.get("source_url")
        ]
        if not claim_citations:
            continue
        statement = _claim_statement(str(claim_row.get("claim_type") or ""), claim_row.get("claim_value_json"))
        claims.append(
            ResearchClaim(
                claim_type=str(claim_row.get("claim_type") or "unknown"),
                statement=statement,
                confidence=float(claim_row.get("confidence") or 0.0),
                citations=claim_citations,
            )
        )
        citations.extend(claim_citations)
        contradiction_state = str(claim_row.get("contradiction_state") or "none")
        if contradiction_state != "none":
            contradictions.append(f"{claim_row.get('claim_type')}: contradiction_state={contradiction_state}")

    citations = _dedupe_citations(citations)
    if not claims:
        for doc in (evidence_context.get("documents") or [])[:5]:
            citation = ResearchCitation(
                source_url=str(doc.get("source_url") or ""),
                source_type=str(doc.get("source_type") or "unknown"),
                page_type=str(doc.get("page_type") or "unknown"),
                snippet=str(doc.get("snippet") or "")[:320],
            )
            if citation.source_url:
                citations.append(citation)
        citations = _dedupe_citations(citations)

    materialization_status = str(research_context.get("materialization_status") or "unknown")
    recent_events = research_context.get("recent_events") or []
    if not claims:
        open_questions.append("Evidence coverage is thin; expand crawl or search-grounded acquisition before publishing conclusions.")
    if not any(claim.claim_type == "docs_api_presence" for claim in claims):
        open_questions.append("Confirm docs/API presence or lack thereof.")
    if not any(claim.claim_type == "pricing_plan_details" for claim in claims):
        open_questions.append("Confirm whether the company exposes pricing or runs sales-led only.")
    if recent_events:
        open_questions.append("Check whether recent events changed the current positioning or product scope.")

    thesis_parts = [
        f"{startup_name} research synthesis",
        f"materialization={materialization_status}",
    ]
    if focus_areas:
        thesis_parts.append(f"focus={', '.join(focus_areas)}")
    if claims:
        thesis_parts.append(f"claims={len(claims)}")
    thesis = " | ".join(thesis_parts)
    confidence = round(sum(claim.confidence for claim in claims[:5]) / max(min(len(claims), 5), 1), 3) if claims else 0.35

    output = StructuredResearchOutput(
        thesis=thesis,
        key_claims=claims,
        supporting_evidence=citations[:12],
        contradictions=contradictions[:6],
        confidence=confidence,
        open_questions=open_questions[:8],
        citations=citations[:16],
        research_output_markdown="",
    )
    output.research_output_markdown = render_structured_research_markdown(startup_name, output)
    return output


async def maybe_synthesize_research_thesis(
    *,
    client,
    model: str,
    startup_name: str,
    output: StructuredResearchOutput,
) -> Tuple[StructuredResearchOutput, Dict[str, int]]:
    """Optionally ask the LLM to sharpen the thesis while keeping citations deterministic."""
    if client is None:
        return output, {"input": 0, "output": 0}

    prompt = {
        "startup_name": startup_name,
        "claims": [
            {
                "claim_type": claim.claim_type,
                "statement": claim.statement,
                "confidence": claim.confidence,
                "citations": [citation.source_url for citation in claim.citations],
            }
            for claim in output.key_claims[:8]
        ],
        "contradictions": output.contradictions,
        "open_questions": output.open_questions,
    }
    response = await asyncio.wait_for(
        client.chat.completions.create(
            model=model,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a startup intelligence analyst. Tighten the thesis and give a short "
                        "bull case and bear case. Return strict JSON with keys thesis, bull_case, bear_case."
                    ),
                },
                {"role": "user", "content": json.dumps(prompt)},
            ],
            **llm_kwargs(model, max_tokens=800, temperature=0.2),
        ),
        timeout=90.0,
    )
    content = response.choices[0].message.content or "{}"
    payload = json.loads(content)
    thesis = str(payload.get("thesis") or output.thesis).strip()
    bull_case = str(payload.get("bull_case") or "").strip()
    bear_case = str(payload.get("bear_case") or "").strip()
    updated = output.model_copy(deep=True)
    updated.thesis = thesis
    if bull_case:
        updated.open_questions.append(f"Bull case: {bull_case}")
    if bear_case:
        updated.contradictions.append(f"Bear case: {bear_case}")
    updated.research_output_markdown = render_structured_research_markdown(startup_name, updated)
    tokens = {
        "input": int(getattr(response.usage, "prompt_tokens", 0) or 0),
        "output": int(getattr(response.usage, "completion_tokens", 0) or 0),
    }
    return updated, tokens


def render_structured_research_markdown(startup_name: str, output: StructuredResearchOutput) -> str:
    lines = [
        f"# Deep Research: {startup_name}",
        "",
        f"Generated: {datetime.now(timezone.utc).isoformat()}",
        "",
        "## Thesis",
        output.thesis,
        "",
        "## Key Claims",
    ]
    for claim in output.key_claims:
        lines.append(f"- {claim.statement} (confidence={claim.confidence:.2f})")
        for citation in claim.citations[:3]:
            lines.append(f"  - [{citation.source_type}/{citation.page_type}] {citation.source_url}")
    lines.append("")
    lines.append("## Contradictions")
    if output.contradictions:
        lines.extend([f"- {item}" for item in output.contradictions])
    else:
        lines.append("- None observed.")
    lines.append("")
    lines.append("## Open Questions")
    if output.open_questions:
        lines.extend([f"- {item}" for item in output.open_questions])
    else:
        lines.append("- None.")
    lines.append("")
    lines.append("## Citations")
    for citation in output.citations:
        lines.append(f"- {citation.source_url}")
        if citation.snippet:
            lines.append(f"  - {_short(citation.snippet)}")
    return "\n".join(lines).strip() + "\n"


def validate_structured_research_output(output: StructuredResearchOutput) -> None:
    for claim in output.key_claims:
        if not claim.citations:
            raise ValueError(f"Structured research claim '{claim.claim_type}' is missing citations.")
    if output.citations and not output.key_claims:
        return
    if not output.citations:
        raise ValueError("Structured research output is missing citations.")


def _claim_statement(claim_type: str, value: Any) -> str:
    if isinstance(value, dict):
        printable = json.dumps(value, sort_keys=True)
    else:
        printable = str(value)
    return f"{claim_type}: {printable}"


def _dedupe_citations(citations: Sequence[ResearchCitation]) -> List[ResearchCitation]:
    seen = set()
    deduped: List[ResearchCitation] = []
    for citation in citations:
        key = (citation.source_url, citation.snippet)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(citation)
    return deduped


def _short(value: str, limit: int = 260) -> str:
    normalized = " ".join(str(value or "").split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: limit - 3].rstrip() + "..."
