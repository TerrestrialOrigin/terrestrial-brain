## Context

The ingest pipeline currently handles project detection inline within `freshIngest()` (helpers.ts) — the LLM call that splits notes into thoughts also attempts to tag each thought with a `project_id`. This approach has three problems: (1) project detection is coupled to the thought-splitting prompt, making it hard to improve independently, (2) it only detects projects, not tasks or other entities, and (3) it cannot auto-create projects from folder structure.

Sprint 2 introduced the structural parser (`parser.ts`), which produces `ParsedNote` objects with headings and checkboxes. Sprint 3 builds the extraction layer on top of this — a pipeline framework where sequential extractors consume `ParsedNote` and produce structured references. The first extractor (ProjectExtractor) replaces the inline project detection from `freshIngest()`.

### Current state
- `parser.ts` exports `ParsedNote`, `ParsedCheckbox`, `ParsedHeading`, and `parseNote()`
- `helpers.ts::freshIngest()` embeds project detection in the thought-splitting LLM call
- `projects` table has `id`, `name`, `type`, `parent_id`, `description`, `metadata`, `archived_at`
- Three seed projects: CarChief, Terrestrial Brain, CarChief Backend (child of CarChief)
- Tests use Deno test framework, integration tests call the MCP server on `localhost:54321`

## Goals / Non-Goals

**Goals:**
- Define a clean `Extractor` interface that future extractors (TaskExtractor, etc.) can implement
- Build a pipeline runner that executes extractors sequentially with shared, enrichable context
- Implement ProjectExtractor with three detection signals: file path, heading match, LLM content matching
- Auto-create project rows when a `/projects/{name}/` folder is detected with no DB match
- Full test coverage of the pipeline framework and ProjectExtractor

**Non-Goals:**
- Integrating the pipeline into `ingest_note` or `capture_thought` (Sprint 5)
- Building TaskExtractor (Sprint 4)
- Modifying the `thoughts.metadata.references` format (Sprint 5)
- Changing the Obsidian plugin
- Modifying existing MCP tool registrations

## Decisions

### 1. Extractor interface uses async + context enrichment pattern

The `Extractor` interface defines an `extract(note, context)` method returning `ExtractionResult`. Context is mutable — each extractor can add to `newlyCreatedProjects` / `newlyCreatedTasks` so downstream extractors see newly created entities.

**Why over immutable context:** Extractors depend on each other (TaskExtractor needs projects found by ProjectExtractor). Immutable context would require the pipeline to explicitly merge and rebuild context between each step, adding complexity. Mutable context is simpler and the pipeline runs sequentially so there's no concurrency risk.

**Alternatives considered:** (a) Return enrichment data from `extract()` and have the pipeline merge it — more explicit but more boilerplate for every extractor. (b) Event-based enrichment — over-engineered for 2-3 extractors.

### 2. Pipeline runs extractors sequentially, not in parallel

Extractors run in insertion order. The pipeline iterates the array, awaiting each before proceeding.

**Why:** Later extractors depend on context enrichment from earlier ones (e.g., TaskExtractor needs `knownProjects` enriched by ProjectExtractor). Parallel execution would require complex synchronization. The performance cost is negligible — typically 2-3 extractors per note.

### 3. ProjectExtractor uses three detection signals with priority

1. **File path** — deterministic, highest confidence. If `referenceId` matches `/projects/{name}/...`, look up or create that project.
2. **Heading match** — deterministic. Compare `ParsedNote.headings` against `knownProjects` names (case-insensitive).
3. **LLM content matching** — for remaining associations. A focused, cheap LLM call that receives note title, heading structure, first ~200 chars per section, and the known projects list. Returns `{ "project_ids": ["uuid1"] }`.

**Why this order:** Deterministic signals first avoids unnecessary LLM calls (saving latency and cost). File path is the strongest signal since the user explicitly organized the note there.

**Alternative considered:** Single LLM call handling all signals — simpler code but wastes money/latency when deterministic matching would suffice, and LLM can hallucinate project names.

### 4. Auto-creation of projects from folder structure

If a note's `referenceId` indicates a `/projects/{name}/` path and no matching project exists in the DB, ProjectExtractor inserts a new project row with `name` from the folder name, `type: null`, and no description. This is enriched into `newlyCreatedProjects` for downstream extractors.

**Why:** The user implicitly created a project by making a folder. Requiring manual `create_project` calls creates friction and missed associations.

**Guard:** Only auto-creates from the `/projects/` path pattern — random folders elsewhere don't trigger project creation.

### 5. Files live in `extractors/` subdirectory

New files:
- `supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts` — types + runner
- `supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts` — ProjectExtractor

**Why a subdirectory:** Keeps extraction logic separate from MCP tool registration and helpers. Future extractors (TaskExtractor) go in the same directory.

### 6. LLM matching uses OpenRouter gpt-4o-mini via existing helper pattern

The content-matching LLM call follows the same `fetch(OPENROUTER_BASE + "/chat/completions")` pattern used in `helpers.ts`. It uses `gpt-4o-mini` with `response_format: { type: "json_object" }`.

**Why not a new helper:** The call is specific to project matching (custom prompt). Abstracting a generic "call LLM with system/user" helper adds indirection without value at this stage. The pattern is simple enough to duplicate.

### Test Strategy

- **Unit tests** (pure functions): Pipeline runner logic with mock extractors (fake implementations of the `Extractor` interface). Verifies sequential execution, context enrichment, and result composition.
- **Integration tests**: ProjectExtractor against real Supabase (via the running MCP server or direct Supabase client). Tests file-path detection, heading detection, LLM content matching, and auto-creation.
- **No E2E tests needed**: The pipeline is not yet integrated into any user-facing tool (that's Sprint 5). E2E testing happens when `ingest_note` uses the pipeline.

### User Error Scenarios

| Scenario | Handling |
|---|---|
| Note with `referenceId` of `/projects//` (empty folder name) | Skip auto-creation — folder name extraction returns empty string |
| Note content mentions a project name that is a substring of another (e.g., "Car" vs "CarChief") | LLM matching is asked for exact project IDs from the known list — it cannot invent new ones |
| Note with no headings, no `/projects/` path, and no project mentions | All three signals return empty — `ExtractionResult.ids` is `[]`, which is valid |
| Very long note (100+ headings) | Heading matching is O(headings × projects) string comparison — fast. LLM call truncates to first ~200 chars per section |
| Known projects list is empty (no projects in DB) | Skip LLM call entirely (no projects to match against). File-path detection still creates new projects |

### Security Analysis

| Threat | Mitigation |
|---|---|
| LLM prompt injection via note content | The LLM call for content matching receives a constrained prompt asking only for project ID matching from a known list. The response is parsed as JSON and only valid UUIDs from the known list are accepted. Arbitrary output is discarded. |
| Unauthorized project creation | Auto-creation only triggers from the `/projects/` path pattern. The MCP server is already auth-gated (`x-brain-key`). No new auth surface. |
| Supabase injection via folder names | Folder names are used as string values in Supabase `.eq()` queries, which are parameterized. No raw SQL. |

## Risks / Trade-offs

- **[LLM content matching may over- or under-tag]** → Mitigation: Only IDs from the known projects list are accepted. Users can correct via existing `update_project` tool. This matches current behavior in `freshIngest()`.
- **[Auto-created projects have minimal metadata]** → Mitigation: Created with just `name` from folder. User or AI can enrich via `update_project` later. Acceptable because the alternative (missing the association entirely) is worse.
- **[Mutable context pattern could cause subtle bugs]** → Mitigation: Pipeline runs sequentially and context fields are append-only arrays. Extractors should only push to `newlyCreated*` arrays, never modify `known*` arrays beyond appending.
- **[LLM call adds latency to extraction]** → Mitigation: LLM call is skipped when deterministic signals (path, heading) already found matches, or when no known projects exist to match against. The call itself is small (project list + note summary, not full content).

## Open Questions

None — Sprint 3 scope is well-defined and self-contained.
