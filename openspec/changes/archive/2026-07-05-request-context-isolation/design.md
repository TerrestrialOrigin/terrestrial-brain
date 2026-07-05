## Context

The MCP edge function logs every tool/HTTP call to `function_call_logs`, including the client IP. HTTP sub-routes (`/ingest-note`, `/get-pending-ai-output`, …) thread the extracted `ipAddress` explicitly into `logger.logCall(...)`, so they are correct. The MCP path is different: the SDK's tool handlers are invoked deep inside `transport.handleRequest(c)`, with no way to pass per-call context down. To bridge that gap, `index.ts` writes the IP into a **module-level global** (`setCurrentRequestIp`), and `withMcpLogging` reads it back (`getCurrentRequestIp`) when a tool fires.

A Deno isolate serves requests concurrently. Between `setCurrentRequestIp(A)` and A's handler reading the global, request B can run `setCurrentRequestIp(B)` — so A's log row gets B's IP. This is finding C8. The same code path also `connect()`s one shared, module-level `McpServer` on every request, which the MCP SDK explicitly warns against for stateless HTTP transports (each request should get its own server+transport).

Constraints:
- Supabase edge runtime is Deno with Node compatibility; `AsyncLocalStorage` is available via `node:async_hooks`.
- HTTP sub-routes must keep working unchanged (they don't use the global).
- Pure correctness/refactor: no change to the log schema or to any tool's output. The existing integration suite is the safety net and must stay green.

## Goals / Non-Goals

**Goals:**
- The request IP is carried in per-request context so concurrent requests can never cross-attribute it.
- Remove the module-level mutable IP global entirely (no `setCurrentRequestIp`/`getCurrentRequestIp`).
- Construct MCP server + transport per request via a factory; tool registration happens inside it.
- A failing-first integration test that reproduces the cross-attribution and passes after the fix.

**Non-Goals:**
- Changing IP-extraction header priority or the log schema.
- Touching HTTP sub-route handlers (already correct).
- Any change to tool behavior or MCP wire responses.

## Decisions

### Decision 1: `AsyncLocalStorage` for the request IP (over explicit plumbing)
Introduce a `requestContext.ts` exposing an `AsyncLocalStorage<{ ipAddress: string | null }>` with a `runWithRequestContext(ctx, fn)` wrapper and a `getRequestIp()` reader. `index.ts` runs the MCP dispatch inside `runWithRequestContext({ ipAddress }, () => …)`; `withMcpLogging` calls `getRequestIp()`.

- **Why over explicit plumbing (Hono context → logger):** the IP has to reach a handler the MCP SDK invokes; we cannot pass it through the SDK's call signature without forking the SDK. `AsyncLocalStorage` propagates automatically across the `await`s inside `handleRequest`, and every concurrent request gets its own store — which is exactly the isolation the bug needs. Explicit plumbing would require the SDK to hand our context to the tool callback, which it does not.
- **Why `AsyncLocalStorage` is safe here:** it is Node-compat-supported in the Deno edge runtime; each `.run()` establishes an independent async context that concurrent requests cannot observe.

### Decision 2: Per-request MCP server + transport factory
Move the seven `register*(server, supabase, logger)` calls into a `createMcpServer(supabase, logger)` factory. Per MCP request: `const server = createMcpServer(...); const transport = new StreamableHTTPTransport(); await server.connect(transport); return transport.handleRequest(c);`

- **Why:** the MCP SDK's stateless-HTTP guidance is one server+transport per request; sharing a single `connect()`ed server across concurrent requests risks transport-state races. Constructing per request removes the last shared mutable in the MCP path.
- **Trade-off:** small per-request allocation cost (building the server + registering tools). Acceptable — registration is in-memory object wiring, dwarfed by DB/LLM round-trips. `supabase` and `logger` remain shared singletons (stateless clients), so no per-request DB reconnect.
- **Alternative considered:** keep the shared server, only fix the IP global. Rejected — the step explicitly calls for the stateless pattern and the shared server is a latent concurrency hazard; verifying the shared instance is safe would require guarantees the SDK docs decline to give.

### Decision 3: Reproduce the race deterministically at the module level (evidence-based revision)
The reproduction was first attempted as an integration test firing many concurrent MCP requests with distinct `x-forwarded-for` values and asserting each `function_call_logs` row carries its own IP. **Measured behavior of the local Supabase edge runtime made that infeasible as a failing-first test:** it caps concurrency at ~4 in-flight requests, intermittently hangs requests for seconds under load, and — critically — the set→read critical section (`setCurrentRequestIp` → `await server.connect()` → handler reads the IP) does not yield at a point where a competing request's IP-set interleaves, so even 2–3 genuinely-concurrent requests never cross-attributed locally. A test that cannot fail on the buggy code is theater, not a reproduction.

The faithful, deterministic reproduction exercises the **real** `withMcpLogging` wrapper and the **real** request-context helper together, faking only the DB logger (the legitimate unit mock boundary — the bug is not in the DB write):
- Two request scopes run concurrently under `runWithRequestContext({ ipAddress }, fn)`.
- Each `fn` performs an `await` (a resolved-timer tick) **between** context establishment and the handler's IP read — mirroring the real `await server.connect()` that sits between `setCurrentRequestIp` and the tool handler reading the IP.
- The faked logger records `(marker → ipAddress)` for each call; the test asserts each marker maps to its own request's IP.

With a **module-global** backing, the `await` yields and the second scope's set overwrites the first before it reads → cross-attribution → **test fails** (reproduces C8). With **`AsyncLocalStorage`**, each scope's IP survives the `await` → **test passes**. This is deterministic, faithful to the exact mechanism of the bug (shared module mutable vs per-request async context), and satisfies GATE 2b: reverting `requestContext` to a global reddens it.

### Test Strategy
- **Unit (primary reproduction):** `tests/unit/request_context.test.ts` — the deterministic interleaving test above, exercising real `withMcpLogging` + real `runWithRequestContext`/`getRequestIp` with a fake DB logger. Failing-first against a global-backed context, green against the `AsyncLocalStorage` implementation.
- **Integration (refactor regression guard):** `tests/integration/request_context.test.ts` — a single MCP request with an `x-forwarded-for` header asserts its `function_call_logs` row records that IP, proving the per-request server/transport factory did not break end-to-end IP logging. (Reliable and fast; does not attempt to force the concurrency race the runtime can't sustain locally.)
- **Integration (full suite):** the entire existing suite must stay green untouched, proving the per-request factory didn't change tool behavior or single-request logging.

### User error scenarios
- Missing/duplicate/malformed IP headers: unchanged — still handled by the existing `extractIpAddress` priority logic; a request with no IP header logs `ip_address = null` exactly as today.
- Concurrent identical requests (same IP): still each log their own (identical) IP — correctness is unaffected.

### Security analysis
- **Threat: audit-log integrity / IP misattribution (the bug itself).** Cross-attributed IPs corrupt the security audit trail — an action could be blamed on the wrong client. The fix restores per-request accuracy. No new attack surface is introduced; `AsyncLocalStorage` is in-process only.
- **No secrets, auth, or external I/O change.** Auth (`x-brain-key`) runs before context is established and is untouched. No new dependency, no new network path.
- ThreatModel note: this change strictly *reduces* a data-integrity weakness; there is no new threat to model.

## Risks / Trade-offs

- **[`AsyncLocalStorage` context lost across an un-awaited boundary]** → All logging happens inside the awaited `handleRequest` chain; we introduce no detached timers/`queueMicrotask` between `.run()` and the logger read. Verified by the passing concurrent test.
- **[Per-request server construction regresses behavior]** → Guarded by keeping the entire existing integration suite green with zero test edits; any needed edit is a red flag to investigate.
- **[Edge runtime lacks `node:async_hooks`]** → It does not: the Supabase edge runtime supports it; the integration test running on the real stack is the proof. If it were unavailable, the test would fail at import and we'd fall back to explicit context threading — but that is not expected.

## Migration Plan

- Code-only change; no DB migration (log schema unchanged).
- Deploy the updated edge function. Rollback = redeploy the previous function bundle. No data backfill, no state to migrate.

## Open Questions

- None. Approach and boundaries are settled by the decisions above.
