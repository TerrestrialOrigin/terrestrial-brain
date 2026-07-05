## Why

On re-ingest, `TaskExtractor` can silently destroy data. When project resolution fails (LLM error, or no known projects), an existing matched task's `project_id` is unconditionally overwritten with `null` — the extractor cannot tell "resolved to no project" from "resolution unavailable". Meanwhile due dates and assignees are *never* cleared even when the user removes them from the note. The merge policy is inconsistent in both directions. Separately, the Supabase writes in the update/parent-link/archive phases ignore their `error` channel, so failed writes are reported as success. (Finding C6, fix-plan Step 8.)

## What Changes

- **Distinguish "resolved to no value" from "resolution unavailable"** per field (project, due date, assignee) during extraction, so an LLM failure or absent capability can never masquerade as a deliberate clear.
- **One consistent merge policy** for `project_id`, `due_by`, and `assigned_to` on matched (existing) tasks: the note is authoritative when resolution for that field is *available* (the field is cleared when the note removed it); the stored value is *preserved* when resolution is *unavailable*.
- **Check the `error` channel of every Supabase write** in the matched-update, parent-link-update, and archive phases (mirroring the already-checked insert phase), and **surface write failures in the `ExtractionResult`** instead of swallowing them.
- Add an optional `errors` field to `ExtractionResult`; the pipeline runner logs any surfaced extractor errors instead of dropping them.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `task-extractor`: adds requirements for re-ingest merge semantics (preserve-on-unavailable, clear-on-available-empty, never null `project_id` on resolution failure) and for surfacing Supabase write failures during extraction.

## Impact

- `supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts` — project/date/assignee resolution now tracks availability; matched-task update construction; error checks on Phases 2/4/5 writes; `inferProjectsByContent`/`inferTaskEnrichments` return an `ok` flag.
- `supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts` — `ExtractionResult` gains an optional `errors: string[]`; `runExtractionPipeline` logs surfaced errors.
- Tests: new unit coverage in `tests/unit/` driving `TaskExtractor.extract` against a fake Supabase context + stubbed `fetch`. No terrestrial-core dependency; layers are the Deno suite + plugin vitest.
- No database migration and no MCP tool-signature change; behavior change is confined to re-ingest merge and error reporting.
