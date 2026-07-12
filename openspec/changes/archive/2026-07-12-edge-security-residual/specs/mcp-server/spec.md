# mcp-server (delta: edge-security-residual)

Security-residual hardening of the edge function's network boundary: CORS defaults to deny (operator-configured allowlist) and the deprecated `?key=` query-param auth fallback is rejected by default, re-enablable only via an explicit opt-in flag.

## MODIFIED Requirements

### Requirement: Header-primary authentication with deprecated query-param fallback

The server SHALL read the access key from the `x-tb-key` request header as the primary and default mechanism. The `?key=` query-parameter fallback is **disabled by default** and SHALL be rejected unless the operator explicitly opts in by setting `TB_ALLOW_KEY_IN_QUERY=1` (the exact string `1`; any other value, including unset, empty, `true`, or `0`, means disabled). When the fallback is enabled and the `x-tb-key` header is absent, the server SHALL fall back to the `?key=` query parameter. When both a header and a query parameter are present, the header takes precedence regardless of the flag. The query-param mechanism remains deprecated (keys in URLs leak through proxy/CDN/edge logs) and is retained only for MCP clients that cannot set custom headers.

#### Scenario: Header authentication accepted (flag off, the default)
- **WHEN** a request carries `x-tb-key: <valid key>` and no `?key=` parameter, with `TB_ALLOW_KEY_IN_QUERY` unset
- **THEN** the request is authenticated and processed normally

#### Scenario: Query-param fallback rejected by default
- **WHEN** a request carries `?key=<valid key>` and no `x-tb-key` header, with `TB_ALLOW_KEY_IN_QUERY` unset (or not `1`)
- **THEN** the server returns HTTP 401 `{"error": "Invalid or missing access key"}` — the query key is not consulted

#### Scenario: Query-param fallback accepted only under the opt-in flag
- **WHEN** a request carries `?key=<valid key>` and no `x-tb-key` header, with `TB_ALLOW_KEY_IN_QUERY=1`
- **THEN** the request is authenticated (the deprecated fallback path)

#### Scenario: Header wins over query param regardless of flag
- **WHEN** a request carries a valid `x-tb-key` header and an invalid `?key=` parameter
- **THEN** the request is authenticated (the header value is the one compared), whether or not the flag is set

#### Scenario: Invalid header with valid query param rejected
- **WHEN** a request carries an invalid `x-tb-key` header and a valid `?key=` parameter
- **THEN** the server returns HTTP 401 (the header, being present, is the value compared) — the query param is never consulted while a header is present

#### Scenario: Missing credentials rejected
- **WHEN** a request carries neither an `x-tb-key` header nor (when the flag permits) a consulted `?key=`
- **THEN** the server returns HTTP 401 `{"error": "Invalid or missing access key"}`

## ADDED Requirements

### Requirement: CORS origin allowlist defaulting to deny

The server SHALL constrain cross-origin access to an operator-configured allowlist read from the `TB_ALLOWED_ORIGINS` environment variable (a comma-separated list of exact origins; surrounding whitespace trimmed and empty entries dropped). When a request's `Origin` is present in the allowlist, the server SHALL reflect that origin in the `Access-Control-Allow-Origin` response header. When the `Origin` is absent from the allowlist — including when `TB_ALLOWED_ORIGINS` is unset or empty, in which case the allowlist is empty and every cross-origin request is denied — the server SHALL NOT emit an `Access-Control-Allow-Origin` header for that origin. The server SHALL NOT respond with the wildcard `Access-Control-Allow-Origin: *`. Allowed methods remain `POST, GET, OPTIONS` and allowed headers remain `Content-Type, x-tb-key`. CORS is a browser-side control only; the access-key check remains the authoritative authorization gate for all clients.

#### Scenario: Allowlisted origin is reflected
- **WHEN** `TB_ALLOWED_ORIGINS` includes `https://console.example` and a request arrives with `Origin: https://console.example`
- **THEN** the response carries `Access-Control-Allow-Origin: https://console.example` (not `*`)

#### Scenario: Non-allowlisted origin is denied
- **WHEN** `TB_ALLOWED_ORIGINS` does not include `https://evil.example` and a request arrives with `Origin: https://evil.example`
- **THEN** the response carries no `Access-Control-Allow-Origin` for that origin and never `*`

#### Scenario: Unset allowlist denies all cross-origin
- **WHEN** `TB_ALLOWED_ORIGINS` is unset or empty and a request arrives with any `Origin`
- **THEN** the response carries no `Access-Control-Allow-Origin` header and never `*`

#### Scenario: Locked-down CORS does not affect non-browser auth
- **WHEN** a non-browser client (Obsidian plugin, MCP client) sends a valid `x-tb-key` header from any or no origin
- **THEN** the request is authenticated and processed normally — CORS never gates a non-browser client
