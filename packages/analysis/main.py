#!/usr/bin/env python3
"""
Startup GenAI Analysis CLI

Analyze startups for GenAI usage patterns and build insights.
"""

import asyncio
import json
import os
from pathlib import Path
from typing import Optional, List

import typer
from rich.console import Console
from rich.table import Table
from rich.progress import Progress, SpinnerColumn, TextColumn
from rich.panel import Panel

from src.config import settings
from src.data.ingestion import load_startups_from_csv, get_pilot_startups, filter_startups
from src.data.models import StartupInput, StartupAnalysis
from src.crawler.engine import StartupCrawler
from src.analysis.genai_detector import GenAIAnalyzer
from src.reports.generator import (
    save_startup_brief,
    create_analysis_only_csv,
    create_enriched_csv,
    generate_batch_summary_report,
    get_logo_path_for_company,
)

app = typer.Typer(help="Startup GenAI Analysis Tool")
console = Console()


@app.command()
def analyze(
    csv_path: Path = typer.Argument(
        ...,
        help="Path to the CSV file with startup data"
    ),
    limit: Optional[int] = typer.Option(
        None,
        "--limit", "-l",
        help="Limit number of startups to analyze"
    ),
    pilot: bool = typer.Option(
        False,
        "--pilot", "-p",
        help="Use curated pilot list of startups"
    ),
    output_dir: Optional[Path] = typer.Option(
        None,
        "--output", "-o",
        help="Output directory for results"
    ),
    period: Optional[str] = typer.Option(
        None,
        "--period",
        help="Period for analysis (e.g., 2026-01). Auto-detected from path if not specified."
    ),
    min_funding: Optional[float] = typer.Option(
        None,
        "--min-funding",
        help="Minimum funding amount to include"
    ),
    enrich_csv: bool = typer.Option(
        True,
        "--enrich-csv/--no-enrich-csv",
        help="Create enriched CSV with analysis columns"
    ),
    skip_crawl: bool = typer.Option(
        False,
        "--skip-crawl",
        help="Skip crawling, use existing cached data only"
    ),
    force_crawl: bool = typer.Option(
        False,
        "--force-crawl",
        help="Ignore cached content, always re-crawl every startup"
    ),
    min_content_chars: int = typer.Option(
        0,
        "--min-content-chars",
        help="Min content chars threshold; retry with deep crawl if below this"
    ),
    upload_to_blob: bool = typer.Option(
        False,
        "--upload-to-blob",
        help="Upload analysis JSONs and briefs to Azure Blob Storage"
    ),
    blob_output_prefix: str = typer.Option(
        "",
        "--blob-output-prefix",
        help="Blob path prefix (e.g., periods/2026-02/)"
    ),
):
    """Analyze startups for GenAI usage and build patterns.

    This will:
    1. Crawl startup websites, blogs, and documentation
    2. Save all raw content locally
    3. Analyze for GenAI usage and build patterns
    4. Generate individual briefs for each startup
    5. Create enriched CSV with analysis columns
    6. Generate batch summary report
    7. Generate monthly statistics
    """
    # Determine period from path or use provided
    detected_period = period or settings.extract_period_from_path(csv_path)
    if detected_period:
        output_path = output_dir or settings.get_output_dir(detected_period)
        settings.ensure_period_dirs(detected_period)
    else:
        output_path = output_dir or settings.data_output_dir
    output_path.mkdir(parents=True, exist_ok=True)

    console.print(Panel.fit(
        "[bold blue]Startup GenAI Analysis System[/bold blue]\n"
        "Discovering build patterns and insights from AI startups",
        border_style="blue"
    ))

    console.print(f"\n[bold]Loading startups from[/bold] {csv_path}...")

    if pilot:
        startups = get_pilot_startups(csv_path)
        console.print(f"[green]Loaded {len(startups)} pilot startups[/green]")
    else:
        startups = load_startups_from_csv(csv_path, limit=limit)
        if min_funding:
            startups = filter_startups(startups, min_funding=min_funding)
        console.print(f"[green]Loaded {len(startups)} startups[/green]")

    if not startups:
        console.print("[red]No startups found![/red]")
        raise typer.Exit(1)

    # Show preview
    table = Table(title="Startups to Analyze", show_lines=True)
    table.add_column("Name", style="cyan", width=25)
    table.add_column("Funding", style="green", width=15)
    table.add_column("Website", style="blue", width=30)
    table.add_column("Industries", style="yellow", width=30)

    for s in startups[:10]:
        funding = f"${s.funding_amount:,.0f}" if s.funding_amount else "N/A"
        industries = ", ".join(s.industries[:2]) if s.industries else "N/A"
        if len(s.industries) > 2:
            industries += f" (+{len(s.industries) - 2})"
        table.add_row(s.name, funding, s.website or "N/A", industries)

    if len(startups) > 10:
        table.add_row("...", f"+{len(startups) - 10} more", "...", "...")

    console.print(table)

    console.print(f"\n[bold]Output directory:[/bold] {output_path}")

    # Confirm
    if not typer.confirm("\nProceed with analysis?"):
        raise typer.Exit()

    # Run analysis
    console.print("\n[bold blue]Starting analysis pipeline...[/bold blue]")
    results, startup_map = asyncio.run(_run_full_analysis(
        startups, output_path, csv_path, enrich_csv, skip_crawl,
        force_crawl=force_crawl, min_content_chars=min_content_chars,
        upload_to_blob=upload_to_blob, blob_output_prefix=blob_output_prefix,
    ))

    # Generate outputs
    console.print("\n[bold green]Analysis complete![/bold green]")

    # Generate monthly statistics
    if detected_period:
        from src.data.monthly_stats import MonthlyStatistics
        console.print(f"\n[bold]Generating monthly statistics for {detected_period}...[/bold]")
        monthly_stats = MonthlyStatistics(detected_period)
        monthly_stats.generate_full_stats(startups, results)
        stats_path = monthly_stats.save(output_path)
        report_path = monthly_stats.generate_summary_report(output_path.parent)
        console.print(f"  - Monthly stats: {stats_path}")
        console.print(f"  - Monthly summary: {report_path}")

    console.print(f"\n[bold]Output files:[/bold]")
    console.print(f"  - Raw content: {output_path / 'raw_content'}")
    console.print(f"  - Briefs: {output_path / 'briefs'}")
    console.print(f"  - Analysis CSV: {output_path / 'analysis_results.csv'}")
    if enrich_csv:
        console.print(f"  - Enriched CSV: {output_path / 'startups_enriched_with_analysis.csv'}")
    console.print(f"  - Summary report: {output_path / 'batch_summary_report.md'}")

    # Show high-potential findings
    _show_high_potential(results)


async def _run_full_analysis(
    startups: List[StartupInput],
    output_path: Path,
    original_csv_path: Path,
    enrich_csv: bool,
    skip_crawl: bool = False,
    force_crawl: bool = False,
    min_content_chars: int = 0,
    upload_to_blob: bool = False,
    blob_output_prefix: str = "",
) -> tuple[List[StartupAnalysis], dict]:
    """Run the complete analysis pipeline."""
    analyzer = GenAIAnalyzer()
    crawler = StartupCrawler(
        raw_content_dir=output_path / "raw_content",
        disable_frontier=True,
    )
    results = []
    startup_map = {s.name: s for s in startups}
    crawl_diagnostics_map: dict[str, dict] = {}

    # Initialize blob client if uploading
    blob_client = None
    if upload_to_blob:
        try:
            from src.storage.blob_client import BlobStorageClient, ContainerName
            blob_client = BlobStorageClient()
            console.print("[green]Blob upload enabled[/green]")
        except Exception as e:
            console.print(f"[yellow]Blob upload disabled: {e}[/yellow]")

    with Progress(
        SpinnerColumn(),
        TextColumn("[progress.description]{task.description}"),
        console=console,
    ) as progress:

        # Phase 1: Crawl all startups (website + enrichment sources)
        if skip_crawl:
            console.print("[yellow]Skipping crawl, using cached data...[/yellow]")
        else:
            crawl_task = progress.add_task("[cyan]Crawling & enriching...", total=len(startups))

            for startup in startups:
                diag: dict = {
                    "initial_content_chars": 0,
                    "retry_content_chars": None,
                    "deep_crawl_triggered": False,
                    "failure_reason": None,
                    "crawl_runtime": "scrapy",
                }

                if not startup.website:
                    diag["failure_reason"] = "no_website"
                    crawl_diagnostics_map[startup.name] = diag
                    progress.advance(crawl_task)
                    continue

                # Check if we have existing cached content
                if not force_crawl:
                    existing_content = crawler.get_all_cached_content(startup.name)
                    if existing_content and len(existing_content) > 1000:
                        diag["initial_content_chars"] = len(existing_content)
                        if min_content_chars <= 0 or len(existing_content) >= min_content_chars:
                            console.print(f"  [dim]Using cached data for {startup.name} ({len(existing_content):,} chars)[/dim]")
                            crawl_diagnostics_map[startup.name] = diag
                            progress.advance(crawl_task)
                            continue

                progress.update(crawl_task, description=f"[cyan]Crawling {startup.name}...")
                try:
                    sources = await crawler.crawl_startup(startup)
                    # Save raw content locally
                    content_dir = crawler.save_raw_content(startup.name)
                    initial_content = crawler.get_all_cached_content(startup.name)
                    initial_chars = len(initial_content) if initial_content else 0
                    diag["initial_content_chars"] = initial_chars

                    # Deep crawl retry if content is below threshold
                    if min_content_chars > 0 and initial_chars < min_content_chars and initial_chars > 0:
                        console.print(f"  [yellow]Content below threshold ({initial_chars:,} < {min_content_chars:,}), retrying with deep crawl...[/yellow]")
                        diag["deep_crawl_triggered"] = True
                        try:
                            sources = await crawler.deep_crawl_startup(startup)
                            retry_content = crawler.get_all_cached_content(startup.name)
                            diag["retry_content_chars"] = len(retry_content) if retry_content else 0
                        except Exception as e2:
                            console.print(f"  [red]Deep crawl failed for {startup.name}: {e2}[/red]")
                            diag["failure_reason"] = "deep_crawl_failed"

                    # Count source types
                    source_types = {}
                    for s in sources:
                        st = s.source_type or "unknown"
                        source_types[st] = source_types.get(st, 0) + 1
                    source_summary = ", ".join(f"{k}:{v}" for k, v in source_types.items())
                    final_chars = diag.get("retry_content_chars") or diag["initial_content_chars"]
                    console.print(f"  [dim]Saved to {content_dir} [{source_summary}] ({final_chars:,} chars)[/dim]")
                except Exception as e:
                    console.print(f"  [red]Crawl error for {startup.name}: {e}[/red]")
                    diag["failure_reason"] = "crawl_error"

                crawl_diagnostics_map[startup.name] = diag
                progress.advance(crawl_task)

            # Close crawler clients
            await crawler.close()

        # Phase 2: Analyze all startups
        analyze_task = progress.add_task("[yellow]Analyzing...", total=len(startups))

        for startup in startups:
            progress.update(analyze_task, description=f"[yellow]Analyzing {startup.name}...")
            try:
                analysis = await analyzer.analyze_startup(startup)

                # Attach crawl diagnostics if available
                if startup.name in crawl_diagnostics_map:
                    analysis.crawl_diagnostics = crawl_diagnostics_map[startup.name]

                results.append(analysis)

                # Get logo path if available
                logo_path = get_logo_path_for_company(startup.name)

                # Save individual brief with logo
                brief_path = save_startup_brief(analysis, startup, output_path, logo_path)
                console.print(f"  [dim]Generated brief: {brief_path.name}[/dim]")

                # Upload brief to blob if enabled
                if blob_client and blob_output_prefix:
                    try:
                        from src.storage.blob_client import ContainerName
                        brief_bytes = brief_path.read_bytes()
                        blob_client.upload_blob(
                            ContainerName.BRIEFS,
                            f"{blob_output_prefix}{analysis.company_slug}/latest.md",
                            brief_bytes,
                        )
                    except Exception as be:
                        console.print(f"  [dim yellow]Blob brief upload failed: {be}[/dim yellow]")

                # Print summary
                genai_status = "[green]Yes[/green]" if analysis.uses_genai else "[red]No[/red]"
                patterns_str = ", ".join([p.name for p in analysis.build_patterns[:3]]) or "none"
                console.print(f"  {startup.name}: GenAI={genai_status}, Patterns=[{patterns_str}]")

            except Exception as e:
                console.print(f"  [red]Analysis error for {startup.name}: {e}[/red]")

            progress.advance(analyze_task)

    # Phase 3: Generate outputs
    console.print("\n[bold]Generating output files...[/bold]")

    # Save individual JSON results
    for analysis in results:
        filepath = output_path / f"{analysis.company_slug}.json"
        json_str = json.dumps(analysis.model_dump(mode="json"), indent=2, default=str)
        with open(filepath, "w") as f:
            f.write(json_str)

        # Upload JSON to blob if enabled
        if blob_client and blob_output_prefix:
            try:
                from src.storage.blob_client import ContainerName
                from datetime import date
                json_bytes = json_str.encode("utf-8")
                blob_client.upload_blob(
                    ContainerName.ANALYSIS_SNAPSHOTS,
                    f"{blob_output_prefix}{analysis.company_slug}/latest.json",
                    json_bytes,
                )
                blob_client.upload_blob(
                    ContainerName.ANALYSIS_SNAPSHOTS,
                    f"{blob_output_prefix}{analysis.company_slug}/{date.today().isoformat()}.json",
                    json_bytes,
                )
            except Exception as be:
                console.print(f"  [dim yellow]Blob JSON upload failed for {analysis.company_slug}: {be}[/dim yellow]")

    # Create analysis-only CSV
    analysis_csv = create_analysis_only_csv(results, output_path)
    console.print(f"  Created: {analysis_csv.name}")

    # Create enriched CSV
    if enrich_csv:
        enriched_csv = create_enriched_csv(original_csv_path, results, output_path)
        console.print(f"  Created: {enriched_csv.name}")

    # Generate batch summary report
    summary_report = generate_batch_summary_report(results, output_path)
    console.print(f"  Created: {summary_report.name}")

    # Save summary JSON
    summary = {
        "total_analyzed": len(results),
        "uses_genai_count": sum(1 for r in results if r.uses_genai),
        "pattern_distribution": {},
        "newsletter_potential": {
            "high": sum(1 for r in results if r.newsletter_potential == "high"),
            "medium": sum(1 for r in results if r.newsletter_potential == "medium"),
            "low": sum(1 for r in results if r.newsletter_potential == "low"),
        },
        "startups": [
            {
                "name": r.company_name,
                "uses_genai": r.uses_genai,
                "genai_intensity": r.genai_intensity.value,
                "patterns": [p.name for p in r.build_patterns],
                "unique_findings": r.unique_findings,
                "newsletter_potential": r.newsletter_potential,
            }
            for r in results
        ]
    }

    for r in results:
        for p in r.build_patterns:
            summary["pattern_distribution"][p.name] = summary["pattern_distribution"].get(p.name, 0) + 1

    with open(output_path / "analysis_summary.json", "w") as f:
        json.dump(summary, f, indent=2)

    # Upload manifest to blob if enabled
    if blob_client and blob_output_prefix:
        try:
            from src.storage.blob_client import ContainerName
            manifest = {
                r.company_slug: {
                    "raw_content_analyzed": r.raw_content_analyzed,
                    "vertical": r.vertical.value if hasattr(r.vertical, "value") else str(r.vertical),
                    "has_brief": True,
                    "analyzed_at": r.analyzed_at.isoformat() if r.analyzed_at else None,
                    "uses_genai": r.uses_genai,
                    "crawl_diagnostics": r.crawl_diagnostics,
                }
                for r in results
            }
            manifest_bytes = json.dumps(manifest, indent=2, default=str).encode("utf-8")
            blob_client.upload_blob(
                ContainerName.PERIODS,
                f"{blob_output_prefix}manifest.json",
                manifest_bytes,
            )
            console.print(f"  [green]Uploaded manifest to blob ({len(results)} entries)[/green]")
        except Exception as be:
            console.print(f"  [yellow]Blob manifest upload failed: {be}[/yellow]")

    return results, startup_map


def _show_high_potential(results: List[StartupAnalysis]):
    """Show high newsletter potential findings."""
    high_potential = [r for r in results if r.newsletter_potential == "high" and r.unique_findings]

    if high_potential:
        console.print("\n[bold yellow]HIGH NEWSLETTER POTENTIAL FINDINGS:[/bold yellow]")
        for r in high_potential:
            console.print(f"\n[bold cyan]{r.company_name}[/bold cyan]")
            console.print(f"  GenAI: {r.genai_intensity.value} | Patterns: {', '.join([p.name for p in r.build_patterns])}")
            for finding in r.unique_findings[:3]:
                console.print(f"  [green]→[/green] {finding}")
    else:
        console.print("\n[dim]No high newsletter potential startups identified in this batch.[/dim]")


@app.command()
def crawl(
    csv_path: Path = typer.Argument(..., help="Path to CSV with startup data"),
    limit: int = typer.Option(10, "--limit", "-l", help="Number of startups to crawl"),
):
    """Crawl startup websites without analysis (for testing/caching)."""
    startups = load_startups_from_csv(csv_path, limit=limit)
    startups = filter_startups(startups, has_website=True)

    console.print(f"[blue]Crawling {len(startups)} startups...[/blue]")

    crawler = StartupCrawler()

    async def crawl_all():
        try:
            for startup in startups:
                console.print(f"  Crawling {startup.name}...")
                try:
                    sources = await crawler.crawl_startup(startup)
                    content_dir = crawler.save_raw_content(startup.name)
                    success = sum(1 for s in sources if s.success)
                    # Show source breakdown
                    source_types = {}
                    for s in sources:
                        st = s.source_type or "unknown"
                        source_types[st] = source_types.get(st, 0) + 1
                    type_str = ", ".join(f"{k}:{v}" for k, v in source_types.items())
                    console.print(f"    {success}/{len(sources)} sources [{type_str}] → {content_dir}")
                except Exception as e:
                    console.print(f"    [red]Error: {e}[/red]")
        finally:
            await crawler.close()

    asyncio.run(crawl_all())


@app.command("crawl-frontier")
def crawl_frontier(
    once: bool = typer.Option(False, "--once", help="Run one lease/crawl iteration and exit"),
    worker_id: Optional[str] = typer.Option(None, "--worker-id", help="Optional stable worker identifier"),
    batch_size: Optional[int] = typer.Option(None, "--batch-size", help="Max leased URLs per loop"),
    max_loops: Optional[int] = typer.Option(None, "--max-loops", help="Exit after N loops"),
    idle_sleep_seconds: float = typer.Option(5.0, "--idle-sleep-seconds", help="Sleep when queue is empty"),
):
    """Run modern frontier worker (Scrapy runtime)."""
    from src.crawl_runtime.worker import run_frontier_worker

    loops = 1 if once else max_loops
    result = asyncio.run(
        run_frontier_worker(
            worker_id=worker_id,
            batch_size=batch_size,
            idle_sleep_seconds=idle_sleep_seconds,
            max_loops=loops,
        )
    )

    console.print(Panel.fit(
        "[bold blue]Frontier Worker Summary[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Worker:[/bold] {result.get('worker_id')}")
    console.print(f"[bold]Loops:[/bold] {result.get('loops', 0)}")
    console.print(f"[bold]Leased:[/bold] {result.get('leased', 0)}")
    console.print(f"[bold]Processed:[/bold] {result.get('processed', 0)}")
    console.print(f"[bold]Failed:[/bold] {result.get('failed', 0)}")
    console.print(f"[bold]Recovered stale leases:[/bold] {result.get('recovered_leases', 0)}")
    if result.get("errors"):
        console.print(f"[red]Errors:[/red] {len(result['errors'])}")


@app.command("crawl-retention")
def crawl_retention(
    retention_days: int = typer.Option(0, "--retention-days", help="Delete raw captures older than this many days"),
):
    """Cleanup expired WARC-lite raw captures."""
    from src.crawl_runtime.retention import cleanup_raw_captures
    from src.config import settings

    days = retention_days if retention_days > 0 else settings.crawler.raw_capture_retention_days
    try:
        result = asyncio.run(cleanup_raw_captures(days))
    except Exception as exc:
        console.print(f"[red]Raw capture cleanup failed:[/red] {exc}")
        raise typer.Exit(1)

    console.print(Panel.fit(
        "[bold blue]Raw Capture Retention Summary[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Retention days:[/bold] {result.get('retention_days', days)}")
    console.print(f"[bold]Rows deleted:[/bold] {result.get('deleted_rows', 0)}")
    console.print(f"[bold]Blobs deleted:[/bold] {result.get('deleted_blobs', 0)}")


@app.command("seed-frontier")
def seed_frontier(
    limit: int = typer.Option(5000, "--limit", "-l", help="Max startups to read from database"),
):
    """Seed crawl frontier queue from startups table."""
    from src.crawl_runtime.seed_frontier import run_seed_frontier

    try:
        result = asyncio.run(run_seed_frontier(limit=max(1, int(limit))))
    except Exception as exc:
        console.print(f"[red]Frontier seed failed:[/red] {exc}")
        raise typer.Exit(1)

    console.print(Panel.fit(
        "[bold blue]Frontier Seed Summary[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Startups considered:[/bold] {result.get('startups_considered', 0)}")
    console.print(f"[bold]Startups seeded:[/bold] {result.get('startups_seeded', 0)}")
    console.print(f"[bold]URLs seeded:[/bold] {result.get('urls_seeded', 0)}")


@app.command("ingest-news")
def ingest_news(
    lookback_hours: int = typer.Option(48, "--lookback-hours", help="How far back to collect stories"),
    edition_date: Optional[str] = typer.Option(None, "--edition-date", help="Edition date in YYYY-MM-DD"),
    rebuild_only: bool = typer.Option(False, "--rebuild-only", help="Skip fetching, rebuild clusters/edition from existing raw items"),
):
    """Ingest daily startup news and build ranked edition snapshot."""
    from src.automation.news_ingest import run_news_ingestion

    try:
        result = asyncio.run(
            run_news_ingestion(
                lookback_hours=max(1, int(lookback_hours)),
                edition_date=edition_date,
                rebuild_only=rebuild_only,
            )
        )
    except Exception as exc:
        console.print(f"[red]News ingestion failed:[/red] {exc}")
        raise typer.Exit(1)

    console.print(Panel.fit(
        "[bold blue]Daily News Ingestion Summary[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Run ID:[/bold] {result.get('run_id')}")
    console.print(f"[bold]Edition date:[/bold] {result.get('edition_date')}")
    console.print(f"[bold]Sources attempted:[/bold] {result.get('sources_attempted', 0)}")
    console.print(f"[bold]Items fetched:[/bold] {result.get('items_fetched', 0)}")
    console.print(f"[bold]Items kept:[/bold] {result.get('items_kept', 0)}")
    console.print(f"[bold]Clusters built:[/bold] {result.get('clusters_built', 0)}")
    images_enriched = result.get("images_enriched", 0)
    if images_enriched:
        console.print(f"[bold]Images enriched:[/bold] {images_enriched}")
    llm_metrics = result.get("llm_metrics") or ((result.get("stats") or {}).get("llm"))
    if isinstance(llm_metrics, dict):
        console.print(
            "[bold]LLM:[/bold] "
            f"attempted={llm_metrics.get('attempted', 0)} "
            f"succeeded={llm_metrics.get('succeeded', 0)} "
            f"failed={llm_metrics.get('failed', 0)} "
            f"timeouts={llm_metrics.get('timeouts', 0)} "
            f"p50={llm_metrics.get('latency_ms_p50', 0)}ms "
            f"p95={llm_metrics.get('latency_ms_p95', 0)}ms"
        )
    memory = result.get("stats", {}).get("memory") or {}
    if memory and not memory.get("skipped"):
        console.print(
            "[bold]Memory:[/bold] "
            f"entities={memory.get('entities_linked', 0)} "
            f"claims={memory.get('claims_extracted', 0)} "
            f"new_facts={memory.get('new_facts', 0)} "
            f"confirmations={memory.get('confirmations', 0)} "
            f"contradictions={memory.get('contradictions', 0)} "
            f"written={memory.get('facts_written', 0)}"
        )
    elif memory.get("skipped"):
        console.print("[bold]Memory:[/bold] [yellow]skipped (tables may not exist yet)[/yellow]")
    stats = result.get("stats") or {}
    has_brief = bool(stats.get("daily_brief"))
    console.print(f"[bold]Daily brief:[/bold] {'generated' if has_brief else '[yellow]not generated[/yellow]'}")
    if result.get("errors"):
        console.print(f"[yellow]Warnings:[/yellow] {len(result['errors'])}")
        for err in result["errors"]:
            console.print(f"  [dim]- {err}[/dim]")


@app.command("test-ainews")
def test_ainews(
    limit: int = typer.Option(5, "--limit", "-l", help="Max RSS entries to parse"),
):
    """Fetch latest AINews RSS and test the digest parser.

    Useful for debugging when the newsletter format changes.
    """
    import httpx
    import feedparser
    from src.automation.ainews_parser import AINewsDigestParser
    from src.automation.news_ingest import parse_entry_datetime

    console.print("[bold]Fetching AINews RSS feed...[/bold]")
    resp = httpx.get("https://news.smol.ai/rss.xml", follow_redirects=True, timeout=20)
    resp.raise_for_status()
    parsed = feedparser.parse(resp.text)
    console.print(f"Found {len(parsed.entries)} RSS entries\n")

    parser = AINewsDigestParser()
    total = 0

    for entry in parsed.entries[:limit]:
        title = entry.get("title", "Untitled")
        link = entry.get("link", "")
        published = parse_entry_datetime(entry)
        pub_str = published.strftime("%Y-%m-%d %H:%M") if published else "unknown"

        console.print(f"[bold blue]--- {title} ({pub_str}) ---[/bold blue]")

        html = ""
        content_list = entry.get("content", [])
        if content_list and isinstance(content_list, list):
            html = content_list[0].get("value", "")
        if not html:
            html = entry.get("summary", entry.get("description", ""))

        if not html:
            console.print("[yellow]  No HTML content found[/yellow]")
            continue

        from datetime import datetime, timezone
        items = parser.parse_digest(html, published or datetime.now(timezone.utc), link)
        total += len(items)

        table = Table(title=f"Extracted {len(items)} items")
        table.add_column("#", style="dim", width=4)
        table.add_column("Section", width=10)
        table.add_column("Title", width=50)
        table.add_column("Author", width=16)
        table.add_column("URL", width=40)

        for i, item in enumerate(items, 1):
            section = item.payload.get("section_category", "?")
            table.add_row(
                str(i), section,
                item.title[:50], item.author or "",
                item.url[:40] + ("..." if len(item.url) > 40 else ""),
            )
        console.print(table)
        console.print()

    console.print(f"[bold green]Total items extracted: {total}[/bold green]")


@app.command("send-news-digest")
def send_news_digest(
    edition_date: Optional[str] = typer.Option(None, "--edition-date", help="Edition date in YYYY-MM-DD (defaults to latest ready edition)"),
    region: str = typer.Option("global", "--region", help="Subscriber region to send to (global or turkey)"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Do not send emails or write deliveries; just validate pipeline"),
    target_hour: int = typer.Option(8, "--target-hour", help="Send to subscribers whose local time is this hour (0-23). Default 8 for 08:xx."),
    target_minute: int = typer.Option(45, "--target-minute", help="Target minute (informational, hour-window match). Default 45."),
):
    """Send daily startup-news digest to active subscribers for a given region.

    Timezone-aware: only sends to subscribers whose local time is currently
    in the target hour (default 08:xx). Cron should run hourly at :45 so
    each timezone batch is reached at ~08:45 local.
    """
    from src.automation.news_digest import run_news_digest_sender

    if region not in ("global", "turkey"):
        console.print(f"[red]Invalid region '{region}'. Must be 'global' or 'turkey'.[/red]")
        raise typer.Exit(1)

    try:
        result = asyncio.run(
            run_news_digest_sender(
                edition_date=edition_date,
                region=region,
                dry_run=dry_run,
                target_hour=target_hour,
                target_minute=target_minute,
            )
        )
    except Exception as exc:
        console.print(f"[red]News digest send failed:[/red] {exc}")
        raise typer.Exit(1)

    console.print(Panel.fit(
        "[bold blue]Daily News Digest Send Summary[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Edition date:[/bold] {result.get('edition_date')}")
    console.print(f"[bold]Region:[/bold] {result.get('region', 'global')}")
    console.print(f"[bold]Target local time:[/bold] {result.get('target_local_time', '08:45')}")
    console.print(f"[bold]Dry run:[/bold] {bool(result.get('dry_run', False))}")
    console.print(f"[bold]Stories:[/bold] {result.get('stories', 0)}")
    console.print(f"[bold]Total subscribers:[/bold] {result.get('subscribers', 0)}")
    console.print(f"[bold]Timezone-eligible:[/bold] {result.get('tz_eligible', '—')}")
    console.print(f"[bold green]Sent:[/bold green] {result.get('sent', 0)}")
    console.print(f"[bold yellow]Skipped:[/bold yellow] {result.get('skipped', 0)}")
    console.print(f"[bold red]Failed:[/bold red] {result.get('failed', 0)}")


@app.command()
def show(
    company: str = typer.Argument(..., help="Company name or slug"),
    output_dir: Optional[Path] = typer.Option(None, "--dir", "-d", help="Output directory"),
    period: Optional[str] = typer.Option(None, "--period", "-p", help="Period (e.g., 2026-01)"),
):
    """Show analysis results for a company."""
    if period:
        output_path = output_dir or settings.get_output_dir(period)
    else:
        output_path = output_dir or settings.data_output_dir

    # Find the file
    slug = company.lower().replace(" ", "-").replace(".", "").replace(",", "")
    filepath = output_path / f"{slug}.json"

    if not filepath.exists():
        # Try to find by partial match
        matches = list(output_path.glob(f"*{slug}*.json"))
        if matches:
            filepath = matches[0]
        else:
            console.print(f"[red]No analysis found for '{company}'[/red]")
            raise typer.Exit(1)

    with open(filepath) as f:
        data = json.load(f)

    # Display
    console.print(Panel.fit(
        f"[bold cyan]{data['company_name']}[/bold cyan]",
        border_style="cyan"
    ))

    console.print(f"\n[bold]Website:[/bold] {data.get('website', 'N/A')}")
    console.print(f"[bold]Funding:[/bold] ${data.get('funding_amount', 0):,.0f}")

    console.print(f"\n[bold yellow]GenAI Usage:[/bold yellow]")
    console.print(f"  Uses GenAI: {'Yes' if data.get('uses_genai') else 'No'}")
    console.print(f"  Intensity: {data.get('genai_intensity', 'unknown')}")
    console.print(f"  Models: {', '.join(data.get('models_mentioned', [])) or 'None detected'}")

    console.print(f"\n[bold yellow]Build Patterns:[/bold yellow]")
    for p in data.get("build_patterns", []):
        console.print(f"  • {p['name']} (confidence: {p['confidence']:.0%})")
        if p.get('description'):
            console.print(f"    [dim]{p['description']}[/dim]")

    console.print(f"\n[bold yellow]Unique Findings:[/bold yellow]")
    for finding in data.get("unique_findings", []):
        console.print(f"  → {finding}")

    console.print(f"\n[bold]Newsletter Potential:[/bold] {data.get('newsletter_potential', 'unknown').upper()}")


@app.command()
def summary(
    output_dir: Optional[Path] = typer.Option(None, "--dir", "-d", help="Output directory"),
    period: Optional[str] = typer.Option(None, "--period", "-p", help="Period (e.g., 2026-01)"),
):
    """Show summary of all analyzed startups."""
    if period:
        output_path = output_dir or settings.get_output_dir(period)
    else:
        output_path = output_dir or settings.data_output_dir
    summary_path = output_path / "analysis_summary.json"

    if not summary_path.exists():
        console.print("[red]No summary found. Run analyze first.[/red]")
        raise typer.Exit(1)

    with open(summary_path) as f:
        data = json.load(f)

    console.print(Panel.fit(
        "[bold]Analysis Summary[/bold]",
        border_style="blue"
    ))

    console.print(f"\n[bold]Total analyzed:[/bold] {data['total_analyzed']}")
    console.print(f"[bold]Using GenAI:[/bold] {data['uses_genai_count']} ({data['uses_genai_count']/data['total_analyzed']*100:.1f}%)")

    console.print(f"\n[bold yellow]Pattern Distribution:[/bold yellow]")
    for pattern, count in sorted(data.get("pattern_distribution", {}).items(), key=lambda x: -x[1]):
        pct = count / data['total_analyzed'] * 100
        console.print(f"  {pattern}: {count} ({pct:.1f}%)")

    console.print(f"\n[bold yellow]Newsletter Potential:[/bold yellow]")
    for level, count in data.get("newsletter_potential", {}).items():
        console.print(f"  {level}: {count}")


@app.command()
def brief(
    company: str = typer.Argument(..., help="Company name"),
    output_dir: Optional[Path] = typer.Option(None, "--dir", "-d", help="Output directory"),
    period: Optional[str] = typer.Option(None, "--period", "-p", help="Period (e.g., 2026-01)"),
):
    """View the generated brief for a company."""
    if period:
        output_path = output_dir or settings.get_output_dir(period)
    else:
        output_path = output_dir or settings.data_output_dir
    briefs_dir = output_path / "briefs"

    slug = company.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")

    # Find brief file
    brief_path = briefs_dir / f"{slug}_brief.md"
    if not brief_path.exists():
        matches = list(briefs_dir.glob(f"*{slug}*_brief.md"))
        if matches:
            brief_path = matches[0]
        else:
            console.print(f"[red]No brief found for '{company}'[/red]")
            raise typer.Exit(1)

    with open(brief_path) as f:
        content = f.read()

    from rich.markdown import Markdown
    console.print(Markdown(content))


@app.command()
def incremental(
    csv_path: Path = typer.Argument(..., help="Path to CSV with startup data"),
    viral: bool = typer.Option(True, "--viral/--no-viral", help="Run viral analysis"),
    force: bool = typer.Option(False, "--force", "-f", help="Force reprocess all startups"),
    max_concurrent: int = typer.Option(3, "--concurrent", "-c", help="Max concurrent API calls"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Output directory"),
    period: Optional[str] = typer.Option(None, "--period", help="Period (e.g., 2026-01)"),
):
    """Incremental analysis - only processes NEW startups.

    This is the recommended command for ongoing analysis:
    - First run: Analyzes all startups and stores results
    - Subsequent runs: Only analyzes NEW startups added to CSV
    - Newsletter generation uses ALL stored results
    - Monthly statistics are automatically generated/updated

    Example workflow:
    1. Add 100 startups to CSV -> run incremental -> analyzes 100
    2. Add 50 more startups to CSV -> run incremental -> analyzes only 50 new ones
    3. Generate newsletter -> uses all 150 stored analyses
    """
    from src.analysis.incremental_processor import IncrementalProcessor
    from src.data.store import AnalysisStore

    # Determine period
    detected_period = period or settings.extract_period_from_path(csv_path)
    if detected_period:
        output_path = output_dir or settings.get_output_dir(detected_period)
        settings.ensure_period_dirs(detected_period)
    else:
        output_path = output_dir or settings.data_output_dir
    store = AnalysisStore(output_path / "analysis_store")
    processor = IncrementalProcessor(store)

    console.print(Panel.fit(
        "[bold cyan]Incremental Analysis[/bold cyan]\n"
        "Processing only NEW/changed startups",
        border_style="cyan"
    ))

    # Load all startups
    startups = load_startups_from_csv(csv_path)
    console.print(f"\n[bold]Total in CSV:[/bold] {len(startups)}")

    # Show current store status
    stats = store.get_stats()
    console.print(f"[bold]Already in store:[/bold] {stats['total_startups']}")
    console.print(f"[bold]With viral analysis:[/bold] {stats['with_viral_analysis']}")

    # Calculate delta
    delta = store.get_delta(startups)
    if not delta and not force:
        console.print(f"\n[green]All startups already processed![/green]")
        console.print(f"Use --force to reprocess all.")

        # Offer to generate newsletter
        if typer.confirm("\nGenerate newsletter from stored data?"):
            newsletter_path = processor.generate_newsletter_from_store(output_path)
            console.print(f"\n[bold green]Newsletter generated:[/bold green] {newsletter_path}")
        return

    console.print(f"[bold yellow]New startups to process:[/bold yellow] {len(delta)}")

    if not typer.confirm(f"\nProcess {len(delta)} startups?"):
        raise typer.Exit()

    # Run incremental processing
    async def run():
        return await processor.process_incremental(
            startups,
            run_base=True,
            run_viral=viral,
            max_concurrent=max_concurrent,
            force_reprocess=force,
        )

    results = asyncio.run(run())

    # Show results
    console.print(f"\n[bold green]Processing complete![/bold green]")
    console.print(f"  New base analyses: {results['new_base_analyses']}")
    console.print(f"  New viral analyses: {results['new_viral_analyses']}")
    if results['errors']:
        console.print(f"  [red]Errors: {len(results['errors'])}[/red]")

    # Show updated store status
    stats = store.get_stats()
    console.print(f"\n[bold]Store now contains:[/bold]")
    console.print(f"  Total startups: {stats['total_startups']}")
    console.print(f"  With viral analysis: {stats['with_viral_analysis']}")

    # Generate monthly statistics
    if detected_period:
        from src.data.monthly_stats import MonthlyStatistics
        console.print(f"\n[bold]Updating monthly statistics for {detected_period}...[/bold]")
        all_analyses = store.get_all_base_analyses()
        monthly_stats = MonthlyStatistics(detected_period)
        monthly_stats.generate_full_stats(startups, all_analyses)
        stats_path = monthly_stats.save(output_path)
        report_path = monthly_stats.generate_summary_report(output_path.parent)
        console.print(f"  Monthly stats: {stats_path}")
        console.print(f"  Monthly summary: {report_path}")

    # Offer to generate newsletter
    if typer.confirm("\nGenerate newsletter from all stored data?"):
        newsletter_path = processor.generate_newsletter_from_store(output_path)
        console.print(f"\n[bold green]Newsletter generated:[/bold green] {newsletter_path}")


@app.command()
def store_status(
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Output directory"),
    period: Optional[str] = typer.Option(None, "--period", "-p", help="Period (e.g., 2026-01)"),
):
    """Show status of the analysis store."""
    from src.data.store import AnalysisStore

    if period:
        output_path = output_dir or settings.get_output_dir(period)
    else:
        output_path = output_dir or settings.data_output_dir
    store = AnalysisStore(output_path / "analysis_store")

    stats = store.get_stats()

    console.print(Panel.fit(
        "[bold]Analysis Store Status[/bold]",
        border_style="blue"
    ))

    console.print(f"\n[bold]Total startups:[/bold] {stats['total_startups']}")
    console.print(f"[bold]With base analysis:[/bold] {stats['with_base_analysis']}")
    console.print(f"[bold]With viral analysis:[/bold] {stats['with_viral_analysis']}")
    console.print(f"[bold]Missing viral:[/bold] {stats['missing_viral']}")
    console.print(f"[bold]Last updated:[/bold] {stats['last_updated']}")

    if stats['total_startups'] > 0:
        console.print(f"\n[dim]Store location: {output_path / 'analysis_store'}[/dim]")


@app.command()
def newsletter(
    csv_path: Path = typer.Argument(..., help="Path to CSV with startup data"),
    pilot: bool = typer.Option(True, "--pilot/--no-pilot", help="Use pilot list"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Output directory"),
    period: Optional[str] = typer.Option(None, "--period", "-p", help="Period (e.g., 2026-01)"),
):
    """Generate a viral newsletter from analyzed startups.

    This runs enhanced analysis including:
    - Job posting tech stack extraction
    - HackerNews sentiment analysis
    - Contrarian analysis (finding the flaws)
    - Viral hooks generation
    - Unique voice content writing
    """
    from src.analysis.viral_analyzer import ViralContentAnalyzer
    from src.analysis.genai_detector import GenAIAnalyzer
    from src.reports.newsletter_generator import generate_viral_newsletter

    # Determine period
    detected_period = period or settings.extract_period_from_path(csv_path)
    if detected_period:
        output_path = output_dir or settings.get_output_dir(detected_period)
    else:
        output_path = output_dir or settings.data_output_dir

    console.print(Panel.fit(
        "[bold magenta]Viral Newsletter Generator[/bold magenta]\n"
        "Creating high-impact, unique voice content",
        border_style="magenta"
    ))

    # Load startups
    if pilot:
        startups = get_pilot_startups(csv_path)
    else:
        startups = load_startups_from_csv(csv_path, limit=5)

    console.print(f"\n[bold]Analyzing {len(startups)} startups for viral content...[/bold]")

    # Run analysis
    async def run_viral_analysis():
        base_analyzer = GenAIAnalyzer()
        viral_analyzer = ViralContentAnalyzer()
        crawler = StartupCrawler()

        viral_analyses = []

        for startup in startups:
            console.print(f"\n[cyan]{'='*50}[/cyan]")
            console.print(f"[bold cyan]{startup.name}[/bold cyan]")
            console.print(f"[cyan]{'='*50}[/cyan]")

            try:
                # Get cached content
                content = crawler.get_all_cached_content(startup.name)
                if not content:
                    console.print(f"  [yellow]No cached content - run 'analyze' first[/yellow]")
                    continue

                # Run base analysis
                console.print(f"  [dim]Running base analysis...[/dim]")
                base_analysis = await base_analyzer.analyze_startup(startup)

                # Run viral content analysis
                console.print(f"  [dim]Running viral content analysis...[/dim]")
                viral_result = await viral_analyzer.analyze_for_viral_content(
                    startup, base_analysis, content
                )

                viral_analyses.append(viral_result)

                # Show preview
                hooks = viral_result.get("viral_hooks", {}).get("headlines", [])
                if hooks:
                    best_hook = max(hooks, key=lambda h: h.get("hook_strength", 0))
                    console.print(f"  [green]Best hook:[/green] {best_hook.get('headline', 'N/A')}")

                contrarian = viral_result.get("contrarian_analysis", {})
                if contrarian.get("honest_take"):
                    console.print(f"  [yellow]Honest take:[/yellow] {contrarian['honest_take'][:100]}...")

            except Exception as e:
                console.print(f"  [red]Error: {e}[/red]")

        # Close clients
        await viral_analyzer.close()

        return viral_analyses

    viral_results = asyncio.run(run_viral_analysis())

    if not viral_results:
        console.print("[red]No results to generate newsletter from![/red]")
        raise typer.Exit(1)

    # Generate newsletter
    console.print(f"\n[bold]Generating viral newsletter...[/bold]")
    newsletter_path = generate_viral_newsletter(viral_results, output_path)

    console.print(f"\n[bold green]Newsletter generated![/bold green]")
    console.print(f"  [bold]File:[/bold] {newsletter_path}")

    # Show preview
    console.print(f"\n[bold magenta]Preview:[/bold magenta]")
    with open(newsletter_path) as f:
        preview = f.read()[:2000]
    from rich.markdown import Markdown
    console.print(Markdown(preview + "\n\n*... [truncated] ...*"))


@app.command("monthly-stats")
def monthly_stats(
    csv_path: Optional[Path] = typer.Argument(None, help="Path to CSV with startup data"),
    period: Optional[str] = typer.Option(None, "--period", "-p", help="Period (e.g., 2026-01)"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Output directory"),
    view_only: bool = typer.Option(False, "--view", "-v", help="Only view existing stats, don't regenerate"),
):
    """Generate or view monthly statistics.

    This command generates comprehensive monthly statistics including:
    - Deal summary (total deals, funding, averages)
    - Funding by stage, type, and vertical
    - Geographic breakdowns (continent, country, city, US state)
    - Top deals and investors
    - GenAI analysis metrics (if analyses exist)
    """
    from src.data.monthly_stats import MonthlyStatistics
    from src.data.store import AnalysisStore

    # Determine period
    if csv_path:
        detected_period = period or settings.extract_period_from_path(csv_path)
    else:
        detected_period = period or settings.get_current_period()

    if detected_period:
        output_path = output_dir or settings.get_output_dir(detected_period)
        period_dir = settings.get_period_dir(detected_period)
    else:
        output_path = output_dir or settings.data_output_dir
        period_dir = output_path.parent

    console.print(Panel.fit(
        f"[bold blue]Monthly Statistics: {detected_period or 'Current'}[/bold blue]",
        border_style="blue"
    ))

    stats_file = output_path / "monthly_stats.json"

    # View existing stats
    if view_only or (stats_file.exists() and not csv_path):
        if stats_file.exists():
            with open(stats_file) as f:
                data = json.load(f)

            # Display summary
            if "deal_summary" in data:
                ds = data["deal_summary"]
                console.print(f"\n[bold]Deal Summary[/bold]")
                console.print(f"  Total Deals: {ds['total_deals']}")
                console.print(f"  Total Funding: ${ds['total_funding_usd']:,.0f}")
                console.print(f"  Average Deal: ${ds['average_deal_size']:,.0f}")
                console.print(f"  Median Deal: ${ds['median_deal_size']:,.0f}")

            if "funding_by_stage" in data:
                console.print(f"\n[bold]Funding by Stage[/bold]")
                for stage, info in sorted(data["funding_by_stage"].items(), key=lambda x: -x[1]["total_usd"])[:5]:
                    console.print(f"  {stage}: {info['count']} deals, ${info['total_usd']:,.0f}")

            if "funding_by_continent" in data:
                console.print(f"\n[bold]Funding by Region[/bold]")
                for region, info in sorted(data["funding_by_continent"].items(), key=lambda x: -x[1]["total_usd"]):
                    console.print(f"  {region.replace('_', ' ').title()}: {info['count']} deals, ${info['total_usd']:,.0f}")

            if "genai_analysis" in data and data["genai_analysis"].get("total_analyzed", 0) > 0:
                ga = data["genai_analysis"]
                console.print(f"\n[bold]GenAI Analysis[/bold]")
                console.print(f"  Analyzed: {ga['total_analyzed']}")
                console.print(f"  Adoption Rate: {ga['genai_adoption_rate']*100:.1f}%")

            console.print(f"\n[dim]Full stats: {stats_file}[/dim]")
            summary_file = period_dir / "monthly_summary.md"
            if summary_file.exists():
                console.print(f"[dim]Summary report: {summary_file}[/dim]")
        else:
            console.print(f"[yellow]No stats file found at {stats_file}[/yellow]")
            console.print("Run with a CSV path to generate statistics.")
        return

    # Generate new stats
    if not csv_path:
        # Try to find CSV in period input directory
        input_dir = settings.get_input_dir(detected_period)
        csv_files = list(input_dir.glob("*.csv"))
        if csv_files:
            csv_path = csv_files[0]
            console.print(f"[dim]Using: {csv_path}[/dim]")
        else:
            console.print(f"[red]No CSV file provided and none found in {input_dir}[/red]")
            raise typer.Exit(1)

    # Load startups
    startups = load_startups_from_csv(csv_path)
    console.print(f"\n[bold]Loaded {len(startups)} startups from CSV[/bold]")

    # Load analyses if available
    store = AnalysisStore(output_path / "analysis_store")
    analyses = store.get_all_base_analyses()
    console.print(f"[bold]Found {len(analyses)} analyzed startups in store[/bold]")

    # Generate stats
    console.print(f"\n[bold]Generating monthly statistics...[/bold]")
    monthly = MonthlyStatistics(detected_period or "current")
    monthly.generate_full_stats(startups, analyses if analyses else None)

    # Save
    settings.ensure_period_dirs(detected_period)
    stats_path = monthly.save(output_path)
    report_path = monthly.generate_summary_report(period_dir)

    console.print(f"\n[bold green]Statistics generated![/bold green]")
    console.print(f"  JSON stats: {stats_path}")
    console.print(f"  Summary report: {report_path}")

    # Show summary
    ds = monthly.stats.get("deal_summary", {})
    if ds:
        console.print(f"\n[bold]Quick Summary[/bold]")
        console.print(f"  Total Deals: {ds.get('total_deals', 0)}")
        console.print(f"  Total Funding: ${ds.get('total_funding_usd', 0):,.0f}")
        console.print(f"  Average Deal: ${ds.get('average_deal_size', 0):,.0f}")


@app.command()
def intelligence(
    csv_path: Path = typer.Argument(..., help="Path to CSV with startup data"),
    period: Optional[str] = typer.Option(None, "--period", "-p", help="Period (e.g., 2026-01)"),
    limit: int = typer.Option(10, "--limit", "-l", help="Number of startups to process"),
    output_dir: Optional[Path] = typer.Option(None, "--output", "-o", help="Output directory"),
    skip_providers: bool = typer.Option(False, "--skip-providers", help="Skip startup database lookups"),
    skip_tech_programs: bool = typer.Option(False, "--skip-tech-programs", help="Skip tech program checks"),
    skip_accelerators: bool = typer.Option(False, "--skip-accelerators", help="Skip accelerator checks"),
    skip_vc_resources: bool = typer.Option(False, "--skip-vc-resources", help="Skip VC resources"),
):
    """Collect external intelligence for startups.

    Gathers data from multiple external sources:
    - Startup databases (Crunchbase, CB Insights, PitchBook, Tracxn, Dealroom)
    - Big tech programs (Google, AWS, Microsoft, NVIDIA, Meta, Salesforce, Intel)
    - Accelerators (YC, Techstars, 500 Global, Endeavor, Plug and Play)
    - VC resources (Sequoia, a16z, Greylock, First Round curated content)

    All data is scoped to the specified period (e.g., January 2026).

    Example:
        python main.py intelligence data/2026-01/input/startups.csv --period 2026-01 -l 5
    """
    from src.intelligence import StartupIntelligenceAggregator
    from src.data.store import AnalysisStore

    # Determine period
    detected_period = period or settings.extract_period_from_path(csv_path)
    if not detected_period:
        console.print("[yellow]Warning: Period not specified. Using current month.[/yellow]")
        detected_period = settings.get_current_period()

    if detected_period:
        output_path = output_dir or settings.get_output_dir(detected_period)
        settings.ensure_period_dirs(detected_period)
    else:
        output_path = output_dir or settings.data_output_dir

    console.print(Panel.fit(
        f"[bold blue]External Intelligence Collection[/bold blue]\n"
        f"Period: {detected_period}",
        border_style="blue"
    ))

    # Load startups
    startups = load_startups_from_csv(csv_path, limit=limit)
    console.print(f"\n[bold]Loaded {len(startups)} startups[/bold]")

    # Load existing analyses if available (for better VC resource matching)
    store = AnalysisStore(output_path / "analysis_store")
    analyses_map = {}
    for analysis in store.get_all_base_analyses():
        slug = StartupAnalysis.to_slug(analysis.company_name)
        analyses_map[slug] = analysis
    if analyses_map:
        console.print(f"[dim]Found {len(analyses_map)} existing analyses for context[/dim]")

    # Show what will be collected
    console.print(f"\n[bold]Collection targets:[/bold]")
    console.print(f"  - Startup databases: {'[yellow]skipped[/yellow]' if skip_providers else '[green]enabled[/green]'}")
    console.print(f"  - Tech programs: {'[yellow]skipped[/yellow]' if skip_tech_programs else '[green]enabled[/green]'}")
    console.print(f"  - Accelerators: {'[yellow]skipped[/yellow]' if skip_accelerators else '[green]enabled[/green]'}")
    console.print(f"  - VC resources: {'[yellow]skipped[/yellow]' if skip_vc_resources else '[green]enabled[/green]'}")

    if not typer.confirm(f"\nCollect intelligence for {len(startups)} startups?"):
        raise typer.Exit()

    # Update settings based on flags
    settings.intelligence.enable_crunchbase = not skip_providers
    settings.intelligence.enable_cbinsights = not skip_providers
    settings.intelligence.enable_pitchbook = not skip_providers
    settings.intelligence.enable_tracxn = not skip_providers
    settings.intelligence.enable_dealroom = not skip_providers
    settings.intelligence.enable_tech_programs = not skip_tech_programs
    settings.intelligence.enable_accelerators = not skip_accelerators
    settings.intelligence.enable_vc_resources = not skip_vc_resources

    # Run collection
    async def run_collection():
        aggregator = StartupIntelligenceAggregator(detected_period)

        intelligence_data = {}

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            console=console,
        ) as progress:
            task = progress.add_task("[cyan]Collecting intelligence...", total=len(startups))

            for startup in startups:
                progress.update(task, description=f"[cyan]Collecting: {startup.name}...")

                try:
                    # Get existing analysis for context
                    slug = StartupAnalysis.to_slug(startup.name)
                    analysis = analyses_map.get(slug)

                    # Collect intelligence
                    intel = await aggregator.collect_full_intelligence(startup, analysis)
                    intelligence_data[slug] = intel

                    # Show brief summary
                    parts = []
                    if intel.provider_data:
                        parts.append(f"providers:{len(intel.provider_data)}")
                    if intel.tech_programs:
                        parts.append(f"tech:{len(intel.tech_programs)}")
                    if intel.accelerators:
                        parts.append(f"accel:{len(intel.accelerators)}")
                    if intel.vc_resources:
                        parts.append(f"vc:{len(intel.vc_resources)}")

                    summary = ", ".join(parts) if parts else "no data"
                    console.print(f"  [dim]{startup.name}: [{summary}] score={intel.intelligence_score:.2f}[/dim]")

                except Exception as e:
                    console.print(f"  [red]Error for {startup.name}: {e}[/red]")

                progress.advance(task)

        # Save report
        report_path = aggregator.save_intelligence_report(intelligence_data, output_path)
        await aggregator.close()

        return intelligence_data, report_path

    intelligence_data, report_path = asyncio.run(run_collection())

    # Show summary
    console.print(f"\n[bold green]Intelligence collection complete![/bold green]")
    console.print(f"\n[bold]Results:[/bold]")
    console.print(f"  Startups processed: {len(intelligence_data)}")

    # Calculate summary stats
    with_providers = sum(1 for i in intelligence_data.values() if i.provider_data)
    with_tech = sum(1 for i in intelligence_data.values() if i.tech_programs)
    with_accel = sum(1 for i in intelligence_data.values() if i.accelerators)
    avg_score = sum(i.intelligence_score for i in intelligence_data.values()) / len(intelligence_data) if intelligence_data else 0

    console.print(f"  With provider data: {with_providers}")
    console.print(f"  In tech programs: {with_tech}")
    console.print(f"  In accelerators: {with_accel}")
    console.print(f"  Average score: {avg_score:.2f}")

    console.print(f"\n[bold]Report saved:[/bold] {report_path}")

    # Show notable findings
    notable = [
        (slug, intel) for slug, intel in intelligence_data.items()
        if intel.accelerators or len(intel.tech_programs) >= 2
    ]
    if notable:
        console.print(f"\n[bold yellow]Notable findings:[/bold yellow]")
        for slug, intel in notable[:5]:
            accels = [a.accelerator for a in intel.accelerators]
            programs = [p.program_name for p in intel.tech_programs]
            console.print(f"  {intel.company_name}:")
            if accels:
                console.print(f"    Accelerators: {', '.join(accels)}")
            if programs:
                console.print(f"    Tech programs: {', '.join(programs)}")


@app.command("memory-backfill")
def memory_backfill(
    days: int = typer.Option(7, "--days", help="How many days of existing clusters to backfill"),
    region: str = typer.Option("global", "--region", help="Region: 'global' or 'turkey'"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Print stats without persisting"),
):
    """Backfill memory gate on existing news clusters.

    Runs entity linking + fact extraction on clusters from the last N days
    and populates news_entity_facts + news_item_extractions tables.

    Use --region turkey to backfill with Turkish-language patterns and
    write facts with region='turkey'.
    """
    from src.automation.memory_gate import MemoryGate
    import asyncpg as apg

    if region not in ("global", "turkey"):
        console.print(f"[red]Invalid region '{region}'. Use 'global' or 'turkey'.[/red]")
        raise typer.Exit(1)

    async def run_backfill():
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            console.print("[red]DATABASE_URL not set[/red]")
            return

        pool = await apg.create_pool(db_url, min_size=2, max_size=5, command_timeout=60)
        async with pool.acquire() as conn:
            gate = MemoryGate()
            await gate.load(conn, region=region)

            try:
                rows = await conn.fetch(
                    """
                    SELECT id::text, cluster_key, canonical_url, title, summary,
                           story_type, entities, trust_score
                    FROM news_clusters
                    WHERE published_at >= NOW() - ($1 || ' days')::interval
                      AND region = $2
                    ORDER BY published_at DESC
                    """,
                    str(days),
                    region,
                )
            except Exception:
                # Back-compat: older DBs didn't have per-region clusters.
                rows = await conn.fetch(
                    """
                    SELECT id::text, cluster_key, canonical_url, title, summary,
                           story_type, entities, trust_score
                    FROM news_clusters
                    WHERE published_at >= NOW() - ($1 || ' days')::interval
                    ORDER BY published_at DESC
                    """,
                    str(days),
                )
            console.print(f"[bold]Found {len(rows)} clusters from last {days} days (region={region})[/bold]")

            processed = 0
            facts_written = 0
            for row in rows:
                result = await gate.process_cluster(
                    conn,
                    cluster_key=row["cluster_key"],
                    title=row["title"],
                    summary=row["summary"] or "",
                    story_type=row["story_type"],
                    entities=list(row["entities"] or []),
                    canonical_url=row["canonical_url"] or "",
                    trust_score=float(row["trust_score"] or 0),
                    region=region,
                )
                if not dry_run:
                    await gate.persist_extraction(conn, row["id"], result)
                    facts_written += await gate.persist_facts(
                        conn, row["id"], row["canonical_url"] or "", result, region=region,
                    )
                processed += 1

            stats = gate.stats
            stats["facts_written"] = facts_written

        await pool.close()
        return stats

    try:
        stats = asyncio.run(run_backfill())
    except Exception as exc:
        console.print(f"[red]Memory backfill failed:[/red] {exc}")
        raise typer.Exit(1)

    if not stats:
        return

    console.print(Panel.fit(
        f"[bold blue]Memory Backfill Summary ({region})[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Clusters processed:[/bold] {stats.get('clusters_processed', 0)}")
    console.print(f"[bold]Entities linked:[/bold] {stats.get('entities_linked', 0)}")
    console.print(f"[bold]Claims extracted:[/bold] {stats.get('claims_extracted', 0)}")
    console.print(f"[bold]New facts:[/bold] {stats.get('new_facts', 0)}")
    console.print(f"[bold]Confirmations:[/bold] {stats.get('confirmations', 0)}")
    console.print(f"[bold]Contradictions:[/bold] {stats.get('contradictions', 0)}")
    console.print(f"[bold]Facts written:[/bold] {stats.get('facts_written', 0)}")
    if dry_run:
        console.print("[yellow]Dry run — nothing was persisted[/yellow]")


@app.command("embed-backfill")
def embed_backfill(
    days: int = typer.Option(0, "--days", help="Limit to clusters from last N days (0 = all)"),
    batch_size: int = typer.Option(100, "--batch-size", help="Embedding batch size"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Count unembedded clusters without processing"),
):
    """Backfill embeddings for existing news clusters.

    Generates text-embedding-3-small vectors for all clusters where
    embedded_at IS NULL.  Idempotent — skips already-embedded clusters.
    Also populates related_cluster_ids for newly embedded clusters.

    Requires AZURE_OPENAI_ENDPOINT and managed identity (or AZURE_OPENAI_API_KEY).
    """
    from src.automation.embedding import EmbeddingService
    import asyncpg as apg

    async def run():
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            console.print("[red]DATABASE_URL not set[/red]")
            return None

        # Initialise Azure OpenAI client (same pattern as NewsIngestionPipeline)
        azure_client = None
        try:
            from openai import AsyncAzureOpenAI as _AsyncAzureOpenAI
            endpoint = os.getenv("AZURE_OPENAI_ENDPOINT", "")
            if endpoint:
                try:
                    from azure.identity import DefaultAzureCredential as _DAC
                    from azure.identity import get_bearer_token_provider as _gbtp
                    _cred = _DAC()
                    _tp = _gbtp(_cred, "https://cognitiveservices.azure.com/.default")
                    azure_client = _AsyncAzureOpenAI(
                        azure_ad_token_provider=_tp,
                        api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01"),
                        azure_endpoint=endpoint,
                    )
                except ImportError:
                    api_key = os.getenv("AZURE_OPENAI_API_KEY", "")
                    if api_key:
                        azure_client = _AsyncAzureOpenAI(
                            api_key=api_key,
                            api_version=os.getenv("AZURE_OPENAI_API_VERSION", "2024-06-01"),
                            azure_endpoint=endpoint,
                        )
        except ImportError:
            console.print("[yellow]openai package not installed[/yellow]")

        if azure_client is None and not dry_run:
            console.print("[red]No Azure OpenAI client available. Set AZURE_OPENAI_ENDPOINT.[/red]")
            return None

        deployment = os.getenv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "text-embedding-3-small")
        service = EmbeddingService(azure_client=azure_client, deployment_name=deployment)

        pool = await apg.create_pool(db_url, min_size=2, max_size=5, command_timeout=120)
        async with pool.acquire() as conn:
            where = "WHERE embedding IS NULL"
            params: list = []
            if days > 0:
                where += " AND published_at >= NOW() - ($1 || ' days')::interval"
                params.append(str(days))

            count = await conn.fetchval(
                f"SELECT COUNT(*) FROM news_clusters {where}", *params
            )
            console.print(f"[bold]Found {count} unembedded clusters[/bold]")

            if dry_run or count == 0:
                await pool.close()
                return {"total": count, "embedded": 0, "related": 0, "dry_run": dry_run}

            rows = await conn.fetch(
                f"""SELECT id::text, title, summary, entities
                    FROM news_clusters {where}
                    ORDER BY published_at DESC""",
                *params,
            )

            embedded = 0
            for b_start in range(0, len(rows), batch_size):
                batch = rows[b_start : b_start + batch_size]
                texts = [
                    service.prepare_text(
                        row["title"],
                        row["summary"],
                        list(row["entities"] or []),
                    )
                    for row in batch
                ]
                embeddings = await service.embed_texts(texts)

                for row, emb in zip(batch, embeddings):
                    if emb is not None:
                        await conn.execute(
                            """UPDATE news_clusters
                               SET embedding = $1::vector, embedded_at = NOW()
                               WHERE id = $2::uuid""",
                            str(emb), row["id"],
                        )
                        embedded += 1
                console.print(f"  Embedded {min(b_start + batch_size, len(rows))}/{len(rows)}")

            # Populate related clusters for newly embedded items
            all_ids = [row["id"] for row in rows]
            related = await service.populate_related_clusters(conn, all_ids)

        await pool.close()
        return {"total": len(rows), "embedded": embedded, "related": related}

    try:
        result = asyncio.run(run())
    except Exception as exc:
        console.print(f"[red]Embed backfill failed:[/red] {exc}")
        raise typer.Exit(1)

    if not result:
        return

    console.print(Panel.fit(
        f"[bold blue]Embedding Backfill Results[/bold blue]",
        border_style="blue",
    ))
    console.print(f"[bold]Total unembedded:[/bold] {result.get('total', 0)}")
    console.print(f"[bold]Embedded:[/bold] {result.get('embedded', 0)}")
    console.print(f"[bold]Related populated:[/bold] {result.get('related', 0)}")
    if result.get("dry_run"):
        console.print("[yellow]Dry run — nothing was persisted[/yellow]")


@app.command("backfill-turkish-enrichments")
def backfill_turkish_enrichments(
    days: int = typer.Option(7, "--days", help="How many days back to re-enrich"),
    since: str = typer.Option("", "--since", help="Override start date (YYYY-MM-DD)"),
    until: str = typer.Option("", "--until", help="Override end date (YYYY-MM-DD)"),
    dry_run: bool = typer.Option(False, "--dry-run", help="Count clusters without calling LLM"),
    concurrency: int = typer.Option(4, "--concurrency", help="Max parallel LLM calls"),
    include_briefs: bool = typer.Option(True, "--include-briefs/--no-briefs", help="Also regenerate daily briefs"),
):
    """Re-enrich Turkey news clusters in Turkish.

    Existing Turkey clusters were enriched before Turkish language prompts
    were added (commit 1cbb3a7). This command re-runs LLM enrichment with
    region='turkey' so builder_takeaway, impact, and daily briefs are in Turkish.
    """
    from datetime import date as dt_date, timedelta
    import asyncpg as apg

    # Parse date range
    if since:
        try:
            start_date = dt_date.fromisoformat(since)
        except ValueError:
            console.print(f"[red]Invalid --since date '{since}'. Use YYYY-MM-DD.[/red]")
            raise typer.Exit(1)
    else:
        start_date = dt_date.today() - timedelta(days=days)

    if until:
        try:
            end_date = dt_date.fromisoformat(until)
        except ValueError:
            console.print(f"[red]Invalid --until date '{until}'. Use YYYY-MM-DD.[/red]")
            raise typer.Exit(1)
    else:
        end_date = dt_date.today() + timedelta(days=1)

    console.print(f"[bold]Turkey enrichment backfill: {start_date} → {end_date}[/bold]")

    async def run():
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            console.print("[red]DATABASE_URL not set[/red]")
            return None

        # Import ingestor to get LLM client and enrichment method
        from src.automation.news_ingest import DailyNewsIngestor, StoryCluster

        pool = await apg.create_pool(db_url, min_size=2, max_size=5, command_timeout=120)

        # Query Turkey clusters that were already LLM-enriched (in English)
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT id::text, cluster_key, canonical_url, title, summary,
                       published_at, topic_tags, entities, story_type,
                       source_count, rank_score, rank_reason, trust_score,
                       builder_takeaway, llm_summary, llm_model,
                       llm_signal_score, llm_confidence_score,
                       llm_topic_tags, llm_story_type, impact,
                       research_context
                FROM news_clusters
                WHERE region = 'turkey'
                  AND published_at >= $1 AND published_at < $2
                  AND llm_model IS NOT NULL
                ORDER BY published_at DESC
                """,
                start_date,
                end_date,
            )

        console.print(f"[bold]Found {len(rows)} Turkey clusters with existing LLM enrichment[/bold]")

        if dry_run or len(rows) == 0:
            await pool.close()
            return {"total": len(rows), "enriched": 0, "failed": 0, "briefs": 0, "dry_run": dry_run}

        # Instantiate ingestor for LLM access
        ingestor = DailyNewsIngestor(database_url=db_url)
        ingestor.llm_enrichment_enabled = True

        enriched = 0
        failed = 0
        sem = asyncio.Semaphore(concurrency)
        edition_dates = set()

        async def enrich_one(row):
            nonlocal enriched, failed
            async with sem:
                cluster = StoryCluster(
                    cluster_key=row["cluster_key"],
                    primary_source_key="",
                    primary_external_id="",
                    canonical_url=row["canonical_url"] or "",
                    title=row["title"],
                    summary=row["summary"] or "",
                    published_at=row["published_at"],
                    topic_tags=list(row["topic_tags"] or []),
                    entities=list(row["entities"] or []),
                    story_type=row["story_type"] or "news",
                    rank_score=float(row["rank_score"] or 0),
                    rank_reason=row["rank_reason"] or "",
                    trust_score=float(row["trust_score"] or 0),
                    builder_takeaway=row["builder_takeaway"],
                    llm_summary=row["llm_summary"],
                    llm_model=row["llm_model"],
                    llm_signal_score=float(row["llm_signal_score"]) if row["llm_signal_score"] else None,
                    llm_confidence_score=float(row["llm_confidence_score"]) if row["llm_confidence_score"] else None,
                    llm_topic_tags=list(row["llm_topic_tags"] or []),
                    llm_story_type=row["llm_story_type"],
                    members=[],
                    research_context=json.loads(row["research_context"]) if isinstance(row["research_context"], str) else row["research_context"],
                    impact=json.loads(row["impact"]) if isinstance(row["impact"], str) else row["impact"],
                )

                try:
                    result = await ingestor._llm_enrich_cluster(cluster, region="turkey")
                    if result.error_code or result.timed_out:
                        console.print(f"  [yellow]SKIP {cluster.title[:50]}… (error={result.error_code}, timeout={result.timed_out})[/yellow]")
                        failed += 1
                        return

                    async with pool.acquire() as conn:
                        await conn.execute(
                            """
                            UPDATE news_clusters
                            SET builder_takeaway = $2,
                                impact = $3::jsonb,
                                llm_summary = $4,
                                llm_model = $5,
                                llm_signal_score = $6,
                                llm_confidence_score = $7,
                                llm_topic_tags = $8::text[],
                                llm_story_type = $9,
                                updated_at = NOW()
                            WHERE id = $1::uuid
                            """,
                            row["id"],
                            result.builder_takeaway,
                            json.dumps(result.impact) if result.impact else None,
                            result.llm_summary,
                            result.llm_model,
                            result.llm_signal_score,
                            result.llm_confidence_score,
                            list(result.llm_topic_tags or []),
                            result.llm_story_type,
                        )

                    enriched += 1
                    pub_date = row["published_at"].date() if hasattr(row["published_at"], "date") else row["published_at"]
                    edition_dates.add(pub_date)
                    console.print(f"  [green]OK[/green] {cluster.title[:60]}…")
                except Exception as exc:
                    console.print(f"  [red]FAIL {cluster.title[:50]}…: {exc}[/red]")
                    failed += 1

        # Run enrichments with concurrency
        tasks = [enrich_one(row) for row in rows]
        await asyncio.gather(*tasks)

        console.print(f"\n[bold]Enriched {enriched}/{len(rows)} clusters ({failed} failed)[/bold]")

        # Regenerate daily briefs for affected edition dates
        briefs_regenerated = 0
        if include_briefs and edition_dates:
            console.print(f"\n[bold]Regenerating daily briefs for {len(edition_dates)} edition dates…[/bold]")
            for ed in sorted(edition_dates):
                try:
                    async with pool.acquire() as conn:
                        # Load top clusters for this edition date
                        cluster_rows = await conn.fetch(
                            """
                            SELECT id::text, cluster_key, canonical_url, title, summary,
                                   published_at, topic_tags, entities, story_type,
                                   source_count, rank_score, rank_reason, trust_score,
                                   builder_takeaway, llm_summary, llm_model,
                                   llm_signal_score, llm_confidence_score,
                                   llm_topic_tags, llm_story_type, impact,
                                   research_context
                            FROM news_clusters
                            WHERE region = 'turkey'
                              AND published_at::date = $1
                              AND llm_model IS NOT NULL
                            ORDER BY rank_score DESC
                            LIMIT 40
                            """,
                            ed,
                        )

                        if not cluster_rows:
                            continue

                        brief_clusters = []
                        for cr in cluster_rows:
                            sc = StoryCluster(
                                cluster_key=cr["cluster_key"],
                                primary_source_key="",
                                primary_external_id="",
                                canonical_url=cr["canonical_url"] or "",
                                title=cr["title"],
                                summary=cr["summary"] or "",
                                published_at=cr["published_at"],
                                topic_tags=list(cr["topic_tags"] or []),
                                entities=list(cr["entities"] or []),
                                story_type=cr["story_type"] or "news",
                                rank_score=float(cr["rank_score"] or 0),
                                rank_reason=cr["rank_reason"] or "",
                                trust_score=float(cr["trust_score"] or 0),
                                builder_takeaway=cr["builder_takeaway"],
                                llm_summary=cr["llm_summary"],
                                llm_model=cr["llm_model"],
                                llm_signal_score=float(cr["llm_signal_score"]) if cr["llm_signal_score"] else None,
                                llm_confidence_score=float(cr["llm_confidence_score"]) if cr["llm_confidence_score"] else None,
                                llm_topic_tags=list(cr["llm_topic_tags"] or []),
                                llm_story_type=cr["llm_story_type"],
                                members=[],
                                research_context=json.loads(cr["research_context"]) if isinstance(cr["research_context"], str) else cr["research_context"],
                                impact=json.loads(cr["impact"]) if isinstance(cr["impact"], str) else cr["impact"],
                            )
                            brief_clusters.append(sc)

                        brief = await ingestor._llm_generate_daily_brief(
                            conn=conn, edition_date=ed, region="turkey", clusters=brief_clusters,
                        )

                        if brief:
                            # Update stats_json.daily_brief in the edition
                            existing_stats = await conn.fetchval(
                                "SELECT stats_json FROM news_daily_editions WHERE edition_date = $1 AND region = 'turkey'",
                                ed,
                            )
                            stats = json.loads(existing_stats) if existing_stats and isinstance(existing_stats, str) else (existing_stats or {})
                            if not isinstance(stats, dict):
                                stats = {}
                            stats["daily_brief"] = brief

                            await conn.execute(
                                """
                                UPDATE news_daily_editions
                                SET stats_json = $2::jsonb, generated_at = NOW()
                                WHERE edition_date = $1 AND region = 'turkey'
                                """,
                                ed,
                                json.dumps(stats),
                            )
                            briefs_regenerated += 1
                            console.print(f"  [green]Brief regenerated for {ed}[/green]")
                        else:
                            console.print(f"  [yellow]Brief skipped for {ed}[/yellow]")
                except Exception as exc:
                    console.print(f"  [red]Brief failed for {ed}: {exc}[/red]")

        await pool.close()
        return {"total": len(rows), "enriched": enriched, "failed": failed, "briefs": briefs_regenerated, "dry_run": False}

    try:
        result = asyncio.run(run())
    except Exception as exc:
        console.print(f"[red]Turkish enrichment backfill failed:[/red] {exc}")
        import traceback
        traceback.print_exc()
        raise typer.Exit(1)

    if not result:
        return

    console.print(Panel.fit(
        "[bold blue]Turkish Enrichment Backfill Results[/bold blue]",
        border_style="blue",
    ))
    console.print(f"[bold]Total clusters:[/bold] {result.get('total', 0)}")
    console.print(f"[bold]Re-enriched:[/bold] {result.get('enriched', 0)}")
    console.print(f"[bold]Failed:[/bold] {result.get('failed', 0)}")
    console.print(f"[bold]Briefs regenerated:[/bold] {result.get('briefs', 0)}")
    if result.get("dry_run"):
        console.print("[yellow]Dry run — nothing was persisted[/yellow]")


@app.command("generate-weekly-brief")
def generate_weekly_brief(
    region: str = typer.Option("global", "--region", help="Region: 'global' or 'turkey'"),
    week: str = typer.Option("", "--week", help="Monday of the week (YYYY-MM-DD). Defaults to last week."),
):
    """Generate a weekly intelligence brief.

    Aggregates stories from the past week, computes stats, and generates
    LLM narrative sections (executive summary, trend analysis, builder lessons).
    """
    from src.automation.periodic_briefs import WeeklyBriefGenerator
    import asyncpg as apg

    if region not in ("global", "turkey"):
        console.print(f"[red]Invalid region '{region}'. Use 'global' or 'turkey'.[/red]")
        raise typer.Exit(1)

    week_start = None
    if week:
        try:
            from datetime import date as dt_date
            week_start = dt_date.fromisoformat(week)
        except ValueError:
            console.print(f"[red]Invalid date '{week}'. Use YYYY-MM-DD format.[/red]")
            raise typer.Exit(1)

    async def run():
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            console.print("[red]DATABASE_URL not set[/red]")
            return None
        pool = await apg.create_pool(db_url, min_size=2, max_size=5, command_timeout=120)
        async with pool.acquire() as conn:
            gen = WeeklyBriefGenerator()
            result = await gen.run(conn, region=region, week_start=week_start)
        await pool.close()
        return result

    try:
        result = asyncio.run(run())
    except Exception as exc:
        console.print(f"[red]Weekly brief generation failed:[/red] {exc}")
        raise typer.Exit(1)

    if not result:
        return

    if result.get("status") == "empty":
        console.print("[yellow]No stories found for the period.[/yellow]")
        return

    console.print(Panel.fit(
        f"[bold blue]Weekly Brief Generated ({region})[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Title:[/bold] {result.get('title', '')}")
    console.print(f"[bold]Period:[/bold] {result.get('period_start')} to {result.get('period_end')}")
    console.print(f"[bold]Stories:[/bold] {result.get('story_count', 0)}")
    console.print(f"[bold]LLM narrative:[/bold] {'Yes' if result.get('has_narrative') else 'No'}")
    console.print(f"[bold]Status:[/bold] {result.get('status')}")


@app.command("generate-monthly-brief-news")
def generate_monthly_brief_news(
    region: str = typer.Option("global", "--region", help="Region: 'global' or 'turkey'"),
    month: str = typer.Option("", "--month", help="Month (YYYY-MM). Defaults to previous month."),
):
    """Generate a monthly intelligence brief from news data.

    Aggregates stories from the month, computes stats, and generates
    LLM narrative sections. Different from the existing monthly brief
    which is based on startup analysis data.
    """
    from src.automation.periodic_briefs import MonthlyBriefGenerator
    import asyncpg as apg

    if region not in ("global", "turkey"):
        console.print(f"[red]Invalid region '{region}'. Use 'global' or 'turkey'.[/red]")
        raise typer.Exit(1)

    month_val = month if month else None

    async def run():
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            console.print("[red]DATABASE_URL not set[/red]")
            return None
        pool = await apg.create_pool(db_url, min_size=2, max_size=5, command_timeout=120)
        async with pool.acquire() as conn:
            gen = MonthlyBriefGenerator()
            result = await gen.run(conn, region=region, month=month_val)
        await pool.close()
        return result

    try:
        result = asyncio.run(run())
    except Exception as exc:
        console.print(f"[red]Monthly brief generation failed:[/red] {exc}")
        raise typer.Exit(1)

    if not result:
        return

    if result.get("status") == "empty":
        console.print("[yellow]No stories found for the period.[/yellow]")
        return

    console.print(Panel.fit(
        f"[bold blue]Monthly Brief Generated ({region})[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Title:[/bold] {result.get('title', '')}")
    console.print(f"[bold]Period:[/bold] {result.get('period_start')} to {result.get('period_end')}")
    console.print(f"[bold]Stories:[/bold] {result.get('story_count', 0)}")
    console.print(f"[bold]LLM narrative:[/bold] {'Yes' if result.get('has_narrative') else 'No'}")
    console.print(f"[bold]Status:[/bold] {result.get('status')}")


@app.command("extract-logos")
def extract_logos(
    use_database: bool = typer.Option(True, "--db/--local", help="Save to PostgreSQL database (default) or local files"),
    max_concurrent: int = typer.Option(5, "--concurrent", "-c", help="Maximum concurrent extractions"),
):
    """Extract and save company logos for existing startups.

    Extracts logos from company websites using multiple strategies:
    - Open Graph images (og:image)
    - Twitter card images
    - HTML logo tags
    - Apple touch icons
    - Clearbit Logo API (fallback)

    By default, saves to PostgreSQL database (served via /api/startups/:slug/logo).
    Use --local to save to local files instead.

    Requires DATABASE_URL environment variable to be set.

    Examples:
        python -m main extract-logos
        python -m main extract-logos --local
        python -m main extract-logos --concurrent 10
    """
    from src.crawler.logo_extractor import extract_logos_for_existing_startups

    console.print(Panel.fit(
        "[bold blue]Logo Extraction[/bold blue]",
        border_style="blue"
    ))

    storage_type = "PostgreSQL database" if use_database else "Local storage"
    console.print(f"[bold]Storage:[/bold] {storage_type}")
    console.print(f"[bold]Concurrent:[/bold] {max_concurrent}")

    if use_database and not os.getenv("DATABASE_URL"):
        console.print("[red]Error: DATABASE_URL not set. Cannot save to database.[/red]")
        console.print("[yellow]Tip: Set DATABASE_URL or use --local to save locally.[/yellow]")
        raise typer.Exit(1)

    async def run_extraction():
        results = await extract_logos_for_existing_startups(
            use_database=use_database,
            max_concurrent=max_concurrent
        )
        return results

    results = asyncio.run(run_extraction())

    # Display summary
    console.print(f"\n[bold green]Logo extraction complete![/bold green]")
    console.print(f"\n[bold]Results:[/bold]")
    console.print(f"  [green]Success:[/green] {len(results['success'])}")
    console.print(f"  [red]Failed:[/red] {len(results['failed'])}")
    console.print(f"  [yellow]Skipped:[/yellow] {len(results['skipped'])}")

    # Show some successful extractions
    if results['success'][:5]:
        console.print(f"\n[bold]Sample logos extracted:[/bold]")
        for item in results['success'][:5]:
            console.print(f"  {item['name']}: {item['logo_url']}")


@app.command("seed-pattern-library")
def seed_pattern_library(
    region: str = typer.Option("global", "--region", help="Region: 'global' or 'turkey'"),
):
    """Seed the news_pattern_library with canonical build patterns.

    Populates 20 canonical patterns from the PatternRegistry. Idempotent —
    skips patterns that already exist.
    """
    from src.automation.memory_gate import PatternMatcher
    import asyncpg as apg

    async def run_seed():
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            console.print("[red]DATABASE_URL not set[/red]")
            return

        pool = await apg.create_pool(db_url, min_size=1, max_size=3, command_timeout=60)
        async with pool.acquire() as conn:
            pm = PatternMatcher()
            await pm.seed_canonical_patterns(conn, region)
            console.print(f"[green]Pattern library seeded for region={region}[/green]")
        await pool.close()

    asyncio.run(run_seed())


@app.command("seed-gtm-taxonomy")
def seed_gtm_taxonomy(
    region: str = typer.Option("global", "--region", help="Region: 'global' or 'turkey'"),
):
    """Seed the news_gtm_taxonomy with the GTM/delivery classification hierarchy.

    Populates ~21 GTM tags across 6 parent categories. Idempotent —
    skips tags that already exist.
    """
    from src.automation.memory_gate import GTMClassifier
    import asyncpg as apg

    async def run_seed():
        db_url = os.getenv("DATABASE_URL")
        if not db_url:
            console.print("[red]DATABASE_URL not set[/red]")
            return

        pool = await apg.create_pool(db_url, min_size=1, max_size=3, command_timeout=60)
        async with pool.acquire() as conn:
            gc = GTMClassifier()
            await gc.seed_taxonomy(conn, region)
            console.print(f"[green]GTM taxonomy seeded for region={region}[/green]")
        await pool.close()

    asyncio.run(run_seed())


@app.command("research-topics")
def research_topics(
    max_items: int = typer.Option(5, "--max-items", help="Max queue items to process per run"),
):
    """Process hot topic research queue — web search + LLM synthesis."""
    from src.automation.topic_researcher import run_topic_research

    try:
        stats = asyncio.run(run_topic_research(max_items=max_items))
    except Exception as exc:
        console.print(f"[red]Topic research failed:[/red] {exc}")
        raise typer.Exit(1)

    console.print(Panel.fit(
        "[bold blue]Topic Research Summary[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Processed:[/bold] {stats.get('processed', 0)}")
    console.print(f"[bold]Succeeded:[/bold] {stats.get('succeeded', 0)}")
    console.print(f"[bold]Failed:[/bold] {stats.get('failed', 0)}")
    console.print(f"[bold]Searches:[/bold] {stats.get('searches', 0)}")
    console.print(f"[bold]Articles fetched:[/bold] {stats.get('articles_fetched', 0)}")
    console.print(f"[bold]LLM calls:[/bold] {stats.get('llm_calls', 0)}")


@app.command("test-research")
def test_research(
    query: str = typer.Argument(..., help="Topic or headline to research"),
):
    """Test web search + LLM synthesis for a topic string (no DB required)."""
    from src.automation.topic_researcher import run_test_research

    try:
        result = asyncio.run(run_test_research(query))
    except Exception as exc:
        console.print(f"[red]Test research failed:[/red] {exc}")
        raise typer.Exit(1)

    console.print(Panel.fit(
        "[bold blue]Test Research Results[/bold blue]",
        border_style="blue"
    ))
    console.print(f"[bold]Queries:[/bold] {result.get('queries', [])}")
    console.print(f"[bold]Search results:[/bold] {len(result.get('search_results', []))}")
    console.print(f"[bold]Articles fetched:[/bold] {result.get('articles_fetched', 0)}")

    output = result.get("research_output")
    if output:
        console.print("\n[bold green]Research Output:[/bold green]")
        console.print(f"[bold]Summary:[/bold] {output.get('enhanced_summary', '')}")
        findings = output.get("key_findings", [])
        if findings:
            console.print("[bold]Key findings:[/bold]")
            for f in findings:
                console.print(f"  • {f}")
        console.print(f"[bold]Builder implications:[/bold] {output.get('builder_implications', '')}")
        sources = output.get("sources_used", [])
        if sources:
            console.print(f"[bold]Sources:[/bold] {len(sources)}")
    else:
        console.print("[yellow]No LLM synthesis output (Azure client may not be configured)[/yellow]")


if __name__ == "__main__":
    app()
