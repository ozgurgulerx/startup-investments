"""Azure Function for processing CSV files from Blob Storage.

Triggers when a new CSV file is uploaded to the incoming/ folder.
"""

import os
import azure.functions as func
import logging
import json
import asyncio
from datetime import datetime, timezone

app = func.FunctionApp()


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
