#!/usr/bin/env python3
"""
Sync startups.csv into the backend database via the admin endpoint.

This is used by VM cron to keep Postgres in sync with the file-based datasets
deployed under apps/web/data/**.

Input CSV format: startups.watch export (same schema as apps/web/data/*/input/startups.csv)

Requires env vars:
- API_URL (optional; defaults to production Front Door endpoint)
- ADMIN_KEY (required)

Optional env vars:
- API_KEY (not required for /api/admin/*, but harmless)

Usage:
  python scripts/sync-startups-to-api.py --csv apps/web/data/2026-02/input/startups.csv --region global
  python scripts/sync-startups-to-api.py --csv apps/web/data/tr/2026-02/input/startups.csv --region turkey
"""

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional


DEFAULT_API_URL = "https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net"


def normalize_region(value: str) -> str:
    raw = (value or "").strip().lower()
    if raw in {"tr", "turkey"}:
        return "turkey"
    if raw in {"global", ""}:
        return "global"
    raise ValueError(f"Invalid region: {value!r} (expected global|turkey|tr)")


def extract_company_name(transaction_name: str) -> str:
    raw = (transaction_name or "").strip()
    if not raw:
        return ""
    if " - " in raw:
        # Common format: "<round> - <company>"
        _, right = raw.split(" - ", 1)
        right = right.strip()
        if right:
            return right
    return raw


def row_to_startup_payload(row: Dict[str, str]) -> Dict[str, Any]:
    tx = (row.get("Transaction Name") or "").strip()
    name = extract_company_name(tx)

    # Support legacy/export variations by reading the canonical startups.watch headers.
    def get(key: str) -> str:
        return (row.get(key) or "").strip()

    return {
        "name": name,
        "description": get("Organization Description"),
        "website": get("Organization Website"),
        "location": get("Organization Location"),
        "industries": get("Organization Industries"),
        "roundType": get("Funding Type"),
        "amountUsd": get("Money Raised (in USD)") or get("Money Raised"),
        "announcedDate": get("Announced Date"),
        "fundingStage": get("Funding Stage"),
        "leadInvestors": get("Lead Investors"),
    }


def post_json(url: str, payload: Dict[str, Any], *, admin_key: str, api_key: Optional[str], timeout_s: int) -> Dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    req.add_header("X-Admin-Key", admin_key)
    if api_key:
        req.add_header("X-API-Key", api_key)

    try:
        with urllib.request.urlopen(req, timeout=timeout_s) as resp:
            body = resp.read().decode("utf-8") if resp.readable() else ""
            return json.loads(body) if body else {}
    except urllib.error.HTTPError as e:
        body = ""
        try:
            body = e.read().decode("utf-8")
        except Exception:
            pass
        raise RuntimeError(f"HTTP {e.code} {e.reason}: {body[:500]}") from e


def chunked(items: List[Dict[str, Any]], size: int) -> List[List[Dict[str, Any]]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync startups.csv to backend via /api/admin/sync-startups")
    parser.add_argument("--csv", required=True, help="Path to startups.csv")
    parser.add_argument("--region", default="global", help="Dataset region: global|turkey (legacy alias: tr)")
    parser.add_argument("--chunk-size", type=int, default=500, help="Max startups per request (default: 500)")
    parser.add_argument("--timeout", type=int, default=90, help="HTTP timeout seconds (default: 90)")
    parser.add_argument("--sleep", type=float, default=0.0, help="Sleep seconds between chunks (default: 0)")
    args = parser.parse_args()

    region = normalize_region(args.region)
    csv_path = args.csv

    api_url = (os.getenv("API_URL") or os.getenv("NEXT_PUBLIC_API_URL") or DEFAULT_API_URL).rstrip("/")
    admin_key = os.getenv("ADMIN_KEY", "").strip()
    api_key = (os.getenv("API_KEY") or "").strip() or None

    if not admin_key:
        print("ERROR: ADMIN_KEY is not set (required for /api/admin/sync-startups)", file=sys.stderr)
        return 2

    startups: List[Dict[str, Any]] = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            payload = row_to_startup_payload(row)
            if not payload["name"]:
                continue
            startups.append(payload)

    if not startups:
        print("No startups found in CSV; nothing to sync.")
        return 0

    url = f"{api_url}/api/admin/sync-startups?region={region}"
    chunks = chunked(startups, max(1, args.chunk_size))

    print(f"Syncing {len(startups)} startups to {url} (chunks={len(chunks)})")

    inserted_total = 0
    updated_total = 0
    failed_total = 0

    for idx, chunk in enumerate(chunks, start=1):
        resp = post_json(
            url,
            {"startups": chunk},
            admin_key=admin_key,
            api_key=api_key,
            timeout_s=max(5, int(args.timeout)),
        )

        # API response shape: { message, results: { inserted, updated, failed, ... } }
        # (Some older environments may have returned counts at top-level.)
        results_obj: Any = resp.get("results") if isinstance(resp, dict) else None
        if isinstance(results_obj, dict):
            result = results_obj
        elif isinstance(resp, dict):
            result = resp
        else:
            result = {}

        inserted = int(result.get("inserted") or 0)
        updated = int(result.get("updated") or 0)
        failed = result.get("failed") or []

        inserted_total += inserted
        updated_total += updated
        failed_total += len(failed) if isinstance(failed, list) else 0

        print(
            f"  chunk {idx}/{len(chunks)}: inserted={inserted} updated={updated} failed={len(failed) if isinstance(failed, list) else 0}"
        )

        if args.sleep and idx < len(chunks):
            time.sleep(max(0.0, float(args.sleep)))

    print(f"Done. inserted={inserted_total} updated={updated_total} failed={failed_total}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
