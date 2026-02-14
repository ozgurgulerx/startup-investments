#!/usr/bin/env python3
"""Normalize CRLF line endings in shell scripts copied into pipelines image.

Some build environments may check out with CRLF line endings even when the repo
enforces LF via .gitattributes. CR bytes can break bash options parsing
(e.g. `set -euo pipefail` -> `pipefail\\r`).

This script is invoked by `infrastructure/pipelines/Dockerfile`.
"""

import pathlib
import sys


def main() -> int:
    roots = [
        pathlib.Path("scripts"),
        pathlib.Path("infrastructure") / "vm-cron",
    ]

    shell_scripts: list[pathlib.Path] = []
    for root in roots:
        if root.exists():
            shell_scripts.extend(root.rglob("*.sh"))

    normalized = 0
    bad: list[str] = []

    for path in shell_scripts:
        data = path.read_bytes()
        if b"\r" in data:
            new = data.replace(b"\r\n", b"\n").replace(b"\r", b"")
            path.write_bytes(new)
            normalized += 1

        if b"\r" in path.read_bytes():
            bad.append(str(path))

    if bad:
        sys.stderr.write("CRLF normalization failed for: " + ", ".join(bad) + "\n")
        return 1

    print(f"Shell script EOL check: {len(shell_scripts)} checked, {normalized} normalized")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
