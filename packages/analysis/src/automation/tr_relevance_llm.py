"""PR #4.7 — optional LLM relevance classifier for Turkey items.

The heuristic prefilter (news_ingest._turkey_prefilter) is fast and
catches obvious noise, but borderline items — stories that pass the
keyword gates yet have weak startup signal — can still leak through.
This module adds a cheap batched LLM classifier that runs on those
borderline items and drops anything not classified as startup or
policy news.

Design:

  * Env-gated. `TR_LLM_RELEVANCE_GATE=true` enables it; otherwise the
    classifier is a no-op and callers fall through to legacy behavior.
  * Runs after the heuristic prefilter, BEFORE cluster assembly.
  * Batched: one LLM call per ~10 items, title + 160 chars summary.
  * Classifies each item as one of:
      STARTUP_NEWS   — founder, funding, product launch, exit, pivot
      POLICY_NEWS    — regulation, public program, grant, visa, tax
      CORPORATE_NEWS — earnings, big-company strategy, press release
      CONSUMER_NEWS  — product reviews, lifestyle, generic tech
      OTHER          — unrelated (sports, politics, celebrity, etc.)
  * Keeps STARTUP_NEWS + POLICY_NEWS; drops the rest.
  * Falls back to "keep" on any LLM error so we never silently delete
    items because of a transient API issue.

Separate module (not a monkey-patch of news_ingest) so it can be
unit-tested and toggled without dragging the whole ingest file.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict, List, Sequence, Tuple

logger = logging.getLogger(__name__)


KEEP_LABELS = frozenset({"STARTUP_NEWS", "POLICY_NEWS"})
ALL_LABELS = frozenset({"STARTUP_NEWS", "POLICY_NEWS", "CORPORATE_NEWS", "CONSUMER_NEWS", "OTHER"})


def is_llm_gate_enabled() -> bool:
    """Return True when the env toggle is on. Default: off."""
    return (os.getenv("TR_LLM_RELEVANCE_GATE", "") or "").strip().lower() in (
        "1",
        "true",
        "yes",
        "on",
    )


SYSTEM_PROMPT = """You classify Turkish-language news items for a startup investor newsletter.

Label each item with exactly one of:
  STARTUP_NEWS   — a startup/founder/fund event (funding round, exit,
                    product launch, pivot, hire, layoffs at a named
                    startup, accelerator cohort announcement)
  POLICY_NEWS    — government regulation, public grant/program,
                    tax change, visa/immigration policy, central bank
                    rule affecting tech startups
  CORPORATE_NEWS — quarterly earnings, big-company strategy, press
                    release from a bank/telco/grocery chain that is
                    NOT a startup (e.g. A101, Migros, Akbank the bank,
                    Türk Telekom the operator)
  CONSUMER_NEWS  — product review, gadget launch, lifestyle content
  OTHER          — sports, politics, celebrity, crime, anything else

Return strict JSON: {"labels": ["STARTUP_NEWS", "CORPORATE_NEWS", ...]}
— one label per input item, in the same order. No prose."""


def _build_user_prompt(items: Sequence[Dict[str, str]]) -> str:
    lines = ["Classify these items:"]
    for idx, item in enumerate(items, start=1):
        title = (item.get("title") or "").strip().replace("\n", " ")[:200]
        summary = (item.get("summary") or "").strip().replace("\n", " ")[:160]
        lines.append(f"{idx}. title: {title}")
        if summary:
            lines.append(f"   summary: {summary}")
    return "\n".join(lines)


async def classify_items(
    azure_client: Any,
    model_name: str,
    items: Sequence[Dict[str, str]],
    *,
    batch_size: int = 10,
) -> List[str]:
    """Return a list of labels aligned 1:1 with `items`.

    On any LLM error, returns a list of 'STARTUP_NEWS' (keep) — we must
    not silently drop news because of a transient API failure.
    """
    if not items:
        return []
    if azure_client is None:
        return ["STARTUP_NEWS"] * len(items)

    try:
        from src.config import llm_kwargs
    except Exception:  # pragma: no cover
        return ["STARTUP_NEWS"] * len(items)

    labels: List[str] = []
    for batch_start in range(0, len(items), batch_size):
        batch = items[batch_start : batch_start + batch_size]
        user_prompt = _build_user_prompt(batch)
        try:
            kwargs = llm_kwargs(model_name, max_tokens=400)
            response = await azure_client.chat.completions.create(
                model=model_name,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt},
                ],
                response_format={"type": "json_object"},
                **kwargs,
            )
            content = response.choices[0].message.content or "{}"
            data = json.loads(content) if isinstance(content, str) else {}
        except Exception as exc:
            logger.warning("TR relevance classifier failed on batch: %s", exc)
            labels.extend(["STARTUP_NEWS"] * len(batch))
            continue
        raw_labels = data.get("labels") if isinstance(data, dict) else None
        if not isinstance(raw_labels, list):
            labels.extend(["STARTUP_NEWS"] * len(batch))
            continue
        for idx in range(len(batch)):
            if idx < len(raw_labels):
                candidate = str(raw_labels[idx]).strip().upper()
                labels.append(candidate if candidate in ALL_LABELS else "STARTUP_NEWS")
            else:
                labels.append("STARTUP_NEWS")
    return labels


def should_keep(label: str) -> bool:
    return label.strip().upper() in KEEP_LABELS


async def filter_items(
    azure_client: Any,
    model_name: str,
    items: List[Dict[str, str]],
) -> Tuple[List[Dict[str, str]], Dict[str, int]]:
    """Apply the classifier and return (kept_items, stats_by_label).

    `items` are opaque dicts — caller decides how title/summary map. We only
    read keys 'title' and 'summary'. Callers typically wrap their rich objects
    in a thin dict per item and use an index to restore the original list.
    """
    if not items:
        return [], {}
    if not is_llm_gate_enabled():
        return items, {"gate_disabled": len(items)}

    labels = await classify_items(azure_client, model_name, items)
    kept: List[Dict[str, str]] = []
    stats: Dict[str, int] = {}
    for item, label in zip(items, labels):
        stats[label] = stats.get(label, 0) + 1
        if should_keep(label):
            kept.append(item)
    return kept, stats
