"""LLM-assisted context merging for startup updates.

Uses LLM to intelligently merge old and new analysis data,
preserving valuable historical context while incorporating updates.
"""

import json
from typing import Dict, Any, Optional, List
from datetime import datetime, timezone

from openai import AzureOpenAI

from src.config import settings
from src.data.models import StartupInput


class LLMContextMerger:
    """Uses LLM to intelligently merge and update startup context."""

    def __init__(self):
        """Initialize with Azure OpenAI client."""
        self.client = AzureOpenAI(
            api_key=settings.azure_openai.api_key,
            api_version=settings.azure_openai.api_version,
            azure_endpoint=settings.azure_openai.endpoint,
        )
        self.model = settings.azure_openai.reasoning_model

    async def merge_analyses(
        self,
        existing_analysis: Dict[str, Any],
        new_analysis: Dict[str, Any],
        changes: List[Dict[str, Any]],
        startup_input: StartupInput,
    ) -> Dict[str, Any]:
        """Merge existing and new analysis intelligently.

        Args:
            existing_analysis: Previous analysis data
            new_analysis: Fresh analysis from re-crawl/re-analyze
            changes: List of detected changes from classifier
            startup_input: Current startup input data

        Returns:
            Merged analysis dict
        """
        # Prepare change summary for LLM
        change_summary = self._format_changes(changes)

        prompt = f"""You are merging startup analysis data after detecting changes.

STARTUP: {startup_input.name}
WEBSITE: {startup_input.website}

CHANGES DETECTED:
{change_summary}

EXISTING ANALYSIS (from previous period):
```json
{json.dumps(self._simplify_for_prompt(existing_analysis), indent=2)}
```

NEW ANALYSIS (from current analysis):
```json
{json.dumps(self._simplify_for_prompt(new_analysis), indent=2)}
```

MERGE INSTRUCTIONS:
1. For factual fields (uses_genai, genai_intensity, tech_stack), prefer NEW values
2. For accumulating fields (unique_findings, story_angles), COMBINE both, remove duplicates
3. For confidence_score, use the higher value unless new data contradicts old
4. Preserve historical insights that remain valid
5. Add an "update_history" entry noting what changed and when

CRITICAL: Return ONLY valid JSON with the merged analysis. Include all fields from the original analysis structure.

The merged analysis should:
- Keep the same structure as the input analyses
- Combine unique_findings from both (deduplicate)
- Combine story_angles from both (keep best ones)
- Update build_patterns with latest confidence scores
- Preserve competitive_analysis but update if new info available
- Add "last_updated" timestamp and "update_reason" field
"""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3,
            response_format={"type": "json_object"}
        )

        try:
            merged = json.loads(response.choices[0].message.content)
            # Ensure metadata
            merged["last_updated"] = datetime.now(timezone.utc).isoformat()
            merged["merge_source"] = "llm_merger"
            return merged
        except json.JSONDecodeError:
            # Fallback: use new analysis with old unique findings appended
            return self._fallback_merge(existing_analysis, new_analysis)

    async def update_brief(
        self,
        existing_brief: str,
        new_analysis: Dict[str, Any],
        changes: List[Dict[str, Any]],
        startup_input: StartupInput,
        update_type: str = "major"
    ) -> str:
        """Update startup brief with new information.

        Args:
            existing_brief: Current brief markdown
            new_analysis: Updated analysis data
            changes: List of changes detected
            startup_input: Current startup input
            update_type: 'major' for full rewrite, 'minor' for targeted patches

        Returns:
            Updated brief markdown
        """
        change_summary = self._format_changes(changes)

        if update_type == "major":
            return await self._major_brief_update(
                existing_brief, new_analysis, change_summary, startup_input
            )
        else:
            return await self._minor_brief_update(
                existing_brief, new_analysis, change_summary, startup_input
            )

    async def _major_brief_update(
        self,
        existing_brief: str,
        new_analysis: Dict[str, Any],
        change_summary: str,
        startup_input: StartupInput
    ) -> str:
        """Full brief rewrite for major changes."""

        prompt = f"""You are updating a startup brief after MAJOR changes (e.g., new funding round, pivot).

STARTUP: {startup_input.name}
CURRENT FUNDING: ${startup_input.funding_amount:,.0f if startup_input.funding_amount else 'Unknown'}
STAGE: {startup_input.funding_stage.value if startup_input.funding_stage else 'Unknown'}

WHAT CHANGED:
{change_summary}

EXISTING BRIEF:
```markdown
{existing_brief[:3000]}  # Truncate if too long
```

NEW ANALYSIS DATA:
```json
{json.dumps(self._simplify_for_prompt(new_analysis), indent=2)}
```

INSTRUCTIONS:
1. Rewrite the brief to reflect the new information
2. ADD a "## Recent Developments" section at the top highlighting what changed
3. Update all metrics, patterns, and analysis sections
4. PRESERVE valuable historical context that's still relevant
5. Keep the same markdown structure and formatting style
6. If funding changed, emphasize the funding trajectory
7. Make it newsletter-ready with compelling hooks

Return the complete updated brief in markdown format.
"""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.4
        )

        return response.choices[0].message.content

    async def _minor_brief_update(
        self,
        existing_brief: str,
        new_analysis: Dict[str, Any],
        change_summary: str,
        startup_input: StartupInput
    ) -> str:
        """Targeted patches for minor changes."""

        prompt = f"""Make TARGETED updates to this startup brief for minor changes.

STARTUP: {startup_input.name}

WHAT CHANGED (minor):
{change_summary}

EXISTING BRIEF:
```markdown
{existing_brief}
```

RELEVANT NEW DATA:
- Industries: {new_analysis.get('industries', [])}
- Lead Investors: {startup_input.lead_investors}
- Sub-vertical: {new_analysis.get('sub_vertical', 'unchanged')}
- Sub-sub-vertical: {new_analysis.get('sub_sub_vertical', 'unchanged')}

INSTRUCTIONS:
1. Make MINIMAL changes - only update affected sections
2. Add a brief "Update Note" at the bottom: "Updated [date]: [what changed]"
3. DO NOT rewrite sections that aren't affected
4. Keep all other content EXACTLY as is

Return the updated brief.
"""

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2
        )

        return response.choices[0].message.content

    async def should_regenerate_brief(
        self,
        changes: List[Dict[str, Any]],
        existing_analysis: Dict[str, Any],
        new_analysis: Dict[str, Any]
    ) -> tuple[bool, str]:
        """Decide if brief needs full regeneration vs patch.

        Returns:
            (should_regenerate: bool, reason: str)
        """
        # Check for major changes
        major_fields = {"funding_amount", "funding_stage", "description"}
        changed_fields = {c.get("field") or c.field for c in changes if hasattr(c, "field") or "field" in c}

        if changed_fields & major_fields:
            return True, "Major change detected (funding or description)"

        # Check confidence score drop
        old_conf = existing_analysis.get("confidence_score", 0)
        new_conf = new_analysis.get("confidence_score", 0)
        if new_conf < old_conf - 0.2:
            return True, "Significant confidence drop"

        # Check pattern changes
        old_patterns = set(p.get("name", p) if isinstance(p, dict) else str(p)
                          for p in existing_analysis.get("build_patterns", []))
        new_patterns = set(p.get("name", p) if isinstance(p, dict) else str(p)
                          for p in new_analysis.get("build_patterns", []))
        if len(new_patterns - old_patterns) >= 2:
            return True, "Multiple new build patterns detected"

        return False, "Minor changes only"

    def _format_changes(self, changes: List[Any]) -> str:
        """Format changes for prompt."""
        if not changes:
            return "No specific changes detected."

        lines = []
        for c in changes:
            if hasattr(c, "field"):
                # ChangeDetail dataclass
                lines.append(f"- {c.field}: {c.old_value} -> {c.new_value} ({c.significance})")
            elif isinstance(c, dict):
                # Dict format
                lines.append(f"- {c.get('field', 'unknown')}: {c.get('old_value')} -> {c.get('new_value')}")
            else:
                lines.append(f"- {str(c)}")

        return "\n".join(lines)

    def _simplify_for_prompt(self, analysis: Dict[str, Any]) -> Dict[str, Any]:
        """Simplify analysis dict for prompt (remove very long fields)."""
        simplified = {}
        for key, value in analysis.items():
            if key in ("evidence_quotes", "sources_crawled", "raw_content"):
                # Skip very long fields
                continue
            if isinstance(value, str) and len(value) > 500:
                simplified[key] = value[:500] + "..."
            elif isinstance(value, list) and len(value) > 10:
                simplified[key] = value[:10] + ["..."]
            else:
                simplified[key] = value
        return simplified

    def _fallback_merge(
        self,
        existing: Dict[str, Any],
        new: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Fallback merge when LLM fails."""
        merged = new.copy()

        # Combine unique findings
        existing_findings = set(existing.get("unique_findings", []))
        new_findings = set(new.get("unique_findings", []))
        merged["unique_findings"] = list(existing_findings | new_findings)

        # Combine story angles (keep both)
        merged["story_angles"] = (
            existing.get("story_angles", []) +
            new.get("story_angles", [])
        )[:10]  # Limit to 10

        # Note the merge
        merged["last_updated"] = datetime.now(timezone.utc).isoformat()
        merged["merge_source"] = "fallback_merge"

        return merged
