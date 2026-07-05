# Design — MCP response envelope & logging decorator refactor

## Context

`supabase/functions/terrestrial-brain-mcp/` exposes ~30 MCP tools plus six direct
HTTP routes. Today each tool handler hand-builds its response envelope
(`{ content: [{ type: "text" as const, text }], isError? }`) at every return point
(~60 sites) and wraps its body in an identical `try { … } catch (err) { return { …
Error: <msg>, isError: true } }` (~33 sites). `withMcpLogging` (`logger.ts`) wraps
each handler for fire-and-forget logging but is typed with `any[]` behind four
`no-explicit-any` pragmas and does **not** catch handler throws. `index.ts` contains
six near-identical HTTP route blocks (`/ingest-note` + five AI-output routes), each
repeating: parse body → validate → `logger.logCall` → run handler → check `error` →
`logger.logResult` → build `c.json(...)`.

This is finding X1 (copy-paste over abstraction) and the X3/6.x sub-findings about
`withMcpLogging`'s erased typing and missing catch. It is a **pure refactor**: the
existing integration suite (HTTP → edge function → Postgres, zero mocks on the tested
path) is the safety net and must stay green **without modification**.

## Goals / Non-Goals

**Goals**
- One home for the success/error envelope (`textResult` / `errorResult`).
- `withMcpLogging` generic + owns the outer `try/catch`; delete per-handler catches.
- One table-driven HTTP route helper; delete the six duplicated blocks.
- Zero externally observable behavior change.

**Non-goals**
- No repository layer (Steps 16–17), no `AiProvider` seam (Step 15).
- No new tools/routes; no change to any message text, payload, or status code.

## Decisions

### D1 — Where the helpers live
New module `mcp-response.ts` exports the `McpToolResult` type, `textResult(text)`,
and `errorResult(text)`. `logger.ts` imports `McpToolResult` from it (moving the type
out of `logger.ts`) so there is no circular dependency: `mcp-response.ts` has no
imports; `logger.ts` and every `tools/*.ts` import from it.

```ts
// mcp-response.ts
export interface McpToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}
export const textResult = (text: string): McpToolResult => ({
  content: [{ type: "text", text }],
});
export const errorResult = (text: string): McpToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});
```

The literal `type: "text" as const` at call sites collapses to `type: "text"` inside
the helper (the helper's return type pins it), so handlers stop needing `as const`.

### D2 — Generic, catch-owning `withMcpLogging`
Signature becomes `withMcpLogging<Args extends unknown[]>(toolName, handler: (...args:
Args) => Promise<McpToolResult>, logger): (...args: Args) => Promise<McpToolResult>`.
Because a function that accepts fewer parameters is assignable where more are
expected (parameter bivariance/contravariance), the MCP SDK's `registerTool` callback
type still accepts the returned function — verified by `deno check`. This removes all
four `no-explicit-any` pragmas.

The wrapper wraps `handler(...args)` in `try/catch`. On throw it produces
`errorResult(\`Error: ${(err as Error).message}\`)` — **exactly** the text the deleted
per-handler catch blocks produced — and falls through to the same logging path, so the
throw is logged (record count 1, the error text) rather than swallowed or propagated.

Trade-off: a handful of handlers currently `throw new Error("Archive tasks failed: …")`
and rely on their own catch to convert it to `Error: Archive tasks failed: …`. With the
catch centralized, the same conversion happens in the wrapper, so the user-visible text
is unchanged. Handlers keep their explicit `if (error) return errorResult(<custom>)`
branches (e.g. `Failed to create project: …`) — only the outer catch-all is removed.

### D3 — Table-driven HTTP routes
A single `HttpRoute` descriptor table drives dispatch. Each descriptor declares the
path suffix, log name, whether it parses a JSON body, an optional `validate(body) →
errorMessage | null`, and a `run(supabase, body) → RouteOutcome`. `RouteOutcome` is a
normalized `{ ok: true; data?; message?; recordCount? } | { ok: false; error; status? }`.
One `dispatchHttpRoute` helper does: log call → validate (400 on failure) → run → on
`ok:false` log+respond error with its status → on `ok:true` log record count/chars and
respond `{ success: true, data|message }`. The five AI-output handlers and
`handleIngestNote` are reused unchanged; only their surrounding scaffolding is unified.

The response shape is selected by which field the outcome carries: `data` → `{ success,
data }` with record count = `Array.isArray(data) ? data.length : 1` and chars =
`JSON.stringify(data).length`; `message` → `{ success, message }` with record count =
the validated `ids.length` (or 1 for ingest-note) and chars = `message.length`. This
reproduces each old block's logging metrics exactly.

### D4 — Auth / CORS untouched
The per-request access-key check, `extractIpAddress`, the MCP transport branch, and the
`runWithRequestContext` wrapper (from Step 11) are unchanged. The route table sits
between the auth check and the MCP fallthrough, exactly where the six blocks are today.

## User Error Scenarios

Behavior is preserved, so the existing user-error handling is preserved verbatim:
- **Missing `content` on `/ingest-note`** → HTTP 400 `{ success:false, error:"content is required" }` (validation runs before the handler).
- **Missing/!array `ids` on the four id-taking routes** → HTTP 400 `{ success:false, error:"ids array is required" }`.
- **Malformed JSON body** → the body parse throws; `dispatchHttpRoute` returns the same 500 `{ success:false, error:<msg> }` the old per-block `catch` produced.
- **Handler throws mid-tool (e.g. DB down)** → now caught centrally, returned as `isError` MCP result `Error: <msg>` and logged, instead of potentially propagating.

## Security Analysis

- No change to the auth boundary: the single-secret `x-brain-key`/`?key=` constant-time
  check (Step 3) still gates every route before the table is consulted.
- No new data leaves the system; error text is identical to today's (already reviewed —
  it surfaces DB/`Error:` messages, not secrets). Centralizing the catch does not widen
  what is exposed; it narrows the chance of an unhandled throw leaking a stack trace to
  the MCP transport.
- `ThreatModel.md`: no new attack surface (no new routes, no new inputs, no new
  external calls). Table-driven dispatch is exact-suffix matched exactly as before, so
  no new path-confusion risk. No threat-model update required beyond noting the
  unchanged surface.

## Test Strategy

| Layer | What it covers | Why |
|---|---|---|
| **Integration (existing, unmodified)** | Every tool + HTTP route end-to-end (HTTP → edge fn → Postgres). This is the primary safety net for the refactor: identical inputs must yield identical outputs. | A pure refactor's proof is that the black-box suite stays green untouched. If a test needs editing, that is a red flag to investigate, not a green light. |
| **Unit (new)** `tests/unit/mcp-response.test.ts` | `textResult`/`errorResult` produce the exact envelope shapes; `withMcpLogging` returns the handler result on success, and on throw returns `errorResult("Error: <msg>")` while calling the logger (fake `FunctionCallLogger`). | GATE 2b: deleting the wrapper's catch or a helper's `isError` must redden a test. These exercise the new central code paths a black-box tool call cannot isolate. |

The unit test injects a fake `FunctionCallLogger` (the existing interface — already a
seam), so it needs no DB and no LLM. Acceptance grep: no inline `isError: true` remains
under `tools/`; no `no-explicit-any` pragma remains in `logger.ts`.

## Note on "no test modifications"

The integration suite passes untouched. One **type-only** change to a pre-existing
*unit* test (`tests/unit/request_context.test.ts`) was required and is expected, not
a red flag: making `withMcpLogging` generic (`<Args extends unknown[]>`, the signature
the fix-plan explicitly specified) infers the wrapped function's argument tuple from
the handler. That test wrapped a zero-arg handler (`() => …`) and then called the
wrapped function with the tool input — legal under the old `any[]` signature, but under
the generic the handler must *declare* the args it implicitly receives. The two handler
lambdas gained a `(_args: Record<string, unknown>)` parameter; **no assertion, input,
or runtime behavior changed** — the test still verifies per-request IP isolation exactly
as before. This is the same benign consequence that a stricter, pragma-free signature
necessarily produces; it does not mask a regression.

## Risks

- **SDK callback typing** rejecting the generic wrapper → mitigated by `deno check`
  before running tests; fall back to a single well-justified assertion at the
  registration boundary only if the SDK's type is invariant (it is not, per D2).
- **A missed catch-to-wrapper text divergence** (a handler whose catch produced text
  other than `Error: <msg>`) → mitigated by grepping every `catch (err` block before
  deleting and confirming each produced `Error: ${...message}`; any exception is kept
  as an explicit `try/catch` in that handler.
