"""Report generation for newsletter output and CSV enrichment.

Supports saving briefs to both local filesystem and Azure Blob Storage.
"""

import csv
from pathlib import Path
from typing import List, Dict, Any, Optional, TYPE_CHECKING

from datetime import datetime, timezone

from src.data.models import StartupAnalysis, StartupInput
from src.config import settings

if TYPE_CHECKING:
    from src.storage import BlobStorageClient


def get_logo_path_for_company(company_name: str) -> Optional[str]:
    """Get the logo path for a company if it exists.

    Args:
        company_name: The company name

    Returns:
        Path to the logo file, or None if not found
    """
    slug = company_name.lower().replace(" ", "-").replace(".", "").replace(",", "").replace("&", "and")
    logos_dir = settings.data_output_dir / "logos"

    for ext in [".png", ".jpg", ".svg", ".webp", ".gif", ".ico"]:
        logo_path = logos_dir / f"{slug}{ext}"
        if logo_path.exists():
            return str(logo_path)

    return None


def _format_competitors(analysis: StartupAnalysis) -> str:
    """Format competitors list for brief with improved visual structure."""
    if not analysis.competitive_analysis.competitors:
        return "*No competitors identified*"

    lines = []
    for i, c in enumerate(analysis.competitive_analysis.competitors, 1):
        lines.append(f"**{i}. {c.name}**")
        if c.similarity:
            lines.append(f"   - *Similarity:* {c.similarity}")
        if c.how_different:
            lines.append(f"   - *Differentiation:* {c.how_different}")
        lines.append("")

    return "\n".join(lines).strip() if lines else "*No competitors identified*"


def _format_differentiation(analysis: StartupAnalysis) -> str:
    """Format differentiation for brief with clear visual hierarchy."""
    diff = analysis.competitive_analysis.differentiation
    lines = []

    if diff.primary:
        lines.append(f"> **Primary:** {diff.primary}")
        lines.append("")

    if diff.technical:
        lines.append(f"**Technical Edge:** {diff.technical}")
        lines.append("")

    if diff.business:
        lines.append(f"**Business Model:** {diff.business}")
        lines.append("")

    if diff.positioning:
        lines.append(f"**Market Position:** {diff.positioning}")

    return "\n".join(lines).strip() if lines else "*No differentiation analysis available*"


def _format_secret_sauce(analysis: StartupAnalysis) -> str:
    """Format secret sauce for brief with highlighted evidence."""
    sauce = analysis.competitive_analysis.secret_sauce
    lines = []

    if sauce.core_advantage:
        lines.append(f"> {sauce.core_advantage}")
        lines.append("")

    if sauce.defensibility:
        lines.append(f"**Defensibility:** {sauce.defensibility}")
        lines.append("")

    if sauce.evidence:
        lines.append("**Supporting Evidence:**")
        for e in sauce.evidence[:3]:
            lines.append(f"- *\"{e}\"*")

    return "\n".join(lines).strip() if lines else "*No secret sauce identified*"


def _format_model_details(analysis: StartupAnalysis) -> str:
    """Format model architecture details. Returns '' if no meaningful data."""
    md = analysis.model_details
    has_data = (
        md.primary_models
        or md.fine_tuning.uses_fine_tuning
        or md.inference_optimization
        or md.model_routing.uses_routing
        or md.compound_ai.is_compound_system
    )
    if not has_data:
        return ""

    lines = ["## Model Architecture", ""]
    rows = []
    if md.primary_models:
        rows.append(f"| **Primary Models** | {', '.join(f'`{m}`' for m in md.primary_models)} |")
    if md.fine_tuning.uses_fine_tuning:
        approach = md.fine_tuning.fine_tuning_approach or "Yes"
        rows.append(f"| **Fine-tuning** | {approach} |")
        if md.fine_tuning.training_data_source:
            rows.append(f"| **Training Data** | {md.fine_tuning.training_data_source} |")
    if md.model_routing.uses_routing:
        strategy = md.model_routing.routing_strategy or "Yes"
        rows.append(f"| **Model Routing** | {strategy} |")
    if md.compound_ai.is_compound_system:
        pattern = md.compound_ai.orchestration_pattern or "Yes"
        rows.append(f"| **Compound AI** | {pattern} |")
    if md.inference_optimization:
        rows.append(f"| **Optimization** | {', '.join(md.inference_optimization)} |")

    if rows:
        lines.append("| Aspect | Detail |")
        lines.append("|:-------|:-------|")
        lines.extend(rows)
        lines.append("")
        lines.append("---")
        lines.append("")

    return "\n".join(lines)


def _format_discovered_patterns(analysis: StartupAnalysis) -> str:
    """Format discovered patterns with novelty >= 6. Returns '' if none qualify."""
    notable = [p for p in analysis.discovered_patterns if p.novelty_score >= 6]
    if not notable:
        return ""

    notable.sort(key=lambda p: p.novelty_score, reverse=True)
    lines = ["## Advanced Build Patterns", ""]

    for p in notable[:8]:
        novelty_bar = "★" * min(p.novelty_score, 10)
        lines.append(f"**{p.pattern_name}** — `{p.category}`")
        lines.append(f"- Novelty: {novelty_bar} ({p.novelty_score}/10) | Confidence: {int(p.confidence * 100)}%")
        if p.description:
            lines.append(f"- {p.description}")
        if p.why_notable:
            lines.append(f"- *Why notable:* {p.why_notable}")
        lines.append("")

    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def _format_team_analysis(analysis: StartupAnalysis) -> str:
    """Format team & leadership analysis. Returns '' if no meaningful data."""
    ta = analysis.team_analysis
    has_data = (
        any(f.name for f in ta.founders)
        or ta.founder_market_fit
        or ta.team_strengths
        or ta.team_red_flags
    )
    if not has_data or ta.team_confidence < 0.1:
        return ""

    lines = ["## Team & Leadership", ""]

    # Founders
    named_founders = [f for f in ta.founders if f.name]
    if named_founders:
        for f in named_founders:
            role_str = f" — {f.role}" if f.role else ""
            lines.append(f"**{f.name}**{role_str}")
            if f.background:
                lines.append(f"- {f.background}")
            if f.previous_companies:
                lines.append(f"- Previously: {', '.join(f.previous_companies)}")
            depth = f.technical_depth if f.technical_depth != "unknown" else None
            expertise = f.domain_expertise if f.domain_expertise and f.domain_expertise != "unknown" else None
            tags = [t for t in [
                f"Technical: {depth}" if depth else None,
                f"Domain: {expertise}" if expertise else None,
            ] if t]
            if tags:
                lines.append(f"- {' | '.join(tags)}")
            lines.append("")

    # Founder-market fit
    if ta.founder_market_fit and "insufficient" not in ta.founder_market_fit.lower():
        lines.append(f"> **Founder-Market Fit:** {ta.founder_market_fit}")
        lines.append("")

    # Strengths
    real_strengths = [s for s in ta.team_strengths if "no public" not in s.lower() and "insufficient" not in s.lower()]
    if real_strengths:
        lines.append("**Strengths:**")
        for s in real_strengths[:5]:
            lines.append(f"- {s}")
        lines.append("")

    # Red flags
    real_flags = [r for r in ta.team_red_flags if "no public" not in r.lower() and "lack of accessible" not in r.lower()]
    if real_flags:
        lines.append("**Red Flags:**")
        for r in real_flags[:5]:
            lines.append(f"- ⚠ {r}")
        lines.append("")

    # Only return if we generated more than the header
    if len(lines) <= 2:
        return ""

    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def _format_business_product(analysis: StartupAnalysis) -> str:
    """Format business model + product analysis combined. Returns '' if no data."""
    bm = analysis.business_model
    pa = analysis.product_analysis

    has_bm = bm.business_model_confidence > 0.1 or bm.business_model_clarity != "unclear"
    has_pa = pa.product_confidence > 0.1 or pa.product_stage != "unknown"

    if not has_bm and not has_pa:
        return ""

    lines = ["## Business Model & Product", ""]

    # Business model table
    bm_rows = []
    if bm.pricing_model.type != "unknown":
        bm_rows.append(f"| **Pricing** | `{bm.pricing_model.type.replace('_', ' ').title()}` |")
    if bm.gtm_strategy.primary_channel != "unknown":
        bm_rows.append(f"| **GTM** | {bm.gtm_strategy.primary_channel.replace('_', ' ').title()} |")
    if bm.gtm_strategy.target_segment != "unknown":
        bm_rows.append(f"| **Segment** | {bm.gtm_strategy.target_segment.replace('_', ' ').title()} |")
    if bm.gtm_strategy.sales_motion != "unknown":
        bm_rows.append(f"| **Sales Motion** | {bm.gtm_strategy.sales_motion.replace('_', ' ').title()} |")
    if bm.revenue_model.recurring_revenue:
        bm_rows.append("| **Revenue** | Recurring |")
    if pa.product_stage != "unknown":
        bm_rows.append(f"| **Product Stage** | `{pa.product_stage.replace('_', ' ').title()}` |")
    bm_clarity = bm.business_model_clarity
    if bm_clarity != "unclear":
        bm_rows.append(f"| **Clarity** | {bm_clarity.title()} |")

    if bm_rows:
        lines.append("| Aspect | Detail |")
        lines.append("|:-------|:-------|")
        lines.extend(bm_rows)
        lines.append("")

    # Revenue approach
    if bm.revenue_model.monetization_approach:
        lines.append(f"> {bm.revenue_model.monetization_approach}")
        lines.append("")

    # Distribution advantages
    if bm.distribution_advantages:
        lines.append("**Distribution Advantages:**")
        for d in bm.distribution_advantages[:4]:
            lines.append(f"- {d}")
        lines.append("")

    # Price points
    if bm.pricing_model.price_points:
        lines.append(f"**Price Points:** {', '.join(bm.pricing_model.price_points)}")
        lines.append("")

    # Product strengths/risks
    real_strengths = [s for s in pa.product_strengths if "no " not in s.lower()[:5]]
    if real_strengths:
        lines.append("**Product Strengths:**")
        for s in real_strengths[:4]:
            lines.append(f"- {s}")
        lines.append("")

    real_risks = [r for r in pa.product_risks if "no " not in r.lower()[:5]]
    if real_risks:
        lines.append("**Product Risks:**")
        for r in real_risks[:4]:
            lines.append(f"- {r}")
        lines.append("")

    if len(lines) <= 2:
        return ""

    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def _format_story_angles(analysis: StartupAnalysis) -> str:
    """Format story angles for newsletter editors. Returns '' if none."""
    if not analysis.story_angles:
        return ""

    angles = sorted(analysis.story_angles, key=lambda a: a.uniqueness_score, reverse=True)
    lines = ["## Story Angles", ""]

    for i, angle in enumerate(angles[:5], 1):
        type_label = angle.angle_type.replace("_", " ").title()
        lines.append(f"### {i}. {angle.headline}")
        lines.append(f"*{type_label}* — Uniqueness: **{angle.uniqueness_score}/10**")
        lines.append("")
        if angle.summary:
            lines.append(angle.summary)
            lines.append("")
        if angle.evidence:
            for e in angle.evidence[:3]:
                lines.append(f"- *{e}*")
            lines.append("")

    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def _format_anti_patterns(analysis: StartupAnalysis) -> str:
    """Format warning signs / anti-patterns. Returns '' if none."""
    if not analysis.anti_patterns:
        return ""

    severity_order = {"high": 0, "medium": 1, "low": 2}
    patterns = sorted(analysis.anti_patterns, key=lambda p: severity_order.get(p.severity, 1))
    lines = ["## Risk Factors", ""]

    for p in patterns[:6]:
        sev = p.severity.upper()
        sev_icon = {"HIGH": "🔴", "MEDIUM": "🟡", "LOW": "🟢"}.get(sev, "⚪")
        type_label = p.pattern_type.replace("_", " ").title()
        lines.append(f"**{sev_icon} {type_label}** — Severity: `{sev}`")
        lines.append(f"- {p.description}")
        if p.evidence:
            for e in p.evidence[:2]:
                lines.append(f"  - *{e}*")
        lines.append("")

    lines.append("---")
    lines.append("")
    return "\n".join(lines)


def generate_startup_brief(
    analysis: StartupAnalysis,
    startup_input: StartupInput,
    logo_path: Optional[str] = None
) -> str:
    """Generate a markdown brief for a startup covering all analysis points.

    Args:
        analysis: The startup analysis data
        startup_input: The original startup input data
        logo_path: Optional path to the company logo image

    Returns:
        Markdown formatted brief
    """

    # Format funding
    funding_str = f"${analysis.funding_amount:,.0f}" if analysis.funding_amount else "Undisclosed"

    # Format patterns with visual confidence bars
    patterns_list = ""
    if analysis.build_patterns:
        for p in analysis.build_patterns:
            conf_pct = int(p.confidence * 100)
            conf_bar = "█" * (conf_pct // 10) + "░" * (10 - conf_pct // 10)
            patterns_list += f"\n**{p.name}**\n"
            patterns_list += f"- Confidence: `{conf_bar}` {conf_pct}%\n"
            if p.description:
                patterns_list += f"- {p.description}\n"
    else:
        patterns_list = "*No patterns detected*"

    # Format unique findings with numbering
    findings_list = ""
    if analysis.unique_findings:
        for i, finding in enumerate(analysis.unique_findings, 1):
            findings_list += f"{i}. {finding}\n"
    else:
        findings_list = "*No unique findings identified*"

    # Format evidence with proper quoting
    evidence_list = ""
    if analysis.evidence_quotes:
        for quote in analysis.evidence_quotes[:5]:
            evidence_list += f"> \"{quote}\"\n\n"
    else:
        evidence_list = "*No evidence quotes available*"

    # Format models mentioned with badges
    models_str = ", ".join([f"`{m}`" for m in analysis.models_mentioned]) if analysis.models_mentioned else "*None detected*"

    # GenAI status badge
    genai_badge = "**YES**" if analysis.uses_genai else "*NO*"
    intensity_badge = f"`{analysis.genai_intensity.value.upper()}`"

    # Moat badge formatting
    moat_value = analysis.competitive_analysis.competitive_moat.upper()
    if moat_value == "STRONG":
        moat_badge = "**STRONG**"
    elif moat_value == "MEDIUM":
        moat_badge = "*MEDIUM*"
    else:
        moat_badge = moat_value

    # Newsletter potential badge
    nl_potential = analysis.newsletter_potential.upper()
    if nl_potential == "HIGH":
        nl_badge = "**HIGH**"
    elif nl_potential == "MEDIUM":
        nl_badge = "*MEDIUM*"
    else:
        nl_badge = nl_potential

    # Format logo section if available
    logo_section = ""
    if logo_path:
        logo_section = f'\n<img src="{logo_path}" alt="{analysis.company_name} logo" width="120" height="120" style="border-radius: 8px;" />\n'

    # Format new sections (each returns '' if no data)
    model_arch_section = _format_model_details(analysis)
    advanced_patterns_section = _format_discovered_patterns(analysis)
    team_section = _format_team_analysis(analysis)
    business_section = _format_business_product(analysis)
    story_section = _format_story_angles(analysis)
    risk_section = _format_anti_patterns(analysis)

    brief = f"""# {analysis.company_name}
{logo_section}
> **GenAI Analysis Brief** | Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}

---

## Overview

| | |
|:--|:--|
| **Company** | {analysis.company_name} |
| **Website** | {analysis.website or 'N/A'} |
| **Funding** | **{funding_str}** |
| **Stage** | `{analysis.funding_stage.value.replace('_', ' ').title()}` |
| **Location** | {startup_input.location or 'N/A'} |
| **Industries** | {', '.join(startup_input.industries) if startup_input.industries else 'N/A'} |

{analysis.description or startup_input.description or '*No description available*'}

---

## GenAI Assessment

| Metric | Result |
|:-------|:------:|
| **Uses GenAI** | {genai_badge} |
| **Intensity** | {intensity_badge} |
| **Confidence** | {analysis.confidence_score:.0%} |
| **Models** | {models_str} |

> **Intensity Scale:**
> - **Core** — GenAI is the main product/value proposition
> - **Enhancement** — GenAI enhances an existing product
> - **Tooling** — GenAI used for internal operations
> - **None** — No GenAI detected

---

{model_arch_section}## Build Patterns

{patterns_list}

---

{advanced_patterns_section}## Market Position

| Classification | |
|:---------------|:--|
| **Market Type** | `{analysis.market_type.value.title()}` |
| **Sub-vertical** | {analysis.sub_vertical or 'N/A'} |
| **Sub-sub-vertical** | {analysis.sub_sub_vertical or 'N/A'} |
| **Target** | `{analysis.target_market.value.upper()}` |

---

## Competitive Analysis

### Key Competitors

{_format_competitors(analysis)}

### Differentiation Strategy

{_format_differentiation(analysis)}

### Secret Sauce

{_format_secret_sauce(analysis)}

### Moat Assessment

| | |
|:--|:--|
| **Competitive Moat** | {moat_badge} |
| **Explanation** | {analysis.competitive_analysis.moat_explanation or 'Not analyzed'} |

---

{team_section}{business_section}## Newsletter Potential

| Metric | Assessment |
|:-------|:----------:|
| **Potential** | {nl_badge} |
| **Technical Depth** | `{analysis.technical_depth.title()}` |

### Key Findings

{findings_list}

---

{story_section}{risk_section}## Evidence

{evidence_list}

---

## Data Quality

| Metric | Value |
|:-------|------:|
| **Sources Crawled** | {len(analysis.sources_crawled)} |
| **Content Analyzed** | {analysis.raw_content_analyzed:,} chars |
| **Analysis Time** | {analysis.analyzed_at.strftime('%Y-%m-%d %H:%M UTC') if analysis.analyzed_at else 'N/A'} |

---

*Auto-generated by the Startup GenAI Analysis System*
"""
    return brief


def save_startup_brief(
    analysis: StartupAnalysis,
    startup_input: StartupInput,
    output_dir: Path,
    logo_path: Optional[str] = None,
    storage_client: Optional["BlobStorageClient"] = None,
) -> Path:
    """Save the startup brief to a markdown file and optionally to blob storage.

    Args:
        analysis: The startup analysis data
        startup_input: The original startup input data
        output_dir: Directory to save the brief
        logo_path: Optional path to the company logo image
        storage_client: Optional BlobStorageClient for blob storage

    Returns:
        Path to the saved brief file
    """
    brief = generate_startup_brief(analysis, startup_input, logo_path)

    # Create briefs directory
    briefs_dir = output_dir / "briefs"
    briefs_dir.mkdir(parents=True, exist_ok=True)

    # Save brief to local filesystem
    brief_path = briefs_dir / f"{analysis.company_slug}_brief.md"
    with open(brief_path, "w") as f:
        f.write(brief)

    # Also save to blob storage if configured
    if storage_client and storage_client.is_configured:
        try:
            storage_client.save_brief(
                slug=analysis.company_slug,
                brief_content=brief,
            )
        except Exception as e:
            print(f"Warning: Failed to save brief to blob storage: {e}")

    return brief_path


def save_briefs_batch(
    analyses: List[StartupAnalysis],
    startup_inputs: Dict[str, StartupInput],
    output_dir: Path,
    storage_client: Optional["BlobStorageClient"] = None,
) -> List[Path]:
    """Save multiple briefs to filesystem and optionally blob storage.

    Args:
        analyses: List of StartupAnalysis objects
        startup_inputs: Dict mapping company name to StartupInput
        output_dir: Directory to save briefs
        storage_client: Optional BlobStorageClient

    Returns:
        List of paths to saved brief files
    """
    saved_paths = []

    for analysis in analyses:
        startup = startup_inputs.get(analysis.company_name)
        if not startup:
            continue

        logo_path = get_logo_path_for_company(analysis.company_name)
        path = save_startup_brief(
            analysis=analysis,
            startup_input=startup,
            output_dir=output_dir,
            logo_path=logo_path,
            storage_client=storage_client,
        )
        saved_paths.append(path)

    return saved_paths


def get_analysis_csv_columns() -> List[str]:
    """Get the column names for analysis enrichment."""
    return [
        # Original columns will be preserved
        # New analysis columns:
        "analysis_uses_genai",
        "analysis_genai_intensity",
        "analysis_models_mentioned",
        "analysis_build_patterns",
        "analysis_market_type",
        "analysis_vertical",
        "analysis_sub_vertical",
        "analysis_target_market",
        "analysis_unique_findings",
        "analysis_newsletter_potential",
        "analysis_technical_depth",
        "analysis_confidence_score",
        "analysis_content_analyzed_chars",
        "analysis_timestamp",
        # Competitive analysis columns
        "analysis_competitors",
        "analysis_differentiation",
        "analysis_secret_sauce",
        "analysis_competitive_moat",
    ]


def analysis_to_csv_row(analysis: StartupAnalysis) -> Dict[str, Any]:
    """Convert analysis to CSV row data."""
    # Format competitors
    competitors_str = "; ".join([
        c.name for c in analysis.competitive_analysis.competitors
    ]) if analysis.competitive_analysis.competitors else ""

    # Format differentiation
    diff = analysis.competitive_analysis.differentiation
    differentiation_str = diff.primary if diff.primary else ""

    # Format secret sauce
    sauce = analysis.competitive_analysis.secret_sauce
    secret_sauce_str = sauce.core_advantage if sauce.core_advantage else ""

    return {
        "analysis_uses_genai": "Yes" if analysis.uses_genai else "No",
        "analysis_genai_intensity": analysis.genai_intensity.value,
        "analysis_models_mentioned": "; ".join(analysis.models_mentioned) if analysis.models_mentioned else "",
        "analysis_build_patterns": "; ".join([p.name for p in analysis.build_patterns]) if analysis.build_patterns else "",
        "analysis_market_type": analysis.market_type.value,
        "analysis_vertical": analysis.vertical.value if analysis.vertical else "",
        "analysis_sub_vertical": analysis.sub_vertical or "",
        "analysis_target_market": analysis.target_market.value,
        "analysis_unique_findings": " | ".join(analysis.unique_findings[:3]) if analysis.unique_findings else "",
        "analysis_newsletter_potential": analysis.newsletter_potential,
        "analysis_technical_depth": analysis.technical_depth,
        "analysis_confidence_score": f"{analysis.confidence_score:.2f}",
        "analysis_content_analyzed_chars": str(analysis.raw_content_analyzed),
        "analysis_timestamp": analysis.analyzed_at.isoformat() if analysis.analyzed_at else "",
        # Competitive analysis
        "analysis_competitors": competitors_str,
        "analysis_differentiation": differentiation_str,
        "analysis_secret_sauce": secret_sauce_str,
        "analysis_competitive_moat": analysis.competitive_analysis.competitive_moat,
    }


def create_enriched_csv(
    original_csv_path: Path,
    analyses: List[StartupAnalysis],
    output_path: Path,
) -> Path:
    """Create an enriched CSV with analysis columns added."""

    # Create mapping from company name to analysis
    analysis_map = {a.company_name.lower(): a for a in analyses}

    # Read original CSV
    with open(original_csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        original_fieldnames = list(reader.fieldnames or [])
        rows = list(reader)

    # New fieldnames with analysis columns
    new_fieldnames = original_fieldnames + get_analysis_csv_columns()

    # Enrich rows
    enriched_rows = []
    for row in rows:
        # Extract company name from transaction name
        transaction_name = row.get("Transaction Name", "")
        # Strip funding type prefixes
        company_name = transaction_name
        for prefix in ["Series A - ", "Series B - ", "Series C - ", "Series D - ", "Series E - ",
                       "Seed Round - ", "Pre Seed Round - ", "Venture Round - ",
                       "Debt Financing - ", "Private Equity Round - ",
                       "Corporate Round - ", "Angel Round - ", "Funding Round - "]:
            company_name = company_name.replace(prefix, "")
        company_name = company_name.strip()

        # Look up analysis
        analysis = analysis_map.get(company_name.lower())

        if analysis:
            # Add analysis columns
            analysis_data = analysis_to_csv_row(analysis)
            row.update(analysis_data)
        else:
            # Add empty analysis columns
            for col in get_analysis_csv_columns():
                row[col] = ""

        enriched_rows.append(row)

    # Write enriched CSV
    enriched_csv_path = output_path / "startups_enriched_with_analysis.csv"
    with open(enriched_csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=new_fieldnames)
        writer.writeheader()
        writer.writerows(enriched_rows)

    return enriched_csv_path


def create_analysis_only_csv(analyses: List[StartupAnalysis], output_path: Path) -> Path:
    """Create a CSV with only the analyzed startups and their analysis data."""

    fieldnames = [
        "company_name",
        "website",
        "funding_amount",
        "funding_stage",
        "uses_genai",
        "genai_intensity",
        "models_mentioned",
        "build_patterns",
        "pattern_count",
        "market_type",
        "sub_vertical",
        "target_market",
        "unique_findings",
        "finding_count",
        "newsletter_potential",
        "technical_depth",
        "confidence_score",
        "content_analyzed_chars",
        "sources_crawled",
        "analyzed_at",
        # Competitive analysis columns
        "competitors",
        "differentiation",
        "secret_sauce",
        "competitive_moat",
        "moat_explanation",
    ]

    rows = []
    for a in analyses:
        # Format competitors
        competitors_str = "; ".join([
            c.name for c in a.competitive_analysis.competitors
        ]) if a.competitive_analysis.competitors else ""

        # Format differentiation
        diff = a.competitive_analysis.differentiation
        differentiation_str = diff.primary if diff.primary else ""

        # Format secret sauce
        sauce = a.competitive_analysis.secret_sauce
        secret_sauce_str = sauce.core_advantage if sauce.core_advantage else ""

        rows.append({
            "company_name": a.company_name,
            "website": a.website or "",
            "funding_amount": f"{a.funding_amount:,.0f}" if a.funding_amount else "",
            "funding_stage": a.funding_stage.value,
            "uses_genai": "Yes" if a.uses_genai else "No",
            "genai_intensity": a.genai_intensity.value,
            "models_mentioned": "; ".join(a.models_mentioned),
            "build_patterns": "; ".join([p.name for p in a.build_patterns]),
            "pattern_count": len(a.build_patterns),
            "market_type": a.market_type.value,
            "sub_vertical": a.sub_vertical or "",
            "target_market": a.target_market.value,
            "unique_findings": " | ".join(a.unique_findings[:3]),
            "finding_count": len(a.unique_findings),
            "newsletter_potential": a.newsletter_potential,
            "technical_depth": a.technical_depth,
            "confidence_score": f"{a.confidence_score:.2f}",
            "content_analyzed_chars": a.raw_content_analyzed,
            "sources_crawled": len(a.sources_crawled),
            "analyzed_at": a.analyzed_at.isoformat() if a.analyzed_at else "",
            # Competitive analysis
            "competitors": competitors_str,
            "differentiation": differentiation_str,
            "secret_sauce": secret_sauce_str,
            "competitive_moat": a.competitive_analysis.competitive_moat,
            "moat_explanation": a.competitive_analysis.moat_explanation or "",
        })

    csv_path = output_path / "analysis_results.csv"
    with open(csv_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    return csv_path


def generate_batch_summary_report(analyses: List[StartupAnalysis], output_path: Path) -> Path:
    """Generate a batch summary report for all analyzed startups."""

    # Compute statistics
    total = len(analyses)
    uses_genai = sum(1 for a in analyses if a.uses_genai)
    genai_pct = (uses_genai / total * 100) if total > 0 else 0
    not_genai_pct = 100 - genai_pct

    # Pattern frequency
    pattern_freq: Dict[str, int] = {}
    for a in analyses:
        for p in a.build_patterns:
            pattern_freq[p.name] = pattern_freq.get(p.name, 0) + 1

    # Intensity distribution
    intensity_dist: Dict[str, int] = {}
    for a in analyses:
        intensity_dist[a.genai_intensity.value] = intensity_dist.get(a.genai_intensity.value, 0) + 1

    # Newsletter potential
    newsletter_dist: Dict[str, int] = {}
    for a in analyses:
        newsletter_dist[a.newsletter_potential] = newsletter_dist.get(a.newsletter_potential, 0) + 1

    # High potential startups
    high_potential = [a for a in analyses if a.newsletter_potential == "high"]

    # Build the report
    report = f"""# Batch Analysis Summary

> **Generated:** {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}
>
> **Total Startups:** {total}

---

## GenAI Adoption Overview

| Metric | Count | Percentage |
|:-------|------:|:----------:|
| **Using GenAI** | {uses_genai} | **{genai_pct:.1f}%** |
| **Not Using GenAI** | {total - uses_genai} | {not_genai_pct:.1f}% |

### Intensity Distribution

| Intensity | Count | Share |
|:----------|------:|------:|
"""
    for intensity, count in sorted(intensity_dist.items(), key=lambda x: -x[1]):
        pct = count / total * 100 if total > 0 else 0
        bar = "█" * int(pct / 10) + "░" * (10 - int(pct / 10))
        report += f"| `{intensity.title()}` | {count} | `{bar}` {pct:.1f}% |\n"

    report += f"""
---

## Build Patterns

| Pattern | Occurrences | Prevalence |
|:--------|------------:|-----------:|
"""
    for pattern, count in sorted(pattern_freq.items(), key=lambda x: -x[1]):
        pct = count / total * 100 if total > 0 else 0
        bar = "█" * int(pct / 10) + "░" * (10 - int(pct / 10))
        report += f"| **{pattern}** | {count} | `{bar}` {pct:.1f}% |\n"

    report += f"""
---

## Newsletter Potential

| Potential | Count | Distribution |
|:----------|------:|-------------:|
"""
    for potential, count in sorted(newsletter_dist.items(), key=lambda x: -x[1]):
        pct = count / total * 100 if total > 0 else 0
        bar = "█" * int(pct / 10) + "░" * (10 - int(pct / 10))
        badge = f"**{potential.upper()}**" if potential == "high" else potential.title()
        report += f"| {badge} | {count} | `{bar}` {pct:.1f}% |\n"

    report += f"""
---

## High-Potential Startups

"""
    if high_potential:
        for i, a in enumerate(high_potential, 1):
            patterns = ', '.join([f"`{p.name}`" for p in a.build_patterns]) or '*None*'
            report += f"""### {i}. {a.company_name}

| | |
|:--|:--|
| **Intensity** | `{a.genai_intensity.value.upper()}` |
| **Patterns** | {patterns} |

**Key Findings:**
"""
            for j, finding in enumerate(a.unique_findings[:3], 1):
                report += f"{j}. {finding}\n"
            report += "\n"
    else:
        report += "*No high-potential startups identified in this batch.*\n"

    report += f"""
---

## Complete Analysis

| Company | GenAI | Intensity | Top Patterns | Potential |
|:--------|:-----:|:---------:|:-------------|:---------:|
"""
    for a in sorted(analyses, key=lambda x: x.company_name):
        genai_badge = "**Yes**" if a.uses_genai else "No"
        patterns_str = ", ".join([p.name for p in a.build_patterns[:2]])
        if len(a.build_patterns) > 2:
            patterns_str += f" +{len(a.build_patterns) - 2}"
        potential_badge = f"**{a.newsletter_potential.upper()}**" if a.newsletter_potential == "high" else a.newsletter_potential
        report += f"| {a.company_name} | {genai_badge} | `{a.genai_intensity.value}` | {patterns_str or '—'} | {potential_badge} |\n"

    report += """
---

*Auto-generated by the Startup GenAI Analysis System*
"""

    # Save report
    report_path = output_path / "batch_summary_report.md"
    with open(report_path, "w") as f:
        f.write(report)

    return report_path
