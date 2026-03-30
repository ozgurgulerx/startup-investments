"""Regression coverage for migration-set composition."""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_apply_migrations_module():
    repo_root = Path(__file__).resolve().parents[3]
    module_path = repo_root / "scripts" / "apply_migrations.py"
    spec = importlib.util.spec_from_file_location("buildatlas_apply_migrations", module_path)
    if spec is None or spec.loader is None:
        raise AssertionError("failed to load apply_migrations.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_content_sample_migration_is_in_crawl_and_startup_sets():
    module = _load_apply_migrations_module()

    assert "037_crawl_diff_content_sample.sql" in module.SETS["crawl"]
    assert "037_crawl_diff_content_sample.sql" in module.SETS["startups"]
    assert "037_crawl_diff_content_sample.sql" in module.SETS["news"]


def test_all_set_includes_content_sample_migration():
    module = _load_apply_migrations_module()

    assert "037_crawl_diff_content_sample.sql" in module._files_for_set("all")
