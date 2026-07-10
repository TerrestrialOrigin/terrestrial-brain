## Why

`function_call_logs.records_returned` is meant to record how many database rows a tool
call returned, but `withMcpLogging` sets it to `result.content.length` — the number of
MCP content blocks, which is **always 1** for text results (and 1 even on errors). The
column therefore carries no signal: a `search_thoughts` call that returned 12 thoughts and
one that returned 0 both log `1`. The New-Feature-Plan Step 4 memory-mechanism audit
depends on this column to measure retrieval volume, and Step 7's `last_retrieved_at` decay
signal needs to know *which* thoughts were returned — neither is possible today. Confirmed
broken in current `develop` code and in production (`codeEval/Fable20260710-UsefulnessAudit.md`
finding 1).

## What Changes

- Add a `meta` seam to the MCP response envelope: row-returning handlers attach
  `{ recordsReturned, returnedIds? }` to their result. The envelope helpers carry it, and the
  logging decorator reads it — the decorator cannot know the row count on its own.
- `withMcpLogging` computes `records_returned` from the handler-reported count instead of the
  content-block count, and **forces `records_returned = 0` on the error path** (thrown or
  `isError`), where today it wrongly logs 1.
- Row-returning handlers report their real count: thought search/list/get, task/people/project/
  document list and get. Empty results report `0` (not the fallback 1).
- **Log the returned thought ids** for `search_thoughts` / `list_thoughts` / `get_thought_by_id`
  in a new nullable `function_call_logs.returned_ids` column (ids only, bounded by the query
  limit, no content — GDPR-minimal). This is the precursor to Step 7's `last_retrieved_at`
  retrieval signal.
- The `meta` field is stripped from the result before it is returned to the MCP client, so it
  never leaks into the JSON-RPC protocol payload.
- Correct the `function-call-logging` spec's table requirement, which omits the already-shipped
  `records_returned` / `response_characters` columns, and document the new `returned_ids` column.

No **BREAKING** changes: the seam is additive, handlers without `meta` keep working (they fall
back to the content-block count of 1, which is correct for single-record responses), and the
new column is nullable.

## Capabilities

### New Capabilities
<!-- none — this corrects existing logging behavior -->

### Modified Capabilities
- `function-call-logging` (`openspec/specs/function-call-logging/spec.md`): the `function_call_logs`
  table requirement gains the `records_returned`, `response_characters`, and new `returned_ids`
  columns; a new requirement mandates that result metrics reflect the true returned-row count and
  that thought-retrieval calls log their returned ids.
- `mcp-response-envelope` (`openspec/specs/mcp-response-envelope/spec.md`): `textResult` may carry
  an optional `meta` that MUST NOT alter the client-facing envelope; the decorator logs the
  handler-reported record count (0 on error), superseding the "logs the record count ... as before"
  content-block behavior.

## Non-goals

- Implementing `last_retrieved_at` / retrieval-count decay or any usefulness-scoring change — that
  is Step 7. This change only makes the *raw telemetry* (row counts + returned ids) correct so the
  audit and later decay work have real data.
- Instrumenting mutation tools (create/update/archive/capture) with a row count — they legitimately
  fall back to 1 (the single affected record). Only row-*returning* reads are in scope.
- Backfilling historical `records_returned` values — pre-fix rows stay as-is; the clean-signal epoch
  starts at deploy.
- Any change to `response_characters` (already correct) or to the `input` truncation behavior.

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/mcp-response.ts` (envelope + `meta` type),
  `logger.ts` (`withMcpLogging`, `FunctionCallLogger.logResult`, `createFunctionCallLogger`),
  and the row-returning handlers in `tools/thoughts.ts`, `tools/tasks.ts`, `tools/people.ts`,
  `tools/projects.ts`, `tools/documents.ts`.
- **Database:** append-only migration adding nullable `returned_ids jsonb` to `function_call_logs`;
  `database.types.ts` regenerated.
- **Tests:** new unit test for the decorator's meta-driven count + error-path 0; new integration
  test asserting real `records_returned` / `returned_ids` rows against the local stack.
- **Downstream:** unblocks Step 4 audit's retrieval-volume queries and Step 7's retrieval signal.
- **Consumers:** none externally — `function_call_logs` is service-role-only telemetry; the MCP
  client payload is unchanged (meta stripped).
