#!/usr/bin/env python3
"""
Sync startups from a BuildAtlas-formatted startups.csv into the backend database via
the admin API endpoint.

This script exists so VM cron + GitHub Actions can share the same sync logic.

Usage:
  python3 scripts/sync-startups-to-api.py --csv apps/web/data/2026-02/input/startups.csv --region global
  python3 scripts/sync-startups-to-api.py --csv apps/web/data/tr/2026-02/input/startups.csv --region turkey

Env:
  API_URL     (default: https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net)
  API_KEY     (required in production)
  ADMIN_KEY   (required)
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Tuple


DEFAULT_API_URL = "https://startupapi-f7gfbpbtbtfqdmdv.b02.azurefd.net"


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    if v is None or str(v).strip() == "":
        return default
    return str(v)


def _normalize_region(raw: str) -> str:
    r = (raw or "").strip().lower()
    if r in ("turkey", "tr"):
        return "turkey"
    return "global"


def _parse_csv_rows(csv_path: Path) -> List[Dict[str, str]]:
    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    startups: List[Dict[str, str]] = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if not isinstance(row, dict):
                continue

            name = (row.get("Transaction Name") or "").strip()
            if " - " in name:
                # Crunchbase-style: "INV123 - Company"
                name = name.split(" - ", 1)[1].strip()

            if not name:
                continue

            website = (row.get("Organization Website") or "").strip() or (row.get("Transaction Name URL") or "").strip()

            startups.append(
                {
                    "name": name,
                    "description": (row.get("Organization Description") or "").strip(),
                    "website": website,
                    "location": (row.get("Organization Location") or "").strip(),
                    "industries": (row.get("Organization Industries") or "").strip(),
                    "roundType": (row.get("Funding Type") or "").strip(),
                    "amountUsd": (row.get("Money Raised (in USD)") or row.get("Money Raised") or "").strip(),
                    "announcedDate": (row.get("Announced Date") or "").strip(),
                    "fundingStage": (row.get("Funding Stage") or "").strip(),
                    "leadInvestors": (row.get("Lead Investors") or "").strip(),
                }
            )

    return startups


def _post_chunk(
    *,
    api_url: str,
    api_key: str,
    admin_key: str,
    region: str,
    startups: List[Dict[str, str]],
    timeout_s: int,
) -> Dict[str, Any]:
    params = {}
    if region and region != "global":
        params["region"] = region
    qs = urllib.parse.urlencode(params)
    url = f"{api_url.rstrip('/')}/api/admin/sync-startups{('?' + qs) if qs else ''}"

    payload = json.dumps({"startups": startups}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={
            "Content-Type": "application/json; charset=utf-8",
            "X-API-Key": api_key,
            "X-Admin-Key": admin_key,
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw) if raw else {}


def _accumulate_results(acc: Dict[str, int], resp: Dict[str, Any]) -> None:
    results = resp.get("results") if isinstance(resp, dict) else None
    if not isinstance(results, dict):
        return
    for key, out_key in (("total", "total"), ("inserted", "inserted"), ("updated", "updated")):
        v = results.get(key)
        if isinstance(v, int):
            acc[out_key] += v

    failed = results.get("failed")
    if isinstance(failed, list):
        acc["failed"] += len(failed)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync startups.csv to BuildAtlas backend via /api/admin/sync-startups")
    parser.add_argument("--csv", required=True, help="Path to startups.csv")
    parser.add_argument("--region", default="global", help="Dataset region: global|turkey|tr (default: global)")
    parser.add_argument("--api-url", default=None, help=f"Override API_URL (default: {DEFAULT_API_URL})")
    parser.add_argument("--chunk-size", type=int, default=1000, help="Rows per request (default: 1000)")
    parser.add_argument("--timeout", type=int, default=120, help="Request timeout seconds (default: 120)")
    args = parser.parse_args()

    region = _normalize_region(args.region)
    api_url = args.api_url or _env("API_URL") or DEFAULT_API_URL
    api_key = _env("API_KEY") or ""
    admin_key = _env("ADMIN_KEY") or ""

    if not api_key:
        sys.stderr.write("ERROR: API_KEY is not set\n")
        return 2
    if not admin_key:
        sys.stderr.write("ERROR: ADMIN_KEY is not set\n")
        return 2

    csv_path = Path(args.csv).expanduser().resolve()
    startups = _parse_csv_rows(csv_path)

    if not startups:
        print(f"No startups parsed from CSV: {csv_path}")
        return 0

    chunk_size = max(1, int(args.chunk_size))
    timeout_s = max(10, int(args.timeout))

    print(f"Syncing CSV to API...")
    print(f"  csv:    {csv_path}")
    print(f"  region: {region}")
    print(f"  api:    {api_url}")
    print(f"  rows:   {len(startups)}")
    print(f"  chunk:  {chunk_size}")

    totals = {"total": 0, "inserted": 0, "updated": 0, "failed": 0}

    for i in range(0, len(startups), chunk_size):
        chunk = startups[i : i + chunk_size]
        try:
            resp = _post_chunk(
                api_url=api_url,
                api_key=api_key,
                admin_key=admin_key,
                region=region,
                startups=chunk,
                timeout_s=timeout_s,
            )
            _accumulate_results(totals, resp)
            print(
                f"  chunk {i//chunk_size + 1}: ok (rows={len(chunk)}) "
                f"inserted={totals['inserted']} updated={totals['updated']} failed={totals['failed']}"
            )
        except urllib.error.HTTPError as e:
            sys.stderr.write(f"HTTP Error {e.code}: {e.reason}\n")
            try:
                sys.stderr.write(e.read().decode("utf-8") + "\n")
            except Exception:
                pass
            return 1
        except urllib.error.URLError as e:
            sys.stderr.write(f"URL Error: {e.reason}\n")
            return 1

    print("Done.")
    print(json.dumps({"results": totals}, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

