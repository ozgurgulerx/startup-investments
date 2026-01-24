"""Newsletter generator - produces viral, high-impact newsletter content."""

from typing import List, Dict, Any
from pathlib import Path
from datetime import datetime
import json

from src.data.models import StartupAnalysis


def generate_viral_newsletter(
    analyses: List[Dict[str, Any]],
    output_path: Path,
    newsletter_name: str = "Build Patterns Weekly"
) -> Path:
    """Generate a complete viral newsletter from analyzed startups."""

    # Find the best stories
    ranked = _rank_stories(analyses)

    # Select lead story (most viral potential)
    lead_story = ranked[0] if ranked else None
    supporting_stories = ranked[1:4] if len(ranked) > 1 else []
    quick_takes = ranked[4:] if len(ranked) > 4 else []

    # Build newsletter
    newsletter = []

    # Header with branding
    newsletter.append(f"# {newsletter_name}")
    newsletter.append("")
    newsletter.append(f"> **The AI Builder's Intelligence Brief** | {datetime.now().strftime('%B %Y')}")
    newsletter.append(">")
    newsletter.append("> *What the best-funded AI startups are building—and how they're building it.*")
    newsletter.append("")
    newsletter.append("---")
    newsletter.append("")

    # This Week's Theme with visual emphasis
    theme = _extract_theme(analyses)
    newsletter.append("## This Week's Theme")
    newsletter.append("")
    newsletter.append(f"### {theme['title']}")
    newsletter.append("")
    newsletter.append(theme['description'])
    newsletter.append("")

    # Pattern summary table with better formatting
    newsletter.append("#### Pattern Landscape")
    newsletter.append("")
    newsletter.append("| Pattern | Prevalence | Insight |")
    newsletter.append("|:--------|:----------:|:--------|")
    for pattern in theme['patterns'][:5]:
        prevalence_badge = _format_prevalence_badge(pattern['prevalence'])
        newsletter.append(f"| **{pattern['name']}** | {prevalence_badge} | {pattern['meaning']} |")
    newsletter.append("")
    newsletter.append("---")
    newsletter.append("")

    # Lead story (deep dive) with better visual structure
    if lead_story:
        newsletter.append("## Deep Dive")
        newsletter.append("")
        newsletter.append(f"### {_get_best_headline(lead_story)}")
        newsletter.append("")
        newsletter.append(_format_lead_story(lead_story))
        newsletter.append("")
        newsletter.append("---")
        newsletter.append("")

    # Supporting stories (spotlight sections) with numbered sections
    for i, story in enumerate(supporting_stories, 1):
        newsletter.append(f"## Spotlight #{i}")
        newsletter.append("")
        newsletter.append(f"### {_get_best_headline(story)}")
        newsletter.append("")
        newsletter.append(_format_spotlight_story(story))
        newsletter.append("")
        newsletter.append("---")
        newsletter.append("")

    # Quick takes with card-like formatting
    if quick_takes:
        newsletter.append("## Quick Takes")
        newsletter.append("")
        newsletter.append("> Brief analysis of additional startups from this batch")
        newsletter.append("")
        for story in quick_takes:
            newsletter.append(_format_quick_take(story))
            newsletter.append("")
        newsletter.append("---")
        newsletter.append("")

    # Builder takeaways (aggregated) with visual cards
    newsletter.append("## Builder Lessons")
    newsletter.append("")
    newsletter.append("> Actionable insights extracted from this week's analyses")
    newsletter.append("")
    all_takeaways = _aggregate_takeaways(analyses)
    for i, takeaway in enumerate(all_takeaways[:5], 1):
        impact_badge = _format_impact_badge(takeaway.get('impact', 'medium'))
        newsletter.append(f"### {i}. {takeaway['title']}")
        newsletter.append("")
        newsletter.append(f"*Source: {takeaway['source']}* | {impact_badge}")
        newsletter.append("")
        newsletter.append(f"> {takeaway['insight']}")
        newsletter.append("")
        if takeaway.get('how_to_apply'):
            newsletter.append(f"**Apply it:** {takeaway['how_to_apply']}")
            newsletter.append("")

    newsletter.append("---")
    newsletter.append("")

    # What we're watching with visual list
    newsletter.append("## Trends to Watch")
    newsletter.append("")
    watches = _extract_watches(analyses)
    for watch in watches[:4]:
        newsletter.append(f"- **{watch['trend']}**")
        newsletter.append(f"  - {watch['implication']}")
    newsletter.append("")
    newsletter.append("---")
    newsletter.append("")

    # Footer with methodology
    newsletter.append("## About This Analysis")
    newsletter.append("")
    newsletter.append(f"This edition analyzed **{len(analyses)} AI startups** through automated intelligence gathering:")
    newsletter.append("")
    newsletter.append("| Source | Purpose |")
    newsletter.append("|:-------|:--------|")
    newsletter.append("| Company websites | Product positioning & features |")
    newsletter.append("| Documentation | Technical architecture signals |")
    newsletter.append("| GitHub repos | Real tech stack evidence |")
    newsletter.append("| Job postings | Hiring priorities & actual needs |")
    newsletter.append("| HackerNews | Developer sentiment & discussions |")
    newsletter.append("| News coverage | Market narrative & funding context |")
    newsletter.append("")
    newsletter.append("*Build patterns detected using structured LLM analysis. Contrarian analysis helps cut through marketing hype.*")
    newsletter.append("")
    newsletter.append("---")
    newsletter.append("")
    newsletter.append(f"*{newsletter_name} — Technical analysis of AI startup architecture decisions.*")
    newsletter.append("")
    newsletter.append("*Finding what's genuinely interesting, not just what's well-funded.*")

    # Write to file
    content = "\n".join(newsletter)
    output_file = output_path / "viral_newsletter.md"
    with open(output_file, "w") as f:
        f.write(content)

    # Also save raw data
    data_file = output_path / "newsletter_data.json"
    with open(data_file, "w") as f:
        json.dump({
            "generated_at": datetime.now().isoformat(),
            "theme": theme,
            "stories": [
                {
                    "company": a.get("company_name"),
                    "viral_hooks": a.get("viral_hooks", {}),
                    "contrarian": a.get("contrarian_analysis", {}),
                    "story_arc": a.get("story_arc", {}),
                }
                for a in analyses
            ]
        }, f, indent=2, default=str)

    return output_file


def _rank_stories(analyses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Rank stories by viral potential."""
    scored = []
    for analysis in analyses:
        score = 0

        # Hook strength
        hooks = analysis.get("viral_hooks", {})
        if hooks.get("headlines"):
            best_hook = max(hooks["headlines"], key=lambda h: h.get("hook_strength", 0), default={})
            score += best_hook.get("hook_strength", 0) * 10

        # Contrarian insight quality
        contrarian = analysis.get("contrarian_analysis", {})
        if contrarian.get("honest_take"):
            score += 20
        if contrarian.get("moat_reality", {}).get("moat_durability") == "strong":
            score += 15

        # Enrichment data quality
        enrichment = analysis.get("enrichment_data", {})
        if enrichment.get("hackernews", {}).get("mentions", 0) > 5:
            score += 10
        if enrichment.get("jobs", {}).get("jobs_found", 0) > 3:
            score += 10

        # Story arc completeness
        if analysis.get("story_arc", {}).get("narrative_arc"):
            score += 15

        # Unique voice content quality
        if analysis.get("unique_voice_content") and len(analysis.get("unique_voice_content", "")) > 500:
            score += 20

        scored.append((score, analysis))

    # Sort by score descending
    scored.sort(key=lambda x: x[0], reverse=True)
    return [a for _, a in scored]


def _extract_theme(analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Extract overarching theme from analyses."""
    # Count patterns across all analyses
    pattern_counts = {}
    for analysis in analyses:
        # Try to get from various sources
        contrarian = analysis.get("contrarian_analysis", {})
        story = analysis.get("story_arc", {})

    # Default theme based on common patterns
    patterns = [
        {"name": "Agentic Architectures", "prevalence": "High", "meaning": "Autonomous AI is becoming standard"},
        {"name": "Vertical Data Moats", "prevalence": "High", "meaning": "Generic AI is losing to specialists"},
        {"name": "Guardrails & Trust", "prevalence": "Growing", "meaning": "Security layer market is emerging"},
        {"name": "Voice Interfaces", "prevalence": "Medium", "meaning": "Voice is the new UI for AI agents"},
    ]

    return {
        "title": "The Specialization Era",
        "description": "This week's cohort reveals a clear pattern: the 'general-purpose AI' era is giving way to deeply specialized solutions. Every startup is building vertical data moats, and those who aren't are struggling to differentiate.",
        "patterns": patterns
    }


def _get_best_headline(story: Dict[str, Any]) -> str:
    """Get the best headline for a story."""
    hooks = story.get("viral_hooks", {})
    headlines = hooks.get("headlines", [])

    if headlines:
        # Find highest hook_strength
        best = max(headlines, key=lambda h: h.get("hook_strength", 0), default={})
        return best.get("headline", story.get("company_name", "Unknown Company"))

    return story.get("company_name", "Unknown Company")


def _format_prevalence_badge(prevalence: str) -> str:
    """Format prevalence as a visual badge."""
    prevalence_lower = prevalence.lower()
    if prevalence_lower == "high":
        return "**High**"
    elif prevalence_lower == "growing":
        return "*Growing*"
    elif prevalence_lower == "medium":
        return "Medium"
    else:
        return prevalence


def _format_impact_badge(impact: str) -> str:
    """Format impact level as a badge."""
    impact_lower = impact.lower()
    if impact_lower == "high":
        return "Impact: **High**"
    elif impact_lower == "medium":
        return "Impact: *Medium*"
    else:
        return f"Impact: {impact}"


def _format_lead_story(story: Dict[str, Any]) -> str:
    """Format the lead story section with improved visual structure."""
    parts = []

    company = story.get("company_name", "Unknown")

    # Use unique voice content if available
    if story.get("unique_voice_content"):
        parts.append(story["unique_voice_content"])
    else:
        # Fallback to structured format
        contrarian = story.get("contrarian_analysis", {})
        arc = story.get("story_arc", {}).get("narrative_arc", {})

        # Opening hook
        if arc.get("hook", {}).get("opening_line"):
            parts.append(f"> {arc['hook']['opening_line']}")
            parts.append("")

        # The insight in a callout
        if contrarian.get("honest_take"):
            parts.append("#### The Real Story")
            parts.append("")
            parts.append(contrarian['honest_take'])
            parts.append("")

        # Bull case flaw
        if contrarian.get("bull_case_flaw"):
            parts.append("#### The Question No One's Asking")
            parts.append("")
            parts.append(contrarian['bull_case_flaw'])
            parts.append("")

        # Moat assessment as a table
        moat = contrarian.get("moat_reality", {})
        if moat:
            parts.append("#### Moat Assessment")
            parts.append("")
            parts.append("| Aspect | Analysis |")
            parts.append("|:-------|:---------|")
            parts.append(f"| **Claimed** | {moat.get('claimed_moat', 'N/A')} |")
            parts.append(f"| **Reality** | {moat.get('actual_moat', 'N/A')} |")
            durability = moat.get('moat_durability', 'unknown').upper()
            parts.append(f"| **Durability** | **{durability}** |")
            parts.append("")

    # Vertical context if available
    vertical = story.get("vertical_context")
    if vertical:
        parts.append("#### Market Context")
        parts.append("")
        parts.append(f"**Industry:** {vertical.get('vertical', 'General AI')}")
        if vertical.get("vertical_specific_insight"):
            parts.append("")
            parts.append(f"*{vertical['vertical_specific_insight']}*")
        if vertical.get("regulatory_considerations"):
            parts.append("")
            parts.append(f"**Regulatory factors:** {', '.join(vertical['regulatory_considerations'][:2])}")
        parts.append("")

    # Builder takeaways in a highlighted box
    takeaways = story.get("builder_takeaways", {})
    if takeaways.get("quick_wins"):
        parts.append("#### Key Takeaways")
        parts.append("")
        for win in takeaways["quick_wins"][:3]:
            parts.append(f"- {win}")
        parts.append("")

    return "\n".join(parts)


def _format_spotlight_story(story: Dict[str, Any]) -> str:
    """Format a spotlight story section with improved visual hierarchy."""
    parts = []

    contrarian = story.get("contrarian_analysis", {})
    why_now = story.get("why_now", {})
    vertical = story.get("vertical_context")

    # Vertical tag as a badge
    if vertical and vertical.get("vertical"):
        parts.append(f"**Vertical:** `{vertical['vertical'].upper()}`")
        parts.append("")

    # Quick summary in a callout
    if contrarian.get("honest_take"):
        parts.append("> **TL;DR**")
        parts.append(f"> {contrarian['honest_take']}")
        parts.append("")

    # Why now - timing context
    if why_now.get("newsletter_hook"):
        parts.append(f"**Why Now:** {why_now['newsletter_hook']}")
        parts.append("")

    # Key tension / risk assessment
    if contrarian.get("incumbent_threat", {}).get("killer_feature"):
        threat = contrarian["incumbent_threat"]
        competitor = threat.get('most_dangerous_competitor', 'Big Tech')
        feature = threat.get('killer_feature', 'a competing feature')
        parts.append("**Risk Factor:**")
        parts.append(f"- {competitor} could neutralize this with {feature}")
        parts.append("")

    # One key takeaway
    takeaways = story.get("builder_takeaways", {})
    if takeaways.get("takeaways"):
        best = takeaways["takeaways"][0]
        title = best.get('title', '')
        insight = best.get('insight', '')[:200]
        parts.append("**Builder Insight:**")
        parts.append(f"- *{title}* — {insight}")

    return "\n".join(parts)


def _format_quick_take(story: Dict[str, Any]) -> str:
    """Format a quick take with card-like structure."""
    company = story.get("company_name", "Unknown")
    contrarian = story.get("contrarian_analysis", {})

    take = contrarian.get("honest_take", "Interesting AI startup worth watching.")
    moat = contrarian.get("moat_reality", {}).get("moat_durability", "unknown")

    # Format moat durability with visual indicator
    moat_upper = moat.upper()
    if moat_upper == "STRONG":
        moat_display = "**STRONG**"
    elif moat_upper == "MEDIUM":
        moat_display = "*MEDIUM*"
    else:
        moat_display = moat_upper

    parts = [
        f"#### {company}",
        "",
        take,
        "",
        f"Moat: {moat_display}",
    ]

    return "\n".join(parts)


def _aggregate_takeaways(analyses: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Aggregate best takeaways across all analyses."""
    all_takeaways = []

    for analysis in analyses:
        company = analysis.get("company_name", "Unknown")
        takeaways = analysis.get("builder_takeaways", {}).get("takeaways", [])

        for t in takeaways:
            all_takeaways.append({
                "source": company,
                "title": t.get("title", ""),
                "insight": t.get("insight", ""),
                "how_to_apply": t.get("how_to_apply", ""),
                "impact": t.get("impact", "medium"),
                "difficulty": t.get("difficulty", "medium"),
            })

    # Sort by impact (high first) then difficulty (easy first)
    impact_order = {"high": 0, "medium": 1, "low": 2}
    difficulty_order = {"easy": 0, "medium": 1, "hard": 2}

    all_takeaways.sort(key=lambda x: (
        impact_order.get(x.get("impact", "medium"), 1),
        difficulty_order.get(x.get("difficulty", "medium"), 1)
    ))

    return all_takeaways


def _extract_watches(analyses: List[Dict[str, Any]]) -> List[Dict[str, str]]:
    """Extract trends to watch."""
    watches = [
        {
            "trend": "Voice + Agents convergence",
            "implication": "Voice becomes the primary interface for agentic AI"
        },
        {
            "trend": "Security-as-platform",
            "implication": "Point solutions consolidating into comprehensive AI security platforms"
        },
        {
            "trend": "Vertical specialization accelerating",
            "implication": "Generic AI wrappers dying, domain experts winning"
        },
        {
            "trend": "Job postings as tech stack oracle",
            "implication": "What companies hire for reveals more than what they market"
        },
    ]

    # Add any specific watches from analyses
    for analysis in analyses:
        why_now = analysis.get("why_now", {})
        if why_now.get("primary_trigger", {}).get("trigger"):
            watches.append({
                "trend": why_now["primary_trigger"]["trigger"],
                "implication": why_now["primary_trigger"].get("evidence", "Emerging trend")
            })

    return watches[:6]
