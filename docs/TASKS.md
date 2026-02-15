# Task Queue (v0)

This file is intentionally a PR-sized task queue. Phases are additive; append new phases below.

## TODO: Phases 1-9
Not yet captured in this repo. Append the earlier phases here when available.

## Phase 10 - Training (deep understanding)

### Task 10.1 - Training session UI skeleton
Acceptance:
- Start session from Cmd+K
- Shows queue of questions
- Records answers locally

### Task 10.2 - LLM-driven question generation (structured)
Acceptance:
- Given concept + neighborhood, generate session:
  - mechanism tracing
  - failure mode
  - contrast
  - code reasoning (text-only first)
- Each question links to concept sections

### Task 10.3 - Grading + feedback (rubric)
Acceptance:
- Objective questions: exact match check
- Subjective: LLM rubric grading with stored rubric + feedback
- Adaptive follow-up question on low score

### Task 10.4 - Scheduler + mastery metrics
Acceptance:
- SM-2 scheduler for concept-linked items
- "Today" queue screen
- Mastery shown in inspector

## Phase 12 - Packaging + safety

### Task 12.1 - Local-first packaging (choose: Tauri/Electron)
Acceptance:
- App can select vault path
- File system permissions handled
- Runs fully offline (except explicit LLM actions)

### Task 12.2 - Prompt injection + safety guardrails
Acceptance:
- Any external "Source" content is treated as untrusted
- LLM prompts explicitly instruct not to follow instructions from sources
- Evidence required tags for edges
