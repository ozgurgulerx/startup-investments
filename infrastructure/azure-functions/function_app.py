"""Azure Functions for Build Atlas automation.

Includes:
- CSV Blob processing (event-triggered)
- Pending blobs check (timer-triggered, every 30 min)
- Website content monitoring (timer-triggered, every 6 hours)
- RSS feed consumption (timer-triggered, every hour)
- Event processing (timer-triggered, every 15 min)
- Deep research queue processing (timer-triggered, every 30 min)
- Pattern correlation computation (timer-triggered, daily)
- Staleness check (timer-triggered, daily)
- Deploy trigger with batching (timer-triggered, every 30 min)
"""

import os
import azure.functions as func
import logging
import json
import asyncio
from datetime import datetime, timezone

app = func.FunctionApp()


def _setup_analysis_path():
    """Add analysis package to path."""
    import sys
    paths_to_add = [
        "/home/site/wwwroot/packages_analysis",
        "/home/site/wwwroot/packages/analysis",
    ]
    for path in paths_to_add:
        if path not in sys.path:
            sys.path.insert(0, path)


@app.blob_trigger(
    arg_name="blob",
    path="startup-csvs/incoming/{name}",
    connection="AzureWebJobsStorage"
)
async def process_csv_blob(blob: func.InputStream):
    """Triggered when a new CSV file is uploaded to incoming/ folder.

    Args:
        blob: The uploaded blob (CSV file)
    """
    logging.info(f"Processing blob: {blob.name}, Size: {blob.length} bytes")

    try:
        # Import here to avoid cold start issues
        import sys
        sys.path.insert(0, "/home/site/wwwroot/packages/analysis")

        from src.pipeline.blob_processor import BlobProcessor, BlobConfig
        from src.data.store import AnalysisStore

        # Initialize
        config = BlobConfig(
            connection_string=os.environ.get("AzureWebJobsStorage", ""),
            container_name="startup-csvs"
        )

        store = AnalysisStore()
        processor = BlobProcessor(config=config, store=store)

        # Process the blob
        report = await processor.process_blob(blob.name)

        logging.info(f"Processing complete: {json.dumps({
            'blob': blob.name,
            'status': report.status,
            'total_rows': report.total_rows,
            'new': report.new_startups,
            'updated': report.updated_startups,
            'unchanged': report.unchanged_startups,
            'errors': report.errors,
            'duration_ms': report.processing_time_ms
        })}")

        if report.status == "failed":
            logging.error(f"Processing failed: {report.error_message}")
            raise Exception(report.error_message)

    except Exception as e:
        logging.error(f"Error processing blob {blob.name}: {str(e)}")
        raise


@app.timer_trigger(
    schedule="0 */30 * * * *",  # Every 30 minutes
    arg_name="timer",
    run_on_startup=False
)
async def check_pending_blobs(timer: func.TimerRequest):
    """Backup timer trigger to check for any missed blobs.

    Runs every 30 minutes as a safety net.
    """
    logging.info("Timer trigger: Checking for pending blobs...")

    try:
        import sys
        sys.path.insert(0, "/home/site/wwwroot/packages/analysis")

        from src.pipeline.blob_processor import BlobProcessor, BlobConfig
        from src.data.store import AnalysisStore

        config = BlobConfig(
            connection_string=os.environ.get("AzureWebJobsStorage", ""),
            container_name="startup-csvs"
        )

        store = AnalysisStore()
        processor = BlobProcessor(config=config, store=store)

        # List and process any pending blobs
        pending = await processor.list_pending_blobs()
        logging.info(f"Found {len(pending)} pending blobs")

        for blob_name in pending:
            logging.info(f"Processing pending blob: {blob_name}")
            report = await processor.process_blob(blob_name)
            logging.info(f"Completed: {report.status}")

    except Exception as e:
        logging.error(f"Timer trigger error: {str(e)}")
        raise


@app.route(route="health", methods=["GET"])
def health_check(req: func.HttpRequest) -> func.HttpResponse:
    """Health check endpoint."""
    return func.HttpResponse(
        json.dumps({
            "status": "healthy",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "service": "csv-processor"
        }),
        mimetype="application/json"
    )


@app.route(route="process", methods=["POST"])
async def manual_process(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger to process a specific blob.

    POST /api/process
    Body: {"blob_name": "incoming/file.csv"}
    """
    try:
        body = req.get_json()
        blob_name = body.get("blob_name")

        if not blob_name:
            return func.HttpResponse(
                json.dumps({"error": "blob_name required"}),
                status_code=400,
                mimetype="application/json"
            )

        import sys
        sys.path.insert(0, "/home/site/wwwroot/packages/analysis")

        from src.pipeline.blob_processor import BlobProcessor, BlobConfig
        from src.data.store import AnalysisStore

        config = BlobConfig(
            connection_string=os.environ.get("AzureWebJobsStorage", ""),
            container_name="startup-csvs"
        )

        store = AnalysisStore()
        processor = BlobProcessor(config=config, store=store)

        report = await processor.process_blob(blob_name)

        return func.HttpResponse(
            json.dumps({
                "status": report.status,
                "blob": blob_name,
                "total_rows": report.total_rows,
                "new_startups": report.new_startups,
                "updated_startups": report.updated_startups,
                "unchanged_startups": report.unchanged_startups,
                "errors": report.errors,
                "processing_time_ms": report.processing_time_ms,
                "error_message": report.error_message
            }),
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )


# =============================================================================
# WEBSITE CONTENT MONITORING
# =============================================================================

@app.timer_trigger(
    schedule="0 0 */6 * * *",  # Every 6 hours
    arg_name="timer",
    run_on_startup=False
)
async def monitor_websites(timer: func.TimerRequest):
    """Monitor startup websites for content changes.

    Runs every 6 hours to detect website updates.
    """
    logging.info("Timer trigger: Starting website monitoring...")

    try:
        _setup_analysis_path()
        from src.automation.website_monitor import run_website_monitor

        results = await run_website_monitor(limit=100, max_concurrent=5)

        success = sum(1 for r in results if r.success)
        changed = sum(1 for r in results if r.content_changed)
        events = sum(1 for r in results if r.event_created)

        logging.info(f"Website monitoring complete: {success}/{len(results)} success, {changed} changed, {events} events")

    except Exception as e:
        logging.error(f"Website monitoring error: {str(e)}")
        raise


# =============================================================================
# RSS FEED CONSUMPTION
# =============================================================================

@app.timer_trigger(
    schedule="0 0 * * * *",  # Every hour
    arg_name="timer",
    run_on_startup=False
)
async def consume_rss_feeds(timer: func.TimerRequest):
    """Consume RSS feeds to detect funding news and startup mentions.

    Runs every hour to catch new articles.
    """
    logging.info("Timer trigger: Starting RSS feed consumption...")

    try:
        _setup_analysis_path()
        from src.automation.rss_consumer import run_rss_consumer

        results = await run_rss_consumer(lookback_hours=2)

        total_events = sum(r.events_created for r in results)
        success_count = sum(1 for r in results if r.success)

        logging.info(f"RSS consumption complete: {success_count}/{len(results)} feeds, {total_events} events")

    except Exception as e:
        logging.error(f"RSS consumption error: {str(e)}")
        raise


# =============================================================================
# EVENT PROCESSING
# =============================================================================

@app.timer_trigger(
    schedule="0 */15 * * * *",  # Every 15 minutes
    arg_name="timer",
    run_on_startup=False
)
async def process_startup_events(timer: func.TimerRequest):
    """Process startup events and route to appropriate handlers.

    Runs every 15 minutes to handle new events quickly.
    """
    logging.info("Timer trigger: Starting event processing...")

    try:
        _setup_analysis_path()
        from src.automation.event_processor import run_event_processor

        results = await run_event_processor(batch_size=50)

        success = sum(1 for r in results if r.success)
        reanalyzed = sum(1 for r in results if r.triggered_reanalysis)

        logging.info(f"Event processing complete: {success}/{len(results)} success, {reanalyzed} triggered reanalysis")

    except Exception as e:
        logging.error(f"Event processing error: {str(e)}")
        raise


# =============================================================================
# DEEP RESEARCH QUEUE PROCESSING
# =============================================================================

@app.timer_trigger(
    schedule="0 */30 * * * *",  # Every 30 minutes
    arg_name="timer",
    run_on_startup=False
)
async def process_research_queue(timer: func.TimerRequest):
    """Process deep research queue items.

    Runs every 30 minutes to handle LLM-based analysis.
    """
    logging.info("Timer trigger: Starting research queue processing...")

    try:
        _setup_analysis_path()
        from src.automation.deep_research_consumer import run_consumer

        results = await run_consumer(batch_size=5, max_concurrent=2)

        success = sum(1 for r in results if r.success)
        total_tokens = sum(r.tokens_used for r in results)
        total_cost = sum(r.cost_usd for r in results)

        logging.info(f"Research processing complete: {success}/{len(results)} success, {total_tokens} tokens, ${total_cost:.4f}")

    except Exception as e:
        logging.error(f"Research processing error: {str(e)}")
        raise


# =============================================================================
# PATTERN CORRELATION COMPUTATION
# =============================================================================

@app.timer_trigger(
    schedule="0 0 2 * * *",  # Daily at 2 AM
    arg_name="timer",
    run_on_startup=False
)
async def compute_pattern_correlations(timer: func.TimerRequest):
    """Compute pattern correlations across startups.

    Runs daily to update pattern co-occurrence statistics.
    """
    logging.info("Timer trigger: Starting pattern correlation computation...")

    try:
        _setup_analysis_path()
        from src.automation.pattern_correlator import run_pattern_correlator

        results = await run_pattern_correlator()

        logging.info(f"Pattern correlation complete: {len(results)} correlations computed")

    except Exception as e:
        logging.error(f"Pattern correlation error: {str(e)}")
        raise


# =============================================================================
# MANUAL TRIGGER ENDPOINTS
# =============================================================================

@app.route(route="trigger/websites", methods=["POST"])
async def manual_website_monitor(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for website monitoring.

    POST /api/trigger/websites
    Body: {"limit": 50}
    """
    try:
        body = req.get_json() if req.get_body() else {}
        limit = body.get("limit", 50)

        _setup_analysis_path()
        from src.automation.website_monitor import run_website_monitor

        results = await run_website_monitor(limit=limit, max_concurrent=5)

        return func.HttpResponse(
            json.dumps({
                "status": "completed",
                "total": len(results),
                "success": sum(1 for r in results if r.success),
                "changed": sum(1 for r in results if r.content_changed),
                "events_created": sum(1 for r in results if r.event_created)
            }),
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )


@app.route(route="trigger/rss", methods=["POST"])
async def manual_rss_consumer(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for RSS consumption.

    POST /api/trigger/rss
    Body: {"lookback_hours": 24}
    """
    try:
        body = req.get_json() if req.get_body() else {}
        lookback_hours = body.get("lookback_hours", 24)

        _setup_analysis_path()
        from src.automation.rss_consumer import run_rss_consumer

        results = await run_rss_consumer(lookback_hours=lookback_hours)

        return func.HttpResponse(
            json.dumps({
                "status": "completed",
                "feeds_processed": len(results),
                "feeds_success": sum(1 for r in results if r.success),
                "total_items": sum(r.items_fetched for r in results),
                "events_created": sum(r.events_created for r in results)
            }),
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )


@app.route(route="trigger/events", methods=["POST"])
async def manual_event_processor(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for event processing.

    POST /api/trigger/events
    Body: {"batch_size": 50}
    """
    try:
        body = req.get_json() if req.get_body() else {}
        batch_size = body.get("batch_size", 50)

        _setup_analysis_path()
        from src.automation.event_processor import run_event_processor

        results = await run_event_processor(batch_size=batch_size)

        return func.HttpResponse(
            json.dumps({
                "status": "completed",
                "events_processed": len(results),
                "success": sum(1 for r in results if r.success),
                "triggered_reanalysis": sum(1 for r in results if r.triggered_reanalysis)
            }),
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )


@app.route(route="trigger/research", methods=["POST"])
async def manual_research_consumer(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for research queue processing.

    POST /api/trigger/research
    Body: {"batch_size": 5, "max_concurrent": 2}
    """
    try:
        body = req.get_json() if req.get_body() else {}
        batch_size = body.get("batch_size", 5)
        max_concurrent = body.get("max_concurrent", 2)

        _setup_analysis_path()
        from src.automation.deep_research_consumer import run_consumer

        results = await run_consumer(batch_size=batch_size, max_concurrent=max_concurrent)

        return func.HttpResponse(
            json.dumps({
                "status": "completed",
                "items_processed": len(results),
                "success": sum(1 for r in results if r.success),
                "total_tokens": sum(r.tokens_used for r in results),
                "total_cost_usd": sum(r.cost_usd for r in results)
            }),
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )


@app.route(route="trigger/correlations", methods=["POST"])
async def manual_pattern_correlator(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for pattern correlation computation.

    POST /api/trigger/correlations
    Body: {"period": "2026-01"}
    """
    try:
        body = req.get_json() if req.get_body() else {}
        period = body.get("period")

        _setup_analysis_path()
        from src.automation.pattern_correlator import run_pattern_correlator

        results = await run_pattern_correlator(period=period)

        return func.HttpResponse(
            json.dumps({
                "status": "completed",
                "correlations_computed": len(results),
                "top_correlations": [
                    {
                        "pattern_a": r.pattern_a,
                        "pattern_b": r.pattern_b,
                        "lift": r.lift_score,
                        "correlation": r.correlation_coefficient
                    }
                    for r in sorted(results, key=lambda x: x.lift_score, reverse=True)[:10]
                ] if results else []
            }),
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )


# =============================================================================
# STALENESS CHECK
# =============================================================================

@app.timer_trigger(
    schedule="0 0 3 * * *",  # Daily at 3 AM
    arg_name="timer",
    run_on_startup=False
)
async def check_staleness(timer: func.TimerRequest):
    """Check for stale startups that need re-crawling.

    Runs daily to identify startups not updated in 90+ days.
    Queues them for re-analysis via the deep research queue.
    """
    logging.info("Timer trigger: Starting staleness check...")

    try:
        _setup_analysis_path()
        from src.storage import SnapshotManager
        from src.automation.db import DatabaseManager

        snapshot_manager = SnapshotManager()
        db = DatabaseManager()

        # Get stale startups (90+ days since last analysis)
        stale_startups = snapshot_manager.get_stale_startups(max_days=90, limit=50)
        logging.info(f"Found {len(stale_startups)} stale startups")

        if not stale_startups:
            logging.info("No stale startups found")
            return

        # Queue them for re-analysis
        queued = 0
        async with db.get_connection() as conn:
            for startup in stale_startups:
                try:
                    # Get startup ID from slug
                    result = await conn.fetchrow(
                        "SELECT id FROM startups WHERE slug = $1",
                        startup["slug"]
                    )
                    if not result:
                        continue

                    startup_id = result["id"]

                    # Check if already queued
                    existing = await conn.fetchrow(
                        """SELECT id FROM deep_research_queue
                           WHERE startup_id = $1 AND status IN ('pending', 'processing')""",
                        startup_id
                    )
                    if existing:
                        continue

                    # Add to deep research queue
                    await conn.execute(
                        """INSERT INTO deep_research_queue
                           (startup_id, priority, trigger_reason, created_at)
                           VALUES ($1, $2, $3, $4)""",
                        startup_id,
                        3,  # Medium priority for staleness refresh
                        "staleness_refresh",
                        datetime.now(timezone.utc)
                    )
                    queued += 1

                except Exception as e:
                    logging.warning(f"Error queueing {startup['slug']}: {e}")

        logging.info(f"Staleness check complete: {queued} startups queued for refresh")

    except Exception as e:
        logging.error(f"Staleness check error: {str(e)}")
        raise


@app.route(route="trigger/staleness", methods=["POST"])
async def manual_staleness_check(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for staleness check.

    POST /api/trigger/staleness
    Body: {"max_days": 90, "limit": 50}
    """
    try:
        body = req.get_json() if req.get_body() else {}
        max_days = body.get("max_days", 90)
        limit = body.get("limit", 50)

        _setup_analysis_path()
        from src.storage import SnapshotManager

        snapshot_manager = SnapshotManager()
        stale_startups = snapshot_manager.get_stale_startups(max_days=max_days, limit=limit)

        return func.HttpResponse(
            json.dumps({
                "status": "completed",
                "stale_count": len(stale_startups),
                "max_days": max_days,
                "stale_startups": [
                    {
                        "slug": s["slug"],
                        "last_analyzed": s["last_analyzed"],
                        "days_since": s["days_since"]
                    }
                    for s in stale_startups[:20]  # Limit response size
                ]
            }),
            mimetype="application/json"
        )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )


# =============================================================================
# DEPLOY TRIGGER WITH BATCHING
# =============================================================================

# Track pending changes for batching
_pending_changes_key = "pending_deploy_changes"


@app.timer_trigger(
    schedule="0 */30 * * * *",  # Every 30 minutes
    arg_name="timer",
    run_on_startup=False
)
async def check_deploy_trigger(timer: func.TimerRequest):
    """Check for pending changes and trigger deploy if needed.

    Runs every 30 minutes as a batching window to avoid excessive deploys.
    Triggers GitHub Actions workflow via repository_dispatch.
    """
    logging.info("Timer trigger: Checking for pending deploy changes...")

    try:
        _setup_analysis_path()
        from src.automation.db import DatabaseManager

        db = DatabaseManager()

        # Check for recent changes that need syncing
        # Look for analyses updated in last 30 minutes
        async with db.get_connection() as conn:
            recent_changes = await conn.fetch(
                """SELECT COUNT(*) as count, MAX(updated_at) as last_update
                   FROM startups
                   WHERE updated_at > NOW() - INTERVAL '30 minutes'"""
            )

            change_count = recent_changes[0]["count"] if recent_changes else 0
            last_update = recent_changes[0]["last_update"] if recent_changes else None

        if change_count == 0:
            logging.info("No pending changes, skipping deploy trigger")
            return

        logging.info(f"Found {change_count} changes, triggering deploy...")

        # Trigger GitHub Actions via repository_dispatch
        import aiohttp

        github_token = os.environ.get("GITHUB_TOKEN")
        repo = os.environ.get("GITHUB_REPO", "buildatlas/startup-analysis")

        if not github_token:
            logging.warning("GITHUB_TOKEN not configured, skipping deploy trigger")
            return

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://api.github.com/repos/{repo}/dispatches",
                headers={
                    "Authorization": f"Bearer {github_token}",
                    "Accept": "application/vnd.github.v3+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                json={
                    "event_type": "data-updated",
                    "client_payload": {
                        "changes": change_count,
                        "last_update": last_update.isoformat() if last_update else None,
                        "trigger": "batched_timer",
                    }
                }
            ) as response:
                if response.status == 204:
                    logging.info(f"Deploy triggered successfully for {change_count} changes")
                else:
                    error = await response.text()
                    logging.error(f"Failed to trigger deploy: {response.status} - {error}")

    except Exception as e:
        logging.error(f"Deploy trigger error: {str(e)}")
        raise

@app.route(route="trigger/deploy", methods=["POST"])
async def manual_deploy_trigger(req: func.HttpRequest) -> func.HttpResponse:
    """Manual trigger for deploy (bypasses batching).

    POST /api/trigger/deploy
    Body: {"force": true}
    """
    try:
        body = req.get_json() if req.get_body() else {}
        force = body.get("force", False)

        import aiohttp

        github_token = os.environ.get("GITHUB_TOKEN")
        repo = os.environ.get("GITHUB_REPO", "buildatlas/startup-analysis")

        if not github_token:
            return func.HttpResponse(
                json.dumps({"error": "GITHUB_TOKEN not configured"}),
                status_code=500,
                mimetype="application/json"
            )

        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"https://api.github.com/repos/{repo}/dispatches",
                headers={
                    "Authorization": f"Bearer {github_token}",
                    "Accept": "application/vnd.github.v3+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                json={
                    "event_type": "sync-data",
                    "client_payload": {
                        "force": force,
                        "trigger": "manual",
                        "triggered_at": datetime.now(timezone.utc).isoformat(),
                    }
                }
            ) as response:
                if response.status == 204:
                    return func.HttpResponse(
                        json.dumps({
                            "status": "triggered",
                            "message": "Deploy workflow triggered successfully"
                        }),
                        mimetype="application/json"
                    )
                else:
                    error = await response.text()
                    return func.HttpResponse(
                        json.dumps({"error": f"GitHub API error: {error}"}),
                        status_code=response.status,
                        mimetype="application/json"
                    )

    except Exception as e:
        return func.HttpResponse(
            json.dumps({"error": str(e)}),
            status_code=500,
            mimetype="application/json"
        )
