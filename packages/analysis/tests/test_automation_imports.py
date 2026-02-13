"""Regression tests for import-time safety in src.automation.

Historically, src.automation.__init__ eagerly imported DeepResearchConsumer, which
imports the `openai` package. That made unrelated cron jobs (e.g. event-processor)
crash at import time if optional deps were missing/broken.
"""

from __future__ import annotations

import builtins
import importlib
import sys

import pytest


def _snapshot_modules(*, prefixes: tuple[str, ...]) -> dict[str, object]:
    snapshot: dict[str, object] = {}
    for name, mod in list(sys.modules.items()):
        for prefix in prefixes:
            if name == prefix or name.startswith(prefix + "."):
                snapshot[name] = mod
                break
    return snapshot


def _clear_modules(*, prefixes: tuple[str, ...]) -> None:
    for name in list(sys.modules.keys()):
        for prefix in prefixes:
            if name == prefix or name.startswith(prefix + "."):
                sys.modules.pop(name, None)
                break


def _restore_modules(*, snapshot: dict[str, object], prefixes: tuple[str, ...]) -> None:
    # Remove any modules imported during the test so we don't leak reloaded module
    # identities into the rest of the suite (which can break isinstance checks
    # and patch() calls).
    _clear_modules(prefixes=prefixes)
    sys.modules.update(snapshot)


def _block_openai_imports(monkeypatch) -> None:
    real_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):  # type: ignore[override]
        if name == "openai" or name.startswith("openai."):
            raise AssertionError("openai imported during src.automation import path")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", guarded_import)


def test_import_src_automation_does_not_import_openai(monkeypatch):
    snapshot = _snapshot_modules(prefixes=("src.automation", "openai"))
    _block_openai_imports(monkeypatch)
    _clear_modules(prefixes=("src.automation", "openai"))
    try:
        importlib.import_module("src.automation")
    finally:
        _restore_modules(snapshot=snapshot, prefixes=("src.automation", "openai"))


def test_import_onboarding_trace_does_not_import_openai(monkeypatch):
    snapshot = _snapshot_modules(prefixes=("src.automation", "openai"))
    _block_openai_imports(monkeypatch)
    _clear_modules(prefixes=("src.automation", "openai"))
    try:
        mod = importlib.import_module("src.automation.onboarding_trace")
        assert hasattr(mod, "build_dedupe_key")
    finally:
        _restore_modules(snapshot=snapshot, prefixes=("src.automation", "openai"))


def test_import_event_processor_does_not_import_openai(monkeypatch):
    pytest.importorskip("asyncpg")
    snapshot = _snapshot_modules(prefixes=("src.automation", "openai"))
    _block_openai_imports(monkeypatch)
    _clear_modules(prefixes=("src.automation", "openai"))
    try:
        importlib.import_module("src.automation.event_processor")
    finally:
        _restore_modules(snapshot=snapshot, prefixes=("src.automation", "openai"))
