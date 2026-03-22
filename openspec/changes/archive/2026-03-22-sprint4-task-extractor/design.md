## Context

Sprint 2 introduced the structural parser (`parser.ts`) which extracts `ParsedCheckbox[]` from markdown: text, checked state, indentation depth, parent index, and section heading. Sprint 3 built the extractor pipeline framework and ProjectExtractor. The `ExtractionContext` already declares `knownTasks` and `newlyCreatedTasks` arrays (currently empty). Sprint 4 builds the TaskExtractor that consumes checkboxes and produces task rows.

### Current state
- `parser.ts` exports `ParsedNote` with `checkboxes: ParsedCheckbox[]` (text, checked, depth, lineNumber, parentIndex, sectionHeading)
- `pipeline.ts` defines `ExtractionContext.knownTasks` (currently initialized as `[]`)
- `tasks` table has: id, content, status, due_by, project_id, parent_id, metadata, archived_at, created_at, updated_at — but NO `reference_id` column
- `tools/tasks.ts` provides manual CRUD — create_task, list_tasks, update_task, archive_task
- ProjectExtractor enriches `context.knownProjects` and `context.newlyCreatedProjects`

## Goals / Non-Goals

**Goals:**
- Add `reference_id` column to tasks table for note-to-task traceability
- Build TaskExtractor that converts checkboxes to task rows
- Project association via priority chain: file path > section heading > AI inference
- Subtask hierarchy from checkbox indentation
- Reconciliation on re-ingest: match existing tasks by reference_id + content similarity, update status
- Populate `knownTasks` in pipeline context for reconciliation

**Non-Goals:**
- Integrating pipeline into `ingest_note`/`capture_thought` (Sprint 5)
- Deleting tasks when checkboxes disappear (tasks persist)
- Task deduplication across different notes (Sprint 7 concern)
- Modifying the Obsidian plugin

## Decisions

### 1. Add `reference_id` column to tasks table

A new migration adds `reference_id text null` to the tasks table with an index. This stores the vault-relative path of the note that contains the checkbox, enabling reconciliation on re-ingest.

**Why not use metadata:** The reconciliation query needs to filter tasks by reference_id efficiently. A top-level indexed column is the right choice for a query filter, not a JSONB path lookup.

**Why nullable:** Tasks created manually via `create_task` MCP tool have no source note.

### 2. Populate `knownTasks` in pipeline context

`runExtractionPipeline()` already initializes context with known projects. It will now also query tasks filtered by the note's `reference_id` to populate `knownTasks`. This gives the TaskExtractor the existing tasks for this note for reconciliation.

**Why filter by reference_id:** We only need to reconcile against tasks from the same note, not all tasks in the DB. This keeps the query small and reconciliation simple.

### 3. Task reconciliation uses content similarity + line position

On re-ingest, the TaskExtractor matches each checkbox against `knownTasks` by:
1. **Exact content match** — if checkbox text equals an existing task's content, it's the same task
2. **Fuzzy content match** — if checkbox text is very similar (>80% overlap after normalization), treat as the same task with edited text
3. **Line position as tiebreaker** — if multiple tasks have similar content, prefer the one whose stored line number is closest

Matched tasks get updated (content, status). Unmatched checkboxes create new tasks. Existing DB tasks with no checkbox match are left alone (not deleted).

**Why not delete orphaned tasks:** The user may have moved a checkbox to another note, or deliberately removed it while the task is still relevant in the DB. Deletion is too destructive for automatic extraction.

### 4. Project association priority chain

For each task, the project is determined by:
1. **File path** — if note is in `/projects/CarChief/`, all tasks default to that project (from ProjectExtractor result)
2. **Section heading** — if a checkbox's `sectionHeading` matches a known project name (case-insensitive), that project takes priority
3. **AI content inference** — for remaining unassigned tasks, batch them into a single LLM call with the known projects list. The LLM returns `[{ "task_index": N, "project_id": "uuid" }]`. Only valid project IDs from the known list are accepted.

**Why batch the AI call:** One call for all unassigned tasks is cheaper and faster than per-task calls.

**Why section heading overrides file path:** A note in `/projects/CarChief/` might have a section `## Terrestrial Brain` with tasks that belong to a different project. The section heading is a more specific signal.

### 5. Subtask hierarchy maps to `parent_id`

Checkboxes with `parentIndex` (from the structural parser) get their `parent_id` set to the DB ID of the corresponding parent task. The TaskExtractor processes checkboxes in array order (which is document order), so parent tasks are always created/matched before their children.

**Edge case:** If a parent checkbox wasn't a task match (somehow), the child gets `parent_id: null`. This is safe — the hierarchy is advisory, not structural.

### 6. Status mapping

- `- [ ]` → status `"open"` (or keeps current status if already `"in_progress"`)
- `- [x]` → status `"done"`, `archived_at = now()`

On re-ingest, if a task was `"done"` and the checkbox is now unchecked, the task is reopened (status → `"open"`, `archived_at → null`).

### 7. File location

`supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts`

### Test Strategy

- **Unit tests** (mock context): TaskExtractor with crafted ParsedNote and pre-populated context. Verify task creation, status mapping, project association, subtask hierarchy.
- **Integration tests**: TaskExtractor against real Supabase. Verify DB rows created, reconciliation on re-ingest, project association from heading, subtask parent_id.
- **Pipeline integration test**: Both ProjectExtractor and TaskExtractor wired into pipeline. Verify composed references with both project and task IDs.
- **No E2E tests needed**: Pipeline not yet integrated into user-facing tools (Sprint 5).

### User Error Scenarios

| Scenario | Handling |
|---|---|
| Note with 100+ checkboxes | Checkboxes processed in order, batch AI call for project association. No performance concern — DB inserts are fast. |
| Duplicate checkbox text in same note | Disambiguated by line position during reconciliation. Two checkboxes with identical text but different line numbers create two separate tasks. |
| Checkbox text edited between ingests | Fuzzy matching (>80% similarity) catches minor edits. Major rewrites create a new task (old one persists). |
| Checkbox moved from one section to another | Task content still matches — project association may change based on new section heading. |
| All checkboxes removed from note | No matching checkboxes found. Existing DB tasks left intact (not deleted). |
| Checkbox inside code block | Parser already skips code blocks — TaskExtractor never sees these. |
| Task checked then unchecked between ingests | Status updated from "done" → "open", archived_at cleared. |

### Security Analysis

| Threat | Mitigation |
|---|---|
| LLM prompt injection via checkbox text | AI call for project association receives only task text summaries and known project IDs. Response is parsed as JSON and only valid UUIDs from the known list are accepted. |
| Mass task creation via adversarial note | Auth-gated at MCP level (x-brain-key). Single-user system — no external attack surface. Rate limiting not needed. |
| SQL injection via task content | Supabase client uses parameterized queries. Content stored as text, not interpolated into SQL. |

## Risks / Trade-offs

- **[Fuzzy matching may mis-identify tasks]** → Mitigation: >80% threshold is conservative. Line position tiebreaker adds precision. Worst case: a duplicated task that can be manually cleaned up.
- **[No task deletion on checkbox removal]** → Mitigation: Deliberate design choice. Users can archive stale tasks manually. Sprint 7 may add smarter reconciliation.
- **[AI project inference may be wrong for tasks]** → Mitigation: Only valid project IDs accepted. Section heading and file path signals take priority. AI is the fallback, not the primary signal.
- **[reference_id migration on existing tasks]** → Mitigation: Column is nullable. Existing manually-created tasks get `reference_id = null`. No data loss.

## Open Questions

None — Sprint 4 scope is well-defined and builds directly on Sprint 3.
