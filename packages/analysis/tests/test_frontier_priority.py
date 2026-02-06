"""Tests for frontier page classification and priority scoring."""

from src.crawl_runtime.frontier import classify_page_type, score_frontier_priority, compute_next_recrawl


def test_classify_page_type_pricing():
    assert classify_page_type("https://acme.com/pricing") == "pricing"


def test_classify_page_type_docs():
    assert classify_page_type("https://acme.com/developer/api/reference") == "docs"


def test_priority_prefers_new_high_value_pages():
    pricing = score_frontier_priority("pricing", change_rate=0.7, is_new=True)
    generic = score_frontier_priority("generic", change_rate=0.0, is_new=False)
    assert pricing > generic


def test_recrawl_windows_change_with_change_rate():
    fast = compute_next_recrawl(change_rate=0.8, page_type="pricing")
    slow = compute_next_recrawl(change_rate=0.05, page_type="pricing")
    assert fast < slow
