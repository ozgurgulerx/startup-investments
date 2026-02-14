"""Guardrail: shipped shell scripts must not contain CRLF line endings.

CR bytes can break bash options (e.g. `set -euo pipefail` -> `pipefail\\r`).
"""

from __future__ import annotations

from pathlib import Path


def test_no_crlf_in_shipped_shell_scripts():
    repo_root = Path(__file__).resolve().parents[3]
    roots = [
        repo_root / "scripts",
        repo_root / "infrastructure" / "vm-cron",
    ]

    shell_scripts: list[Path] = []
    for root in roots:
        if root.exists():
            shell_scripts.extend(root.rglob("*.sh"))

    bad: list[str] = []
    for path in shell_scripts:
        data = path.read_bytes()
        if b"\r" in data:
            bad.append(str(path.relative_to(repo_root)))

    assert not bad, "Shell scripts must be LF-only (no CR bytes). Found CR in: " + ", ".join(bad)

