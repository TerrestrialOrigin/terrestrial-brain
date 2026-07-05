## ADDED Requirements

### Requirement: Required environment variables are validated at cold start

The MCP edge function SHALL read every required environment variable through a shared `requireEnv(name)` helper that returns the value when present and throws an error naming the variable when it is absent or empty. The function MUST NOT read a required secret with a non-null assertion (`Deno.env.get(name)!`) that would let an undefined value flow into runtime logic.

Required variables covered: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_ACCESS_KEY`, `OPENROUTER_API_KEY`.

#### Scenario: Missing required variable fails fast at startup

- **WHEN** the function loads and a required environment variable is unset
- **THEN** `requireEnv` throws an error whose message names the missing variable
- **AND** the function does not start in a degraded state (no `Authorization: Bearer undefined` request is ever issued and auth is not silently broken)

#### Scenario: Empty-string variable is treated as missing

- **WHEN** a required environment variable is set to an empty string
- **THEN** `requireEnv` throws the same named error as when the variable is unset

#### Scenario: Present variable is returned unchanged

- **WHEN** a required environment variable is set to a non-empty value
- **THEN** `requireEnv` returns that exact value with no modification

#### Scenario: Optional variables keep their defaults

- **WHEN** an optional variable such as `TB_USER_TIMEZONE` is unset
- **THEN** the code uses its documented default (e.g. `UTC`) and does NOT throw
