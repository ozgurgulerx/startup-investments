# I Analyzed 336 AI Funding Rounds From February. The $60.6B Headline Is Misleading.

> **LinkedIn Newsletter — February 2026 AI Investment Analysis**
> **Author:** Ozgur Guler | **Source:** [BuildAtlas](https://buildatlas.net)
> **Visuals:** `apps/web/data/2026-02/output/linkedin/` (8 chart PNGs)

---

$60.6 billion in AI funding. Sounds massive.

Here's the part nobody mentions: five checks account for $49.2 billion of it.

Remove Anthropic ($30B), Waymo ($16B), Wayve ($1.2B), World Labs ($1B), and Cerebras ($1B) — and the remaining 331 companies shared $11.4 billion. Still significant. But a completely different market than the headline suggests.

I tracked every one of those 336 rounds and deep-analyzed 107 companies at [BuildAtlas](https://buildatlas.net). Here's what February actually looked like.

---

## Two Markets in One Number

The median AI round in February was **$9 million**. The average was **$180 million**.

That's a 20x gap.

**📊 [INSERT: cover.png]**

This isn't statistical noise. It reveals two parallel AI economies:

**Market A** — Five companies. $49.2B. Infrastructure-scale bets on foundation models and autonomous vehicles. These deals happen in boardrooms with sovereign wealth funds.

**Market B** — 331 companies. $11.4B. Seed rounds, Series As, vertical SaaS plays. These deals happen over demos and pilot contracts.

Market A gets the headlines. Market B is where the patterns live.

---

## Where Market B's Money Actually Goes

Strip the mega-rounds and capital distribution shifts:

**📊 [INSERT: capital-treemap.png]**

| Category             | Deals | Capital | Avg Round |
| -------------------- | ----- | ------- | --------- |
| Enterprise SaaS + AI | 145   | $4.0B   | $27M      |
| AI Infrastructure    | 30    | $3.6B   | $121M     |
| Fintech AI           | 31    | $694M   | $22M      |
| Security AI          | 30    | $595M   | $20M      |
| Healthcare AI        | 24    | $447M   | $19M      |
| Agentic AI           | 25    | $356M   | $14M      |

That last row is the buried lede.

"Agentic AI" as a category raised just $356M across 25 deals. But when we analyzed architectures, **60.7% of all 107 companies** exhibit agentic patterns — multi-step reasoning, tool use, autonomous decision loops.

Agents aren't a category. They're a pattern eating every category.

---

## The Build Pattern Map

We analyzed the technical architecture of 107 funded companies. Not what they claim. What they actually built.

**📊 [INSERT: trend-radar.png]**

| Pattern                       | Prevalence | Translation                                   |
| ----------------------------- | ---------- | --------------------------------------------- |
| Vertical Data Moats           | 77.6%      | Proprietary domain data > model weights       |
| Micro-model Meshes            | 69.2%      | Multiple specialized models > one giant model |
| Continuous-learning Flywheels | 62.6%      | Production data feeding back into training    |
| Agentic Architectures         | 60.7%      | Multi-step, tool-using autonomous systems     |
| RAG                           | 50.5%      | Still the default retrieval pattern           |
| Guardrail-as-LLM              | 48.6%      | Safety layers using their own LLMs            |

**The number that matters:** 77.6% are building vertical data moats — but only 37% are classified as "vertical" companies. Even horizontal platforms are racing to lock up domain-specific data.

The model layer is commoditizing in real time. The moat has moved downstream.

---

## Seed vs. Series A: Two Different Games

**📊 [INSERT: funding-funnel.png]**

Seed rounds made up **48.8%** of all deals but only **5.2%** of capital. The barbell isn't a metaphor. It's structural.

But the real story is _what_ they build differently:

### Seed startups build extraction, not generation.

Dono maps county property records through 700+ jurisdiction-specific connectors. Gushwork clusters manufacturing keywords before generating a single page. Plato ingests ERP transaction histories to underwrite wholesale orders.

The hard problem at seed isn't "make the LLM smarter." It's "get the data into a shape the LLM can use."

### Series A startups build orchestration and safety.

Spirit AI combines a learned robot policy with whole-body control executing at 120Hz. Backslash Security uses MCP (Model Context Protocol) as security middleware — governing what agents output before it hits production. Daytona creates sandboxed execution environments in under 90ms for AI agents.

The shift: **Seed = "How do we capture this domain's data?"** → **Series A = "How do we let agents use it safely at scale?"**

**📊 [INSERT: sankey-diagram.png]**

Follow the money from funding stage to sector. $30.4B flows from Series C+ into Generative AI alone. But at Seed, the largest flow ($1.6B) goes to Enterprise SaaS — where founders are building vertical data extraction before they build generation.

---

## Physical AI Ate February

$19.6 billion went to Robotics & Physical AI. That's 32% of all capital.

More than Enterprise SaaS, Infrastructure, Fintech, Security, Healthcare, and Agentic AI **combined** ($9.7B).

Even after removing Waymo's $16B, robotics companies raised $3.6B:

**Apptronik** ($520M, Series A) — Humanoid robots with force-control safety architecture. Their Apollo robots now help manufacture more robots through their Jabil partnership. Read that again: robots building robots.

**Spirit AI** ($290M, Series A) — Building the "universal AI brain for real-world robots." Their teleop-to-training pipeline captures human demonstrations, fine-tunes policies, and validates through whole-body control — a closed loop that gets better with every hour of operation.

**Bedrock Robotics** ($270M, Series B) — Took Waymo's ML-first safety culture and pointed it at construction. 70,000 cubic yards of earth moved autonomously on a 130-acre site. Autonomy went from freeways to field work.

The signal: physical AI isn't about demos anymore. These companies have production deployments, real-world data flywheels, and hardware moats that code alone can't replicate.

---

## February's Unsexy Bets (That Might Matter Most)

Not everything interesting makes headlines.

**Fundamental** ($225M, Series A) — A foundation model for tabular data. Not text. Not images. Spreadsheets. Pre-trained on billions of enterprise tables. If this works, it eliminates manual feature engineering for every company sitting on structured data. Think: BERT for databases.

**OLIX** ($220M, Series A) — Photonic AI accelerators. Replacing HBM memory stacks with SRAM + optical interconnects. Deliberately avoids supply-constrained components. A hardware architecture bet _against_ the GPU scaling paradigm.

**Backslash Security** ($186M, Series A) — MCP security middleware for AI agents. Real-time prompt injection detection, agent inventory dashboards, centralized governance rules. This is a distinctly 2026 company — built for a world where agents write code autonomously and someone needs to watch.

---

## Geography: Where AI Gets Built

**📊 [INSERT: geography-bar.png]**

| Region        | Companies | Share |
| ------------- | --------- | ----- |
| North America | 192       | 57%   |
| Europe        | 68        | 20%   |
| Asia          | 53        | 16%   |
| Oceania       | 8         | 2%    |
| Other         | 15        | 5%    |

Europe's 20% is quietly significant. Wayve (London), ElevenLabs (London/NYC), Axelera AI (Netherlands) — a UK-Dutch-Nordic corridor is forming, particularly strong in embodied AI and inference hardware.

**📊 [INSERT: genai-intensity.png]**

60% of funded companies are "core AI" — the model IS the product. But 20% are AI-adjacent without being AI-powered. The market still funds plenty of picks-and-shovels plays.

---

## Builder's Playbook: 3 Things to Act On

**1. Your data pipeline IS your moat.**
77.6% of funded companies are building vertical data moats. The model layer is commoditizing. If your competitive advantage depends on which LLM you use, you don't have one.

**2. Build the safety layer now, not later.**
48.6% already use guardrail LLMs. Backslash is building a $186M business around governing what agents output. If you're shipping autonomous agents without a governance layer, you're one incident away from a pivot.

**3. Agents are architecture, not product.**
60.7% exhibit agentic patterns across every category — healthcare, fintech, security, SaaS. The question isn't "should we build an agent?" It's "which parts of our system should be agentic?" The answer: wherever human latency is the bottleneck.

---

**📊 [INSERT: big5-bar.png]**

_Data: 336 funding rounds, 107 deep company analyses. February 2026._
_Full interactive data at [BuildAtlas](https://buildatlas.net)_

---

## Visual Assets

All chart PNGs for LinkedIn posting are in: `apps/web/data/2026-02/output/linkedin/`

| Visual          | File                  | Use After Section             |
| --------------- | --------------------- | ----------------------------- |
| Cover / Hero    | `cover.png`           | Title                         |
| Capital Treemap | `capital-treemap.png` | "Where Market B's Money Goes" |
| Big 5 Bar Chart | `big5-bar.png`        | Footer / standalone post      |
| Trend Radar     | `trend-radar.png`     | "Build Pattern Map"           |
| Funding Funnel  | `funding-funnel.png`  | "Seed vs. Series A"           |
| Sankey Diagram  | `sankey-diagram.png`  | "Stage → Sector flows"        |
| Geography Chart | `geography-bar.png`   | "Where AI Gets Built"         |
| GenAI Intensity | `genai-intensity.png` | "How Deep Does AI Go"         |

## LinkedIn Posting Notes

- **Hook (first 2-3 lines before "see more"):** "$60.6 billion in AI funding. Sounds massive. Here's the part nobody mentions: five checks account for $49.2 billion of it."
- **Best standalone visual for engagement:** Sankey diagram or Trend Radar
- **Carousel opportunity:** Each section heading + its chart = one slide
- **Engagement prompt:** "Which of the 8 categories would you bet on? Or is there a 9th nobody's tracking?"
- **Hashtags:** #AI #VentureCapital #StartupFunding #ArtificialIntelligence #BuilderPlaybook
