# Tasks — MCP response envelope & logging decorator refactor

## 1. Response envelope helpers

- [x] 1.1 Create `supabase/functions/terrestrial-brain-mcp/mcp-response.ts` exporting `McpToolResult` (moved from `logger.ts`), `textResult(text)`, and `errorResult(text)`.
- [x] 1.2 Write failing-first unit test `tests/unit/mcp-response.test.ts` asserting the exact envelope shapes of `textResult`/`errorResult` (success has no `isError`; error has `isError: true`).

## 2. Generic, catch-owning logging decorator

- [x] 2.1 Update `logger.ts` to import `McpToolResult` from `mcp-response.ts`; make `withMcpLogging<Args extends unknown[]>` generic and remove all four `no-explicit-any` pragmas.
- [x] 2.2 Wrap the handler call in `try/catch`; on throw return `errorResult("Error: <message>")` and route it through the existing result/error logging path.
- [x] 2.3 Extend `tests/unit/mcp-response.test.ts` (failing-first) to assert: wrapped handler success passes through unchanged and is logged; a throwing handler yields `errorResult("Error: <msg>")` and calls the (fake) logger — confirm deleting the catch reddens it (GATE 2b).

## 3. Replace envelopes & catches across tools

- [x] 3.1 `tools/projects.ts`: replace every `{ content: [...], isError? }` with `textResult`/`errorResult`; delete the 5 outer handler `try/catch` blocks (wrapper now owns them).
- [x] 3.2 `tools/tasks.ts`: same (5 catches).
- [x] 3.3 `tools/people.ts`: same (5 catches).
- [x] 3.4 `tools/documents.ts`: same (4 catches).
- [x] 3.5 `tools/queries.ts`: same (3 catches).
- [x] 3.6 `tools/ai_output.ts`: same for the wrapped tool handlers; preserve the un-wrapped HTTP handler functions (`handleGetPendingAIOutput`, etc.) unchanged.
- [x] 3.7 `tools/thoughts.ts`: replace envelopes and delete the 8 wrapped-handler catches; **preserve** `handleIngestNote`'s own error handling (it is not `withMcpLogging`-wrapped).
- [x] 3.8 Grep-verify: no inline `isError: true` and no `type: "text" as const` remain under `tools/` (except inside `mcp-response.ts` if colocated — it is not).

## 4. Table-driven HTTP routes

- [x] 4.1 In `index.ts`, add an `HttpRoute` descriptor table + `dispatchHttpRoute` helper encapsulating call-logging, `ids`/`content` validation, result/error logging, and JSON response construction.
- [x] 4.2 Replace the six hand-written route blocks (`/ingest-note` + five AI-output routes) with table lookups reusing the existing handler functions; keep the auth check, `extractIpAddress`, and MCP fallthrough exactly as-is.
- [x] 4.3 Confirm each route's method, validation, success/error payload, and status codes are byte-identical to before (compare against git diff of the deleted blocks).

## 5. Testing & Verification

- [x] 5.1 `deno check` the function entrypoint(s) — confirm zero type errors and that the generic wrapper is accepted by the SDK's `registerTool` (no assertions needed).
- [x] 5.2 `deno lint` the function directory — confirm no lint errors and no remaining `no-explicit-any` suppressions in `logger.ts`.
- [x] 5.3 Run `deno task test:unit` — new `mcp-response.test.ts` green.
- [x] 5.4 Run `deno task test:integration` against the running Supabase stack (with `OPENROUTER_API_KEY` sourced) — **all green; integration tests untouched**. One type-only annotation to a pre-existing *unit* test (`request_context.test.ts`: two zero-arg handler lambdas gained `(_args: Record<string, unknown>)`) is required by the now-generic `withMcpLogging` signature the fix-plan specified — no assertion/behavior change (documented in design.md "Note on no test modifications").
- [x] 5.5 Run `cd obsidian-plugin && npm test && npm run build` — unaffected, confirm still green.
- [x] 5.6 Acceptance greps: `grep -rn 'isError: true' tools/` returns nothing; `grep -rn 'no-explicit-any' logger.ts` returns nothing.
- [x] 5.7 `/opsx:verify`, mark Step 14 complete in `codeEval/Fable20260704-fix-plan.md`, `/opsx:archive`, commit, PR to `develop`.
