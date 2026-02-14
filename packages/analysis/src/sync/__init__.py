"""Sync module for Azure Blob Storage synchronization.

Note: keep this module import-side-effect free.

`sync-data.sh` uses `python -m src.sync.blob_sync ...`. Python's `-m` machinery
imports the parent package (`src.sync`) first. If `src.sync.__init__` eagerly
imports `blob_sync`, `runpy` will warn that the module is already in
`sys.modules` before execution, which can be confusing/noisy in cron logs.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover
    from .blob_sync import BlobSyncManager as BlobSyncManager


def __getattr__(name: str):
    if name == "BlobSyncManager":
        from .blob_sync import BlobSyncManager

        return BlobSyncManager
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = ["BlobSyncManager"]
