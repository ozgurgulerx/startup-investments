"""Tests for the ecosystem memory seed loaders (PR #4.1)."""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from src.intelligence import ecosystem_memory


# ---------------------------------------------------------------------------
# YAML seed structure validation — catches curator mistakes
# ---------------------------------------------------------------------------


def test_ecosystem_facts_seed_parses():
    data = yaml.safe_load(ecosystem_memory.ECOSYSTEM_FACTS_SEED.read_text(encoding="utf-8"))
    assert isinstance(data, list)
    assert len(data) >= 15, "expected at least 15 baseline facts"


def test_startup_exclusions_seed_parses():
    data = yaml.safe_load(ecosystem_memory.STARTUP_EXCLUSIONS_SEED.read_text(encoding="utf-8"))
    assert isinstance(data, list)
    assert len(data) >= 30, "expected a substantial blocklist"


def test_ecosystem_facts_seed_schema():
    data = yaml.safe_load(ecosystem_memory.ECOSYSTEM_FACTS_SEED.read_text(encoding="utf-8"))
    required = {"region", "fact_key", "fact_value", "narrative", "source_type", "as_of_date"}
    for entry in data:
        missing = required - set(entry.keys())
        assert not missing, f"entry missing fields {missing}: {entry}"
        assert entry["region"] in ("global", "turkey"), entry
        assert entry["source_type"] in (
            "report",
            "news_aggregate",
            "ecosystem_index",
            "curated",
            "transcript",
        )
        conf = entry.get("confidence", 0.8)
        assert 0.0 <= float(conf) <= 1.0, entry


def test_startup_exclusions_seed_schema():
    data = yaml.safe_load(ecosystem_memory.STARTUP_EXCLUSIONS_SEED.read_text(encoding="utf-8"))
    valid_categories = {
        "grocery_retail",
        "bank",
        "telecom",
        "media",
        "holding",
        "public_corp",
        "consumer_brand",
        "real_estate",
        "defense_prime",
        "education",
        "energy",
        "other",
    }
    for entry in data:
        assert "entity_name" in entry
        assert entry["category"] in valid_categories, entry


def test_a101_is_excluded():
    """Regression guard — the entity that prompted this whole PR must be in the list."""
    data = yaml.safe_load(ecosystem_memory.STARTUP_EXCLUSIONS_SEED.read_text(encoding="utf-8"))
    names = {str(e["entity_name"]).lower() for e in data}
    assert "a101" in names
    # Neighbours that commonly collide with startup news
    for must in ("bim", "migros", "akbank", "türk telekom", "turkcell"):
        assert must in names, f"{must!r} missing from exclusions"


def test_unicorn_seed_present():
    """Seed must include the canonical 'TR has 7 unicorns' context."""
    data = yaml.safe_load(ecosystem_memory.ECOSYSTEM_FACTS_SEED.read_text(encoding="utf-8"))
    unicorn_facts = [e for e in data if e["fact_key"] == "unicorn_count"]
    assert unicorn_facts, "no unicorn_count fact in seed"
    assert any(e["region"] == "turkey" for e in unicorn_facts)


def test_global_and_turkey_both_seeded():
    """Commentary needs global context to contrast against Turkey."""
    data = yaml.safe_load(ecosystem_memory.ECOSYSTEM_FACTS_SEED.read_text(encoding="utf-8"))
    regions = {e["region"] for e in data}
    assert "turkey" in regions
    assert "global" in regions


# ---------------------------------------------------------------------------
# Module surface — the functions the rest of the pipeline imports
# ---------------------------------------------------------------------------


def test_public_api_surface():
    """Callers in news_ingest.py (PR #4.2–4.3) depend on these symbols."""
    for name in (
        "load_ecosystem_facts_seed",
        "load_startup_exclusions_seed",
        "load_ecosystem_facts_for_brief",
        "load_exclusion_index",
        "ECOSYSTEM_FACTS_SEED",
        "STARTUP_EXCLUSIONS_SEED",
        "CURATED_SOURCE_KEY",
    ):
        assert hasattr(ecosystem_memory, name), f"missing public attr: {name}"


def test_seed_paths_resolve_to_repo():
    """Path anchor must land inside the repo regardless of cwd."""
    assert isinstance(ecosystem_memory.ECOSYSTEM_FACTS_SEED, Path)
    assert ecosystem_memory.ECOSYSTEM_FACTS_SEED.exists()
    assert ecosystem_memory.STARTUP_EXCLUSIONS_SEED.exists()


# ---------------------------------------------------------------------------
# Migration file presence
# ---------------------------------------------------------------------------


def test_migration_file_exists():
    """Schema migration must ship alongside the code that uses it."""
    repo_root = ecosystem_memory.REPO_ROOT
    migration = repo_root / "database" / "migrations" / "084_ecosystem_memory.sql"
    assert migration.exists()
    sql = migration.read_text(encoding="utf-8")
    for must in (
        "news_ecosystem_facts",
        "news_ecosystem_sources",
        "startup_exclusions",
        "CREATE INDEX",
    ):
        assert must in sql, f"migration missing {must!r}"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
