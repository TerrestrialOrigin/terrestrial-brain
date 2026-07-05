## ADDED Requirements

### Requirement: Centralized response envelope helpers

The MCP server SHALL construct every tool response envelope through shared
`textResult(text)` and `errorResult(text)` helpers rather than hand-building the
`{ content: [{ type: "text", text }], isError? }` object at each call site. A
success envelope produced by `textResult` MUST have `content` set to a single text
entry and MUST NOT set `isError`. An error envelope produced by `errorResult` MUST
have `content` set to a single text entry and MUST set `isError: true`.

#### Scenario: Success envelope shape

- **WHEN** a tool handler returns `textResult("Created project \"X\" (id: 1)")`
- **THEN** the result is `{ content: [{ type: "text", text: "Created project \"X\" (id: 1)" }] }`
- **AND** `isError` is not set (falsy)

#### Scenario: Error envelope shape

- **WHEN** a tool handler returns `errorResult("Failed to create project: boom")`
- **THEN** the result is `{ content: [{ type: "text", text: "Failed to create project: boom" }], isError: true }`

#### Scenario: No hand-built envelopes remain in tools

- **WHEN** the `tools/` directory is searched for inline `isError: true` envelope construction
- **THEN** none is found — all error envelopes flow through `errorResult`

### Requirement: Logging decorator catches, logs, and returns thrown handler errors

`withMcpLogging` SHALL wrap the handler invocation in a `try/catch`. When the wrapped
handler throws, the decorator MUST NOT let the error propagate uncaught; instead it
MUST return an error envelope whose text is `Error: <message>` (preserving the exact
text the per-handler catch blocks previously produced) and MUST record that error
through the function-call logger. The decorator SHALL be generically typed over the
handler's argument tuple so that no `no-explicit-any` suppression is required.

#### Scenario: Thrown handler error becomes a logged error result

- **WHEN** a handler wrapped by `withMcpLogging` throws `new Error("db down")`
- **THEN** the decorator returns `{ content: [{ type: "text", text: "Error: db down" }], isError: true }`
- **AND** the failure is recorded via the logger's result/error logging (not swallowed)

#### Scenario: Successful handler result is passed through and logged

- **WHEN** a wrapped handler returns a normal `textResult(...)`
- **THEN** the decorator returns that exact result unchanged
- **AND** logs the record count and response character length as before

#### Scenario: Decorator carries no explicit-any suppressions

- **WHEN** `logger.ts` is inspected
- **THEN** `withMcpLogging` uses a generic argument tuple and contains no `deno-lint-ignore no-explicit-any` pragmas

### Requirement: Table-driven HTTP route dispatch

The direct HTTP routes (`/ingest-note` and the AI-output routes) SHALL be dispatched
through a single table-driven helper that centralizes access-key auth, call logging,
`ids`-array validation, result/error logging, and JSON response construction, so the
per-route scaffolding exists exactly once. Each route's observable behavior — path,
method, request validation, success payload, error payload, and HTTP status codes —
MUST be identical to the previous hand-written blocks.

#### Scenario: AI-output route with missing ids array

- **WHEN** a POST to `/fetch-ai-output-content` omits the `ids` array
- **THEN** the response is HTTP 400 with body `{ success: false, error: "ids array is required" }`

#### Scenario: AI-output data route success

- **WHEN** a POST to `/get-pending-ai-output` succeeds
- **THEN** the response is HTTP 200 with body `{ success: true, data: [...] }`
- **AND** the call and its record count are logged

#### Scenario: ingest-note missing content

- **WHEN** a POST to `/ingest-note` omits `content`
- **THEN** the response is HTTP 400 with body `{ success: false, error: "content is required" }`
