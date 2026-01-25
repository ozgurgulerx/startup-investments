# Pre Stilla AI - GenAI Analysis Brief

**Generated:** 2026-01-23 06:27 UTC

---

## Company Overview

| Field | Value |
|-------|-------|
| **Company** | Pre Stilla AI |
| **Website** | https://stilla.ai/ |
| **Funding** | $5,000,000 |
| **Stage** | Pre Seed |
| **Location** | Stockholm, Stockholms Lan, Sweden, Europe |
| **Industries** | Artificial Intelligence (AI), Productivity Tools |

### Description
Stilla is an AI agent that quietly keeps track of everything — what was said, what needs doing, and what’s already in motion.

---

## GenAI Analysis

### Does This Startup Use GenAI?
**YES** - CORE

| Metric | Value |
|--------|-------|
| **Uses GenAI** | Yes |
| **GenAI Intensity** | Core |
| **Models Mentioned** | None detected |
| **Confidence Score** | 90% |

### GenAI Intensity Explanation
- **Core**: GenAI is the main product/value proposition
- **Enhancement**: GenAI enhances an existing product
- **Tooling**: GenAI used for internal operations
- **None/Unclear**: No GenAI detected or can't determine

---

## Build Patterns Detected

- **Agentic Architectures** (confidence: 95%)
  - Stilla is described as an autonomous agent that coordinates actions between humans and other software tools, acting as a teammate that performs multi-step reasoning and orchestration across meetings and integrations.
- **Knowledge Graphs** (confidence: 70%)
  - Stilla appears to maintain a permission-aware, shared context graph across tools and meetings, supporting RBAC and entity relationships for collaborative intelligence.
- **Vertical Data Moats** (confidence: 60%)
  - While Stilla emphasizes privacy and does not train on user data, the platform's focus on team collaboration and integration with enterprise tools suggests the potential for vertical data moats, especially if proprietary workflows or metadata are used for model improvement.
- **Agentic Architectures** (confidence: 95%)
  - Stilla is described as an autonomous agent that coordinates actions between humans and other software tools, acting as a teammate that performs multi-step reasoning and orchestration across meetings and integrations.

### Pattern Definitions
1. **Knowledge Graphs** - Permission-aware graphs, RBAC indexes, entity relationships
2. **Natural-Language-to-Code** - Converting plain English to working software
3. **Guardrail-as-LLM** - Secondary models checking outputs for compliance
4. **Micro-model Meshes** - Multiple small specialized models
5. **Continuous-learning Flywheels** - Usage data improving models
6. **RAG** - Retrieval-augmented generation
7. **Agentic Architectures** - Autonomous agents with tool use

---

## Market Classification

| Classification | Value |
|----------------|-------|
| **Market Type** | Horizontal |
| **Sub-vertical** | AI-powered productivity and collaboration tools |
| **Target Market** | B2B |

---

## Competitive Analysis

### Competitors
**Otter.ai**
  - *Similarity:* Automated meeting transcription, note-taking, and AI-powered summaries.
  - *How Pre Stilla AI differs:* Stilla emphasizes real-time collaborative notes, deep integrations with productivity tools (Linear, GitHub, Notion, Slack), and operates without joining meetings as a bot. Stilla also positions itself as an 'AI teammate' that orchestrates actions post-meeting, not just note-taking.

**Fireflies.ai**
  - *Similarity:* AI meeting assistant for transcription, note-taking, and workflow automation.
  - *How Pre Stilla AI differs:* Stilla does not require a bot to join calls, offers live collaborative editing, and focuses on syncing context and decisions across multiple tools automatically. It also claims stronger privacy (no training on user data) and SOC2 Type 2 compliance.

**Supernormal**
  - *Similarity:* AI-powered meeting notes, summaries, and integrations with productivity tools.
  - *How Pre Stilla AI differs:* Stilla's differentiation is in its 'multiplayer' approach—shared live docs, team collaboration during meetings, and persistent context across tools and threads. It also highlights more advanced post-meeting automation (e.g., updating Linear, drafting PRs, updating Notion, etc.).

**Fathom**
  - *Similarity:* Automated meeting summaries, transcripts, and CRM integrations.
  - *How Pre Stilla AI differs:* Stilla positions itself as an orchestration layer for both humans and AI agents, not just a meeting summary tool. It integrates more deeply with engineering and product tools, and supports real-time collaboration.

**Notion AI**
  - *Similarity:* AI-powered documentation, note-taking, and knowledge management.
  - *How Pre Stilla AI differs:* Stilla is focused on meetings and action orchestration, not just documentation. It claims to keep context in sync across multiple tools and workflows, acting as an active teammate rather than a passive knowledge base.


### Differentiation
**Primary Differentiator:** Stilla acts as a 'multiplayer AI teammate' that maintains shared context, orchestrates actions across tools, and enables real-time team collaboration before, during, and after meetings.

**Technical:** Runs locally (no bot required in meetings), offers live collaborative notes, integrates deeply with a wide range of productivity/developer tools, maintains persistent context across meetings and threads, SOC2 Type 2 compliance, and does not train on user data.

**Business Model:** Focuses on high-velocity, product-centric teams (startups to public companies), offers a free trial, and positions itself as a central intelligence layer for teams. Emphasizes privacy and security as a selling point.

**Positioning:** Stilla is positioned as the 'AI teammate' for teams, not just a meeting assistant. It claims to go beyond transcription/notes to automate follow-up actions, keep context in sync, and reduce coordination overhead.

### Secret Sauce
**Core Advantage:** Stilla's unique advantage is its ability to maintain and orchestrate shared context across an organization's tools, enabling seamless collaboration and automated action from meetings to execution—without bots joining calls.

**Defensibility:** This is hard to replicate due to the breadth and depth of integrations, real-time collaborative architecture, privacy-first approach (no data used for training), and the persistent context engine that links conversations to actions across tools.

**Evidence:**
  - "Works on all video tools without bot—Stilla listens on your device, so no bot ever joins the call."
  - "Collaborative AI notes—One shared doc for notes and decisions. Your team edits live. Stilla refines as you go."
  - "Stilla keeps Linear in sync with what you decide—so you never have to groom issues again."

| Competitive Moat | MEDIUM |
|------------------|-------|

**Moat Explanation:** Stilla's competitive position is defensible due to its privacy-centric architecture (no bots, no training on user data), deep and broad integrations, and real-time collaborative features. However, the meeting AI space is crowded, and larger incumbents or well-funded startups could replicate integrations and workflow automation. The persistent context and orchestration layer provide some defensibility, but ongoing innovation and ecosystem lock-in will be necessary to maintain a strong moat.

---

## Unique Findings (Newsletter Potential)

**Newsletter Potential:** HIGH
**Technical Depth:** High

### Key Findings
- Device-level meeting capture: Stilla listens on your device rather than joining calls as a bot. This avoids the common 'ghost participant' problem, improves privacy, and likely requires deep OS-level integration for audio capture and context awareness across all video platforms.
- Real-time, collaborative AI notes: Notes are editable live by the team, with Stilla refining them in real time. This suggests a sophisticated backend for multi-user document synchronization and AI-driven summarization, blending collaborative editing (like Google Docs) with AI augmentation.
- Persistent, cross-tool context: Stilla claims to 'remember what you decided across meetings and tools' and updates issues, drafts code, and keeps docs in sync. This implies a context engine that unifies data and decisions from disparate sources (Slack, Linear, GitHub, Notion, etc.), which is technically challenging due to data heterogeneity and the need for accurate, persistent memory.
- No data training on user content: Explicitly stating that neither Stilla nor subprocessors train on user data is a privacy-forward stance, requiring a technical architecture that isolates user data from model training pipelines—potentially limiting some AI capabilities but increasing trust.
- Automated action orchestration: Beyond note-taking, Stilla automates downstream actions (e.g., drafting PRs from conversations, syncing Linear issues, updating Notion, launching Cursor). This is more than summarization—it's workflow automation driven by semantic understanding of meetings, which is a step beyond most AI meeting tools.

---

## Evidence & Quotes

- "The multiplayer AI for teams"
- "Stilla takes meeting notes. And does the work."
- "Collaborative AI notes"
- "Chat with Stilla in a private sidebar"
- "Stilla refines as you go"

---

## Data Quality

| Metric | Value |
|--------|-------|
| **Sources Crawled** | 0 |
| **Content Analyzed** | 63,548 characters |
| **Analysis Timestamp** | 2026-01-23 03:25 UTC |

---

*This brief was auto-generated by the Startup GenAI Analysis System.*
