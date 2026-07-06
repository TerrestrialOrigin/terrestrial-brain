## Context

The MCP edge function (`supabase/functions/terrestrial-brain-mcp/`) exposes tools over an HTTP/MCP transport. After Steps 14–17 (envelope refactor, AI-provider seam, repository layer) the handlers already delegate DB access to repositories and LLM calls to an injected `AiProvider`, and wrap responses via `textResult`/`errorResult`. What remains oversized is the *orchestration + formatting* inside five handlers:

- `handleIngestNote` — `tools/thoughts.ts:885-1195` (~310 lines)
- `get_project_summary` — `tools/queries.ts:47-286` (~240 lines)
- `get_recent_activity` — `tools/queries.ts:305-563` (~260 lines)
- `update_thought` — `tools/thoughts.ts:668-802` (~135 lines, two near-duplicate branches)
- `create_tasks_with_output` — `tools/ai_output.ts:312-453` (~140 lines)

Constraint: this is a **pure refactor**. The integration suite (confirmed green at baseline: 125 passed for the touched files) is the behavior oracle and must stay green **without edits**. The refactor's own new coverage is deterministic unit tests over the extracted pure functions.

## Goals / Non-Goals

**Goals**
- No function in `tools/*.ts` exceeds ~50 lines after the change.
- Data-gathering (`fetchX`) is separated from text rendering (`formatX`) for the two composite-query tools, so formatters are pure and unit-testable with synthetic data.
- `handleIngestNote` reads as a sequence of named steps; each step is independently testable.
- One usefulness-reminder builder replaces the three variants.
- Byte-identical observable behavior (emitted text + DB effects).

**Non-Goals**
- No task-extractor decomposition (Step 19). No plugin work, no migrations, no dependency bumps.
- No new tool behavior, no changed error messages, no changed prompt text.

## Decisions

### D1 — Extract pure formatters that take already-fetched data
`get_project_summary`/`get_recent_activity` split into `fetchProjectSummary(queryRepository, id): ProjectSummaryData` (all awaits, error-bearing) and `formatProjectSummary(data): string` (pure, no I/O). Same for recent activity. **Why:** the pure formatter is the part that regresses on wording changes and is trivially unit-testable with synthetic `...Data`; the fetch part is already covered by integration tests. *Alternative considered:* a class per tool — rejected as heavier than the module-level function pair the rest of the codebase uses.

The `...Data` types carry the section-level `{ data, error }` results so the formatter can still call `renderSectionBody` and preserve the exact "(section unavailable: …)" vs empty-state distinction (finding C9, already implemented). The formatter stays pure — it does the same `renderSectionBody` calls, just fed from a struct instead of inline awaits.

### D2 — `handleIngestNote` becomes an orchestrator over named steps
Extract module-level `async` step functions, each taking the repositories/provider it needs plus the note fields:
- `checkUnchanged(noteSnapshotRepository, note_id, content): Promise<boolean>`
- `upsertSnapshot(noteSnapshotRepository, {note_id,title,content}): Promise<string | null>`
- `fetchExistingThoughts(thoughtRepository, note_id): Promise<ExistingThought[]>`
- `requestReconciliationPlan(aiProvider, {existingThoughts, title, content}): Promise<ReconciliationPlan | null>` — returns `null` to signal "fall back to fresh ingest" (parse failure); rethrows transport errors, matching current behavior exactly.
- `executeReconciliationPlan(deps, plan, ctx): Promise<{updated,added,deleted,failures,ops}>`
- `formatIngestSummary(...): string` — pure, builds the "Synced …" message.

The reconciliation **prompt string** (system + user) moves into `requestReconciliationPlan` verbatim. **Why:** the six `// Step N` comments in the current body are literally method names (owner rule). *Alternative:* leave the LLM prompt inline — rejected; extracting it is what makes the prompt-building unit-testable.

### D2a — Preserve the fresh-ingest fallback control flow precisely
Current code calls `freshIngest(...)` in two places: (a) no existing thoughts, (b) reconciliation parse failure. The orchestrator keeps both call sites and the exact `{ success, message, error? }` mapping. `requestReconciliationPlan` returning `null` triggers the same `freshIngest` path the `AiProviderParseError` catch does today; any non-parse error still propagates to the outer `try/catch`.

### D3 — Unify `update_thought` branches
The content path and non-content path both: validate ≥1 field, fetch existing, build `updatedReferences` from `project_ids`/`document_ids`, apply `reliability`/`author`, call `thoughtRepository.update`, and format `"Thought updated: …"`. They differ **only** in that the content path also awaits `getEmbedding`+`extractMetadata` and merges regenerated metadata + `content` + `embedding` into the payload. Collapse to: compute the shared field updates once; if `content !== undefined`, additionally compute+merge the AI-regenerated fields and prepend the `"content (embedding + metadata regenerated)"` label. **Why:** removes a fully-duplicated ~40-line branch. Emitted text and payload stay identical for both paths (verified against integration cases in `thoughts.test.ts`).

### D4 — Split `create_tasks_with_output`
Three helpers: `resolveTaskNames(supabase, tasks): {projectNameMap, personNameMap}`, `insertTasksAtomically(taskRepository, tasks, file_path): {taskIds} | {error, rollbackNote}`, and reuse of the existing exported `generateTaskMarkdown`. The handler orchestrates: validate path → validate parent indices → resolve names → insert atomically → insert ai_output (rolling back tasks on failure) → format success. The atomic-insert + rollback logic (finding C4, Step 6) is moved **verbatim** into `insertTasksAtomically`, not re-derived.

### D5 — One usefulness-reminder builder with a `tone`
New module `tools/usefulness-reminder.ts` exporting `buildUsefulnessReminder(thoughtIds, tone)` where `tone ∈ {"hard","soft","terse"}`:
- `hard` → current `USEFULNESS_REMINDER_LINES` + `Candidate IDs from this search: …`
- `soft` → current `USEFULNESS_REMINDER_LINES_SOFT` + `Candidate IDs from this list: …`
- `terse` → the `queries.ts` one-liner `\n---\nReminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs: <json>`

A `buildUsefulnessHeader(thoughtIds, tone)` wraps the hard/soft variants with the existing `\n\n--- Results ---\n\n`. The exact strings are preserved character-for-character (asserted by unit tests that pin the output). **Why one module:** the reminders were three near-copies across two files.

### D5a — `search_thoughts` header+footer double emission
`search_thoughts` currently emits the reminder as both a header AND a footer. Decision: **keep it, and add a comment** explaining it is intentional — a long results block pushes the header far up the context window, so repeating the required-action reminder at the end keeps it adjacent to where the model resumes generating. This matches the eval's "acceptable outcome: keep it, with a comment." No output change.

## Risks / Trade-offs

- **[Accidental behavior drift during extraction]** → The integration suite is the oracle; it must stay green with zero edits. New unit tests pin the exact emitted strings so a wording drift fails fast. GATE 2b: deleting an extracted formatter line reddens a unit test.
- **[Formatter needs data the fetch didn't carry]** → Define `...Data` types to carry every field the current inline formatter reads (including the section `{data,error}` results), so the split is mechanical.
- **[`update_thought` unification changes payload shape]** → The non-content path must still send **no** `metadata` key when neither `project_ids` nor `document_ids` changed (today it only sets `metadata` when `metadataChanged`). The unified code preserves this: metadata is added to the payload only when references changed or content was regenerated.
- **[Reconciliation `add` item shape quirk]** → Current code handles both `string` and `{thought: string}` add items. `executeReconciliationPlan` preserves that normalization verbatim.

## Migration Plan

No data migration. Deploy is a code-only edge-function update. Rollback = revert the branch. The local edge runtime hot-reloads the changed files; verification is the full `deno task test` suite plus `deno lint`/`deno fmt --check` on the changed files.

## User Error Scenarios

This is an internal refactor with no new inputs, so no new user-error surface is introduced. The existing input-validation behaviors are preserved exactly:
- `update_thought` with zero fields → same "At least one of …" error.
- `create_tasks_with_output` with empty `tasks` or a forward/self/out-of-range `parent_index` → same errors (logic moved, not changed).
- `get_note_snapshot` with neither id nor reference_id → unchanged (not part of this step).

## Security Analysis

No new attack surface: no new inputs, endpoints, env reads, or external calls. No secrets touched. The refactor does not weaken the existing constant-time key check, RLS, or the LLM-output-never-hard-deletes guarantee (soft-archive in `executeReconciliationPlan` is preserved verbatim from Step 4). No `ThreatModel.md` entry is warranted; documented here for completeness.

## Test Strategy

- **Unit (new, deterministic — no DB, no LLM):** pure formatters (`formatProjectSummary`, `formatRecentActivity`, `formatIngestSummary`, the usefulness-reminder builder, the unified `update_thought` field-application) tested with synthetic data and pinned expected strings; reconciliation step functions (`requestReconciliationPlan` prompt-building + parse-failure→null, `executeReconciliationPlan` update/add/archive counting + soft-archive) tested with a fake `AiProvider` and fake repositories, reusing `tests/unit/fake-supabase-client.ts`.
- **Integration (existing, untouched):** `thoughts.test.ts`, `queries.test.ts`, `ai_output.test.ts`, `enhanced_ingest.test.ts`, `ingest_note_route.test.ts` remain the behavior oracle and must stay green with no edits.
- **E2E:** not applicable — no user-facing UI flow changes (server-internal refactor); the plugin is untouched.

## Open Questions

None. All five decompositions have a determined target shape; the double-emission question is resolved in D5a.
