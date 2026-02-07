# Modern Crawl Runtime (Scrapy + Playwright + Managed Unblock + WARC-lite)

## Runtime Modes
- `CRAWLER_RUNTIME=legacy`: existing crawl4ai path.
- `CRAWLER_RUNTIME=scrapy`: subprocess Scrapy runtime with optional Playwright rendering.

## Core Components
- `scrapy_runtime.py`: adapter used by `StartupCrawler` and frontier workers.
- `run_spider.py`: isolated subprocess spider entrypoint.
- `frontier.py`: Postgres URL frontier queue and scheduling metadata.
- `worker.py`: lease-based worker loop (`crawl_frontier_batch`).
- `extraction.py`: Trafilatura-first extraction with fallback.
- `pdf_parser.py`: PDF extraction via PyMuPDF.
- `unblock_provider.py`: managed unblock abstraction (Browserless adapter).
- `capture.py`: WARC-lite raw capture recorder (blob body + DB envelope).
- `discovery.py`: feed/sitemap-first URL discovery for seeding.
- `retention.py`: cleanup job for expired raw captures.

## Run Locally
```bash
cd packages/analysis
export DATABASE_URL='postgres://...'
export CRAWLER_RUNTIME=scrapy
python main.py seed-frontier --limit 5000
python -m src.crawl_runtime.worker --once --batch-size 50
```

## Pipeline Behavior
1. URLs are canonicalized and upserted into `crawl_frontier_urls`.
2. Worker leases due URLs from `crawl_frontier_queue`.
3. Spider fetches pages (HTTP first, Playwright fallback for JS shell pages).
4. When blocked/challenged pages are detected, runtime can call managed unblock provider.
4. If `ETag`/`Last-Modified` exist, requests send `If-None-Match` / `If-Modified-Since`.
5. WARC-lite records persist request/response envelope metadata and compressed raw body pointers.
6. Results update frontier metadata (`content_hash`, `etag`, `last_modified`, `change_rate`, quality/policy signals).
7. Queue entries are released with adaptive next run timing (not deleted).
8. Newly discovered internal URLs are re-enqueued.
9. Domain policies update conservatively from block/success outcomes.

## Safety/Recovery
- Stale leases are auto-recovered each batch.
- Missing/failed leased URLs are requeued with backoff.
- 304 responses are treated as unchanged content.
- Domain policy defaults assume AI-blocking pressure and gradually escalate proxy/render strategy.
