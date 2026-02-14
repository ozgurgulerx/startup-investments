"""Unit tests for canonical evidence object helpers."""

from __future__ import annotations

from src.automation.evidence_objects import stable_hash


def test_stable_hash_is_deterministic():
    parts = ["news_item", "gnews", "abc123", "https://example.com/story"]
    assert stable_hash(parts) == stable_hash(list(parts))


def test_stable_hash_changes_with_any_part_change():
    base = ["news_cluster", "cluster_key", "global"]
    assert stable_hash(base) != stable_hash(["news_cluster", "cluster_key", "turkey"])

