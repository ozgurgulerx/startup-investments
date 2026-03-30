"""Tests for frontier runtime schema verification."""

from __future__ import annotations

import asyncio

from src.crawl_runtime.frontier import FrontierSchemaError, UrlFrontierStore


class FakeAcquire:
    def __init__(self, conn):
        self.conn = conn

    async def __aenter__(self):
        return self.conn

    async def __aexit__(self, exc_type, exc, tb):
        return False


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    def acquire(self):
        return FakeAcquire(self.conn)


class FakeConn:
    def __init__(self, rows):
        self.rows = rows

    async def fetch(self, *_args, **_kwargs):
        return list(self.rows)


def test_verify_runtime_schema_reports_missing_columns():
    rows = [
        {"table_name": "crawl_frontier_urls", "column_name": "canonical_url"},
        {"table_name": "crawl_frontier_urls", "column_name": "startup_slug"},
        {"table_name": "crawl_frontier_queue", "column_name": "canonical_url"},
        {"table_name": "crawl_frontier_queue", "column_name": "available_at"},
        {"table_name": "domain_policies", "column_name": "domain"},
    ]
    store = UrlFrontierStore("postgres://example.invalid/db")
    store.pool = FakePool(FakeConn(rows))

    report = asyncio.run(store.verify_runtime_schema())

    assert report["compatible"] is False
    assert "crawl_frontier_urls" in report["missing_by_table"]
    assert "last_content_sample" in report["missing_by_table"]["crawl_frontier_urls"]


def test_ensure_runtime_schema_raises_frontier_schema_error():
    rows = []
    store = UrlFrontierStore("postgres://example.invalid/db")
    store.pool = FakePool(FakeConn(rows))

    try:
        asyncio.run(store.ensure_runtime_schema())
    except FrontierSchemaError as exc:
        assert "Frontier schema is incompatible" in str(exc)
    else:
        raise AssertionError("expected FrontierSchemaError")
