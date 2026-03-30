#!/usr/bin/env python3
"""Track onboarding pipeline runs and best-effort per-startup progress in Postgres."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import psycopg2
from psycopg2.extras import Json


def _database_url() -> str:
    value = (os.getenv("DATABASE_URL") or "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL environment variable not set")
    return value


def _connect():
    return psycopg2.connect(_database_url())


def _load_progress_payload(path: Path) -> Dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"Expected object in {path}")
    return payload


def _stage_item_status(stage: str) -> str:
    normalized = str(stage or "").strip().lower()
    if normalized in {"error", "failed", "failure"}:
        return "failed"
    if normalized in {"complete", "completed", "done"}:
        return "completed"
    return "running"


def start_run(args: argparse.Namespace) -> None:
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO onboarding_runs (
                    run_key,
                    pipeline_name,
                    period,
                    region,
                    status,
                    current_stage,
                    latest_stage,
                    artifact_path,
                    metadata_json
                )
                VALUES (%s, %s, %s, %s, 'running', %s, %s, %s, %s)
                ON CONFLICT (run_key) DO UPDATE SET
                    pipeline_name = EXCLUDED.pipeline_name,
                    period = EXCLUDED.period,
                    region = EXCLUDED.region,
                    status = 'running',
                    current_stage = EXCLUDED.current_stage,
                    latest_stage = EXCLUDED.latest_stage,
                    artifact_path = EXCLUDED.artifact_path,
                    metadata_json = onboarding_runs.metadata_json || EXCLUDED.metadata_json,
                    latest_heartbeat_at = NOW(),
                    failure_reason = NULL,
                    completed_at = NULL
                """,
                (
                    args.run_key,
                    args.pipeline_name,
                    args.period,
                    args.region,
                    args.stage,
                    args.stage,
                    args.artifact_path,
                    Json({"job_name": args.job_name} if args.job_name else {}),
                ),
            )
    finally:
        conn.close()


def update_stage(args: argparse.Namespace) -> None:
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE onboarding_runs
                SET
                    status = %s,
                    current_stage = %s,
                    latest_stage = %s,
                    latest_heartbeat_at = NOW(),
                    failure_reason = CASE
                        WHEN %s = 'failed' THEN %s
                        ELSE failure_reason
                    END,
                    completed_at = CASE
                        WHEN %s IN ('completed', 'failed', 'cancelled') THEN NOW()
                        ELSE completed_at
                    END
                WHERE run_key = %s
                """,
                (
                    args.status,
                    args.stage,
                    args.stage,
                    args.status,
                    args.failure_reason,
                    args.status,
                    args.run_key,
                ),
            )
    finally:
        conn.close()


def sync_progress(args: argparse.Namespace) -> None:
    payload = _load_progress_payload(Path(args.progress_json))
    completed = int(payload.get("completed") or 0)
    total = int(payload.get("delta_total") or payload.get("total_in_csv") or 0)
    error_count = int(payload.get("error_count") or 0)
    latest_startup = str(payload.get("latest_startup") or "").strip() or None
    latest_stage = str(payload.get("latest_stage") or payload.get("latest_status") or "running").strip()
    latest_error = str(payload.get("latest_error") or "").strip() or None

    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE onboarding_runs
                SET
                    latest_stage = %s,
                    latest_startup = %s,
                    progress_completed = %s,
                    progress_total = %s,
                    progress_error_count = %s,
                    latest_heartbeat_at = NOW(),
                    metadata_json = onboarding_runs.metadata_json || %s
                WHERE run_key = %s
                RETURNING id
                """,
                (
                    latest_stage,
                    latest_startup,
                    completed,
                    total,
                    error_count,
                    Json({"progress_checkpoint": payload}),
                    args.run_key,
                ),
            )
            row = cur.fetchone()
            if not row or not latest_startup:
                return

            item_status = _stage_item_status(latest_stage)
            cur.execute(
                """
                INSERT INTO onboarding_run_items (
                    run_id,
                    startup_name,
                    stage,
                    status,
                    latest_error,
                    metadata_json,
                    completed_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, CASE WHEN %s IN ('completed', 'failed') THEN NOW() ELSE NULL END)
                ON CONFLICT (run_id, startup_name, stage) DO UPDATE SET
                    status = EXCLUDED.status,
                    latest_error = EXCLUDED.latest_error,
                    metadata_json = onboarding_run_items.metadata_json || EXCLUDED.metadata_json,
                    updated_at = NOW(),
                    completed_at = CASE
                        WHEN EXCLUDED.status IN ('completed', 'failed') THEN NOW()
                        ELSE onboarding_run_items.completed_at
                    END
                """,
                (
                    row[0],
                    latest_startup,
                    latest_stage,
                    item_status,
                    latest_error,
                    Json({"progress_checkpoint": payload}),
                    item_status,
                ),
            )
    finally:
        conn.close()


def finish_run(args: argparse.Namespace) -> None:
    conn = _connect()
    try:
        with conn, conn.cursor() as cur:
            cur.execute(
                """
                UPDATE onboarding_runs
                SET
                    status = %s,
                    completed_at = NOW(),
                    latest_heartbeat_at = NOW(),
                    failure_reason = %s
                WHERE run_key = %s
                """,
                (args.status, args.failure_reason, args.run_key),
            )
    finally:
        conn.close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    start = subparsers.add_parser("start", help="Create or refresh an onboarding run row")
    start.add_argument("--run-key", required=True)
    start.add_argument("--period", required=True)
    start.add_argument("--region", default="global")
    start.add_argument("--pipeline-name", default="global-onboarding")
    start.add_argument("--stage", default="starting")
    start.add_argument("--artifact-path")
    start.add_argument("--job-name")
    start.set_defaults(func=start_run)

    stage = subparsers.add_parser("stage", help="Update the current onboarding stage")
    stage.add_argument("--run-key", required=True)
    stage.add_argument("--stage", required=True)
    stage.add_argument("--status", default="running")
    stage.add_argument("--failure-reason")
    stage.set_defaults(func=update_stage)

    progress = subparsers.add_parser("progress", help="Sync progress.json into onboarding_runs")
    progress.add_argument("--run-key", required=True)
    progress.add_argument("--progress-json", required=True)
    progress.set_defaults(func=sync_progress)

    finish = subparsers.add_parser("finish", help="Mark an onboarding run finished")
    finish.add_argument("--run-key", required=True)
    finish.add_argument("--status", choices=["completed", "failed", "cancelled"], required=True)
    finish.add_argument("--failure-reason")
    finish.set_defaults(func=finish_run)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
