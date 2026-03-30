"""
Email-friendly HTML newsletter generator for BuildAtlas.

Generates inline-styled HTML suitable for email delivery via Resend.
Reads newsletter_data.json and produces a self-contained HTML email.
"""

import json
import os
import sys
from pathlib import Path
from typing import Any, Optional

try:
    import resend
except ImportError:
    resend = None  # type: ignore

try:
    import asyncpg
except ImportError:
    asyncpg = None  # type: ignore


# ---------- Inline styles ----------
STYLES = {
    "body": "margin:0;padding:0;background-color:#0a0a0f;color:#d4c8b0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;",
    "container": "max-width:600px;margin:0 auto;padding:24px 20px;",
    "h1": "font-size:32px;font-weight:300;color:#e8dcc8;line-height:1.2;letter-spacing:-0.02em;margin:0 0 12px 0;",
    "h2": "font-size:20px;font-weight:500;color:#e8dcc8;margin:32px 0 16px 0;",
    "label": "font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#7aa2b8;margin:0 0 4px 0;",
    "body_text": "font-size:14px;line-height:1.6;color:#a89a82;margin:0 0 12px 0;",
    "stat_large": "font-size:28px;font-weight:600;color:#e8dcc8;font-variant-numeric:tabular-nums;",
    "stat_small": "font-size:16px;font-weight:500;color:#e8dcc8;font-variant-numeric:tabular-nums;",
    "card": "background-color:#12121a;border:1px solid rgba(100,100,120,0.2);border-radius:8px;padding:16px;margin:8px 0;",
    "table": "width:100%;border-collapse:collapse;font-size:13px;",
    "th": "text-align:left;padding:6px 8px;border-bottom:1px solid rgba(100,100,120,0.3);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#7aa2b8;",
    "th_right": "text-align:right;padding:6px 8px;border-bottom:1px solid rgba(100,100,120,0.3);font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#7aa2b8;",
    "td": "padding:6px 8px;border-bottom:1px solid rgba(100,100,120,0.1);color:#d4c8b0;",
    "td_right": "text-align:right;padding:6px 8px;border-bottom:1px solid rgba(100,100,120,0.1);color:#d4c8b0;",
    "td_muted": "text-align:right;padding:6px 8px;border-bottom:1px solid rgba(100,100,120,0.1);color:#a89a82;",
    "divider": "border:none;border-top:1px solid rgba(100,100,120,0.2);margin:32px 0;",
    "bar_bg": "background-color:rgba(100,100,120,0.15);border-radius:4px;height:20px;overflow:hidden;",
    "bar_fill": "height:20px;border-radius:4px;background-color:#b8963a;",
    "callout": "background-color:#12121a;border:1px solid rgba(100,100,120,0.2);border-radius:8px;padding:16px;margin:16px 0;",
    "accent": "color:#b8963a;font-weight:500;",
    "footer": "font-size:12px;color:#6b6355;text-align:center;margin:32px 0 0 0;",
    "link": "color:#7aa2b8;text-decoration:none;",
}


def _bar_html(label: str, value: float, max_value: float, formatted: str) -> str:
    """Generate an inline bar chart row."""
    pct = max(value / max_value * 100, 2) if max_value else 2
    return f'''
    <tr>
      <td style="{STYLES['td']};width:120px;font-weight:500;">{label}</td>
      <td style="{STYLES['td']}">
        <div style="{STYLES['bar_bg']}">
          <div style="{STYLES['bar_fill']};width:{pct:.0f}%;"></div>
        </div>
      </td>
      <td style="{STYLES['td_right']};width:80px;font-weight:500;">{formatted}</td>
    </tr>'''


def generate_email_html(data: dict[str, Any], web_url: str = "https://buildatlas.net") -> str:
    """Generate the full HTML email from newsletter data."""
    hero = data["hero"]
    meta = data["meta"]

    # Big 5 bars
    big5_rows = ""
    max_amount = data["big5"][0]["amount"] if data["big5"] else 1
    for b in data["big5"]:
        big5_rows += _bar_html(b["company"], b["amount"], max_amount, b["amount_formatted"])

    # Capital flow table rows
    cf_rows = ""
    for cf in data["capital_flow"]:
        cf_rows += f'''
        <tr>
          <td style="{STYLES['td']}">{cf["category"]}</td>
          <td style="{STYLES['td_muted']}">{cf["rounds"]}</td>
          <td style="{STYLES['td_right']}">{cf["total_funding_formatted"]}</td>
          <td style="{STYLES['td_muted']}">{cf["avg_round_formatted"]}</td>
        </tr>'''

    # Pattern list
    pattern_rows = ""
    for t in data["trend_radar"][:6]:
        pattern_rows += f'''
        <tr>
          <td style="{STYLES['td']}">{t["pattern"]}</td>
          <td style="{STYLES['td_right']};{STYLES['accent']}">{t["percentage"]}%</td>
          <td style="{STYLES['td_muted']}">{t["count"]}/{t["total"]}</td>
        </tr>'''

    # Stage snapshot
    stage_cells = ""
    for s in data["stage_snapshot"]:
        stage_cells += f'''
        <td style="text-align:center;padding:12px 4px;">
          <div style="{STYLES['label']}">{s["stage"]}</div>
          <div style="{STYLES['stat_small']}">{s["rounds"]}</div>
          <div style="font-size:12px;color:#a89a82;">{s["capital_formatted"]}</div>
        </td>'''

    # Geography rows
    geo_rows = ""
    for g in data["geography"]:
        geo_rows += f'''
        <tr>
          <td style="{STYLES['td']}">{g["region"]}</td>
          <td style="{STYLES['td_right']};{STYLES['accent']}">{g["percentage"]}%</td>
          <td style="{STYLES['td_muted']}">{g["companies"]}</td>
        </tr>'''

    # Playbook cards
    playbook_html = ""
    for i, p in enumerate(data["playbook"], 1):
        playbook_html += f'''
        <div style="{STYLES['card']}">
          <div style="font-size:24px;{STYLES['accent']};margin-bottom:8px;">{i}</div>
          <div style="{STYLES['label']}">{p["title"]}</div>
          <div style="{STYLES['stat_small']};margin:4px 0 8px;">{p["stat"]}</div>
          <div style="{STYLES['body_text']}">{p["description"]}</div>
        </div>'''

    # Market DNA
    md = data["market_dna"]
    h_pct = round(md["horizontal"] / (md["horizontal"] + md["vertical"]) * 100) if (md["horizontal"] + md["vertical"]) else 0

    # GenAI intensity
    genai_cells = ""
    for g in data["genai_intensity"]:
        genai_cells += f'''
        <td style="text-align:center;padding:8px 4px;">
          <div style="{STYLES['stat_small']}">{g["percentage"]}%</div>
          <div style="font-size:11px;color:#a89a82;text-transform:capitalize;">{g["intensity"]}</div>
        </td>'''

    period = data["period"]
    newsletter_url = f"{web_url}/newsletter/{period}"

    html = f'''<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{meta["period_label"]} AI Landscape — BuildAtlas</title>
</head>
<body style="{STYLES['body']}">
<div style="{STYLES['container']}">

  <!-- Hero -->
  <p style="{STYLES['label']}">{meta["period_label"]} AI Landscape</p>
  <h1 style="{STYLES['h1']}">{hero["total_funding_formatted"]} deployed across {hero["total_rounds"]} AI rounds</h1>
  <p style="{STYLES['body_text']}">Physical AI and infrastructure dominate as capital concentrates at the extremes.</p>

  <table style="margin:16px 0;">
    <tr>
      <td style="padding:0 24px 0 0;">
        <div style="{STYLES['label']}">Median</div>
        <div style="{STYLES['stat_small']}">{hero["median_round_formatted"]}</div>
      </td>
      <td style="padding:0 24px 0 0;">
        <div style="{STYLES['label']}">Average</div>
        <div style="{STYLES['stat_small']}">{hero["avg_round_formatted"]}</div>
      </td>
      <td>
        <div style="{STYLES['label']}">Analyzed</div>
        <div style="{STYLES['stat_small']}">{meta["total_analyzed"]}</div>
      </td>
    </tr>
  </table>

  <hr style="{STYLES['divider']}">

  <!-- Capital Flow -->
  <p style="{STYLES['label']}">01 — Capital Flow</p>
  <h2 style="{STYLES['h2']}">Where the Money Went</h2>
  <table style="{STYLES['table']}">
    <tr>
      <th style="{STYLES['th']}">Category</th>
      <th style="{STYLES['th_right']}">Rounds</th>
      <th style="{STYLES['th_right']}">Total</th>
      <th style="{STYLES['th_right']}">Avg</th>
    </tr>
    {cf_rows}
  </table>

  <hr style="{STYLES['divider']}">

  <!-- Big 5 -->
  <p style="{STYLES['label']}">02 — The Big 5</p>
  <h2 style="{STYLES['h2']}">Rounds That Shaped the Month</h2>
  <table style="{STYLES['table']}">{big5_rows}</table>

  <div style="{STYLES['callout']}">
    <p style="{STYLES['body_text']};margin:0;">
      <span style="{STYLES['accent']}">Concentration:</span>
      Remove the top 5 ({data["top5_concentration"]["top5_total_formatted"]}) and the
      remaining {data["top5_concentration"]["remaining_count"]} companies raised
      {data["top5_concentration"]["remaining_total_formatted"]}.
    </p>
  </div>

  <hr style="{STYLES['divider']}">

  <!-- Patterns -->
  <p style="{STYLES['label']}">03 — Trend Radar</p>
  <h2 style="{STYLES['h2']}">Build Patterns (&gt;50% confidence)</h2>
  <table style="{STYLES['table']}">
    <tr>
      <th style="{STYLES['th']}">Pattern</th>
      <th style="{STYLES['th_right']}">Prevalence</th>
      <th style="{STYLES['th_right']}">Count</th>
    </tr>
    {pattern_rows}
  </table>

  <hr style="{STYLES['divider']}">

  <!-- Stage Snapshot -->
  <p style="{STYLES['label']}">04 — Funding Funnel</p>
  <h2 style="{STYLES['h2']}">The Stage Snapshot</h2>
  <table style="width:100%;"><tr>{stage_cells}</tr></table>

  <hr style="{STYLES['divider']}">

  <!-- Geography -->
  <p style="{STYLES['label']}">05 — Geography</p>
  <h2 style="{STYLES['h2']}">Where AI Gets Built</h2>
  <table style="{STYLES['table']}">
    <tr>
      <th style="{STYLES['th']}">Region</th>
      <th style="{STYLES['th_right']}">Share</th>
      <th style="{STYLES['th_right']}">Companies</th>
    </tr>
    {geo_rows}
  </table>

  <hr style="{STYLES['divider']}">

  <!-- Market DNA -->
  <p style="{STYLES['label']}">06 — Market DNA</p>
  <h2 style="{STYLES['h2']}">Horizontal vs Vertical</h2>
  <table style="width:100%;">
    <tr>
      <td style="padding:8px 0;width:50%;">
        <div style="{STYLES['stat_large']}">{h_pct}%</div>
        <div style="{STYLES['body_text']}">Horizontal ({md["horizontal"]})</div>
      </td>
      <td style="padding:8px 0;width:50%;">
        <div style="{STYLES['stat_large']}">{100 - h_pct}%</div>
        <div style="{STYLES['body_text']}">Vertical ({md["vertical"]})</div>
      </td>
    </tr>
  </table>

  <hr style="{STYLES['divider']}">

  <!-- GenAI Intensity -->
  <p style="{STYLES['label']}">07 — GenAI Depth</p>
  <h2 style="{STYLES['h2']}">How Deep Does AI Go?</h2>
  <table style="width:100%;"><tr>{genai_cells}</tr></table>

  <hr style="{STYLES['divider']}">

  <!-- Playbook -->
  <p style="{STYLES['label']}">08 — Builder&rsquo;s Playbook</p>
  <h2 style="{STYLES['h2']}">3 Takeaways</h2>
  {playbook_html}

  <hr style="{STYLES['divider']}">

  <!-- Footer -->
  <p style="{STYLES['footer']}">
    Data from {meta["total_rounds"]} funding rounds, {meta["total_analyzed"]} deep analyses. {meta["period_label"]}.
  </p>
  <p style="{STYLES['footer']}">
    <a href="{newsletter_url}" style="{STYLES['link']}">View full newsletter on web</a>
  </p>
  <p style="{STYLES['footer']}">
    BuildAtlas — AI market intelligence for builders and investors.
  </p>

</div>
</body>
</html>'''

    return html


async def send_newsletter_email(
    data: dict[str, Any],
    database_url: Optional[str] = None,
    dry_run: bool = True,
) -> None:
    """Send the global monthly newsletter to active global subscribers."""
    if not resend:
        print("resend package not installed, skipping email send")
        return

    api_key = os.getenv("RESEND_API_KEY", "")
    from_email = os.getenv("NEWS_DIGEST_FROM_EMAIL", "Build Atlas <news@buildatlas.net>")
    public_url = os.getenv("PUBLIC_BASE_URL", "https://buildatlas.net")

    if not api_key:
        print("RESEND_API_KEY not set, skipping email send")
        return

    resend.api_key = api_key
    html = generate_email_html(data, web_url=public_url)
    subject = f"{data['meta']['period_label']} AI Landscape — {data['hero']['total_funding_formatted']} across {data['hero']['total_rounds']} rounds"

    if dry_run:
        # Write HTML to file for preview
        preview_path = Path(__file__).parent / "newsletter_preview.html"
        preview_path.write_text(html, encoding="utf-8")
        print(f"Dry run: HTML preview written to {preview_path}")
        print(f"Subject: {subject}")
        return

    # Fetch subscribers from database
    db_url = database_url or os.getenv("DATABASE_URL", "")
    if not db_url or not asyncpg:
        print("No DATABASE_URL or asyncpg not available, cannot fetch subscribers")
        return

    pool = await asyncpg.create_pool(db_url, min_size=1, max_size=2)
    try:
        async with pool.acquire() as conn:
            emails = await _load_monthly_subscriber_emails(conn)
        print(f"Sending newsletter to {len(emails)} subscribers...")

        for email in emails:
            try:
                resend.Emails.send({
                    "from": from_email,
                    "to": email,
                    "subject": subject,
                    "html": html,
                })
                print(f"  Sent to {email}")
            except Exception as e:
                print(f"  Failed to send to {email}: {e}")
    finally:
        await pool.close()


async def _load_monthly_subscriber_emails(conn: Any) -> list[str]:
    """Return active global monthly-newsletter recipients."""
    rows = await conn.fetch(
        """
        SELECT email
        FROM news_email_subscriptions
        WHERE digest_frequency = 'monthly'
          AND status = 'active'
          AND region = 'global'
        ORDER BY created_at ASC
        """
    )
    return [str(row["email"]) for row in rows]


def main():
    """CLI entry point."""
    import asyncio

    period = sys.argv[1] if len(sys.argv) > 1 else "2026-02"
    dry_run = "--send" not in sys.argv

    script_dir = Path(__file__).resolve().parent
    project_root = script_dir.parents[3]
    data_path = project_root / "apps" / "web" / "data" / period / "output" / "newsletter_data.json"

    if not data_path.exists():
        print(f"Newsletter data not found: {data_path}")
        print("Run newsletter_generator.py first.")
        sys.exit(1)

    data = json.loads(data_path.read_text(encoding="utf-8"))
    print(f"Loaded newsletter data for {period}")

    if dry_run:
        html = generate_email_html(data)
        preview_path = script_dir / "newsletter_preview.html"
        preview_path.write_text(html, encoding="utf-8")
        print(f"HTML preview written to: {preview_path}")
        print(f"Size: {len(html):,} bytes")
        print("Use --send flag to send to subscribers.")
    else:
        asyncio.run(send_newsletter_email(data, dry_run=False))


if __name__ == "__main__":
    main()
