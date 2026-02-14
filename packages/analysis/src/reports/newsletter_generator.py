"""Newsletter generator - produces viral, high-impact newsletter content."""

from typing import List, Dict, Any, Optional
from pathlib import Path
from datetime import datetime
import json
import math
import re


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
    all_takeaways = _aggregate_takeaways(analyses)
    if all_takeaways:
        newsletter.append("## Builder Lessons")
        newsletter.append("")
        newsletter.append("> Actionable insights extracted from this week's analyses")
        newsletter.append("")
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

        # Base-analysis heuristics (when viral fields are missing).
        # This prevents "all scores == 0" and keeps lead story selection stable and sensible.
        newsletter_potential = (analysis.get("newsletter_potential") or "").lower().strip()
        if newsletter_potential == "high":
            score += 12
        elif newsletter_potential == "medium":
            score += 6

        technical_depth = (analysis.get("technical_depth") or "").lower().strip()
        if technical_depth in ("deep", "technical", "high"):
            score += 6
        elif technical_depth in ("medium", "moderate"):
            score += 3

        # Prefer stories with richer story angles (already computed in base analysis).
        angles = analysis.get("story_angles") or []
        if isinstance(angles, list) and angles:
            best_angle = max(
                (a for a in angles if isinstance(a, dict)),
                key=lambda a: a.get("uniqueness_score", 0) or 0,
                default=None,
            )
            if best_angle:
                score += int(best_angle.get("uniqueness_score", 0) or 0)

        # Funding as a weak tie-breaker (log scale).
        amount = analysis.get("funding_amount") or 0
        try:
            amount = float(amount)
        except Exception:
            amount = 0
        if amount > 0:
            score += min(10, int(math.log10(amount + 1)))

        scored.append((score, analysis))

    # Sort by score descending
    scored.sort(key=lambda x: x[0], reverse=True)
    return [a for _, a in scored]


def _extract_theme(analyses: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Extract overarching theme from analyses using real pattern data."""
    # Count patterns across all analyses
    pattern_counts = {}
    category_counts = {}
    novel_pattern_examples = []

    for analysis in analyses:
        # Count from legacy build_patterns
        for pattern in analysis.get("build_patterns", []):
            name = pattern.get("name", "")
            if name:
                pattern_counts[name] = pattern_counts.get(name, 0) + 1

        # Count from new discovered_patterns
        for pattern in analysis.get("discovered_patterns", []):
            name = pattern.get("pattern_name", "")
            category = pattern.get("category", "Other")
            if name:
                pattern_counts[name] = pattern_counts.get(name, 0) + 1
                category_counts[category] = category_counts.get(category, 0) + 1

                # Track high-novelty patterns
                novelty = pattern.get("novelty_score", 5)
                if novelty >= 7:
                    novel_pattern_examples.append({
                        "name": name,
                        "category": category,
                        "why_notable": pattern.get("why_notable", "")
                    })

    # Sort patterns by count
    sorted_patterns = sorted(pattern_counts.items(), key=lambda x: x[1], reverse=True)
    sorted_categories = sorted(category_counts.items(), key=lambda x: x[1], reverse=True)

    # Determine prevalence based on percentage
    total_analyses = max(len(analyses), 1)

    def get_prevalence(count: int) -> str:
        pct = count / total_analyses
        if pct >= 0.5:
            return "High"
        elif pct >= 0.25:
            return "Medium"
        elif pct >= 0.1:
            return "Growing"
        else:
            return "Low"

    # Generate pattern insights
    pattern_meanings = {
        "RAG (Retrieval-Augmented Generation)": "Companies building knowledge-enhanced AI systems",
        "Agentic Architectures": "Autonomous AI agents taking actions independently",
        "Vertical Data Moats": "Domain-specific data creating defensibility",
        "Fine-tuned Models": "Custom models trained on proprietary data",
        "Compound AI Systems": "Multiple AI components working together",
        "EvalOps": "Systematic evaluation and quality measurement",
        "LLMOps": "Infrastructure for deploying and monitoring LLMs",
        "LLM Security": "Protecting AI systems from attacks and misuse",
        "Data Flywheels": "User interactions improving the product over time",
        "Model Routing": "Dynamic selection between multiple models",
        "Guardrail-as-LLM": "Using LLMs to enforce safety constraints",
        "Knowledge Graphs": "Structured relationships enhancing retrieval",
        "Inference Optimization": "Making AI faster and cheaper to run",
        "Prompt Engineering": "Sophisticated prompt design for better outputs",
    }

    # Build patterns list from real data
    patterns = []
    for name, count in sorted_patterns[:6]:
        meaning = pattern_meanings.get(name, f"Appearing in {count} startups this period")
        patterns.append({
            "name": name,
            "prevalence": get_prevalence(count),
            "meaning": meaning
        })

    # Generate theme title and description based on dominant patterns
    if sorted_categories:
        top_category = sorted_categories[0][0]
        theme_titles = {
            "Model Architecture": "The Custom Model Era",
            "Compound AI Systems": "The Orchestration Wave",
            "Retrieval & Knowledge": "The Knowledge Infrastructure Boom",
            "Evaluation & Quality": "The Quality-First Movement",
            "Operations & Infrastructure": "The LLMOps Maturation",
            "Safety & Trust": "The Trust Infrastructure Build-out",
            "Learning & Improvement": "The Flywheel Builders",
            "Data Strategy": "The Data Moat Arms Race",
        }
        title = theme_titles.get(top_category, f"The {top_category} Focus")
    elif sorted_patterns:
        top_pattern = sorted_patterns[0][0]
        title = f"The Rise of {top_pattern}"
    else:
        title = "AI Infrastructure Evolution"

    # Generate description based on actual data
    if sorted_patterns:
        top_3 = [p[0] for p in sorted_patterns[:3]]
        pct_with_genai = sum(1 for a in analyses if a.get("uses_genai", False)) / total_analyses * 100

        if novel_pattern_examples:
            novel_names = [p["name"] for p in novel_pattern_examples[:2]]
            description = (
                f"This cohort of {total_analyses} startups shows strong convergence around "
                f"{', '.join(top_3[:2])} and {top_3[2] if len(top_3) > 2 else 'specialized solutions'}. "
                f"{pct_with_genai:.0f}% use GenAI as a core component. "
                f"Novel approaches emerging: {', '.join(novel_names)}."
            )
        else:
            description = (
                f"Analyzing {total_analyses} AI startups reveals dominant patterns: "
                f"{', '.join(top_3)}. {pct_with_genai:.0f}% use GenAI as a core product component, "
                f"with vertical specialization as the primary differentiation strategy."
            )
    else:
        description = f"This period's {total_analyses} startups show diverse AI adoption patterns."

    return {
        "title": title,
        "description": description,
        "patterns": patterns if patterns else [
            {"name": "Various Patterns", "prevalence": "Mixed", "meaning": "Limited pattern data available"}
        ]
    }

def _get_story_angles(story: Dict[str, Any]) -> List[Dict[str, Any]]:
    angles = story.get("story_angles") or []
    if not isinstance(angles, list):
        return []
    return [a for a in angles if isinstance(a, dict)]


def _pick_best_story_angle(story: Dict[str, Any], allowed_types: Optional[List[str]] = None) -> Optional[Dict[str, Any]]:
    angles = _get_story_angles(story)
    if allowed_types:
        allowed = set(allowed_types)
        angles = [a for a in angles if (a.get("angle_type") or "") in allowed]
    if not angles:
        return None
    return max(angles, key=lambda a: a.get("uniqueness_score", 0) or 0)


def _truncate(text: str, max_len: int) -> str:
    s = (text or "").strip()
    if len(s) <= max_len:
        return s
    return s[: max(0, max_len - 3)].rstrip() + "..."


def _title_from_finding(text: str, max_len: int = 72) -> str:
    s = (text or "").strip()
    if not s:
        return "Insight"
    # Prefer "Title: rest" style findings.
    if ":" in s:
        head = s.split(":", 1)[0].strip()
        if head and len(head) <= max_len:
            return head
    # Otherwise, use a short, word-bound prefix.
    compact = re.sub(r"\s+", " ", s)
    compact = re.sub(r"[.?!].*$", "", compact).strip()
    if not compact:
        compact = s
    return _truncate(compact, max_len)


def _format_base_story_markdown(story: Dict[str, Any], kind: str) -> str:
    """Best-effort renderer when viral fields are missing (base analysis only)."""
    company = (story.get("company_name") or "Unknown").strip()
    description = (story.get("description") or "").strip()
    angle = _pick_best_story_angle(story)
    build_patterns = story.get("build_patterns") or []
    novel = story.get("novel_approaches") or []
    findings = story.get("unique_findings") or []

    parts: List[str] = []

    if description:
        parts.append(description)
        parts.append("")

    if angle and angle.get("summary"):
        if kind == "lead":
            parts.append("#### The Core Insight")
            parts.append("")
        parts.append((angle.get("summary") or "").strip())
        parts.append("")

    if kind in ("lead", "spotlight") and build_patterns:
        patterns = []
        for p in build_patterns:
            if isinstance(p, dict) and p.get("name"):
                patterns.append(p)
        if patterns:
            parts.append("#### Build Pattern Fingerprint")
            parts.append("")
            for p in patterns[:5]:
                name = (p.get("name") or "").strip()
                desc = (p.get("description") or "").strip()
                if name and desc:
                    parts.append(f"- **{name}**: {desc}")
                elif name:
                    parts.append(f"- **{name}**")
            parts.append("")

    if kind == "lead" and isinstance(novel, list) and novel:
        novel_items = [n for n in novel if isinstance(n, dict) and (n.get("approach") or n.get("why_novel"))]
        if novel_items:
            parts.append("#### Novel Approaches")
            parts.append("")
            for n in novel_items[:3]:
                approach = (n.get("approach") or "").strip()
                why = (n.get("why_novel") or "").strip()
                impact = (n.get("potential_impact") or "").strip()
                line = approach or "Novel approach"
                if why:
                    line += f" - {why}"
                if impact and len(line) < 220:
                    line += f" (Impact: {impact})"
                parts.append(f"- {line}")
            parts.append("")

    comp = story.get("competitive_analysis") or {}
    if isinstance(comp, dict):
        moat = (comp.get("competitive_moat") or "").strip().lower()
        if moat and kind in ("lead", "spotlight"):
            parts.append("#### Moat Snapshot")
            parts.append("")
            parts.append(f"Moat durability: **{moat.upper()}**.")
            expl = (comp.get("moat_explanation") or "").strip()
            if expl:
                parts.append("")
                parts.append(expl)
            parts.append("")

    if kind == "lead" and isinstance(findings, list) and findings:
        bullets = [f for f in findings if isinstance(f, str) and f.strip()]
        if bullets:
            parts.append("#### Builder Takeaways")
            parts.append("")
            for b in bullets[:4]:
                parts.append(f"- {b.strip()}")
            parts.append("")

    eng = story.get("engineering_quality") or {}
    if kind == "lead" and isinstance(eng, dict):
        score = eng.get("score")
        signals = eng.get("signals") or []
        sigs = [s for s in signals if isinstance(s, str) and s.strip()]
        if score is not None or sigs:
            parts.append("#### Execution Signals")
            parts.append("")
            if score is not None:
                parts.append(f"Engineering quality score: **{score}/10**.")
            for s in sigs[:3]:
                parts.append(f"- {s.strip()}")
            parts.append("")

    if kind == "quick":
        if not parts:
            parts.append("Interesting AI startup worth watching.")
            parts.append("")
        moat = "UNKNOWN"
        if isinstance(comp, dict):
            cm = (comp.get("competitive_moat") or "").strip()
            if cm:
                moat = cm.upper()
        parts.append(f"Moat: {moat}")

    return "\n".join([p for p in parts if p is not None]).strip()


def _get_best_headline(story: Dict[str, Any]) -> str:
    """Get the best headline for a story."""
    hooks = story.get("viral_hooks", {})
    headlines = hooks.get("headlines", [])

    if headlines:
        # Find highest hook_strength
        best = max(headlines, key=lambda h: h.get("hook_strength", 0), default={})
        return best.get("headline", story.get("company_name", "Unknown Company"))

    angle = _pick_best_story_angle(story)
    if angle and angle.get("headline"):
        return angle.get("headline") or story.get("company_name", "Unknown Company")

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

    rendered = "\n".join(parts).strip()
    if not rendered:
        return _format_base_story_markdown(story, kind="lead")
    return rendered


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

    rendered = "\n".join(parts).strip()
    if not rendered:
        return _format_base_story_markdown(story, kind="spotlight")
    return rendered


def _format_quick_take(story: Dict[str, Any]) -> str:
    """Format a quick take with card-like structure."""
    company = story.get("company_name", "Unknown")
    contrarian = story.get("contrarian_analysis", {})

    take = contrarian.get("honest_take")
    moat = contrarian.get("moat_reality", {}).get("moat_durability", "unknown")
    if not take:
        # Base-analysis fallback: story angles + build patterns + competitive moat.
        body = _format_base_story_markdown(story, kind="quick")
        return "\n".join([f"#### {company}", "", body]).strip()
    take = take.strip()

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

        if takeaways:
            for t in takeaways:
                all_takeaways.append({
                    "source": company,
                    "title": t.get("title", ""),
                    "insight": t.get("insight", ""),
                    "how_to_apply": t.get("how_to_apply", ""),
                    "impact": t.get("impact", "medium"),
                    "difficulty": t.get("difficulty", "medium"),
                })
            continue

        # Base-analysis fallback: use unique findings / novel approaches.
        findings = analysis.get("unique_findings") or []
        if isinstance(findings, list):
            finding = next((f for f in findings if isinstance(f, str) and f.strip()), "")
            if finding:
                all_takeaways.append({
                    "source": company,
                    "title": _title_from_finding(finding),
                    "insight": finding.strip(),
                    "how_to_apply": "",
                    "impact": "medium",
                    "difficulty": "medium",
                })
                continue

        novel = analysis.get("novel_approaches") or []
        if isinstance(novel, list):
            item = next((n for n in novel if isinstance(n, dict) and (n.get("approach") or n.get("why_novel"))), None)
            if item:
                approach = (item.get("approach") or "Novel approach").strip()
                why = (item.get("why_novel") or "").strip()
                insight = approach + (f" - {why}" if why else "")
                all_takeaways.append({
                    "source": company,
                    "title": _truncate(approach, 64),
                    "insight": insight,
                    "how_to_apply": "",
                    "impact": "medium",
                    "difficulty": "medium",
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
    """Extract trends to watch from actual analysis data."""
    watches = []

    # Count patterns with high novelty scores
    novel_patterns = {}
    category_trends = {}
    tech_stack_signals = {}
    business_model_signals = {}

    for analysis in analyses:
        # Extract from discovered patterns
        for pattern in analysis.get("discovered_patterns", []):
            novelty = pattern.get("novelty_score", 5)
            if novelty >= 7:
                name = pattern.get("pattern_name", "")
                if name:
                    novel_patterns[name] = novel_patterns.get(name, 0) + 1

            category = pattern.get("category", "")
            if category:
                category_trends[category] = category_trends.get(category, 0) + 1

        # Extract from tech stack
        tech = analysis.get("tech_stack", {})
        for model in tech.get("llm_models", []):
            tech_stack_signals[model] = tech_stack_signals.get(model, 0) + 1

        # Extract from model details
        model_details = analysis.get("model_details", {})
        if model_details.get("fine_tuning", {}).get("uses_fine_tuning"):
            tech_stack_signals["Fine-tuning"] = tech_stack_signals.get("Fine-tuning", 0) + 1
        if model_details.get("compound_ai", {}).get("is_compound_system"):
            tech_stack_signals["Compound AI"] = tech_stack_signals.get("Compound AI", 0) + 1
        if model_details.get("model_routing", {}).get("uses_routing"):
            tech_stack_signals["Model Routing"] = tech_stack_signals.get("Model Routing", 0) + 1

        # Extract from business model
        biz = analysis.get("business_model", {})
        gtm = biz.get("gtm_strategy", {}).get("primary_channel", "")
        if gtm and gtm != "unknown":
            business_model_signals[gtm] = business_model_signals.get(gtm, 0) + 1

    # Generate watches from novel patterns
    if novel_patterns:
        top_novel = sorted(novel_patterns.items(), key=lambda x: x[1], reverse=True)[:2]
        for name, count in top_novel:
            watches.append({
                "trend": f"{name} emerging",
                "implication": f"Appearing in {count} startups with high novelty scores"
            })

    # Generate watches from tech stack trends
    if tech_stack_signals:
        top_tech = sorted(tech_stack_signals.items(), key=lambda x: x[1], reverse=True)[:2]
        for tech, count in top_tech:
            if tech == "Fine-tuning":
                watches.append({
                    "trend": "Custom model training accelerating",
                    "implication": f"{count} startups building proprietary fine-tuned models"
                })
            elif tech == "Compound AI":
                watches.append({
                    "trend": "Multi-model orchestration maturing",
                    "implication": f"{count} startups deploying compound AI systems"
                })
            elif tech == "Model Routing":
                watches.append({
                    "trend": "Dynamic model selection",
                    "implication": f"{count} startups routing between models for cost/quality optimization"
                })
            else:
                watches.append({
                    "trend": f"{tech} adoption",
                    "implication": f"Leading model choice in {count} startups this period"
                })

    # Generate watches from GTM patterns
    if business_model_signals:
        top_gtm = sorted(business_model_signals.items(), key=lambda x: x[1], reverse=True)[0]
        gtm_name, count = top_gtm
        gtm_labels = {
            "product_led": "Product-led growth dominance",
            "sales_led": "Enterprise sales motion preference",
            "developer_first": "Developer-first distribution",
            "partnership_led": "Partnership ecosystem plays",
        }
        label = gtm_labels.get(gtm_name, f"{gtm_name} GTM strategy")
        watches.append({
            "trend": label,
            "implication": f"{count} startups following this go-to-market approach"
        })

    # Add category-based watches
    if category_trends:
        top_cat = sorted(category_trends.items(), key=lambda x: x[1], reverse=True)[0]
        cat_name, count = top_cat
        watches.append({
            "trend": f"{cat_name} focus area",
            "implication": f"Highest concentration of build patterns this period"
        })

    # Add any specific watches from why_now analysis
    for analysis in analyses:
        why_now = analysis.get("why_now", {})
        if why_now.get("primary_trigger", {}).get("trigger"):
            watches.append({
                "trend": why_now["primary_trigger"]["trigger"],
                "implication": why_now["primary_trigger"].get("evidence", "Emerging trend")
            })

    # Deduplicate and limit
    seen = set()
    unique_watches = []
    for w in watches:
        key = w["trend"].lower()
        if key not in seen:
            seen.add(key)
            unique_watches.append(w)

    return unique_watches[:6]
