"""Small JSON helpers for automation code.

DB JSON/JSONB columns can be returned as either Python objects (dict/list) or
JSON-encoded strings depending on driver/config. These helpers make callers
robust to either shape.
"""

from __future__ import annotations

import json
from typing import Any, Dict


def ensure_json_object(value: Any) -> Dict[str, Any]:
    """Coerce a json/jsonb value into a plain dict.

    Returns {} for None, invalid JSON, or non-object payloads.
    """
    if value is None:
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except Exception:
            return {}
        return dict(parsed) if isinstance(parsed, dict) else {}
    return {}

