## ADDED Requirements

### Requirement: get-pending-ai-output HTTP endpoint

The edge function SHALL expose a POST endpoint at `/get-pending-ai-output` that returns all `ai_output` rows where `picked_up = false` AND `rejected = false`, as a JSON response including full content. The endpoint requires `x-brain-key` header or `?key=` query param authentication.

#### Scenario: Pending output exists
- **WHEN** a client sends POST to `/get-pending-ai-output` with valid auth
- **AND** unpicked, non-rejected rows exist in `ai_output`
- **THEN** the endpoint SHALL return HTTP 200 with `{ success: true, data: [...] }`
- **AND** each item in `data` SHALL contain `id`, `title`, `content`, `file_path`, `created_at`
- **AND** the results SHALL be ordered by `created_at` ascending

#### Scenario: No pending output
- **WHEN** a client sends POST to `/get-pending-ai-output` with valid auth
- **AND** no unpicked, non-rejected rows exist
- **THEN** the endpoint SHALL return HTTP 200 with `{ success: true, data: [] }`

#### Scenario: Database error
- **WHEN** a client sends POST to `/get-pending-ai-output` with valid auth
- **AND** the database query fails
- **THEN** the endpoint SHALL return HTTP 500 with `{ success: false, error: "<message>" }`

---

### Requirement: get-pending-ai-output-metadata HTTP endpoint

The edge function SHALL expose a POST endpoint at `/get-pending-ai-output-metadata` that returns metadata (without content body) for all pending `ai_output` rows. The endpoint calls the `get_pending_ai_output_metadata` PostgreSQL RPC function and requires `x-brain-key` or `?key=` auth.

#### Scenario: Pending output metadata
- **WHEN** a client sends POST to `/get-pending-ai-output-metadata` with valid auth
- **AND** unpicked, non-rejected rows exist
- **THEN** the endpoint SHALL return HTTP 200 with `{ success: true, data: [...] }`
- **AND** each item in `data` SHALL contain `id`, `title`, `file_path`, `content_size` (integer, bytes), `created_at`
- **AND** the response SHALL NOT contain a `content` field in any item

#### Scenario: No pending output
- **WHEN** a client sends POST to `/get-pending-ai-output-metadata` with valid auth
- **AND** no pending rows exist
- **THEN** the endpoint SHALL return HTTP 200 with `{ success: true, data: [] }`

---

### Requirement: fetch-ai-output-content HTTP endpoint

The edge function SHALL expose a POST endpoint at `/fetch-ai-output-content` that returns the full content body for specified AI output IDs. The endpoint accepts `{ ids: string[] }` in the request body and requires auth. Only outputs that are still pending (not picked up, not rejected) are returned.

#### Scenario: Fetch content for pending outputs
- **WHEN** a client sends POST to `/fetch-ai-output-content` with `{ ids: ["uuid1", "uuid2"] }` and valid auth
- **AND** those IDs exist and are pending
- **THEN** the endpoint SHALL return HTTP 200 with `{ success: true, data: [...] }`
- **AND** each item in `data` SHALL contain `id` and `content`

#### Scenario: Already-picked-up or rejected outputs excluded
- **WHEN** a client sends POST to `/fetch-ai-output-content` with IDs of picked-up or rejected outputs
- **THEN** those outputs SHALL NOT appear in the `data` array

#### Scenario: Missing ids in request body
- **WHEN** a client sends POST to `/fetch-ai-output-content` without an `ids` field or with a non-array value
- **THEN** the endpoint SHALL return HTTP 400 with `{ success: false, error: "ids array is required" }`

---

### Requirement: mark-ai-output-picked-up HTTP endpoint

The edge function SHALL expose a POST endpoint at `/mark-ai-output-picked-up` that sets `picked_up = true` and `picked_up_at = now()` for the specified rows. The endpoint accepts `{ ids: string[] }` in the request body and requires auth.

#### Scenario: Mark outputs as picked up
- **WHEN** a client sends POST to `/mark-ai-output-picked-up` with `{ ids: ["uuid1"] }` and valid auth
- **THEN** the endpoint SHALL update the specified rows
- **AND** return HTTP 200 with `{ success: true, message: "Marked 1 output(s) as picked up." }`

#### Scenario: Missing ids in request body
- **WHEN** a client sends POST to `/mark-ai-output-picked-up` without an `ids` field
- **THEN** the endpoint SHALL return HTTP 400 with `{ success: false, error: "ids array is required" }`

---

### Requirement: reject-ai-output HTTP endpoint

The edge function SHALL expose a POST endpoint at `/reject-ai-output` that sets `rejected = true` and `rejected_at = now()` for the specified rows. The endpoint accepts `{ ids: string[] }` in the request body and requires auth.

#### Scenario: Reject outputs
- **WHEN** a client sends POST to `/reject-ai-output` with `{ ids: ["uuid1"] }` and valid auth
- **THEN** the endpoint SHALL update the specified rows
- **AND** return HTTP 200 with `{ success: true, message: "Rejected 1 output(s)." }`

#### Scenario: Missing ids in request body
- **WHEN** a client sends POST to `/reject-ai-output` without an `ids` field
- **THEN** the endpoint SHALL return HTTP 400 with `{ success: false, error: "ids array is required" }`

---

### Requirement: Direct HTTP endpoint authentication

All direct HTTP endpoints SHALL use the same authentication mechanism: the `x-brain-key` header or `?key=` query parameter checked against the `MCP_ACCESS_KEY` environment variable. This is the same auth used by the MCP transport and the existing `/ingest-note` endpoint.

#### Scenario: Valid auth via header
- **WHEN** a client sends a request to any direct endpoint with `x-brain-key` header matching `MCP_ACCESS_KEY`
- **THEN** the request SHALL be processed

#### Scenario: Valid auth via query param
- **WHEN** a client sends a request to any direct endpoint with `?key=` matching `MCP_ACCESS_KEY`
- **THEN** the request SHALL be processed

#### Scenario: Missing or invalid auth
- **WHEN** a client sends a request without valid auth
- **THEN** the endpoint SHALL return HTTP 401 with `{ error: "Invalid or missing access key" }`
