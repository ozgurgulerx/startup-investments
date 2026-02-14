"""Tests for onboarding alerts Slack body rendering."""

from src.automation.onboarding_alerts import _build_body


def test_build_body_parses_region_from_payload_json_string():
    body = _build_body(
        {"payload_json": "{\"region\":\"turkey\"}"},
        context_url="https://buildatlas.net",
    )
    assert "*Region:* `turkey`" in body


def test_build_body_handles_invalid_payload_json_string():
    body = _build_body(
        {"payload_json": "not-json"},
        context_url="https://buildatlas.net",
    )
    assert "*Region:* `global`" in body


def test_build_body_accepts_payload_json_dict():
    body = _build_body(
        {"payload_json": {"region": "turkey"}},
        context_url="https://buildatlas.net",
    )
    assert "*Region:* `turkey`" in body


def test_build_body_startup_region_takes_precedence():
    body = _build_body(
        {"startup_region": "turkey", "payload_json": "{\"region\":\"global\"}"},
        context_url="https://buildatlas.net",
    )
    assert "*Region:* `turkey`" in body

