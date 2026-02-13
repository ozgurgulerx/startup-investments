#!/usr/bin/env python3
"""
Sync manual investor/founder/graph-edge CSVs into Postgres.

Usage examples:
  python scripts/sync-capital-graph-to-db.py \
    --investors-csv data/manual/investors.csv \
    --founders-csv data/manual/founders.csv \
    --edges-csv data/manual/edges.csv \
    --startup-founders-csv data/manual/startup_founders.csv \
    --region global \
    --refresh-views

CSV conventions (headers are case-insensitive):
- investors: name,type,website,headquarters_country,aliases
- founders: full_name,slug,linkedin_url,x_url,website,bio,primary_country,aliases
- edges: src_type,src_key(or src_id),edge_type,dst_type,dst_key(or dst_id),region,attrs_json,source,source_ref,confidence,created_by,valid_from,valid_to
- startup_founders: startup_key(or startup_id),founder_key(or founder_id),region,role,is_current,source,confidence,start_date,end_date
"""

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

import psycopg2


UUID_RE = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def normalize_region(value: str) -> str:
    raw = (value or "").strip().lower()
    if raw in {"global", ""}:
        return "global"
    if raw in {"tr", "turkey"}:
        return "turkey"
    raise ValueError(f"Invalid region: {value!r} (expected global|turkey|tr)")


def is_uuid(value: str) -> bool:
    return bool(UUID_RE.match((value or "").strip()))


def norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip())


def lower_norm(s: str) -> str:
    return norm(s).lower()


def get_value(row: Dict[str, str], *keys: str) -> str:
    lower_map = {k.lower(): v for k, v in row.items()}
    for k in keys:
        if k.lower() in lower_map:
            return (lower_map[k.lower()] or "").strip()
    return ""


def parse_aliases(raw: str) -> List[str]:
    text = (raw or "").strip()
    if not text:
        return []
    parts = re.split(r"[|;]", text)
    if len(parts) == 1 and "," in text:
        # fallback for comma-separated alias lists
        parts = [p.strip() for p in text.split(",")]
    aliases = []
    seen = set()
    for p in parts:
        a = norm(p)
        if not a:
            continue
        key = a.lower()
        if key in seen:
            continue
        seen.add(key)
        aliases.append(a)
    return aliases


def parse_json(raw: str) -> Dict:
    text = (raw or "").strip()
    if not text:
        return {}
    try:
        value = json.loads(text)
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}


def iter_rows(path: str) -> Iterable[Dict[str, str]]:
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            yield row


@dataclass
class SyncStats:
    investors_upserted: int = 0
    investor_aliases_upserted: int = 0
    founders_upserted: int = 0
    founder_aliases_upserted: int = 0
    graph_edges_upserted: int = 0
    startup_founders_upserted: int = 0
    unresolved_edges: List[str] = field(default_factory=list)
    unresolved_startup_founders: List[str] = field(default_factory=list)


def upsert_investor(cur, row: Dict[str, str], source: str = "manual", confidence: Optional[float] = None) -> Tuple[Optional[str], int]:
    name = norm(get_value(row, "name", "investor_name"))
    if not name:
        return None, 0

    inv_type = get_value(row, "type") or None
    website = get_value(row, "website") or None
    country = get_value(row, "headquarters_country", "country") or None
    aliases = parse_aliases(get_value(row, "aliases", "alias"))

    cur.execute(
        """
        INSERT INTO investors (name, type, website, headquarters_country)
        VALUES (%s, %s, %s, %s)
        ON CONFLICT (name)
        DO UPDATE SET
          type = COALESCE(EXCLUDED.type, investors.type),
          website = COALESCE(EXCLUDED.website, investors.website),
          headquarters_country = COALESCE(EXCLUDED.headquarters_country, investors.headquarters_country)
        RETURNING id::text
        """,
        (name, inv_type, website, country),
    )
    investor_id = cur.fetchone()[0]

    alias_count = 0
    for alias in aliases:
        cur.execute(
            """
            INSERT INTO investor_aliases (investor_id, alias, alias_type, source, confidence)
            VALUES (%s::uuid, %s, 'name_variant', %s, %s)
            ON CONFLICT ((lower(regexp_replace(trim(alias), '\\s+', ' ', 'g'))))
            DO UPDATE SET
              investor_id = EXCLUDED.investor_id,
              source = EXCLUDED.source,
              confidence = EXCLUDED.confidence
            """,
            (investor_id, alias, source, confidence),
        )
        alias_count += 1

    return investor_id, alias_count


def upsert_founder(cur, row: Dict[str, str], source: str = "manual", confidence: Optional[float] = None) -> Tuple[Optional[str], int]:
    full_name = norm(get_value(row, "full_name", "name"))
    if not full_name:
        return None, 0

    slug = get_value(row, "slug") or None
    linkedin_url = get_value(row, "linkedin_url", "linkedin") or None
    x_url = get_value(row, "x_url", "twitter_url", "x") or None
    website = get_value(row, "website") or None
    bio = get_value(row, "bio") or None
    primary_country = get_value(row, "primary_country", "country") or None
    aliases = parse_aliases(get_value(row, "aliases", "alias"))

    cur.execute(
        """
        SELECT id::text
        FROM founders
        WHERE (%s::text IS NOT NULL AND linkedin_url = %s)
           OR (%s::text IS NOT NULL AND x_url = %s)
           OR (%s::text IS NOT NULL AND slug = %s)
           OR lower(regexp_replace(trim(full_name), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(%s), '\\s+', ' ', 'g'))
        ORDER BY
          CASE
            WHEN %s::text IS NOT NULL AND linkedin_url = %s THEN 1
            WHEN %s::text IS NOT NULL AND x_url = %s THEN 2
            WHEN %s::text IS NOT NULL AND slug = %s THEN 3
            ELSE 4
          END ASC
        LIMIT 1
        """,
        (
            linkedin_url, linkedin_url,
            x_url, x_url,
            slug, slug,
            full_name,
            linkedin_url, linkedin_url,
            x_url, x_url,
            slug, slug,
        ),
    )
    existing = cur.fetchone()

    if existing:
        founder_id = existing[0]
        cur.execute(
            """
            UPDATE founders
            SET
              full_name = %s,
              slug = COALESCE(%s, slug),
              linkedin_url = COALESCE(%s, linkedin_url),
              x_url = COALESCE(%s, x_url),
              website = COALESCE(%s, website),
              bio = COALESCE(%s, bio),
              primary_country = COALESCE(%s, primary_country),
              source = COALESCE(%s, source),
              updated_at = NOW()
            WHERE id = %s::uuid
            """,
            (full_name, slug, linkedin_url, x_url, website, bio, primary_country, source, founder_id),
        )
    else:
        cur.execute(
            """
            INSERT INTO founders
              (full_name, slug, linkedin_url, x_url, website, bio, primary_country, source)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id::text
            """,
            (full_name, slug, linkedin_url, x_url, website, bio, primary_country, source),
        )
        founder_id = cur.fetchone()[0]

    alias_count = 0
    for alias in aliases:
        cur.execute(
            """
            INSERT INTO founder_aliases (founder_id, alias, alias_type, source, confidence)
            VALUES (%s::uuid, %s, 'name_variant', %s, %s)
            ON CONFLICT ((lower(regexp_replace(trim(alias), '\\s+', ' ', 'g'))))
            DO UPDATE SET
              founder_id = EXCLUDED.founder_id,
              source = EXCLUDED.source,
              confidence = EXCLUDED.confidence
            """,
            (founder_id, alias, source, confidence),
        )
        alias_count += 1

    return founder_id, alias_count


def resolve_investor_id(cur, key: str) -> Optional[str]:
    value = (key or "").strip()
    if not value:
        return None
    if is_uuid(value):
        return value

    cur.execute(
        """
        SELECT i.id::text
        FROM investors i
        LEFT JOIN investor_aliases ia ON ia.investor_id = i.id
        WHERE lower(i.name) = lower(%s)
           OR lower(regexp_replace(trim(COALESCE(ia.alias, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(%s), '\\s+', ' ', 'g'))
        ORDER BY i.created_at ASC
        LIMIT 1
        """,
        (value, value),
    )
    row = cur.fetchone()
    return row[0] if row else None


def resolve_founder_id(cur, key: str) -> Optional[str]:
    value = (key or "").strip()
    if not value:
        return None
    if is_uuid(value):
        return value

    cur.execute(
        """
        SELECT f.id::text
        FROM founders f
        LEFT JOIN founder_aliases fa ON fa.founder_id = f.id
        WHERE lower(f.full_name) = lower(%s)
           OR lower(COALESCE(f.slug, '')) = lower(%s)
           OR lower(regexp_replace(trim(COALESCE(fa.alias, '')), '\\s+', ' ', 'g')) = lower(regexp_replace(trim(%s), '\\s+', ' ', 'g'))
        ORDER BY f.created_at ASC
        LIMIT 1
        """,
        (value, value, value),
    )
    row = cur.fetchone()
    return row[0] if row else None


def resolve_startup_id(cur, key: str, region: str) -> Optional[str]:
    value = (key or "").strip()
    if not value:
        return None
    if is_uuid(value):
        return value

    cur.execute(
        """
        SELECT s.id::text
        FROM startups s
        LEFT JOIN startup_aliases sa ON sa.startup_id = s.id
        WHERE s.dataset_region = %s
          AND (
               lower(COALESCE(s.slug, '')) = lower(%s)
            OR lower(s.name) = lower(%s)
            OR lower(COALESCE(sa.alias, '')) = lower(%s)
          )
        ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC
        LIMIT 1
        """,
        (region, value, value, value),
    )
    row = cur.fetchone()
    return row[0] if row else None


def resolve_entity_id(cur, entity_type: str, key: str, region: str) -> Optional[str]:
    et = (entity_type or "").strip().lower()
    if et == "investor":
        return resolve_investor_id(cur, key)
    if et == "founder":
        return resolve_founder_id(cur, key)
    if et == "startup":
        return resolve_startup_id(cur, key, region)
    if et == "funding_round":
        return key if is_uuid(key) else None
    return None


def parse_bool(raw: str, default: bool = True) -> bool:
    value = (raw or "").strip().lower()
    if not value:
        return default
    if value in {"1", "true", "yes", "y"}:
        return True
    if value in {"0", "false", "no", "n"}:
        return False
    return default


def upsert_startup_founder_link(cur, row: Dict[str, str], default_region: str) -> Tuple[bool, str]:
    startup_key = get_value(row, "startup_id", "startup_key", "startup")
    founder_key = get_value(row, "founder_id", "founder_key", "founder")
    region = normalize_region(get_value(row, "region") or default_region)
    role = norm(get_value(row, "role") or "founder").lower() or "founder"
    is_current = parse_bool(get_value(row, "is_current"), default=True)
    source = get_value(row, "source") or "manual"
    start_date = get_value(row, "start_date") or None
    end_date = get_value(row, "end_date") or None
    confidence_raw = get_value(row, "confidence")

    if not startup_key or not founder_key:
        return False, "Missing startup/founder keys"

    startup_id = resolve_startup_id(cur, startup_key, region)
    if not startup_id:
        return False, f"Unable to resolve startup_id for {startup_key}"

    founder_id = resolve_founder_id(cur, founder_key)
    if not founder_id:
        return False, f"Unable to resolve founder_id for {founder_key}"

    confidence = None
    if confidence_raw:
        try:
            confidence = float(confidence_raw)
        except Exception:
            confidence = None

    cur.execute(
        """
        INSERT INTO startup_founders
          (startup_id, founder_id, role, is_current, start_date, end_date, source, confidence)
        VALUES (%s::uuid, %s::uuid, %s, %s, %s::date, %s::date, %s, %s)
        ON CONFLICT (startup_id, founder_id, role)
        DO UPDATE SET
          is_current = EXCLUDED.is_current,
          start_date = COALESCE(EXCLUDED.start_date, startup_founders.start_date),
          end_date = COALESCE(EXCLUDED.end_date, startup_founders.end_date),
          source = EXCLUDED.source,
          confidence = COALESCE(EXCLUDED.confidence, startup_founders.confidence),
          updated_at = NOW()
        """,
        (startup_id, founder_id, role, is_current, start_date, end_date, source, confidence),
    )
    return True, "ok"


def upsert_edge(cur, row: Dict[str, str], default_region: str) -> Tuple[bool, str]:
    src_type = get_value(row, "src_type")
    dst_type = get_value(row, "dst_type")
    edge_type = get_value(row, "edge_type")
    src_key = get_value(row, "src_id", "src_key")
    dst_key = get_value(row, "dst_id", "dst_key")
    region = normalize_region(get_value(row, "region") or default_region)

    source = get_value(row, "source") or "manual"
    source_ref = get_value(row, "source_ref") or None
    confidence_raw = get_value(row, "confidence")
    created_by = get_value(row, "created_by") or None
    valid_from = get_value(row, "valid_from") or "1900-01-01"
    valid_to = get_value(row, "valid_to") or "9999-12-31"
    attrs_json = parse_json(get_value(row, "attrs_json"))

    if not src_type or not dst_type or not edge_type or not src_key or not dst_key:
        return False, "Missing required edge fields"

    src_id = resolve_entity_id(cur, src_type, src_key, region)
    if not src_id:
        return False, f"Unable to resolve src_id for {src_type}:{src_key}"

    dst_id = resolve_entity_id(cur, dst_type, dst_key, region)
    if not dst_id:
        return False, f"Unable to resolve dst_id for {dst_type}:{dst_key}"

    if src_type == dst_type and src_id == dst_id:
        return False, "Self-loop edges are not allowed"

    confidence = None
    if confidence_raw:
        try:
            confidence = float(confidence_raw)
        except Exception:
            confidence = None

    cur.execute(
        """
        INSERT INTO capital_graph_edges
          (src_type, src_id, edge_type, dst_type, dst_id, region, attrs_json, source, source_ref, confidence, created_by, valid_from, valid_to)
        VALUES (%s, %s::uuid, %s, %s, %s::uuid, %s, %s::jsonb, %s, %s, %s, %s, %s::date, %s::date)
        ON CONFLICT (src_type, src_id, edge_type, dst_type, dst_id, region, valid_from, valid_to)
        DO UPDATE SET
          attrs_json = EXCLUDED.attrs_json,
          source = EXCLUDED.source,
          source_ref = EXCLUDED.source_ref,
          confidence = EXCLUDED.confidence,
          created_by = EXCLUDED.created_by,
          updated_at = NOW()
        """,
        (
            src_type.strip().lower(),
            src_id,
            edge_type.strip(),
            dst_type.strip().lower(),
            dst_id,
            region,
            json.dumps(attrs_json),
            source,
            source_ref,
            confidence,
            created_by,
            valid_from,
            valid_to,
        ),
    )
    return True, "ok"


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync manual capital graph CSV data into Postgres")
    parser.add_argument("--investors-csv", help="Path to investors CSV")
    parser.add_argument("--founders-csv", help="Path to founders CSV")
    parser.add_argument("--edges-csv", help="Path to edges CSV")
    parser.add_argument("--startup-founders-csv", help="Path to startup_founders CSV")
    parser.add_argument("--region", default="global", help="Default region for edges: global|turkey|tr")
    parser.add_argument("--refresh-views", action="store_true", help="Refresh capital graph materialized views after write")
    parser.add_argument("--dry-run", action="store_true", help="Parse and validate, then rollback changes")
    args = parser.parse_args()

    database_url = (os.getenv("DATABASE_URL") or "").strip()
    if not database_url:
        print("ERROR: DATABASE_URL is not set", file=sys.stderr)
        return 2

    if not any([args.investors_csv, args.founders_csv, args.edges_csv, args.startup_founders_csv]):
        print(
            "ERROR: Provide at least one of --investors-csv, --founders-csv, --edges-csv, --startup-founders-csv",
            file=sys.stderr,
        )
        return 2

    default_region = normalize_region(args.region)

    # Validate files early.
    for path in [args.investors_csv, args.founders_csv, args.edges_csv, args.startup_founders_csv]:
        if path and not Path(path).exists():
            print(f"ERROR: File not found: {path}", file=sys.stderr)
            return 2

    stats = SyncStats()

    conn = psycopg2.connect(database_url)
    conn.autocommit = False

    try:
        with conn.cursor() as cur:
            if args.investors_csv:
                for row in iter_rows(args.investors_csv):
                    investor_id, alias_count = upsert_investor(cur, row)
                    if investor_id:
                        stats.investors_upserted += 1
                        stats.investor_aliases_upserted += alias_count

            if args.founders_csv:
                for row in iter_rows(args.founders_csv):
                    founder_id, alias_count = upsert_founder(cur, row)
                    if founder_id:
                        stats.founders_upserted += 1
                        stats.founder_aliases_upserted += alias_count

            if args.edges_csv:
                for idx, row in enumerate(iter_rows(args.edges_csv), start=1):
                    ok, message = upsert_edge(cur, row, default_region)
                    if ok:
                        stats.graph_edges_upserted += 1
                    else:
                        stats.unresolved_edges.append(f"row {idx}: {message}")

            if args.startup_founders_csv:
                for idx, row in enumerate(iter_rows(args.startup_founders_csv), start=1):
                    ok, message = upsert_startup_founder_link(cur, row, default_region)
                    if ok:
                        stats.startup_founders_upserted += 1
                    else:
                        stats.unresolved_startup_founders.append(f"row {idx}: {message}")

            if args.refresh_views and (stats.graph_edges_upserted > 0):
                cur.execute("SELECT refresh_capital_graph_views()")

        if args.dry_run:
            conn.rollback()
            print("DRY RUN complete (all changes rolled back).")
        else:
            conn.commit()
            print("Sync complete.")

        print(f"  Investors upserted: {stats.investors_upserted}")
        print(f"  Investor aliases upserted: {stats.investor_aliases_upserted}")
        print(f"  Founders upserted: {stats.founders_upserted}")
        print(f"  Founder aliases upserted: {stats.founder_aliases_upserted}")
        print(f"  Graph edges upserted: {stats.graph_edges_upserted}")
        print(f"  Startup-founder links upserted: {stats.startup_founders_upserted}")
        if stats.unresolved_edges:
            print(f"  Unresolved edges: {len(stats.unresolved_edges)}")
            for msg in stats.unresolved_edges[:50]:
                print(f"    - {msg}")
            if len(stats.unresolved_edges) > 50:
                print(f"    ... {len(stats.unresolved_edges) - 50} more")
        if stats.unresolved_startup_founders:
            print(f"  Unresolved startup-founder links: {len(stats.unresolved_startup_founders)}")
            for msg in stats.unresolved_startup_founders[:50]:
                print(f"    - {msg}")
            if len(stats.unresolved_startup_founders) > 50:
                print(f"    ... {len(stats.unresolved_startup_founders) - 50} more")

        unresolved_total = len(stats.unresolved_edges) + len(stats.unresolved_startup_founders)
        return 0 if unresolved_total == 0 else 1
    except Exception as exc:
        conn.rollback()
        print(f"ERROR: sync failed: {exc}", file=sys.stderr)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
