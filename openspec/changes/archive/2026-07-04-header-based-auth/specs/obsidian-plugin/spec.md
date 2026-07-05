# Delta: obsidian-plugin — header-based-auth

> Note: the existing `openspec/specs/obsidian-plugin/spec.md` uses prose-style sections
> without `### Requirement:` blocks, so these land as ADDED requirements. At archive time,
> the Settings table (`tbEndpointUrl` "including ?key= param"), the "MCP communication"
> section, and the `buildEndpointUrl` examples should be updated to match.

## ADDED Requirements

### Requirement: Dedicated access-key setting sent as request header
The plugin SHALL store the access key in a dedicated `accessKey` setting (default `""`), separate from the endpoint URL. Every HTTP request the plugin makes to the brain (`callHTTP`, `callIngestNote`) SHALL send the key in an `x-brain-key` request header when `accessKey` is non-empty, and SHALL NOT append the key to the request URL.

#### Scenario: Header sent on generic HTTP calls
- **WHEN** `callHTTP` runs with `accessKey` set to `"secret123"`
- **THEN** the outgoing request includes the header `x-brain-key: secret123`
- **AND** the request URL contains no `key` query parameter

#### Scenario: Header sent on note ingestion
- **WHEN** `callIngestNote` runs with `accessKey` set
- **THEN** the outgoing request includes the `x-brain-key` header with that value

#### Scenario: Empty key omits the header
- **WHEN** `accessKey` is `""`
- **THEN** no `x-brain-key` header is added (the server responds 401 and the existing error path surfaces it)

### Requirement: Legacy key-in-URL settings migration
On settings load, and on endpoint-URL entry in the settings tab, the plugin SHALL detect a `key` query parameter in the stored/entered endpoint URL, move its value into the `accessKey` setting when `accessKey` is empty, and strip the `key` parameter from the URL (removing the `?` entirely when no other parameters remain). When `accessKey` is already non-empty, the URL is still stripped but the existing `accessKey` value is kept.

#### Scenario: Migration on load
- **WHEN** settings load with `tbEndpointUrl = "https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc"` and empty `accessKey`
- **THEN** after load, `accessKey` is `"abc"` and `tbEndpointUrl` is `"https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp"`

#### Scenario: Existing accessKey wins
- **WHEN** settings load with a `?key=urlkey` URL and `accessKey` already `"fieldkey"`
- **THEN** `accessKey` remains `"fieldkey"` and the URL is stripped of the `key` parameter

#### Scenario: Other query parameters preserved
- **WHEN** the stored URL is `"https://host/fn?foo=1&key=abc"`
- **THEN** after migration the URL is `"https://host/fn?foo=1"` and `accessKey` is `"abc"`

#### Scenario: Paste into settings tab migrates immediately
- **WHEN** the user enters a URL containing `?key=abc` in the endpoint-URL setting
- **THEN** the key is moved to the access-key setting (if empty) and the persisted URL contains no `key` parameter

### Requirement: Non-HTTPS endpoint warning
The settings tab SHALL display a persistent warning beneath the endpoint-URL setting whenever the configured endpoint uses plain `http://` and the host is not `localhost` or `127.0.0.1`. The plugin SHALL still allow such endpoints (no hard block). An exported helper `isInsecureEndpoint(url)` SHALL implement the check.

#### Scenario: Plain HTTP production endpoint warns
- **WHEN** the endpoint URL is `"http://example.com/functions/v1/terrestrial-brain-mcp"`
- **THEN** `isInsecureEndpoint` returns true and the settings tab shows the cleartext warning

#### Scenario: Localhost HTTP endpoint does not warn
- **WHEN** the endpoint URL is `"http://localhost:54321/functions/v1/terrestrial-brain-mcp"` or the `127.0.0.1` equivalent
- **THEN** `isInsecureEndpoint` returns false and no warning is shown

#### Scenario: HTTPS endpoint does not warn
- **WHEN** the endpoint URL starts with `https://`
- **THEN** `isInsecureEndpoint` returns false and no warning is shown
