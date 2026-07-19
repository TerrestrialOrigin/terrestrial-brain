# ai-output-http-api — Delta (http-route-validation)

## ADDED Requirements

### Requirement: HTTP request bodies are schema-validated at the dispatcher

Every body-carrying direct HTTP route SHALL declare a Zod body schema that the shared dispatcher runs before the handler. Malformed JSON SHALL return HTTP 400 `{ success: false, error: "Invalid JSON body" }`. A schema violation SHALL return HTTP 400 with the failing field's message; the legacy messages `"content is required"`, `"note_id is required"`, and `"ids array is required"` are preserved for their missing-field cases. `ids` arrays SHALL require UUID elements, at least 1 element, and at most 100 elements. Handlers receive only validated, typed bodies — no casts on raw request JSON.

#### Scenario: Malformed JSON returns 400, not 500

- **WHEN** a client POSTs a body that is not valid JSON to a direct HTTP route
- **THEN** the response is HTTP 400 with error `"Invalid JSON body"`

#### Scenario: Non-UUID ids element is rejected

- **WHEN** a client POSTs `{ "ids": ["not-a-uuid"] }` to an ids route
- **THEN** the response is HTTP 400 and no repository call is made

#### Scenario: Oversized ids array is rejected

- **WHEN** a client POSTs more than 100 ids
- **THEN** the response is HTTP 400 naming the cap

#### Scenario: Legacy missing-field messages preserved

- **WHEN** a client POSTs to an ids route without an `ids` field (or a non-array value)
- **THEN** the response is HTTP 400 with error `"ids array is required"`

### Requirement: Thrown route handlers produce a logged 500

When a route handler throws after its call was logged, the dispatcher SHALL record the failure on the same log row via `logError` (populating `error_details`) before returning HTTP 500. Non-`Error` throws SHALL be stringified — the client never sees `"undefined"`. A `function_call_logs` row for a crashed call MUST NOT remain without error details.

#### Scenario: Handler throw is logged and mapped to 500

- **WHEN** a route handler throws an Error after `logCall` succeeded
- **THEN** the response is HTTP 500 with the error's message
- **AND** the call's log row records the message in `error_details`

### Requirement: Route matching is anchored to the function base path

The dispatcher SHALL match a direct HTTP route only when the request path is exactly `<function-base>/<route-name>` — the final segment equals the route name AND the preceding segment is the edge function's own base segment. Nested paths (extra segments between the base and the route name) SHALL fall through to the MCP transport instead of silently "working".

#### Scenario: Exact route path matches

- **WHEN** a client POSTs to `/functions/v1/terrestrial-brain-mcp/ingest-note`
- **THEN** the ingest-note route handles the request

#### Scenario: Nested bogus path does not match

- **WHEN** a client POSTs to `/functions/v1/terrestrial-brain-mcp/anything/deeper/ingest-note`
- **THEN** no direct route matches and the request falls through to the MCP transport

## MODIFIED Requirements

### Requirement: mark-ai-output-picked-up HTTP endpoint

The edge function SHALL expose a POST endpoint at `/mark-ai-output-picked-up` that sets `picked_up = true` and `picked_up_at = now()` for the specified rows that are not already picked up. The endpoint accepts `{ ids: string[] }` (UUID elements, 1–100) in the request body and requires auth. The success message and `records_returned` SHALL report the number of rows actually updated — a retried pickup reports 0, never the request's array length.

#### Scenario: Mark outputs as picked up

- **WHEN** a client sends POST to `/mark-ai-output-picked-up` with `{ ids: ["uuid1"] }` and valid auth
- **AND** that row is not yet picked up
- **THEN** the endpoint SHALL update the row
- **AND** return HTTP 200 with a message counting 1 updated output

#### Scenario: Retried pickup reports zero updates

- **WHEN** a client retries the same pickup request
- **THEN** the endpoint SHALL return HTTP 200 with a message counting 0 updated outputs
- **AND** `picked_up_at` is not re-stamped

#### Scenario: Missing ids in request body

- **WHEN** a client sends POST to `/mark-ai-output-picked-up` without an `ids` field
- **THEN** the endpoint SHALL return HTTP 400 with `{ success: false, error: "ids array is required" }`

### Requirement: reject-ai-output HTTP endpoint

The edge function SHALL expose a POST endpoint at `/reject-ai-output` that sets `rejected = true` and `rejected_at = now()` for the specified rows that are not already rejected. The endpoint accepts `{ ids: string[] }` (UUID elements, 1–100) in the request body and requires auth. The success message SHALL report the number of rows actually updated.

#### Scenario: Reject outputs

- **WHEN** a client sends POST to `/reject-ai-output` with `{ ids: ["uuid1"] }` and valid auth
- **AND** that row is not yet rejected
- **THEN** the endpoint SHALL update the row
- **AND** return HTTP 200 with a message counting 1 rejected output

#### Scenario: Missing ids in request body

- **WHEN** a client sends POST to `/reject-ai-output` without an `ids` field
- **THEN** the endpoint SHALL return HTTP 400 with `{ success: false, error: "ids array is required" }`
