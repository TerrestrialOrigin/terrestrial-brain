# Design — HTTP Route Validation

## Context

`index.ts` holds the route table (`HTTP_ROUTES`), the dispatcher (inside `app.all`), and the composition root. The dispatcher's single try/catch collapses malformed JSON and handler throws into one unlogged 500, and the table can't be unit-tested because the ingest-note entry closes over module-level `quotaGate`. Validation is hand-rolled per route with casts.

## Goals / Non-Goals

**Goals:** parse-don't-cast at every HTTP body; 400-vs-500 honesty; no orphaned log rows on throw; one `ids` route definition; exact path matching; boundary-tight field schemas for `due_by`/`email`/`parent_index`; the route layer unit-testable with fakes.

**Non-Goals:** metering-accuracy fixes (CORE-9/13, Step 19); changing route semantics, auth, or the MCP path.

## Decisions

### D1 — Extract `http-routes.ts` with full dependency injection

The table, per-route Zod schemas, matcher, and dispatcher move to `http-routes.ts`. `HttpRouteDeps` carries every seam (repositories, aiProvider, supabase, `quotaGate`, `logger`) — no module-level reads. `index.ts` builds deps once and calls `matchHttpRoute` + `dispatchHttpRoute`. This is the same decomposition the codebase already applied to composite queries and ingest steps, and it is what makes CORE-6's throw-path unit-testable (a fake route that throws; a fake logger that records `logError`). Folding in the quota-gate injection (CORE-10) is unavoidable here and noted in the proposal. Alternative — keep the table in `index.ts` and test only fragments — rejected: the dispatcher's catch behavior is the finding.

### D2 — Dispatcher pipeline: parse → log → validate → handle, each failure typed

1. `readBody()` (only for routes with a `bodySchema`) in its own try → 400 `"Invalid JSON body"`, nothing logged (parse fails before `logCall`, as before).
2. `logCall` with the raw parsed body (unchanged telemetry).
3. `bodySchema.safeParse` → on failure, `logResult(logId, 0, 0, message)` + 400. The first issue's message is the response error; required-field messages are pinned to the legacy strings (`"content is required"`, `"note_id is required"`, `"ids array is required"`) so existing clients/tests see identical envelopes for the common cases.
4. `route.handle(validatedBody, deps)` in a try whose catch normalizes the message (`error instanceof Error ? error.message : String(error)`), calls `logger.logError(logId, message)`, and returns 500. `logError` gains its first real caller.

### D3 — Typed route definitions without casts

`defineHttpRoute<Body>` helper: `bodySchema: z.ZodType<Body>` and `handle(deps, body: Body)`. The table stores `HttpRoute` (body typed `unknown` internally); the helper is the single, documented variance seam — route handlers themselves receive fully typed, schema-validated bodies with zero casts. `ids` routes come from `idsRoute(name, run)` (CORE-14), whose shared schema is `z.array(uuidField()).min(1).max(MAX_IDS_PER_REQUEST)` with the legacy message on the missing/non-array case.

### D4 — Base-anchored matching (CORE-17)

`matchHttpRoute(pathname)` splits the path and matches only when the final segment equals `route.name` AND the segment before it is the function's own base segment (`terrestrial-brain-mcp`). Plain final-segment equality would still accept nested bogus paths; anchoring on the base rejects them while working identically for local (`/functions/v1/terrestrial-brain-mcp/<name>`) and hosted deployments. Nested paths fall through to the MCP transport (which 4xx's non-MCP payloads), matching the documented raw-URL constraint.

### D5 — Honest mark/reject counts (CORE-5.3)

`markPickedUp`/`reject` add `.select("id")` and return `RepoResult<number>` (rows actually updated — the claim-style filter means retries legitimately update 0). Handlers report that count. `recordCount` in the route result uses it too.

### D6 — TOOL-15 field schemas

`due_by: z.string().datetime({ offset: true })` everywhere a due date crosses the boundary (create_task; update_task's nullable variant; create_tasks_with_output items). `email: z.string().email()` (nullable in update_person). `parent_index: z.number().int().min(0)` — cross-field ordering checks stay in `validateParentIndices`. `TaskInput` becomes `z.infer<typeof TaskInputSchema>`; the `tasks as TaskInput[]` cast is deleted.

### Test Strategy

- **Unit** (`tests/unit/http-routes.test.ts`, fakes only at seams): matcher exactness (nested path → no match; exact → match); invalid JSON → 400 nothing logged; schema failure → 400 + legacy messages; ids: non-UUID element / empty / 101 elements → 400; throwing route → 500 + fake logger records `logError` (RED first — today the log row is orphaned); fake quota gate `allowed: false` → 429 for ingest-note (CORE-10 proof). Field schemas: `"next Tuesday"` due_by, `"not-an-email"`, `parent_index: 1.5` rejected; valid ISO offset datetime accepted.
- **Integration** (existing suites + additions): legacy 400 cases keep passing byte-identical; new cases — `ids: ["not-a-uuid"]` → 400; mark twice → second message says 0 updated (count honesty, RED first against `ids.length`).
- **Mock audit:** unit fakes stand in for repositories/logger/gate only; dispatcher, schemas, matcher are the real code under test. E2E: HTTP integration tests hit the real edge function over HTTP — that is this repo's end-to-end layer.

## Risks / Trade-offs

- [Stricter schemas could reject payloads the desktop client sends] → the client sends UUID arrays ≤ pull-page size and ISO dates; caps chosen ≥ current page sizes; legacy messages preserved.
- [`z.string().datetime({ offset: true })` rejects date-only strings the LLM may emit] → the tool description already says ISO 8601; a clean 400 at the boundary beats a Postgres parse error deep in the stack (that is the finding). Message names the expected format.
- [Moving the table risks behavior drift] → the existing HTTP integration suite (auth, ingest, forget, pull API) pins the envelopes; run RED/GREEN around the move.

## User Error Scenarios

- Malformed JSON (client bug) → 400 "Invalid JSON body" (was 500).
- Hallucinated due date ("tomorrow") → 400 naming the expected ISO format at the boundary.
- Duplicate/over-large ids array → 400 with the cap; retried mark/reject → success with an honest 0 count (idempotent, no re-stamp — Step 15 behavior preserved).
- Typo'd nested route path → falls to MCP transport and errors there instead of silently "working".

## Security Analysis

Tightens the boundary (UUID allowlisting of ids, bounded arrays — kills the giant-`.in()`-URL failure; no new inputs or privileges). Error messages carry field names and formats, never stored content. Threat model unchanged — no new entries needed in `ThreatModel.md`; the SSRF/injection posture is improved, not altered.

## Migration Plan

Code-only. Deploy with the edge function; rollback = revert. No client coordination needed (messages/envelopes preserved for valid traffic).

## Open Questions

None.
