# Error Surfacing Sweep

## Why

Five residual "broken renders as empty" defects (remediation plan Step 16 — TOOL-4, TOOL-5, TOOL-12, TOOL-13, REPO-7) let transient database failures masquerade as clean zero/empty results: a failed open-task count reads as `Open tasks: 0`, a failed `touchRetrieved` silently stops recency tracking (feeding wrong data to the stale/archival queues), a thrown extraction pipeline degrades ingest silently in two of three handlers, and `Promise.allSettled` failure reasons are discarded so recurring ingest failures are undiagnosable. These violate the binding "distinguish empty from broken" directive and give the model confidently wrong answers.

## What Changes

- **TOOL-4** — `get_project`, `get_person`, and `list_projects` check the `error` channel of every sub-lookup (`findName`, `listChildrenBasic`, `countOpenByProject`, `countOpenByAssignee`, `listChildParentIds`). A failed lookup logs via `console.error` and renders an explicit unavailable marker (e.g. `Open tasks: ? (lookup failed)`) instead of `0` / silently-missing sections.
- **TOOL-5** — the three `touchRetrieved` call sites in `tools/thoughts.ts` (search_thoughts, list_thoughts, get_thought_by_id) log the error channel via a shared `touchRetrievedLogged` helper (Rule of Three — three copies exist). Reads still succeed; failures become observable.
- **TOOL-12** — the extraction-pipeline **catch** blocks in `capture_thought` and `write_document` set the already-plumbed `extractionWarning` (mirroring `update_document`'s existing behavior) so a thrown pipeline appends a visible warning to the success confirmation instead of silently dropping references.
- **TOOL-13** — `executeReconciliationPlan` (tools/thoughts.ts) and `freshIngest` (helpers.ts) log each rejected `Promise.allSettled` reason via `console.error`; the "N failed" summaries are unchanged but now diagnosable from logs.
- **REPO-7** — `countOpenByProject` / `countOpenByAssignee` in `supabase-task-repository.ts` return `{ data: null, error }` on failure instead of `{ data: 0, error }`, matching every other repository method's envelope.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `query-error-surfacing` (`openspec/specs/query-error-surfacing/spec.md`): extends the existing "failed sub-queries render an explicit unavailable marker" requirement to the entity-detail tools (`get_project`, `get_person`, `list_projects`); adds requirements for logged best-effort `touchRetrieved` failures, extraction-pipeline-throw warnings in capture/write confirmations, and logged `allSettled` rejection reasons.
- `task-repository` (`openspec/specs/task-repository/spec.md`): count methods' result envelope — `data` MUST be `null` (never `0`) when `error` is non-null.

## Non-goals

- No change to the composite-query handlers (`get_project_summary`, `get_recent_activity`) — already compliant per the existing spec.
- No change to the pipeline's structured `{ ok: false }` seed-failure path or `partialExtractionWarning` for extractor write errors (EXTR-2/EXTR-6, already landed) — this change covers only the *thrown*-pipeline catch path.
- No retry logic, no failing the read when `touchRetrieved` fails (stays best-effort by design).
- No interface signature changes to repositories beyond the count envelope fix.

## Impact

- `supabase/functions/terrestrial-brain-mcp/tools/projects.ts` (get_project, list_projects)
- `supabase/functions/terrestrial-brain-mcp/tools/people.ts` (get_person)
- `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` (three touchRetrieved sites, capture_thought catch, executeReconciliationPlan)
- `supabase/functions/terrestrial-brain-mcp/tools/documents.ts` (write_document catch)
- `supabase/functions/terrestrial-brain-mcp/helpers.ts` (freshIngest allSettled)
- `supabase/functions/terrestrial-brain-mcp/repositories/supabase-task-repository.ts` (two count methods)
- Tests: new unit tests (fake repositories) for each surfaced path; no API/schema/migration changes; no client-visible breaking changes (output gains warning markers only on failure paths).
