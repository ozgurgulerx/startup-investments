# Graph-AI-Tutor - Product Spec (v0)

## One-line
A local-first, graph-backed learning workspace where Markdown is the source of truth, and LLMs propose reviewable changesets to improve your knowledge base and train deep understanding.

## Core loop (the only loop that matters)
1) Capture: "I learned X" (text / code / link / paper)
2) Propose: LLM suggests **graph + source edits** as a reviewable changeset
3) Curate: you accept/reject diffs -> vault updates
4) Recall: training mode probes understanding -> updates mastery signals
5) Build: jump from concept -> code artifact -> runnable lab

## Target user
An expert learner/builder with a growing personal KB who wants:
- instant recall (definition, invariants, code)
- fast navigation (search + graph)
- deep training (not trivia)
- reliable edits (no silent AI writes)

## Non-negotiable invariants (maintainability + trust)

### Source of truth
- Markdown vault is canonical.
- The database/index is a **rebuildable cache** (safe to delete/rebuild).

### AI change control
- AI NEVER writes directly to the vault.
- AI output = **Changeset** (diff) you must accept to apply.
- Every proposed edge or claim includes **evidence** (snippet/anchor + source link) OR is tagged "hypothesis".

### Schema stability
- All entities + edge types are explicitly enumerated + versioned.
- Any schema change requires a migration + shared type update.

### UX invariants (speed + flow)
- Everything is keyboard-accessible.
- Search is always one shortcut away.
- "Open concept" is always <= 2 actions from anywhere.
- Graph interactions are smooth and don't block typing.

## Entity types (v0)
- Concept
- CodeArtifact (snippet/recipe/lab)
- Person
- Source (paper/book/blog/video)
- Route (learning path)
- Changeset (proposed edits)
- TrainingItem (question/card) + Review (result)

## What "good" looks like (quality bars)
- Global search results appear in <150ms on a medium vault.
- Opening a concept is <200ms (from cached index).
- Graph pan/zoom is ~60fps for typical subgraphs; degrades gracefully by clustering.
- LLM responses are structured JSON; validation failures are recoverable (retry with guardrails).
- No content loss: autosave, undo, git rollback.

## Out of scope for v0 (explicitly)
- Real-time multi-user collaboration (CRDT) - later.
- Hosting other peoples' vaults - later.
- Fully automated fact-checking across the internet - later.
- "AI writes my notes for me" - not the point.

## Privacy / data ownership
- Vault stays local by default.
- LLM calls are opt-in per action (no background uploading).
- Secrets are stored locally (OS keychain if desktop; env if dev).

