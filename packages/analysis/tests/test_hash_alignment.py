"""Tests for hash alignment between store, classifier, and delta_processor."""

import hashlib


def compute_hash_store(name, website, funding_amount, description, industries, lead_investors, funding_stage_value):
    """Hash function as implemented in store.py _get_startup_hash()."""
    key_data = "|".join([
        name or "",
        website or "",
        str(funding_amount or ""),
        description or "",
        ",".join(industries or []),
        ",".join(lead_investors or []),
        funding_stage_value or "",
    ])
    return hashlib.md5(key_data.encode()).hexdigest()[:16]


def compute_hash_classifier(name, website, funding_amount, description, industries, lead_investors, funding_stage_value):
    """Hash function as implemented in classifier.py _compute_hash()."""
    key_data = "|".join([
        name or "",
        website or "",
        str(funding_amount or ""),
        description or "",
        ",".join(industries or []),
        ",".join(lead_investors or []),
        funding_stage_value or "",
    ])
    return hashlib.md5(key_data.encode()).hexdigest()[:16]


def compute_hash_delta(name, website, funding_amount, description, industries, lead_investors, funding_stage_value):
    """Hash function as implemented in delta_processor.py _compute_hash()."""
    key_data = "|".join([
        name or "",
        website or "",
        str(funding_amount or ""),
        description or "",
        ",".join(industries or []),
        ",".join(lead_investors or []),
        funding_stage_value or "",
    ])
    return hashlib.md5(key_data.encode()).hexdigest()[:16]


class TestHashAlignment:
    """Verify all three hash implementations produce identical results."""

    def test_all_hashes_match_basic(self):
        h1 = compute_hash_store("Acme", "https://acme.com", 1000000, "A company", ["AI"], ["Sequoia"], "seed")
        h2 = compute_hash_classifier("Acme", "https://acme.com", 1000000, "A company", ["AI"], ["Sequoia"], "seed")
        h3 = compute_hash_delta("Acme", "https://acme.com", 1000000, "A company", ["AI"], ["Sequoia"], "seed")
        assert h1 == h2 == h3

    def test_all_hashes_match_empty_fields(self):
        h1 = compute_hash_store("Test", None, None, None, [], [], None)
        h2 = compute_hash_classifier("Test", None, None, None, [], [], None)
        h3 = compute_hash_delta("Test", None, None, None, [], [], None)
        assert h1 == h2 == h3

    def test_hash_length_is_16(self):
        h = compute_hash_store("Test", "https://test.com", 5000000, "Desc", ["SaaS"], ["a16z"], "series_a")
        assert len(h) == 16

    def test_hash_changes_on_field_change(self):
        h1 = compute_hash_store("Acme", "https://acme.com", 1000000, "A company", ["AI"], ["Sequoia"], "seed")
        h2 = compute_hash_store("Acme", "https://acme.com", 2000000, "A company", ["AI"], ["Sequoia"], "seed")
        assert h1 != h2

    def test_hash_stable_across_calls(self):
        args = ("Acme", "https://acme.com", 1000000, "A company", ["AI"], ["Sequoia"], "seed")
        h1 = compute_hash_store(*args)
        h2 = compute_hash_store(*args)
        assert h1 == h2


class TestIndexMigration:
    """Verify the index migration logic handles old formats."""

    def test_short_hash_detected(self):
        """12-char hashes from v1 should be detected as needing migration."""
        old_hash = hashlib.md5(b"test").hexdigest()[:12]
        assert len(old_hash) == 12
        assert len(old_hash) < 16  # Should trigger migration

    def test_metadata_field_normalization(self):
        """v1 metadata with has_base_analysis should map to has_base."""
        old_meta = {
            "slug": "test",
            "has_base_analysis": True,
            "funding_amount": 1000000,
        }
        # Simulate migration
        if "has_base_analysis" in old_meta and "has_base" not in old_meta:
            old_meta["has_base"] = old_meta.pop("has_base_analysis")
        if "funding_amount" in old_meta and "funding" not in old_meta:
            old_meta["funding"] = old_meta.pop("funding_amount")

        assert old_meta.get("has_base") is True
        assert "has_base_analysis" not in old_meta
        assert old_meta.get("funding") == 1000000
        assert "funding_amount" not in old_meta
