## Why

The client IP recorded in `function_call_logs` is stored in a module-level mutable global (`currentRequestIpAddress` in `logger.ts`) that `index.ts` sets before dispatching each request to the MCP transport. A single Deno isolate serves many requests concurrently, so two overlapping requests race on that one global — request B overwrites the IP after request A set it but before A's tool handler reads it, cross-attributing A's log rows to B's IP (finding C8). The same isolate also `connect()`s one shared `McpServer` instance per request, contrary to the MCP SDK's stateless-transport guidance, compounding the shared-mutable-state risk.

## What Changes

- Replace the module-level `currentRequestIpAddress` global and its `setCurrentRequestIp`/`getCurrentRequestIp` accessors with a per-request context carried through `AsyncLocalStorage` (available in the Supabase edge runtime via `node:async_hooks`), so each request's IP is isolated to that request's async execution and can never be observed by a concurrent request.
- Follow the MCP SDK stateless pattern: build a fresh `McpServer` + `StreamableHTTPTransport` per request inside a factory (tool registration moves into that factory) instead of `connect()`ing one shared, module-level server on every request.
- No change to what is logged or to any tool's behavior — only *where* the request-scoped IP lives and *how* the server/transport is instantiated.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `function-call-logging`: add a requirement that client-IP attribution is isolated per request so concurrent requests in one isolate cannot cross-attribute IPs. (`openspec/specs/function-call-logging/spec.md`)

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/logger.ts` (remove IP global + accessors; `withMcpLogging` reads IP from per-request context), `supabase/functions/terrestrial-brain-mcp/index.ts` (per-request server/transport factory; run the request under `AsyncLocalStorage`).
- **Tests:** new integration test issuing two concurrent MCP requests with distinct `x-forwarded-for` values and asserting each request's `function_call_logs` rows carry its own IP (fails against the current global; passes after the fix).
- **Dependencies:** none added (`node:async_hooks` is part of the runtime).
- **Behavior/API:** none externally visible; logging output and MCP responses are unchanged.

## Non-goals

- Changing the IP-extraction header priority or the log schema (owned by existing `function-call-logging` requirements).
- Reworking HTTP sub-route handlers, which already thread `ipAddress` explicitly and are not affected by the global.
- Broader logging or observability changes beyond correct per-request IP attribution.
