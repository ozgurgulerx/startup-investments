#!/usr/bin/env python3
"""
Extract founders and founder->startup edges from startups.watch XLSX export.

This parser avoids openpyxl/pandas by reading OOXML directly.

Usage:
  python scripts/extract-startups-watch-founders.py \
    --xlsx /path/to/startups.watch.xlsx \
    --region turkey \
    --out-dir data/manual/turkey_graph_seed
"""

from __future__ import annotations

import argparse
import csv
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Tuple
from xml.etree import ElementTree as ET


NS = {"a": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
COL_RE = re.compile(r"^([A-Z]+)")
SPLIT_RE = re.compile(r"\s+(?:and|ve)\s+|\s+&\s+|,|;|/|\|", re.IGNORECASE)
DENY = {
    "",
    "-",
    "n/a",
    "na",
    "unknown",
    "confidential",
    "stealth",
}


@dataclass(frozen=True)
class RowRecord:
    row_id: str
    startup: str
    headquarter: str
    people: str


def col_index(ref: str) -> int:
    m = COL_RE.match(ref or "")
    if not m:
        return 0
    s = m.group(1)
    n = 0
    for ch in s:
        n = n * 26 + (ord(ch) - 64)
    return n - 1


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "").strip())


def cell_value(cell: ET.Element, shared: List[str]) -> str:
    ctype = cell.attrib.get("t")
    if ctype == "inlineStr":
        return normalize_space("".join(t.text or "" for t in cell.findall(".//a:t", NS)))
    v = cell.find("a:v", NS)
    if v is None or v.text is None:
        return ""
    raw = v.text.strip()
    if ctype == "s":
        try:
            return normalize_space(shared[int(raw)])
        except Exception:
            return ""
    return normalize_space(raw)


def load_sheet_rows(xlsx_path: Path) -> List[Dict[int, str]]:
    with zipfile.ZipFile(xlsx_path) as zf:
        shared: List[str] = []
        if "xl/sharedStrings.xml" in zf.namelist():
            sroot = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in sroot.findall("a:si", NS):
                shared.append("".join(t.text or "" for t in si.findall(".//a:t", NS)))

        root = ET.fromstring(zf.read("xl/worksheets/sheet1.xml"))
        rows: List[Dict[int, str]] = []
        for row in root.findall(".//a:sheetData/a:row", NS):
            out: Dict[int, str] = {}
            for c in row.findall("a:c", NS):
                out[col_index(c.attrib.get("r", "A1"))] = cell_value(c, shared)
            rows.append(out)
        return rows


def parse_region(headquarter: str) -> str:
    hq = (headquarter or "").lower()
    if "turkey" in hq:
        return "turkey"
    return "global"


def clean_founder_name(raw: str) -> str:
    name = normalize_space(raw)
    if not name:
        return ""
    name = re.sub(r"\(.*?\)", "", name).strip()
    name = re.sub(r"^(dr|prof|mr|mrs|ms|sn)\.?\s+", "", name, flags=re.IGNORECASE).strip()
    if not name:
        return ""
    lower = name.lower()
    if lower in DENY:
        return ""
    if "@" in name or "http://" in lower or "https://" in lower:
        return ""
    # Keep initials like "M. Ayberk Kurt", but drop single very-short tokens.
    if len(name.split()) == 1 and len(name) < 3:
        return ""
    return name


def split_people(people: str) -> List[str]:
    text = normalize_space(people)
    if not text:
        return []
    names: List[str] = []
    seen = set()
    for part in SPLIT_RE.split(text):
        n = clean_founder_name(part)
        if not n:
            continue
        key = n.lower()
        if key in seen:
            continue
        seen.add(key)
        names.append(n)
    return names


def to_records(rows: List[Dict[int, str]]) -> List[RowRecord]:
    if not rows:
        return []
    header = [rows[0].get(i, "") for i in range(15)]
    idx = {name: i for i, name in enumerate(header)}
    required = ["Id", "Startup", "Headquarter", "People"]
    for req in required:
        if req not in idx:
            raise ValueError(f"Missing expected column: {req!r}")

    out: List[RowRecord] = []
    for row in rows[1:]:
        startup = normalize_space(row.get(idx["Startup"], ""))
        people = normalize_space(row.get(idx["People"], ""))
        if not startup or not people:
            continue
        out.append(
            RowRecord(
                row_id=normalize_space(row.get(idx["Id"], "")),
                startup=startup,
                headquarter=normalize_space(row.get(idx["Headquarter"], "")),
                people=people,
            )
        )
    return out


def iter_filtered(records: Iterable[RowRecord], region: str) -> Iterable[Tuple[RowRecord, str]]:
    for rec in records:
        row_region = parse_region(rec.headquarter)
        if region != "all" and row_region != region:
            continue
        yield rec, row_region


def write_csv(path: Path, rows: List[Dict[str, str]], fieldnames: List[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames)
        w.writeheader()
        w.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Extract founders from startups.watch XLSX")
    parser.add_argument("--xlsx", required=True, help="Path to startups.watch XLSX")
    parser.add_argument("--out-dir", required=True, help="Output directory for CSV files")
    parser.add_argument("--region", default="turkey", choices=["global", "turkey", "all"])
    parser.add_argument("--source", default="startups_watch_manual")
    parser.add_argument("--default-confidence", type=float, default=0.70)
    args = parser.parse_args()

    xlsx_path = Path(args.xlsx)
    if not xlsx_path.exists():
        raise SystemExit(f"XLSX not found: {xlsx_path}")

    out_dir = Path(args.out_dir)

    rows = load_sheet_rows(xlsx_path)
    records = to_records(rows)

    founder_rows: List[Dict[str, str]] = []
    edge_rows: List[Dict[str, str]] = []
    startup_founder_rows: List[Dict[str, str]] = []

    founder_seen = set()
    edge_seen = set()
    link_seen = set()

    for rec, row_region in iter_filtered(records, args.region):
        founders = split_people(rec.people)
        if not founders:
            continue

        for founder_name in founders:
            f_key = founder_name.lower()
            if f_key not in founder_seen:
                founder_seen.add(f_key)
                founder_rows.append(
                    {
                        "full_name": founder_name,
                        "slug": "",
                        "linkedin_url": "",
                        "x_url": "",
                        "website": "",
                        "bio": "",
                        "primary_country": "Turkey" if row_region == "turkey" else "",
                        "aliases": "",
                    }
                )

            edge_key = (f_key, rec.startup.lower(), row_region)
            if edge_key not in edge_seen:
                edge_seen.add(edge_key)
                edge_rows.append(
                    {
                        "src_type": "founder",
                        "src_key": founder_name,
                        "edge_type": "FOUNDED",
                        "dst_type": "startup",
                        "dst_key": rec.startup,
                        "region": row_region,
                        "attrs_json": (
                            '{"origin":"startups.watch","field":"People","row_id":"%s"}'
                            % (rec.row_id or "")
                        ),
                        "source": args.source,
                        "source_ref": f"startups.watch:{rec.row_id}" if rec.row_id else "startups.watch",
                        "confidence": f"{args.default_confidence:.2f}",
                        "created_by": "xlsx_seed",
                        "valid_from": "1900-01-01",
                        "valid_to": "9999-12-31",
                    }
                )

            link_key = (rec.startup.lower(), f_key, row_region)
            if link_key not in link_seen:
                link_seen.add(link_key)
                startup_founder_rows.append(
                    {
                        "startup_key": rec.startup,
                        "founder_key": founder_name,
                        "region": row_region,
                        "role": "founder",
                        "is_current": "true",
                        "source": args.source,
                        "confidence": f"{args.default_confidence:.2f}",
                        "start_date": "",
                        "end_date": "",
                    }
                )

    founders_csv = out_dir / "founders.csv"
    edges_csv = out_dir / "edges.csv"
    startup_founders_csv = out_dir / "startup_founders.csv"

    write_csv(
        founders_csv,
        founder_rows,
        ["full_name", "slug", "linkedin_url", "x_url", "website", "bio", "primary_country", "aliases"],
    )
    write_csv(
        edges_csv,
        edge_rows,
        [
            "src_type",
            "src_key",
            "edge_type",
            "dst_type",
            "dst_key",
            "region",
            "attrs_json",
            "source",
            "source_ref",
            "confidence",
            "created_by",
            "valid_from",
            "valid_to",
        ],
    )
    write_csv(
        startup_founders_csv,
        startup_founder_rows,
        ["startup_key", "founder_key", "region", "role", "is_current", "source", "confidence", "start_date", "end_date"],
    )

    print(f"Extracted founders: {len(founder_rows)}")
    print(f"Extracted founder->startup edges: {len(edge_rows)}")
    print(f"Extracted startup_founders links: {len(startup_founder_rows)}")
    print(f"Wrote: {founders_csv}")
    print(f"Wrote: {edges_csv}")
    print(f"Wrote: {startup_founders_csv}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
