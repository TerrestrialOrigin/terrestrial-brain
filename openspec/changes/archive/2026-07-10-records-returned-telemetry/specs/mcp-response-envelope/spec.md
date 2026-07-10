## MODIFIED Requirements

### Requirement: Centralized response envelope helpers

The MCP server SHALL construct every tool response envelope through shared
`textResult(text)` and `errorResult(text)` helpers rather than hand-building the
`{ content: [{ type: "text", text }], isError? }` object at each call site. A
success envelope produced by `textResult` MUST have `content` set to a single text
entry and MUST NOT set `isError`. An error envelope produced by `errorResult` MUST
have `content` set to a single text entry and MUST set `isError: true`.

`textResult` MAY additionally accept an optional `meta` object carrying result
telemetry (`recordsReturned`, `returnedIds`) that a row-returning handler uses to report
its real returned-row count and returned ids to the logging decorator. When `meta` is
omitted the returned envelope MUST be byte-for-byte the bare `{ content: [...] }` shape.
The `meta` field is internal telemetry only: it MUST NOT appear in the response envelope
returned to the MCP client.

#### Scenario: Success envelope shape

- **WHEN** a tool handler returns `textResult("Created project \"X\" (id: 1)")`
- **THEN** the result is `{ content: [{ type: "text", text: "Created project \"X\" (id: 1)" }] }`
- **AND** `isError` is not set (falsy)
- **AND** no `meta` key is present

#### Scenario: Error envelope shape

- **WHEN** a tool handler returns `errorResult("Failed to create project: boom")`
- **THEN** the result is `{ content: [{ type: "text", text: "Failed to create project: boom" }], isError: true }`

#### Scenario: Meta is carried on the result but not sent to the client

- **WHEN** a handler returns `textResult("Found 3 thought(s): …", { recordsReturned: 3, returnedIds: ["a", "b", "c"] })`
- **THEN** the value the handler returns carries `meta` for the decorator to read
- **AND** the envelope the decorator returns to the MCP client has no `meta` key

#### Scenario: No hand-built envelopes remain in tools

- **WHEN** the `tools/` directory is searched for inline `isError: true` envelope construction
- **THEN** none is found — all error envelopes flow through `errorResult`

### Requirement: Logging decorator catches, logs, and returns thrown handler errors

`withMcpLogging` SHALL wrap the handler invocation in a `try/catch`. When the wrapped
handler throws, the decorator MUST NOT let the error propagate uncaught; instead it
MUST return an error envelope whose text is `Error: <message>` (preserving the exact
text the per-handler catch blocks previously produced) and MUST record that error
through the function-call logger with `records_returned = 0`. When the handler succeeds,
the decorator MUST log the handler-reported returned-row count — taken from the result's
`meta.recordsReturned` when present, otherwise the single-record fallback — and, for
thought-retrieval calls, the handler-reported `returnedIds`. The decorator MUST strip the
`meta` field from the result before returning it to the caller. The decorator SHALL be
generically typed over the handler's argument tuple so that no `no-explicit-any`
suppression is required.

#### Scenario: Thrown handler error becomes a logged error result

- **WHEN** a handler wrapped by `withMcpLogging` throws `new Error("db down")`
- **THEN** the decorator returns `{ content: [{ type: "text", text: "Error: db down" }], isError: true }`
- **AND** the failure is recorded via the logger with `records_returned = 0`

#### Scenario: Successful handler result is passed through and logged with its real count

- **WHEN** a wrapped handler returns `textResult("…", { recordsReturned: 3, returnedIds: ["a", "b", "c"] })`
- **THEN** the decorator returns the text envelope with the `meta` field stripped
- **AND** logs `records_returned = 3` and `returned_ids = ["a", "b", "c"]`

#### Scenario: Un-instrumented success falls back to one record

- **WHEN** a wrapped handler returns a bare `textResult("done")` with no `meta`
- **THEN** the decorator returns that exact envelope unchanged
- **AND** logs `records_returned = 1`

#### Scenario: Decorator carries no explicit-any suppressions

- **WHEN** `logger.ts` is inspected
- **THEN** `withMcpLogging` uses a generic argument tuple and contains no `deno-lint-ignore no-explicit-any` pragmas
