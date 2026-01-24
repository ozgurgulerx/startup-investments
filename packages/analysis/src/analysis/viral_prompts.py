"""Prompts designed to generate viral, high-impact newsletter content with unique voice."""


# Contrarian Analysis - Finding what everyone's missing
CONTRARIAN_ANALYSIS_PROMPT = """You're a sharp, skeptical tech analyst who's seen hundreds of AI startups. Most are hype. Your job is to find the truth behind {company_name}.

CONTENT ABOUT {company_name}:
{content}

FUNDING: {funding_info}
TECH STACK (from job postings): {tech_stack}
HACKERNEWS SENTIMENT: {hn_sentiment}

Be brutally honest. Great analysis has teeth. Identify:

1. **The Bull Case Flaw**
   What's the biggest hole in their story? What are they NOT telling us?

2. **The Elephant in the Room**
   What obvious question should customers/investors ask that they're avoiding?

3. **The Timing Risk**
   - Too early? (Market not ready, infrastructure missing)
   - Too late? (Incumbents already winning, commoditized)
   - Just right? (Why specifically NOW?)

4. **The Incumbent Threat**
   How would OpenAI, Google, or Microsoft crush this in 6 months if they wanted to?
   Be specific - what feature announcement would kill them?

5. **The Hidden Assumption**
   What must be TRUE for this company to succeed that they're not explicitly stating?
   (e.g., "LLM costs must drop 10x", "Enterprises must trust AI with sensitive data")

6. **The Moat Reality Check**
   They claim: [what they claim]
   Reality: [your honest assessment]

Provide analysis in JSON:
{{
    "bull_case_flaw": "The biggest weakness in their pitch",
    "elephant_in_room": "The question they're avoiding",
    "timing_assessment": {{
        "verdict": "too_early|too_late|good_timing|uncertain",
        "reasoning": "Why"
    }},
    "incumbent_threat": {{
        "most_dangerous_competitor": "Who could crush them",
        "killer_feature": "What announcement would hurt them most",
        "time_to_threat": "How long until this threat materializes"
    }},
    "hidden_assumptions": ["List of things that must be true"],
    "moat_reality": {{
        "claimed_moat": "What they say",
        "actual_moat": "What you assess",
        "moat_durability": "weak|medium|strong"
    }},
    "honest_take": "Your unfiltered 2-sentence assessment"
}}

Return ONLY valid JSON."""


# Viral Hook Generator - Headlines that get clicked
VIRAL_HOOKS_PROMPT = """You write headlines for a newsletter read by 50,000 AI engineers and founders. They've seen every "Company X raises $Y" post. They scroll past boring stuff.

COMPANY: {company_name}
WHAT THEY DO: {description}
FUNDING: {funding_info}
UNIQUE ANGLE: {unique_angle}
BUILD PATTERNS: {patterns}
CONTRARIAN TAKE: {contrarian_take}

Generate 5 different headline styles. Each must be:
- Specific (no generic "AI startup does AI things")
- Intriguing (creates curiosity gap)
- Honest (no clickbait that doesn't deliver)

HEADLINE STYLES:

1. **The Contrarian Hook**
   Pattern: "Why [Company] is betting AGAINST [conventional wisdom]"
   Example: "Why Deepgram thinks OpenAI's voice strategy is wrong"

2. **The Insider Knowledge Hook**
   Pattern: "I [analyzed/reverse-engineered/discovered] [Company]'s [secret]"
   Example: "I analyzed 47 Anthropic job postings. Here's their real tech stack."

3. **The Pattern Match Hook**
   Pattern: "[Company] is using the same playbook as [successful company]"
   Example: "Stripe's API strategy, but for voice AI: Inside Deepgram's bet"

4. **The Builder Lesson Hook**
   Pattern: "The [specific decision] every AI team should steal from [Company]"
   Example: "The caching trick that makes Deepgram 10x cheaper than Whisper"

5. **The Spicy Question Hook**
   Pattern: "Is [Company] actually [provocative claim]? Let's find out."
   Example: "Is WitnessAI solving a problem that doesn't exist yet?"

Provide in JSON:
{{
    "headlines": [
        {{
            "style": "contrarian|insider|pattern_match|builder_lesson|spicy_question",
            "headline": "The actual headline",
            "subheadline": "One sentence that expands on it",
            "hook_strength": 1-10
        }}
    ],
    "best_headline": "Which one you'd actually use and why",
    "social_media_version": "Twitter-length version of best headline"
}}

Return ONLY valid JSON."""


# Unique Voice Generator - Making content sound like a smart friend
UNIQUE_VOICE_PROMPT = """You're writing for builders who are tired of:
- Corporate PR speak
- Breathless hype ("REVOLUTIONARY!", "GAME-CHANGING!")
- Obvious observations dressed as insights
- Humble brags disguised as analysis

Your voice is:
- Smart friend who happens to know a lot about AI
- Slightly irreverent but substantive
- Opinionated but fair
- Technical but accessible
- Honest about uncertainty

COMPANY: {company_name}
RAW ANALYSIS: {analysis}
CONTRARIAN TAKE: {contrarian_take}
TECHNICAL DETAILS: {tech_details}

Rewrite this analysis in your unique voice. Include:

1. **The Opening Hook** (2-3 sentences)
   - Don't start with "[Company] is a company that..."
   - Start with the most interesting thing
   - Make the reader want to keep reading

2. **The Core Insight** (1 paragraph)
   - What's actually interesting here?
   - Use analogies builders understand
   - Be specific, not generic

3. **The Technical Meat** (2-3 paragraphs)
   - Architecture decisions and why they matter
   - What they got right
   - What's questionable

4. **The Honest Assessment** (1 paragraph)
   - Would YOU use this? Why or why not?
   - Who should care about this? Who shouldn't?

5. **The Builder Takeaway** (bullet points)
   - What can readers apply to their own work?
   - Be specific and actionable

6. **The Prediction** (1-2 sentences)
   - Where is this company in 2 years?
   - What would change your mind?

Write in a conversational but intelligent tone. Imagine you're explaining this to a senior engineer friend over coffee.

Return the full rewritten analysis as markdown (not JSON)."""


# Why Now Analysis - Timeliness hooks
WHY_NOW_PROMPT = """Every great startup story needs a "Why Now?" that's compelling and specific.

COMPANY: {company_name}
WHAT THEY DO: {description}
MARKET CONTEXT:
- Recent funding: {funding_info}
- Industry: {industry}
- Competitors: {competitors}

RECENT EVENTS (last 6 months):
{recent_events}

Identify the "Why Now?" from multiple angles:

1. **Technology Trigger**
   What recent technical breakthrough enables this?
   (e.g., "GPT-4's function calling made agentic architectures viable")

2. **Market Trigger**
   What market shift creates urgency?
   (e.g., "Enterprise AI budgets grew 300% in 2024")

3. **Regulatory Trigger**
   What regulation or compliance pressure helps/hurts?
   (e.g., "EU AI Act forces companies to audit AI systems")

4. **Competitive Trigger**
   What did competitors do (or fail to do)?
   (e.g., "OpenAI's voice API has 2s latency - enterprises need better")

5. **Behavioral Trigger**
   What changed in how people/companies work?
   (e.g., "Remote work normalized async voice messages")

Provide in JSON:
{{
    "primary_trigger": {{
        "type": "technology|market|regulatory|competitive|behavioral",
        "trigger": "Specific event or trend",
        "evidence": "How we know this is real",
        "timing": "When this became relevant"
    }},
    "secondary_triggers": [
        {{
            "type": "...",
            "trigger": "...",
            "relevance": "Why this matters for the company"
        }}
    ],
    "why_not_earlier": "Why couldn't this company exist 2 years ago?",
    "why_not_later": "Why is waiting dangerous for them?",
    "newsletter_hook": "One sentence 'Why Now' for the newsletter"
}}

Return ONLY valid JSON."""


# Builder Takeaways - Actionable insights
BUILDER_TAKEAWAYS_PROMPT = """You're writing for engineers and technical founders who want to apply insights, not just read about them.

COMPANY: {company_name}
TECHNICAL ANALYSIS:
{technical_analysis}

ARCHITECTURE DECISIONS:
{architecture}

WHAT WORKED:
{what_worked}

Extract actionable takeaways that readers can apply MONDAY MORNING.

For each takeaway:
- Be specific (not "use good practices")
- Explain WHY it works
- Note when it DOESN'T apply
- Include code/config example if relevant

Categories:

1. **Architecture Decision**
   What structural choice could readers adopt?

2. **Cost Optimization**
   What trick reduces LLM/infra costs?

3. **Performance Hack**
   What improves latency or throughput?

4. **Developer Experience**
   What makes their API/product easy to use?

5. **Data Strategy**
   How do they handle data for competitive advantage?

Provide in JSON:
{{
    "takeaways": [
        {{
            "category": "architecture|cost|performance|devex|data",
            "title": "Short, memorable title",
            "insight": "The core insight in 2-3 sentences",
            "how_to_apply": "Specific steps to implement",
            "when_not_to_use": "Situations where this doesn't apply",
            "example": "Code snippet or config example if applicable",
            "difficulty": "easy|medium|hard",
            "impact": "low|medium|high"
        }}
    ],
    "quick_wins": ["Easy things to try this week"],
    "deeper_dives": ["Topics worth researching further"]
}}

Return ONLY valid JSON."""


# Story Arc Generator - Narrative structure
STORY_ARC_PROMPT = """Great newsletter pieces follow a narrative arc. You're structuring the story of {company_name}.

COMPANY INFO:
{company_info}

TECHNICAL ANALYSIS:
{technical_analysis}

CONTRARIAN VIEW:
{contrarian_view}

BUILDER TAKEAWAYS:
{takeaways}

Create a narrative structure that keeps readers engaged:

**Act 1: The Hook** (Why should I care?)
- Opening line that grabs attention
- The stakes/opportunity
- Why this matters NOW

**Act 2: The Discovery** (What did we find?)
- The surface story (what they say)
- The deeper story (what we found)
- The surprising element

**Act 3: The Analysis** (What does it mean?)
- Technical breakdown
- Competitive implications
- Bull case vs bear case

**Act 4: The Resolution** (So what?)
- Builder takeaways
- Prediction
- Call to action / what to watch

Provide in JSON:
{{
    "narrative_arc": {{
        "hook": {{
            "opening_line": "First sentence of the piece",
            "stakes": "What's at stake",
            "why_now": "Timeliness hook"
        }},
        "discovery": {{
            "surface_story": "What they want you to know",
            "deeper_story": "What we actually found",
            "surprise": "The unexpected element"
        }},
        "analysis": {{
            "technical_insight": "Core technical finding",
            "competitive_insight": "Market positioning finding",
            "tension": "Bull vs bear case"
        }},
        "resolution": {{
            "takeaway": "Main thing reader should remember",
            "prediction": "Where this goes",
            "call_to_action": "What reader should do next"
        }}
    }},
    "estimated_read_time": "X minutes",
    "target_word_count": number,
    "suggested_visuals": ["Diagrams or images that would help"]
}}

Return ONLY valid JSON."""


def get_contrarian_analysis_prompt(
    company_name: str,
    content: str,
    funding_info: str = "",
    tech_stack: str = "",
    hn_sentiment: str = ""
) -> str:
    """Get the contrarian analysis prompt."""
    return CONTRARIAN_ANALYSIS_PROMPT.format(
        company_name=company_name,
        content=content[:25000],
        funding_info=funding_info or "Not disclosed",
        tech_stack=tech_stack or "Not detected",
        hn_sentiment=hn_sentiment or "No data"
    )


def get_viral_hooks_prompt(
    company_name: str,
    description: str,
    funding_info: str = "",
    unique_angle: str = "",
    patterns: str = "",
    contrarian_take: str = ""
) -> str:
    """Get the viral hooks prompt."""
    return VIRAL_HOOKS_PROMPT.format(
        company_name=company_name,
        description=description or "AI startup",
        funding_info=funding_info or "Undisclosed",
        unique_angle=unique_angle or "Not identified",
        patterns=patterns or "Not detected",
        contrarian_take=contrarian_take or "None"
    )


def get_unique_voice_prompt(
    company_name: str,
    analysis: str,
    contrarian_take: str = "",
    tech_details: str = ""
) -> str:
    """Get the unique voice rewrite prompt."""
    return UNIQUE_VOICE_PROMPT.format(
        company_name=company_name,
        analysis=analysis[:20000],
        contrarian_take=contrarian_take or "None provided",
        tech_details=tech_details or "Not available"
    )


def get_why_now_prompt(
    company_name: str,
    description: str,
    funding_info: str = "",
    industry: str = "",
    competitors: str = "",
    recent_events: str = ""
) -> str:
    """Get the why now analysis prompt."""
    return WHY_NOW_PROMPT.format(
        company_name=company_name,
        description=description or "AI startup",
        funding_info=funding_info or "Not disclosed",
        industry=industry or "AI/ML",
        competitors=competitors or "Not identified",
        recent_events=recent_events or "No recent events tracked"
    )


def get_builder_takeaways_prompt(
    company_name: str,
    technical_analysis: str,
    architecture: str = "",
    what_worked: str = ""
) -> str:
    """Get the builder takeaways prompt."""
    return BUILDER_TAKEAWAYS_PROMPT.format(
        company_name=company_name,
        technical_analysis=technical_analysis[:20000],
        architecture=architecture or "Not detailed",
        what_worked=what_worked or "Not identified"
    )


def get_story_arc_prompt(
    company_name: str,
    company_info: str,
    technical_analysis: str,
    contrarian_view: str = "",
    takeaways: str = ""
) -> str:
    """Get the story arc prompt."""
    return STORY_ARC_PROMPT.format(
        company_name=company_name,
        company_info=company_info[:10000],
        technical_analysis=technical_analysis[:15000],
        contrarian_view=contrarian_view or "None",
        takeaways=takeaways or "None"
    )
