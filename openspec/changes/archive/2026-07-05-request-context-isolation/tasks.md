## 1. Replicate the bug (failing test first)

- [x] 1.1 Add deterministic unit test `tests/unit/request_context.test.ts` that runs two request scopes concurrently under `runWithRequestContext`, each awaiting a tick between context-set and the real `withMcpLogging` IP read (fake DB logger), and asserts each scope logs its own IP — mirrors the real `await server.connect()` window
- [x] 1.2 Confirm the test FAILS against a module-global-backed context (reproduces C8 cross-attribution), demonstrating red-first before the AsyncLocalStorage fix
- [x] 1.3 Add integration guard `tests/integration/request_context.test.ts`: a single MCP request with `x-forwarded-for` asserts its `function_call_logs` row records that IP (guards the per-request factory refactor; the local runtime cannot sustain the concurrency race — see design.md Decision 3)

## 2. Per-request context

- [x] 2.1 Add `requestContext.ts` exposing an `AsyncLocalStorage<{ ipAddress: string | null }>` with `runWithRequestContext(ctx, fn)` and `getRequestIp()`
- [x] 2.2 In `logger.ts`, remove `currentRequestIpAddress`, `setCurrentRequestIp`, and `getCurrentRequestIp`; make `withMcpLogging` read the IP via `getRequestIp()`
- [x] 2.3 In `index.ts`, remove the `setCurrentRequestIp` import/call and run the MCP dispatch inside `runWithRequestContext({ ipAddress }, ...)`

## 3. Per-request MCP server/transport

- [x] 3.1 Extract the seven `register*` calls into a `createMcpServer(supabase, logger)` factory (in `index.ts` or a small `mcpServer.ts`)
- [x] 3.2 In the MCP branch of the request handler, construct a fresh server + `StreamableHTTPTransport` per request, `connect()`, and `handleRequest` — remove the shared module-level `server` instance

## 4. Verification

- [x] 4.1 Run `tests/integration/request_context.test.ts` and confirm it now PASSES (fix confirmed; GATE 2b — reverting the fix reddens it)
- [x] 4.2 Run the full Deno suite `deno test --allow-net --allow-env tests/` — zero failures, zero skips, no edits to existing tests
- [x] 4.3 Run `cd obsidian-plugin && npm test && npm run build` — green (no plugin change expected, confirm no regression)
- [x] 4.4 Grep the function source for `setCurrentRequestIp`/`getCurrentRequestIp`/`currentRequestIpAddress` and confirm zero remaining references
