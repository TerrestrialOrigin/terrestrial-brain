# HTTP Route Validation

## Why

The six direct HTTP routes validate by hand and then cast: `title`/`note_id` are `as string | undefined` on raw request JSON, `ids` is `as string[]` after only an `Array.isArray` check (elements never validated, array unbounded), malformed client JSON surfaces as an unlogged 500, a thrown route handler leaves an orphaned `function_call_logs` row with no `error_details`, three `ids` routes are verbatim copies, and route matching by `pathname.endsWith` accepts arbitrarily nested bogus paths (remediation plan Step 18 — CORE-5, CORE-6, CORE-14, CORE-17). Several MCP tool fields are likewise under-validated at the boundary: `due_by` accepts any string, `email` accepts junk, `parent_index` accepts floats, and a `tasks as TaskInput[]` cast papers over the schema/type gap (TOOL-15).

## What Changes

- **CORE-5** — every body-carrying HTTP route gets a Zod `bodySchema` run by the dispatcher: `ingest-note` (`content` required non-blank string, `title`/`note_id` optional strings), `forget-note` (`note_id` required non-blank string), and the three `ids` routes (`ids`: UUID elements, min 1, max `MAX_IDS_PER_REQUEST = 100`). Schema failure → 400 with the field's message; the exact legacy messages `"content is required"` / `"note_id is required"` / `"ids array is required"` are preserved for the missing-field cases.
- **CORE-5 (counts)** — `markPickedUp`/`reject` return the number of rows actually updated (`.select("id")`), and mark/reject responses report that count, not `ids.length`.
- **CORE-6** — body parsing is split from execution: malformed JSON → 400 `"Invalid JSON body"`; a thrown handler → `logger.logError(logId, message)` before the 500 (no more orphaned log rows); non-`Error` throws are stringified, never `"undefined"`.
- **CORE-14** — the three `ids` routes are declared through one `idsRoute` factory.
- **CORE-17** — route matching compares the final path segment exactly instead of `endsWith`.
- **Refactor enabling all of the above:** the route table + dispatcher move from `index.ts` into a `http-routes.ts` module with injected deps — including the quota gate, which the ingest-note handler previously reached around its context to grab (this lands **CORE-10**, planned for Step 19, here as a structural prerequisite; Step 19 retains CORE-9 + CORE-13).
- **TOOL-15** — `due_by: z.string().datetime({ offset: true })` (create_task, update_task nullable variant, create_tasks_with_output items), `email: z.string().email()` (create_person, update_person nullable variant), `parent_index: z.number().int().min(0)`; `TaskInput` derived from the Zod schema so the `tasks as TaskInput[]` cast is deleted.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `ai-output-http-api` (`openspec/specs/ai-output-http-api/spec.md`): fetch/mark/reject gain element-level UUID validation + array bounds; mark/reject messages count rows actually updated; new envelope requirements (invalid JSON → 400, thrown handler → logged 500, exact-segment routing).
- `input-validation` (`openspec/specs/input-validation/spec.md`): boundary schemas for `due_by`, `email`, `parent_index`; HTTP route bodies validated by schema at the dispatcher.

## Non-goals

- CORE-9 / CORE-13 (quota metering accuracy, clock seam) — Step 19.
- No route additions/removals, no auth changes, no change to the MCP transport path.
- No trimming/normalizing of stored content — validation only.

## Impact

- `supabase/functions/terrestrial-brain-mcp/index.ts` (slims to composition + dispatch call)
- new `supabase/functions/terrestrial-brain-mcp/http-routes.ts` (table, schemas, matcher, dispatcher, idsRoute factory)
- `supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts`, `tools/tasks.ts`, `tools/people.ts` (field schemas, count-honest messages, cast removal)
- `repositories/ai-output-repository.ts` + `supabase-ai-output-repository.ts` (mark/reject return updated count)
- Tests: new unit suite for schemas/matcher/dispatcher; existing integration expectations for legacy 400 messages preserved; new integration expectations for element validation and update counts.
- Client impact: the desktop pull client sends valid UUID arrays (no change); mark/reject `message` strings now reflect actual rows updated — previously inflated on retries (an accuracy fix).
