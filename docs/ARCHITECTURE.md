# Architecture Spec (v0)

## Reference stack (swap if needed)
- Frontend: React + TypeScript
- App shell: Next.js (App Router) or Vite + Router
- State: Zustand (or Jotai)
- Editor: CodeMirror 6
- Graph: Cytoscape.js (Atlas + DAG layouts)
- Storage:
  - Vault = filesystem Markdown
  - Index DB = SQLite (migrations) + FTS5
  - Vector search = sqlite-vss / sqlite-vector (or pgvector if server)

This design is "local-first": DB is a derived index; vault is canonical.

## High-level modules
- core/schema: Zod schemas + types (shared)
- core/vault: file IO, parsing, watchers
- core/indexer: builds DB from vault (incremental)
- core/search: FTS + vector + rank fusion
- core/graph: traversal, neighborhoods, paths
- core/changesets: diff model, apply, rollback hooks
- core/llm: provider routing + structured outputs + retries
- core/training: question gen, grading, scheduling
- ui: panes, command palette, graph, editor, trainer

## Data model (conceptual)

### Node
- id (stable, UUID)
- type (Concept|CodeArtifact|Person|Source|Route)
- title
- aliases[]
- tags[]
- file_path (for concepts/persons/sources backed by MD)
- summary
- created_at, updated_at

### Edge
- id
- from_id, to_id
- type (prereq|implements|uses|contrasts|related|authored_by|cites|example_of)
- weight (optional)
- evidence[] (anchors/snippets/URLs)
- created_at

### CodeArtifact
- subtype (snippet|recipe|lab)
- language
- code (or file_path)
- runnable (bool) + runner config

### Changeset
- id
- title
- status (proposed|applied|rejected)
- patches[] (unified diffs or structured patch objects)
- graph_ops[] (add edge, remove edge, create node...)
- rationale + confidence
- created_at

### Training
- TrainingItem:
  - id, type, prompt, expected (optional), rubric (optional)
  - concept_ids[]
- Review:
  - training_item_id, score, feedback, timestamp
- Mastery:
  - concept_id, score, last_reviewed_at, scheduling_state

## Vault format (Markdown)
- Frontmatter stores stable id + typed metadata.
- Links can be:
  - wiki links [[Concept]]
  - explicit edges in frontmatter for stable typed edges.

DB rebuild must be deterministic from vault.

## Indexing pipeline
1) Scan vault
2) Parse frontmatter + headings + wiki links + code fences
3) Upsert nodes
4) Upsert edges (wiki links become `related` unless overridden)
5) Update FTS index
6) Compute embeddings (chunked) for semantic search
7) Emit "index ready" event for UI

Incremental:
- file watcher triggers reindex of only changed file + affected backlinks.

## Search architecture
- Exact search: SQLite FTS5 over:
  - title, aliases, headings, body text, tags, code fences (separately weighted)
- Semantic search:
  - chunk embeddings stored with (node_id, chunk_id, text_span)
- Hybrid:
  - weighted fusion + type boosts + recency boosts

## LLM integration (guardrails)
- Every LLM action has:
  - explicit input schema
  - explicit output schema
  - validation + retry with "fix JSON" prompt
- LLM cannot mutate vault directly; only returns Changeset.

Key LLM actions:
- ProposeChangesetFromCapture
- ProposeEdges (with evidence)
- GenerateContextPack
- GenerateTrainingSession
- GradeAnswerWithRubric

## Changeset application
- Apply:
  - show diff preview
  - apply patches to files
  - reindex affected files
- Reject:
  - store for audit, no changes
- Optional later:
  - "commit to git" integration

## Training engine
- Session generator selects concepts based on:
  - weak mastery
  - recent edits
  - route progression
- Question generator uses local retrieval:
  - concept sections + neighbors + code artifacts
- Grader:
  - objective checks when possible
  - rubric-based grading when not
- Scheduler:
  - start with SM-2; optionally FSRS later

## Testing & quality gates
- Unit tests: core graph/search/indexer
- Integration tests: changeset apply + reindex
- E2E: command palette, open concept, graph click, editor save, training session flow

