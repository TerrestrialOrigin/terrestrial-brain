## Why

The MCP server is built from copy-paste, not abstraction (finding X1). The
success/error response envelope is hand-built ~60 times, every tool handler wraps
its body in an identical `try/catch` (~33 copies), and the six HTTP route blocks
in `index.ts` are near-verbatim duplicates. The `withMcpLogging` decorator erases
handler typing with `any[]` behind four `no-explicit-any` pragmas and does not
guard the handler with a `try/catch`, so a throwing handler would escape logging.
This duplication is the codebase's defining weakness and the single highest-leverage
place to remove it: centralizing the envelope and the wrapper shrinks every handler
and every future one.

## What Changes

- Add `textResult(text)` and `errorResult(text)` helpers that build the MCP
  response envelope in one place.
- Make `withMcpLogging` generic (`<Args extends unknown[]>`), removing the four
  `no-explicit-any` pragmas, and give it an outer `try/catch` so a throwing handler
  is logged and returned as a proper MCP error envelope instead of propagating.
- Delete the ~33 per-handler `try/catch` blocks and ~60 hand-built envelopes across
  `tools/*.ts`, replacing them with the helpers.
- Collapse the six copy-pasted HTTP route blocks in `index.ts` into one table-driven
  route helper (path → handler + validation), so the `ids`-array validation and the
  log/respond scaffolding exist exactly once.
- This is a **pure refactor: zero externally observable behavior change**. The
  existing integration suite is the safety net and must stay green without
  modification.

## Capabilities

### New Capabilities
- `mcp-response-envelope`: the contract for how MCP tool handlers produce response
  envelopes and how the logging decorator wraps them — including the guarantee that a
  thrown handler is caught, logged, and returned as an error result rather than
  propagating uncaught.

### Modified Capabilities
<!-- None. mcp-server, function-call-logging, and ai-output-http-api behavior is
     preserved unchanged; this change only relocates where that behavior is
     implemented, so no existing spec's requirements change. -->

## Non-goals

- No change to any tool's inputs, outputs, error messages, or status codes — the
  exact user-visible text (`Error: <message>`, `Failed to create project: …`, etc.)
  is preserved.
- No repository/data-access layer (that is Steps 16–17) and no AI-provider seam
  (Step 15) — this change touches only the response envelope, the logging wrapper,
  and the HTTP route scaffolding.
- No new tools, routes, or endpoints.

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/logger.ts` (generic wrapper +
  catch), a new small response-helpers module, all seven `tools/*.ts` handler files,
  and `index.ts` (route table). AI-output HTTP handler functions in
  `tools/ai_output.ts` are reused unchanged.
- **Tests:** existing integration tests must pass untouched; new unit tests cover
  `textResult`/`errorResult` and the `withMcpLogging` catch path.
- **Specs:** new `mcp-response-envelope` capability documenting the invariant.
