"""Pytest config for analysis package tests."""

import importlib.util
from pathlib import Path
import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def pytest_sessionstart(session: pytest.Session) -> None:
    """Fail fast with an actionable setup hint when critical deps are missing."""
    required_modules = {
        "bs4": "beautifulsoup4",
    }
    missing = [pkg for module, pkg in required_modules.items() if importlib.util.find_spec(module) is None]
    if not missing:
        return

    repo_root = ROOT.parent.parent
    local_venv_python = repo_root / "venv" / "bin" / "python"
    if local_venv_python.exists():
        suggested = (
            f"{local_venv_python} -m pip install -e {ROOT}[dev] && "
            f"{local_venv_python} -m pytest -q"
        )
    else:
        suggested = f"python -m pip install -e {ROOT}[dev] && python -m pytest -q"

    raise pytest.UsageError(
        "Missing required Python test dependencies: "
        f"{', '.join(missing)}. Use the project environment before running tests.\n"
        f"Suggested command: {suggested}"
    )
