"""Tests for onboarding trace helpers."""

from src.automation.onboarding_trace import (
    build_dedupe_key,
    classify_research_failure,
    guidance_for_reason,
)


def test_build_dedupe_key_is_stable_for_same_input():
    key1 = build_dedupe_key("deep_research", "failed", "startup-1")
    key2 = build_dedupe_key("deep_research", "failed", "startup-1")
    assert key1 == key2


def test_build_dedupe_key_changes_when_parts_change():
    key1 = build_dedupe_key("deep_research", "failed", "startup-1")
    key2 = build_dedupe_key("deep_research", "failed", "startup-2")
    assert key1 != key2


def test_classify_research_failure_missing_credentials_is_actionable():
    result = classify_research_failure("Missing credentials. Please pass one of ...")
    assert result["actionable"] is True
    assert result["reason_code"] == "missing_openai_credentials"


def test_classify_research_failure_timeout_is_not_actionable():
    result = classify_research_failure("OpenAI API call timed out after 180s")
    assert result["actionable"] is False
    assert result["reason_code"] == "transient_timeout"


def test_classify_research_failure_retry_exhausted_is_actionable():
    result = classify_research_failure("internal error", retry_count=3, max_retries=3)
    assert result["actionable"] is True
    assert result["reason_code"] == "retry_exhausted"


def test_guidance_for_reason_defaults():
    guidance = guidance_for_reason("nonexistent_reason")
    assert "Review details" in guidance


def test_guidance_for_missing_openai_library_is_actionable():
    guidance = guidance_for_reason("missing_openai_library")
    assert "openai" in guidance.lower()
