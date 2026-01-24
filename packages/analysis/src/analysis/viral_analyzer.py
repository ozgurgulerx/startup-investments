"""Viral content analyzer - generates high-impact newsletter content."""

import json
from typing import Dict, Any, List, Optional
from openai import AzureOpenAI
from tenacity import retry, stop_after_attempt, wait_exponential

from src.config import settings
from src.data.models import StartupInput, StartupAnalysis
from src.crawler.enrichment import (
    JobPostingClient,
    HackerNewsClient,
    TwitterClient,
    PackageRegistryClient,
    ConferenceTalkClient,
)
from src.analysis.viral_prompts import (
    get_contrarian_analysis_prompt,
    get_viral_hooks_prompt,
    get_unique_voice_prompt,
    get_why_now_prompt,
    get_builder_takeaways_prompt,
    get_story_arc_prompt,
)


class ViralContentAnalyzer:
    """Generates viral, high-impact newsletter content for startups."""

    def __init__(self):
        self.client = AzureOpenAI(
            api_key=settings.azure_openai.api_key,
            api_version=settings.azure_openai.api_version,
            azure_endpoint=settings.azure_openai.endpoint,
        )
        self.model = settings.azure_openai.reasoning_model

        # Enrichment clients
        self.job_client = JobPostingClient()
        self.hn_client = HackerNewsClient()
        self.twitter_client = TwitterClient()
        self.package_client = PackageRegistryClient()
        self.talks_client = ConferenceTalkClient()

    async def analyze_for_viral_content(
        self,
        startup: StartupInput,
        base_analysis: StartupAnalysis,
        content: str
    ) -> Dict[str, Any]:
        """Generate viral content analysis for a startup."""

        # Phase 1: Gather enrichment data
        print(f"  Gathering enrichment data for {startup.name}...")
        enrichment_data = await self._gather_enrichment_data(startup)

        # Phase 2: Generate contrarian analysis
        print(f"  Generating contrarian analysis...")
        contrarian = await self._analyze_contrarian(
            startup, content, base_analysis, enrichment_data
        )

        # Phase 3: Generate why now analysis
        print(f"  Analyzing 'Why Now'...")
        why_now = await self._analyze_why_now(startup, content, base_analysis)

        # Phase 4: Generate builder takeaways
        print(f"  Extracting builder takeaways...")
        takeaways = await self._generate_takeaways(startup, content, base_analysis)

        # Phase 5: Generate viral hooks
        print(f"  Generating viral hooks...")
        hooks = await self._generate_viral_hooks(
            startup, base_analysis, contrarian
        )

        # Phase 6: Generate story arc (skip if previous steps have issues)
        story_arc = {}
        try:
            print(f"  Creating story arc...")
            story_arc = await self._generate_story_arc(
                startup, base_analysis, contrarian, takeaways
            )
        except Exception as e:
            print(f"  [Skipping story arc: {e}]")

        # Phase 7: Generate unique voice content
        unique_voice_content = ""
        try:
            print(f"  Writing in unique voice...")
            unique_voice_content = await self._generate_unique_voice(
                startup, base_analysis, contrarian, enrichment_data
            )
        except Exception as e:
            print(f"  [Skipping unique voice: {e}]")

        # Extract vertical context from base analysis
        vertical_context = None
        if base_analysis.vertical:
            vertical_context = {
                "vertical": base_analysis.vertical.value if hasattr(base_analysis.vertical, 'value') else str(base_analysis.vertical),
                "vertical_specific_insight": base_analysis.vertical_insight if hasattr(base_analysis, 'vertical_insight') else None,
                "regulatory_considerations": base_analysis.regulatory_considerations if hasattr(base_analysis, 'regulatory_considerations') else [],
            }

        return {
            "company_name": startup.name,
            "enrichment_data": enrichment_data,
            "contrarian_analysis": contrarian,
            "why_now": why_now,
            "builder_takeaways": takeaways,
            "viral_hooks": hooks,
            "story_arc": story_arc,
            "unique_voice_content": unique_voice_content,
            "vertical_context": vertical_context,
        }

    async def _gather_enrichment_data(self, startup: StartupInput) -> Dict[str, Any]:
        """Gather all enrichment data for a startup."""
        results = {}

        try:
            # Job postings (real tech stack)
            results["jobs"] = await self.job_client.search_jobs(startup.name)
        except Exception as e:
            results["jobs"] = {"error": str(e)}

        try:
            # HackerNews sentiment
            results["hackernews"] = await self.hn_client.search_mentions(startup.name)
        except Exception as e:
            results["hackernews"] = {"error": str(e)}

        try:
            # Twitter presence
            results["twitter"] = await self.twitter_client.search_tweets(startup.name)
        except Exception as e:
            results["twitter"] = {"error": str(e)}

        try:
            # Package registry (actual developer adoption)
            results["packages"] = await self.package_client.search_packages(startup.name)
        except Exception as e:
            results["packages"] = {"error": str(e)}

        try:
            # Conference talks
            results["talks"] = await self.talks_client.search_talks(startup.name)
        except Exception as e:
            results["talks"] = {"error": str(e)}

        return results

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _analyze_contrarian(
        self,
        startup: StartupInput,
        content: str,
        base_analysis: StartupAnalysis,
        enrichment: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate contrarian analysis."""
        funding_info = f"${startup.funding_amount:,.0f}" if startup.funding_amount else ""

        # Extract tech stack from jobs
        tech_stack = ""
        if enrichment.get("jobs", {}).get("tech_stack_from_jobs"):
            tech_stack = json.dumps(enrichment["jobs"]["tech_stack_from_jobs"])

        # Extract HN sentiment
        hn_sentiment = ""
        if enrichment.get("hackernews", {}).get("sentiment"):
            hn = enrichment["hackernews"]
            hn_sentiment = f"Sentiment: {hn.get('sentiment')}, Mentions: {hn.get('mentions', 0)}"
            if hn.get("top_comments"):
                hn_sentiment += f"\nTop comment: {hn['top_comments'][0].get('text', '')[:200]}"

        prompt = get_contrarian_analysis_prompt(
            startup.name, content, funding_info, tech_stack, hn_sentiment
        )
        return await self._call_llm(prompt)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _analyze_why_now(
        self,
        startup: StartupInput,
        content: str,
        base_analysis: StartupAnalysis
    ) -> Dict[str, Any]:
        """Generate why now analysis."""
        funding_info = f"${startup.funding_amount:,.0f}" if startup.funding_amount else ""
        competitors = ", ".join([c.name for c in base_analysis.competitive_analysis.competitors[:3]])
        industry = ", ".join(startup.industries[:2]) if startup.industries else "AI"

        prompt = get_why_now_prompt(
            startup.name,
            startup.description or "",
            funding_info,
            industry,
            competitors
        )
        return await self._call_llm(prompt)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _generate_takeaways(
        self,
        startup: StartupInput,
        content: str,
        base_analysis: StartupAnalysis
    ) -> Dict[str, Any]:
        """Generate builder takeaways."""
        # Compile technical analysis
        tech_analysis = f"""
        Build Patterns: {', '.join([p.name for p in base_analysis.build_patterns])}
        Tech Stack: LLMs: {base_analysis.tech_stack.llm_models}, Frameworks: {base_analysis.tech_stack.frameworks}
        Approach: {base_analysis.tech_stack.approach}
        Engineering Quality: {base_analysis.engineering_quality.score}/10
        """

        architecture = f"""
        Secret Sauce: {base_analysis.competitive_analysis.secret_sauce.core_advantage}
        Differentiation: {base_analysis.competitive_analysis.differentiation.technical}
        """

        what_worked = "\n".join(base_analysis.unique_findings[:3])

        prompt = get_builder_takeaways_prompt(
            startup.name, tech_analysis, architecture, what_worked
        )
        return await self._call_llm(prompt)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _generate_viral_hooks(
        self,
        startup: StartupInput,
        base_analysis: StartupAnalysis,
        contrarian: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate viral hooks/headlines."""
        funding_info = f"${startup.funding_amount:,.0f}" if startup.funding_amount else ""
        patterns = ", ".join([p.name for p in base_analysis.build_patterns[:3]])
        unique_angle = base_analysis.unique_findings[0] if base_analysis.unique_findings else ""
        contrarian_take = contrarian.get("honest_take", "")

        prompt = get_viral_hooks_prompt(
            startup.name,
            startup.description or "",
            funding_info,
            unique_angle,
            patterns,
            contrarian_take
        )
        return await self._call_llm(prompt)

    @retry(stop=stop_after_attempt(2), wait=wait_exponential(multiplier=1, min=1, max=5))
    async def _generate_story_arc(
        self,
        startup: StartupInput,
        base_analysis: StartupAnalysis,
        contrarian: Dict[str, Any],
        takeaways: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Generate narrative story arc."""
        funding_str = f"${startup.funding_amount:,.0f}" if startup.funding_amount else "N/A"
        industries_str = ', '.join(startup.industries[:3]) if startup.industries else "AI"

        company_info = f"""
        Name: {startup.name}
        Description: {startup.description or 'AI startup'}
        Funding: {funding_str}
        Industries: {industries_str}
        """

        patterns = [p.name for p in base_analysis.build_patterns] if base_analysis.build_patterns else []
        findings = base_analysis.unique_findings[:3] if base_analysis.unique_findings else []
        moat = base_analysis.competitive_analysis.competitive_moat if base_analysis.competitive_analysis else "unknown"

        tech_analysis = f"""
        Patterns: {', '.join(patterns) or 'None detected'}
        Findings: {'; '.join(findings) or 'None'}
        Moat: {moat}
        """

        contrarian_view = contrarian.get("honest_take", "") if contrarian else ""
        takeaway_str = json.dumps(takeaways.get("quick_wins", []) if takeaways else [])

        prompt = get_story_arc_prompt(
            startup.name, company_info, tech_analysis, contrarian_view, takeaway_str
        )
        return await self._call_llm(prompt)

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _generate_unique_voice(
        self,
        startup: StartupInput,
        base_analysis: StartupAnalysis,
        contrarian: Dict[str, Any],
        enrichment: Dict[str, Any]
    ) -> str:
        """Generate content in unique voice style."""
        # Safe funding format
        funding_str = f"${startup.funding_amount:,.0f}" if startup.funding_amount else "N/A"

        # Safe extraction of base_analysis fields
        genai_intensity = base_analysis.genai_intensity.value if base_analysis.genai_intensity else "unknown"
        build_patterns = ', '.join([p.name for p in base_analysis.build_patterns]) if base_analysis.build_patterns else "None detected"
        unique_findings = base_analysis.unique_findings[:5] if base_analysis.unique_findings else []
        findings_str = chr(10).join(['- ' + f for f in unique_findings]) if unique_findings else "- None documented"

        # Safe competitive analysis extraction
        comp = base_analysis.competitive_analysis
        moat = comp.competitive_moat if comp else "unknown"
        secret_sauce = comp.secret_sauce.core_advantage if comp and comp.secret_sauce else "Not identified"
        differentiation = comp.differentiation.primary if comp and comp.differentiation else "Not identified"

        # Compile analysis summary
        analysis = f"""
        Company: {startup.name}
        What they do: {startup.description or 'AI startup'}
        Funding: {funding_str}

        GenAI Usage: {genai_intensity}
        Build Patterns: {build_patterns}

        Unique Findings:
        {findings_str}

        Competitive Position:
        - Moat: {moat}
        - Secret Sauce: {secret_sauce}
        - Differentiation: {differentiation}
        """

        contrarian_take = json.dumps({
            "flaw": contrarian.get("bull_case_flaw", ""),
            "honest_take": contrarian.get("honest_take", ""),
            "moat_reality": contrarian.get("moat_reality", {})
        })

        # Safe tech details extraction
        tech_stack_data = base_analysis.tech_stack.model_dump() if base_analysis.tech_stack else {}
        eng_score = base_analysis.engineering_quality.score if base_analysis.engineering_quality else "N/A"

        tech_details = f"""
        Tech Stack: {json.dumps(tech_stack_data)}
        Engineering Quality: {eng_score}/10
        HackerNews: {enrichment.get('hackernews', {}).get('sentiment', 'unknown')} sentiment
        Jobs Found: {enrichment.get('jobs', {}).get('jobs_found', 0)}
        """

        prompt = get_unique_voice_prompt(
            startup.name, analysis, contrarian_take, tech_details
        )

        # For unique voice, we return markdown not JSON
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[
                {"role": "system", "content": "You're a sharp, witty tech analyst writing for AI builders. Write in markdown."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.7,  # Higher temperature for more creative voice
            max_tokens=3000,
        )

        return response.choices[0].message.content or ""

    async def _call_llm(self, prompt: str) -> Dict[str, Any]:
        """Call Azure OpenAI and parse JSON response."""
        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "You are a sharp tech analyst. Always respond with valid JSON only."},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.4,
                max_tokens=2500,
            )

            content = response.choices[0].message.content
            if content:
                return self._parse_json_response(content)
            return {}

        except Exception as e:
            print(f"LLM call failed: {e}")
            return {}

    def _parse_json_response(self, content: str) -> Dict[str, Any]:
        """Parse JSON from LLM response."""
        content = content.strip()

        if content.startswith("```"):
            lines = content.split("\n")
            content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])

        try:
            return json.loads(content)
        except json.JSONDecodeError:
            import re
            json_match = re.search(r'\{[\s\S]*\}', content)
            if json_match:
                try:
                    return json.loads(json_match.group())
                except json.JSONDecodeError:
                    pass
            return {}

    async def close(self):
        """Close all clients."""
        await self.job_client.close()
        await self.hn_client.close()
        await self.twitter_client.close()
        await self.package_client.close()
        await self.talks_client.close()
