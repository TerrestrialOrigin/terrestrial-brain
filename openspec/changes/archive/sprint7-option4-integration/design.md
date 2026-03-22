## Context

Sprint 7 integrates the "Option 4" pattern: when the AI creates tasks for the user, it writes both structured data (tasks table) AND human-readable markdown (ai_output table). The key challenge is ensuring that when the delivered markdown is later ingested, the TaskExtractor recognizes the pre-existing tasks and doesn't create duplicates.

## Goals / Non-Goals

**Goals:**
- Provide a single MCP tool that atomically creates structured tasks + markdown output
- Tag task rows with `reference_id` = target file path so TaskExtractor can match them on ingest
- Generate correct markdown from structured task data (checkboxes, headings, hierarchy)
- Verify the round-trip: create → deliver → ingest → no duplicates

**Non-Goals:**
- No changes to TaskExtractor reconciliation logic (it already works)
- No changes to the extractor pipeline
- No changes to the Obsidian plugin
- No composite queries (Sprint 8)

## Decisions

### 1. Single composite tool rather than orchestrating existing tools

**Decision:** Create `create_tasks_with_output` as a single tool that handles both task insertion and ai_output creation, rather than requiring the AI to call `create_task` N times + `create_ai_output`.

**Why:** Atomicity — if the AI calls tools individually, a failure mid-sequence leaves tasks without their markdown or markdown without matching tasks. A single tool ensures consistency. Also reduces round-trip latency (one MCP call vs N+1).

### 2. Tasks tagged with `reference_id` = `file_path`

**Decision:** Each task row's `reference_id` is set to the `file_path` from the ai_output.

**Why:** The TaskExtractor's reconciliation already queries `tasks WHERE reference_id = note.referenceId`. When `ingest_note` is called with `note_id = "projects/CarChief/SprintPlan.md"`, the pipeline finds the pre-created tasks tagged with the same path and matches by content similarity. No code changes needed in the extractor.

### 3. Markdown generation from structured task data

**Decision:** The tool generates markdown with `- [ ]`/`- [x]` checkboxes, grouped under project headings. Indentation represents subtask hierarchy. The markdown is stored in ai_output exactly as generated.

**Why:** The structural parser expects standard markdown checkboxes. Generating them from the structured data ensures the parser will extract checkboxes that exactly match the task rows' content, guaranteeing high similarity scores during reconciliation.

### 4. Tool lives in `ai_output.ts`

**Decision:** Add `create_tasks_with_output` to the existing `tools/ai_output.ts` module rather than creating a new file.

**Why:** It's fundamentally an ai_output creation tool that also creates tasks. It uses the ai_output table. Keeping it in the same module avoids a new file for a single tool.

### User Error Scenarios

- **Empty tasks array:** Tool returns error "At least one task is required"
- **Missing file_path:** Zod schema validation rejects (required field)
- **Invalid project_id:** Task insertion fails with FK violation — tool catches and returns error
- **Duplicate file_path (ai_output already exists for that path):** Tool succeeds — multiple ai_output rows for the same path are fine (plugin delivers all pending)

### Security Analysis

- **Input validation:** Zod schema validates all inputs. `file_path` is a string — no path traversal risk since the plugin writes to the vault (not filesystem)
- **SQL injection:** Supabase client uses parameterized queries
- **Access control:** Same `x-brain-key` auth as all other tools
- No new threat vectors beyond existing tool surface

### Test Strategy

- **Plugin unit tests (Vitest):** Test `create_tasks_with_output` generates correct markdown, creates tasks with correct `reference_id`
- **Round-trip integration test:** Create tasks + ai_output → call ingest_note with the same content/path → verify TaskExtractor matches existing tasks, no duplicates
- **Edge cases:** Empty tasks, single task, subtask hierarchy, mixed project assignments

## Risks / Trade-offs

- **[Markdown content drift]** If the AI later edits the delivered file, the checkboxes may diverge from the task rows. → Mitigation: On re-ingest, TaskExtractor reconciles (updates task content). This is existing behavior.
- **[Large task lists]** 100+ tasks in a single call could be slow. → Mitigation: Batch insert via Supabase is efficient. Markdown generation is O(n). Acceptable for MVP.

## Open Questions

None — the design leverages existing infrastructure (TaskExtractor reconciliation, ai_output delivery, reference_id matching).
