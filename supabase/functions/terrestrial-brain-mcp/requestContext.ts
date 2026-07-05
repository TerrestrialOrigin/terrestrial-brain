import { AsyncLocalStorage } from "node:async_hooks";

// ─── Per-request context ─────────────────────────────────────────────────────
// The MCP transport invokes tool handlers deep inside `handleRequest`, with no
// way to thread per-call data down through the SDK's signature. Previously the
// client IP was stashed in a module-level mutable global and read back when a
// tool fired — but a single edge isolate serves requests concurrently, so two
// overlapping requests raced on that one global and cross-attributed each
// other's IPs in `function_call_logs` (finding C8).
//
// `AsyncLocalStorage` (Node-compat, available in the Supabase edge runtime)
// binds the context to the request's async execution: each request runs its
// dispatch inside `runWithRequestContext`, and every `await` in that chain —
// including the SDK's internals — preserves the request's own store. Concurrent
// requests each get an independent store and can never observe one another's IP.

export interface RequestContext {
  ipAddress: string | null;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Run `callback` with `context` bound to the current async execution. Any code
 * awaited within `callback` (including MCP tool handlers) observes this same
 * context; a concurrent request running its own `runWithRequestContext` gets a
 * separate, isolated store.
 */
export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return requestContextStorage.run(context, callback);
}

/**
 * Return the client IP for the current request, or null when there is no active
 * request context or no IP was extracted from the request headers.
 */
export function getRequestIp(): string | null {
  return requestContextStorage.getStore()?.ipAddress ?? null;
}
