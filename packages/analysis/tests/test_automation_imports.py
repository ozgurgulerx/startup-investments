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


def _clear_automation_modules() -> None:
    for name in list(sys.modules.keys()):
        if name == "src.automation" or name.startswith("src.automation."):
            sys.modules.pop(name, None)


def _block_openai_imports(monkeypatch) -> None:
    real_import = builtins.__import__

    def guarded_import(name, globals=None, locals=None, fromlist=(), level=0):  # type: ignore[override]
        if name == "openai" or name.startswith("openai."):
            raise AssertionError("openai imported during src.automation import path")
        return real_import(name, globals, locals, fromlist, level)

    monkeypatch.setattr(builtins, "__import__", guarded_import)


def test_import_src_automation_does_not_import_openai(monkeypatch):
    _block_openai_imports(monkeypatch)
    _clear_automation_modules()

    importlib.import_module("src.automation")


def test_import_onboarding_trace_does_not_import_openai(monkeypatch):
    _block_openai_imports(monkeypatch)
    _clear_automation_modules()

    mod = importlib.import_module("src.automation.onboarding_trace")
    assert hasattr(mod, "build_dedupe_key")


def test_import_event_processor_does_not_import_openai(monkeypatch):
    pytest.importorskip("asyncpg")
    _block_openai_imports(monkeypatch)
    _clear_automation_modules()

    importlib.import_module("src.automation.event_processor")

