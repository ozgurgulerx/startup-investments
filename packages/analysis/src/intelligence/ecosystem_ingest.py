"""Ecosystem memory — external content ingestion (PR #4.4–4.6).

Fetches long-horizon context documents (KPMG quarterly PDFs,
startups.watch blog posts, YouTube session transcripts) and distills
them into structured rows in `news_ecosystem_facts` via an LLM pass.

Design:

  * Document fetchers (`fetch_pdf`, `fetch_html`, `fetch_youtube_transcript`)
    return plain text plus a source-metadata dict. They do not touch the DB.

  * `distill_document_to_facts()` turns text + metadata into a list of
    candidate facts via a single LLM call. The prompt is shared across
    all document types so output shape is consistent.

  * `ingest_external_source()` orchestrates fetch + distill + DB upsert.
    Upsert reuses the same supersession-on-(region, sector, fact_key)
    pattern as the curated seed loader. Source provenance row is
    inserted first so `source_ref_id` is never null for ingested facts.

  * Incremental friendly: content hash is stored on
    `news_ecosystem_sources`; re-running against an unchanged document
    short-circuits without another LLM call.

  * YouTube transcripts use yt-dlp's `--write-auto-sub --skip-download`
    — no YouTube Data API key needed. Captions may be noisy; we lower
    confidence to 0.6 by default to reflect that.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import asyncpg
except ImportError:  # pragma: no cover
    asyncpg = None

try:
    import httpx
except ImportError:  # pragma: no cover
    httpx = None

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover
    fitz = None

try:
    import trafilatura
except ImportError:  # pragma: no cover
    trafilatura = None

try:
    import yt_dlp  # type: ignore
except ImportError:  # pragma: no cover
    yt_dlp = None

logger = logging.getLogger(__name__)

CURATED_SOURCE_KEY = "seed_curated_v1"  # re-exported for callers


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class SourceMeta:
    """Shared metadata across ingested document types."""

    source_key: str
    source_type: str  # pdf | blog | youtube_transcript
    title: str
    url: Optional[str] = None
    publisher: Optional[str] = None
    period_covered: Optional[str] = None
    published_at: Optional[date] = None
    region: str = "turkey"


@dataclass
class CandidateFact:
    """One distilled fact, pre-DB-insert."""

    region: str
    sector: Optional[str]
    fact_key: str
    fact_value: Dict[str, Any]
    narrative: str
    confidence: float
    as_of_date: date
    valid_until: Optional[date] = None


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------


def _hash_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()


def make_ingest_http_client() -> "httpx.AsyncClient":
    """Build an AsyncClient that actually works for Medium / KPMG TLS chains.

    Cert-chain issues vary by host: blog.startups.watch (Medium CDN) fails
    under Python's bundled OpenSSL + certifi on some macOS setups even
    though curl with the system keychain succeeds. We try three strategies:

      1. truststore (OS trust store — macOS Security framework / Windows
         SChannel / Linux OpenSSL default) — most reliable when available.
      2. certifi bundle — the PyPI standard.
      3. httpx default — last resort.
    """
    if httpx is None:
        raise RuntimeError("httpx is not installed")
    headers = {"User-Agent": "Mozilla/5.0 BuildAtlasBot"}

    try:
        import ssl

        import truststore

        ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        return httpx.AsyncClient(
            timeout=60.0,
            follow_redirects=True,
            verify=ctx,
            headers=headers,
        )
    except ImportError:
        pass

    try:
        import certifi

        return httpx.AsyncClient(
            timeout=60.0,
            follow_redirects=True,
            verify=certifi.where(),
            headers=headers,
        )
    except ImportError:
        return httpx.AsyncClient(
            timeout=60.0,
            follow_redirects=True,
            headers=headers,
        )


async def fetch_pdf(url: str, *, client: "httpx.AsyncClient") -> Tuple[str, str]:
    """Download a PDF and extract plain text via PyMuPDF.

    Returns (text, content_hash). Raises on HTTP errors or unparseable PDFs.
    """
    if fitz is None:
        raise RuntimeError("PyMuPDF (fitz) is not installed")
    resp = await client.get(url, follow_redirects=True, timeout=60.0)
    resp.raise_for_status()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
        tmp.write(resp.content)
        tmp_path = Path(tmp.name)
    try:
        doc = fitz.open(tmp_path)
        pages = [page.get_text("text") for page in doc]  # type: ignore[attr-defined]
        text = "\n".join(pages).strip()
        doc.close()
    finally:
        tmp_path.unlink(missing_ok=True)
    if not text:
        raise RuntimeError("PDF produced no extractable text (likely image-only)")
    return text, _hash_text(text)


async def fetch_html(url: str, *, client: "httpx.AsyncClient") -> Tuple[str, str]:
    """Download HTML and extract main-content text via trafilatura."""
    if trafilatura is None:
        raise RuntimeError("trafilatura is not installed")
    resp = await client.get(
        url,
        follow_redirects=True,
        timeout=30.0,
        headers={"User-Agent": "Mozilla/5.0 BuildAtlasBot"},
    )
    resp.raise_for_status()
    extracted = trafilatura.extract(
        resp.text,
        include_comments=False,
        include_tables=True,
        favor_recall=True,
    )
    text = (extracted or "").strip()
    if not text:
        raise RuntimeError("trafilatura returned no content")
    return text, _hash_text(text)


def _parse_webvtt(vtt_text: str) -> str:
    """Strip VTT cue metadata to get a plain transcript string."""
    lines: List[str] = []
    for raw in vtt_text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("WEBVTT") or line.startswith("NOTE"):
            continue
        if "-->" in line:
            continue
        if line.isdigit():
            continue
        # Drop inline timestamps like <00:00:01.000>
        line = re.sub(r"<\d{2}:\d{2}:\d{2}\.\d{3}>", "", line)
        # Drop speaker tags like <c>...</c>
        line = re.sub(r"</?c[^>]*>", "", line)
        line = line.strip()
        if line:
            lines.append(line)
    return " ".join(lines)


async def fetch_youtube_transcript(
    video_url: str,
    *,
    prefer_langs: Tuple[str, ...] = ("tr", "en"),
) -> Tuple[str, str]:
    """Fetch the auto-caption transcript for a YouTube video via yt-dlp.

    Runs yt-dlp in a thread (blocking) to avoid its internal event loop.
    """
    if yt_dlp is None:
        raise RuntimeError("yt-dlp is not installed")

    def _download_sub() -> str:
        with tempfile.TemporaryDirectory() as tmpdir:
            opts = {
                "skip_download": True,
                "writesubtitles": True,
                "writeautomaticsub": True,
                "subtitleslangs": list(prefer_langs),
                "subtitlesformat": "vtt",
                "outtmpl": os.path.join(tmpdir, "%(id)s.%(ext)s"),
                "quiet": True,
                "no_warnings": True,
            }
            with yt_dlp.YoutubeDL(opts) as ydl:
                ydl.extract_info(video_url, download=True)
            # Find the best-matching VTT file
            for lang in prefer_langs:
                for ext in (f".{lang}.vtt", f".{lang}-auto.vtt"):
                    matches = list(Path(tmpdir).glob(f"*{ext}"))
                    if matches:
                        return matches[0].read_text(encoding="utf-8")
            # Fallback: any vtt in the dir
            any_vtt = list(Path(tmpdir).glob("*.vtt"))
            if any_vtt:
                return any_vtt[0].read_text(encoding="utf-8")
            return ""

    vtt_text = await asyncio.to_thread(_download_sub)
    if not vtt_text:
        raise RuntimeError(f"No captions available for {video_url}")
    text = _parse_webvtt(vtt_text).strip()
    if not text:
        raise RuntimeError("VTT parsed to empty string")
    return text, _hash_text(text)


# ---------------------------------------------------------------------------
# LLM distiller
# ---------------------------------------------------------------------------

DISTILL_SYSTEM_PROMPT = """You are a senior startup-ecosystem analyst. You read a long-form
document (VC report, ecosystem blog post, or conference transcript)
and extract durable ecosystem-level facts — the kind that inform
commentary for the next 3–12 months.

Extract facts ONLY when they describe:
  * Ecosystem structure (unicorn count, sector distribution, capital
    stack composition, exit channels)
  * Sector strength / weakness (ranking, dominance, emerging verticals)
  * Policy / regulatory state (tax regime, public programs, funding bodies)
  * Market velocity (YoY / QoQ funding, deal count, valuation levels)

Do NOT extract single-company rounds or per-deal news — those go
through the regular news pipeline, not ecosystem memory.

Output strict JSON with shape: {"facts": [<fact>, <fact>, ...]}.

Each <fact> object has:
  * region       — "turkey" or "global"
  * sector       — lowercase_snake_case or null for market-wide
  * fact_key     — short, stable key (e.g. "unicorn_count", "total_funding_usd_q3")
  * fact_value   — structured dict with at least {"value": ...} plus unit/period if relevant
  * narrative    — ONE sentence, declarative, <=220 chars. This is what
                    the daily-brief LLM reads; make it self-contained.
  * confidence   — 0.0–1.0. 0.9 only for explicit numeric claims; 0.7
                    for attributed qualitative claims; 0.5 for inferred.
  * as_of_date   — YYYY-MM-DD. The date the fact describes (not today).

Cap the array at 20 facts. Quality over quantity. Omit facts that
duplicate each other or that are too stale to be useful. Aim for 8–15
facts from a typical quarterly report or blog post.

Return ONLY the JSON object, no prose, no markdown."""


async def distill_document_to_facts(
    azure_client: Any,
    model_name: str,
    *,
    doc_text: str,
    source: SourceMeta,
    max_chars: int = 60000,
) -> List[CandidateFact]:
    """Run the LLM distiller. Returns an empty list on any failure."""
    if azure_client is None:
        raise RuntimeError("azure_client is None — cannot distill")
    from src.config import llm_kwargs

    snippet = doc_text[:max_chars]
    user_prompt = (
        f"Document metadata:\n"
        f"  title: {source.title}\n"
        f"  publisher: {source.publisher or 'unknown'}\n"
        f"  period_covered: {source.period_covered or 'unknown'}\n"
        f"  published_at: {source.published_at.isoformat() if source.published_at else 'unknown'}\n"
        f"  region: {source.region}\n\n"
        f"Document text (truncated to {max_chars} chars):\n"
        f"---\n{snippet}\n---"
    )

    # gpt-5-nano burns ~3K reasoning tokens; <16384 returns empty content
    # when the document is long. Bump well above that for safety.
    try:
        kwargs = llm_kwargs(model_name, max_tokens=16384)
        response = await azure_client.chat.completions.create(
            model=model_name,
            messages=[
                {"role": "system", "content": DISTILL_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={"type": "json_object"},
            **kwargs,
        )
        content = response.choices[0].message.content or ""
        if not content.strip():
            logger.warning(
                "ecosystem distill returned empty content (model=%s); "
                "check max_completion_tokens and document size",
                model_name,
            )
            return []
    except Exception as exc:
        logger.warning("ecosystem distill LLM call failed: %s", exc)
        return []

    # The LLM may wrap its array in an object (`{"facts": [...]}`) despite the
    # prompt — handle both shapes.
    data: Any
    try:
        data = json.loads(content)
    except Exception as exc:
        logger.warning("ecosystem distill returned non-JSON: %s", exc)
        return []
    if isinstance(data, dict):
        # Common LLM wrappings: {"facts": [...]}, {"items": [...]}, {"data": [...]}.
        unwrapped = None
        for key in ("facts", "items", "data", "results"):
            if isinstance(data.get(key), list):
                unwrapped = data[key]
                break
        if unwrapped is not None:
            data = unwrapped
        elif "fact_key" in data and "narrative" in data:
            # Single-fact object — wrap in a list.
            data = [data]
        else:
            return []
    if not isinstance(data, list):
        return []

    facts: List[CandidateFact] = []
    today = date.today()
    for entry in data[:20]:
        if not isinstance(entry, dict):
            continue
        try:
            region = str(entry["region"]).strip().lower()
            if region not in ("global", "turkey"):
                continue
            sector_raw = entry.get("sector")
            sector = (
                str(sector_raw).strip().lower() if sector_raw not in (None, "null", "") else None
            )
            fact_key = str(entry["fact_key"]).strip()
            fact_value = entry.get("fact_value") or {"value": None}
            if not isinstance(fact_value, (dict, list)):
                fact_value = {"value": fact_value}
            narrative = str(entry.get("narrative") or "").strip()[:250]
            if not narrative or not fact_key:
                continue
            confidence = float(entry.get("confidence", 0.7))
            confidence = max(0.0, min(1.0, confidence))
            as_of_raw = entry.get("as_of_date")
            as_of: date
            if as_of_raw:
                try:
                    as_of = datetime.strptime(str(as_of_raw), "%Y-%m-%d").date()
                except ValueError:
                    as_of = today
            else:
                as_of = today
            facts.append(
                CandidateFact(
                    region=region,
                    sector=sector,
                    fact_key=fact_key,
                    fact_value=fact_value
                    if isinstance(fact_value, dict)
                    else {"value": fact_value},
                    narrative=narrative,
                    confidence=confidence,
                    as_of_date=as_of,
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return facts


# ---------------------------------------------------------------------------
# DB upsert
# ---------------------------------------------------------------------------


async def _upsert_source(
    conn: "asyncpg.Connection",
    source: SourceMeta,
    *,
    content_hash: str,
    raw_text: Optional[str],
    distilled_count: int,
) -> Tuple[str, bool]:
    """Insert or update the provenance row. Returns (source_id, is_new).

    `is_new` is True when the content_hash changed (or the row didn't exist),
    signaling that callers should re-distill. False skips redundant LLM work.
    """
    existing = await conn.fetchrow(
        "SELECT id::text AS id, content_hash FROM news_ecosystem_sources WHERE source_key = $1",
        source.source_key,
    )
    if existing and existing["content_hash"] == content_hash:
        return str(existing["id"]), False
    if existing:
        new_id = existing["id"]
        await conn.execute(
            """
            UPDATE news_ecosystem_sources
            SET content_hash = $1,
                raw_text = $2,
                downloaded_at = now(),
                distilled_fact_count = $3,
                processed_at = NULL,
                updated_at = now()
            WHERE id = $4::uuid
            """,
            content_hash,
            raw_text,
            distilled_count,
            existing["id"],
        )
        return str(new_id), True
    row = await conn.fetchrow(
        """
        INSERT INTO news_ecosystem_sources (
            source_key, source_type, url, title, publisher, period_covered,
            published_at, content_hash, raw_text, distilled_fact_count, region
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id::text AS id
        """,
        source.source_key,
        source.source_type,
        source.url,
        source.title,
        source.publisher,
        source.period_covered,
        source.published_at,
        content_hash,
        raw_text,
        distilled_count,
        source.region,
    )
    return str(row["id"]), True


async def _upsert_fact(
    conn: "asyncpg.Connection",
    *,
    fact: CandidateFact,
    source_id: str,
    source_type_row: str,
) -> str:
    """Upsert one fact. Supersedes the current row for (region, sector, fact_key)."""
    existing = await conn.fetchrow(
        """
        SELECT id::text AS id, narrative, fact_value::text AS fact_value_text,
               confidence, as_of_date
        FROM news_ecosystem_facts
        WHERE region = $1
          AND COALESCE(sector, '') = COALESCE($2, '')
          AND fact_key = $3
          AND is_current = TRUE
        """,
        fact.region,
        fact.sector,
        fact.fact_key,
    )
    fact_value_json = json.dumps(fact.fact_value, sort_keys=True, ensure_ascii=False)
    if existing:
        if (
            existing["narrative"] == fact.narrative
            and existing["fact_value_text"] == fact_value_json
            and abs(float(existing["confidence"]) - fact.confidence) < 1e-6
            and existing["as_of_date"] == fact.as_of_date
        ):
            return "unchanged"
        new_id = await conn.fetchval(
            """
            INSERT INTO news_ecosystem_facts (
                region, sector, fact_key, fact_value, narrative,
                source_type, source_ref_id, as_of_date, valid_until,
                confidence, is_current
            )
            VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::uuid, $8, $9, $10, TRUE)
            RETURNING id::text
            """,
            fact.region,
            fact.sector,
            fact.fact_key,
            fact_value_json,
            fact.narrative,
            source_type_row,
            source_id,
            fact.as_of_date,
            fact.valid_until,
            fact.confidence,
        )
        await conn.execute(
            """
            UPDATE news_ecosystem_facts
            SET is_current = FALSE, superseded_by = $1::uuid, updated_at = now()
            WHERE id = $2::uuid
            """,
            new_id,
            existing["id"],
        )
        return "superseded"
    await conn.execute(
        """
        INSERT INTO news_ecosystem_facts (
            region, sector, fact_key, fact_value, narrative,
            source_type, source_ref_id, as_of_date, valid_until,
            confidence, is_current
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::uuid, $8, $9, $10, TRUE)
        """,
        fact.region,
        fact.sector,
        fact.fact_key,
        fact_value_json,
        fact.narrative,
        source_type_row,
        source_id,
        fact.as_of_date,
        fact.valid_until,
        fact.confidence,
    )
    return "inserted"


# Maps ingested-source types to the enum value on news_ecosystem_facts.source_type.
_FACT_SOURCE_TYPE_BY_DOC: Dict[str, str] = {
    "pdf": "report",
    "blog": "report",
    "youtube_transcript": "transcript",
}


async def ingest_external_source(
    conn: "asyncpg.Connection",
    *,
    doc_text: str,
    content_hash: str,
    source: SourceMeta,
    azure_client: Any,
    model_name: str,
    force_redistill: bool = False,
) -> Dict[str, int]:
    """Fetch+distill+upsert pipeline for one external document.

    Fetches already happened upstream (caller owns the HTTP client). Here we
    just do the LLM distill + DB writes. Returns a stats dict.
    """
    source_id, is_new = await _upsert_source(
        conn,
        source,
        content_hash=content_hash,
        raw_text=doc_text[:200000],
        distilled_count=0,
    )
    if not is_new and not force_redistill:
        return {"source_id": source_id, "skipped": 1, "distilled": 0, "inserted": 0}

    facts = await distill_document_to_facts(
        azure_client, model_name, doc_text=doc_text, source=source
    )
    fact_source_type = _FACT_SOURCE_TYPE_BY_DOC.get(source.source_type, "report")
    stats = {"source_id": source_id, "inserted": 0, "superseded": 0, "unchanged": 0}
    for fact in facts:
        outcome = await _upsert_fact(
            conn,
            fact=fact,
            source_id=source_id,
            source_type_row=fact_source_type,
        )
        if outcome in stats:
            stats[outcome] += 1  # type: ignore[operator]
    stats["distilled"] = len(facts)
    await conn.execute(
        "UPDATE news_ecosystem_sources "
        "SET distilled_fact_count = $1, processed_at = now(), updated_at = now() "
        "WHERE id = $2::uuid",
        len(facts),
        source_id,
    )
    return stats


# ---------------------------------------------------------------------------
# Batch drivers (CLI-friendly wrappers around common source types)
# ---------------------------------------------------------------------------


KPMG_REPORTS: List[Dict[str, Any]] = [
    {
        "source_key": "kpmg_tr_startup_2025_full",
        "url": "https://assets.kpmg.com/content/dam/kpmg/tr/pdf/2026/03/turkish-startup-investments-review-2025.pdf",
        "title": "KPMG Turkish Startup Investments Review 2025",
        "publisher": "KPMG Turkey",
        "period_covered": "2025 full year",
        "region": "turkey",
    },
    # NOTE: older KPMG quarterly PDFs return 404 on assets.kpmg.com; only
    # the latest annual is reliably reachable. Add new quarterlies here as
    # they're published (announced on 212.vc's hub page).
]

STARTUPS_WATCH_POSTS: List[Dict[str, Any]] = [
    {
        "source_key": "startups_watch_tr_2024_review",
        "url": "https://blog.startups.watch/turkish-startup-ecosystem-year-in-review-2024-f5328f274f9b",
        "title": "Turkish Startup Ecosystem Year in Review 2024",
        "publisher": "startups.watch",
        "period_covered": "2024 full year",
        "region": "turkey",
    },
    {
        "source_key": "startups_watch_tr_2024_q3",
        "url": "https://blog.startups.watch/turkish-startup-ecosystem-in-2024-q3-a1ff33741df9",
        "title": "Turkish Startup Ecosystem in 2024 Q3",
        "publisher": "startups.watch",
        "period_covered": "2024 Q3",
        "region": "turkey",
    },
]


async def ingest_kpmg_reports(
    conn: "asyncpg.Connection",
    *,
    azure_client: Any,
    model_name: str,
    http_client: "httpx.AsyncClient",
    reports: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Download + distill the curated KPMG PDF list."""
    results: List[Dict[str, Any]] = []
    for spec in reports or KPMG_REPORTS:
        try:
            text, chash = await fetch_pdf(spec["url"], client=http_client)
        except Exception as exc:
            results.append({"source_key": spec["source_key"], "error": str(exc)})
            continue
        source = SourceMeta(
            source_key=spec["source_key"],
            source_type="pdf",
            title=spec["title"],
            url=spec["url"],
            publisher=spec.get("publisher"),
            period_covered=spec.get("period_covered"),
            published_at=spec.get("published_at"),
            region=spec.get("region", "turkey"),
        )
        stats = await ingest_external_source(
            conn,
            doc_text=text,
            content_hash=chash,
            source=source,
            azure_client=azure_client,
            model_name=model_name,
        )
        results.append({"source_key": spec["source_key"], **stats})
    return results


async def ingest_startups_watch_blog(
    conn: "asyncpg.Connection",
    *,
    azure_client: Any,
    model_name: str,
    http_client: "httpx.AsyncClient",
    posts: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Download + distill the curated startups.watch blog posts."""
    results: List[Dict[str, Any]] = []
    for spec in posts or STARTUPS_WATCH_POSTS:
        try:
            text, chash = await fetch_html(spec["url"], client=http_client)
        except Exception as exc:
            results.append({"source_key": spec["source_key"], "error": str(exc)})
            continue
        source = SourceMeta(
            source_key=spec["source_key"],
            source_type="blog",
            title=spec["title"],
            url=spec["url"],
            publisher=spec.get("publisher"),
            period_covered=spec.get("period_covered"),
            region=spec.get("region", "turkey"),
        )
        stats = await ingest_external_source(
            conn,
            doc_text=text,
            content_hash=chash,
            source=source,
            azure_client=azure_client,
            model_name=model_name,
        )
        results.append({"source_key": spec["source_key"], **stats})
    return results


async def ingest_youtube_channel(
    conn: "asyncpg.Connection",
    channel_url: str,
    *,
    azure_client: Any,
    model_name: str,
    max_videos: int = 5,
) -> List[Dict[str, Any]]:
    """Fetch the N most recent videos from a channel, transcribe + distill each."""
    if yt_dlp is None:
        raise RuntimeError("yt-dlp is not installed")

    def _list_recent() -> List[Dict[str, Any]]:
        videos_url = channel_url.rstrip("/")
        if not videos_url.endswith(("/videos", "/streams", "/shorts")):
            videos_url = f"{videos_url}/videos"
        opts = {
            "quiet": True,
            "no_warnings": True,
            "skip_download": True,
            "extract_flat": "in_playlist",
            "playlistend": max_videos,
        }
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(videos_url, download=False) or {}
        return info.get("entries", [])

    entries = await asyncio.to_thread(_list_recent)
    results: List[Dict[str, Any]] = []
    for entry in entries[:max_videos]:
        if not isinstance(entry, dict):
            continue
        vid = entry.get("id")
        if not vid:
            continue
        video_url = f"https://www.youtube.com/watch?v={vid}"
        try:
            text, chash = await fetch_youtube_transcript(video_url)
        except Exception as exc:
            results.append({"source_key": f"yt_{vid}", "error": str(exc)})
            continue
        source = SourceMeta(
            source_key=f"yt_{vid}",
            source_type="youtube_transcript",
            title=str(entry.get("title") or f"YouTube video {vid}")[:200],
            url=video_url,
            publisher=channel_url,
            region="turkey",
        )
        stats = await ingest_external_source(
            conn,
            doc_text=text,
            content_hash=chash,
            source=source,
            azure_client=azure_client,
            model_name=model_name,
        )
        results.append({"source_key": source.source_key, "title": source.title, **stats})
    return results
