# UX Spec (v0)

## North-star UX principle
Two seconds to: (1) define, (2) connect, (3) show code, (4) test understanding.

## Layout: 3-pane + command palette

### Left pane: Explore
Tabs:
- Search (optional pinned results)
- Outline (vault folders / routes)
- Queues (Today / Weak / New / Pending changesets)
- Graph mini-map (optional)

### Center pane: Content
- Concept page renderer (default)
- Markdown editor (toggle)
- Code lab runner (when opening a CodeArtifact)

### Right pane: Inspector
Context-aware:
- Definition + invariants
- Prereqs + neighbors
- Code artifacts
- Sources + evidence
- Mastery + last reviews
- LLM actions (buttons, not chat-first)

### Global: Command palette (Cmd+K)
Top actions:
- Open concept/code/person/source
- Search (Exact / Semantic / Hybrid)
- Create node
- Link nodes / add edge
- Capture "I learned X..."
- Generate context pack
- Start training session
- Review pending changesets

## Navigation rules
- Back/Forward history works across graph traversals.
- Hover = peek card; click = open; shift-click = expand neighborhood.
- Always show breadcrumbs: Domain -> Topic -> Concept (even if inferred).

## Search UX requirements

### Universal search
- Single input + results list + facets.
Facets:
- Type (Concept/Code/Person/Source/File)
- Tags
- Edge types (optional)
- Scope (Global vs Local neighborhood)

### Matching modes
- Exact: symbols, filenames, tags, headings
- Semantic: embeddings over chunks (concept sections + code chunks)
- Hybrid: rank fusion

### Result cards must show
- Title + type icon
- 1-line summary (from frontmatter or first paragraph)
- "Why matched" (keyword highlight or semantic rationale)
- Quick actions:
  - Open
  - Open in split
  - Copy link
  - Show in graph (focus node)

### Saved views (queries)
- "No code examples"
- "Missing sources"
- "Low mastery"
- "High usage / low mastery" (later)

## Markdown editing UX (you own the sources)

### Read mode
- Fast rendered MD
- Wiki links clickable
- Hover previews
- Code blocks: copy / open in lab / expand
- Images/diagrams: click to lightbox zoom

### Edit mode
- Split view (MD <-> rendered) with synced scroll
- Autosave (debounced) + manual save shortcut
- Link autocomplete ([[...]])
- Frontmatter editor UI (no manual YAML required)
- Backlinks panel

### Change safety
- Local undo
- File history (via git integration later)
- "Apply changeset" always shows a diff preview

## Graph UX requirements (usable, not gimmick)
Two views:
1) Atlas (force/cluster) - exploration
2) Prereq DAG - learning paths

Must-have interactions:
- Pan/zoom + minimap
- Filter by node type + edge type
- Expand 1-hop / 2-hop / shortest-path-to...
- Pin nodes + focus mode
- "Show path between A and B"
- Smooth transitions (no full re-layout on minor changes)

Performance behavior:
- If node count > threshold, auto-cluster by topic.
- Always prefer local graph rendering when possible.

## Capture -> Suggest edits UX ("I learned X...")
Entry points:
- Cmd+K -> Capture
- Button on concept pages
Input types:
- plain text
- code snippet
- pasted link + notes

Output (always):
- Proposed Changeset with:
  - files to change (diff)
  - nodes/edges to add/update
  - evidence snippets/anchors
  - confidence + rationale
User actions:
- Accept all / accept per hunk / reject
- Edit before apply (optional)
- Create follow-up tasks (e.g., "add a lab", "add contrasts")

## Context pack UX ("Give me context...")
User chooses:
- target node(s)
- radius (1 hop / 2 hops / prereq path)
- include code artifacts (yes/no)
- include quiz (yes/no)

Output:
- Generated file(s) under /exports with deterministic naming
- Open immediately in center pane
- Copy-to-clipboard

## Training UX (deep understanding)
Modes:
- Recall (fast)
- Deep Check (mechanisms, failure modes, contrasts, code reasoning)

Session structure:
- 10-15 minutes default
- Mix of:
  - mechanism tracing
  - counterexample/failure-mode
  - compare/contrast
  - graph completion (drag nodes/edges)
  - code completion/debug

Scoring:
- Objective: exact/structured check
- Subjective: rubric-based LLM grading (stored rubric + feedback)
- Follow-up: adaptive probing to identify missing invariant

Training -> KB integration:
- Each question links back to the exact note section.
- Wrong answers can trigger a "propose patch" suggestion ("add missing invariant section").

## Accessibility + polish
- Keyboard shortcuts for every major action
- High-contrast mode friendly
- No UI state that requires hover-only
- Skeleton loaders; never block typing on network calls

