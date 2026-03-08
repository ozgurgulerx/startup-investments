"""Shared validation rules for evidence-gated build patterns."""

from __future__ import annotations

import re
from collections.abc import Mapping, Sequence
from typing import Any


MICRO_MODEL_MESHES_NAME = "Micro-model Meshes"
MICRO_MODEL_MESHES_MIN_CONFIDENCE = 0.65

_MICRO_MODEL_MESH_STRONG_PATTERNS = [
    re.compile(r"\bmixture(?:s)? of experts\b", re.IGNORECASE),
    re.compile(r"\bmoe\b", re.IGNORECASE),
    re.compile(r"\bmodel routing\b", re.IGNORECASE),
    re.compile(r"\bmodel router\b", re.IGNORECASE),
    re.compile(r"\brouter\b", re.IGNORECASE),
    re.compile(r"\bensemble(?:s)?\b", re.IGNORECASE),
    re.compile(r"\broute(?:s|d|ing)? to\b", re.IGNORECASE),
]

_MICRO_MODEL_MESH_LEFT_PATTERNS = [
    re.compile(r"\btask-specific model(?:s)?\b", re.IGNORECASE),
    re.compile(r"\bspecialized model(?:s)?(?: for\b)?", re.IGNORECASE),
    re.compile(r"\bdistilled model(?:s)?\b", re.IGNORECASE),
    re.compile(r"\bsmall language model(?:s)?\b", re.IGNORECASE),
    re.compile(r"\bslm(?:s)?\b", re.IGNORECASE),
]

_MICRO_MODEL_MESH_RIGHT_PATTERNS = [
    re.compile(r"\bmodel routing\b", re.IGNORECASE),
    re.compile(r"\bmodel router\b", re.IGNORECASE),
    re.compile(r"\brouter\b", re.IGNORECASE),
    re.compile(r"\bensemble(?:s)?\b", re.IGNORECASE),
    re.compile(r"\bmodel selection\b", re.IGNORECASE),
    re.compile(r"\bdispatch(?:es|ed|ing)?\b", re.IGNORECASE),
    re.compile(r"\broute(?:s|d|ing)? to\b", re.IGNORECASE),
]


def _coerce_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _coerce_text_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        items: list[str] = []
        for item in value:
            text = _coerce_text(item)
            if text:
                items.append(text)
        return items
    text = _coerce_text(value)
    return [text] if text else []


def _get_field(item: Any, field: str, default: Any = None) -> Any:
    if isinstance(item, Mapping):
        return item.get(field, default)
    return getattr(item, field, default)


def micro_model_meshes_evidence_is_strong(*texts: str) -> bool:
    """Return whether the provided text contains explicit mesh evidence."""
    haystack = " ".join(text for text in texts if text).strip()
    if not haystack:
        return False

    if any(pattern.search(haystack) for pattern in _MICRO_MODEL_MESH_STRONG_PATTERNS):
        return True

    has_left = any(pattern.search(haystack) for pattern in _MICRO_MODEL_MESH_LEFT_PATTERNS)
    has_right = any(pattern.search(haystack) for pattern in _MICRO_MODEL_MESH_RIGHT_PATTERNS)
    return has_left and has_right


def pattern_is_allowed(
    name: str,
    confidence: float,
    evidence: Sequence[str] | None = None,
    description: str | None = None,
    *,
    content: str = "",
) -> bool:
    """Return whether a pattern should be retained downstream."""
    pattern_name = _coerce_text(name)
    if pattern_name != MICRO_MODEL_MESHES_NAME:
        return bool(pattern_name)

    try:
        confidence_value = float(confidence)
    except (TypeError, ValueError):
        confidence_value = 0.0
    if confidence_value < MICRO_MODEL_MESHES_MIN_CONFIDENCE:
        return False

    evidence_texts = _coerce_text_list(evidence)
    description_text = _coerce_text(description)
    return micro_model_meshes_evidence_is_strong(content, description_text, *evidence_texts)


def filter_pattern_items(
    items: Sequence[Any] | None,
    *,
    content: str = "",
    name_key: str = "name",
    confidence_key: str = "confidence",
    evidence_key: str = "evidence",
    description_key: str = "description",
) -> list[Any]:
    """Filter a pattern collection using shared evidence-gating rules."""
    filtered: list[Any] = []
    for item in items or []:
        name = _coerce_text(_get_field(item, name_key, ""))
        confidence = _get_field(item, confidence_key, 0.0)
        evidence = _coerce_text_list(_get_field(item, evidence_key, []))
        description = _coerce_text(_get_field(item, description_key, ""))
        if pattern_is_allowed(name, confidence, evidence, description, content=content):
            filtered.append(item)
    return filtered


def pattern_names(
    items: Sequence[Any] | None,
    *,
    content: str = "",
    name_key: str = "name",
    confidence_key: str = "confidence",
    evidence_key: str = "evidence",
    description_key: str = "description",
) -> list[str]:
    """Return validated pattern names from a pattern collection."""
    names: list[str] = []
    for item in filter_pattern_items(
        items,
        content=content,
        name_key=name_key,
        confidence_key=confidence_key,
        evidence_key=evidence_key,
        description_key=description_key,
    ):
        name = _coerce_text(_get_field(item, name_key, ""))
        if name:
            names.append(name)
    return names
