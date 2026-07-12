## Why

Two residual edge-function security gaps survive the earlier auth hardening (fix-plan Steps 1/3): CORS is still wildcard (`origin: "*"`, `index.ts:383`) and the deprecated `?key=` query-param auth fallback is still unconditionally accepted (`index.ts:395-398`). Both are keys-in-URL / cross-origin surfaces that a hosted, publicly-listed product should not ship open by default. This is Step 9 of the New-Feature-Plan and a prerequisite for provisioning automation (Step 10 must not deploy a repo with an open CORS/key posture).

## What Changes

- **CORS lockdown.** Replace `origin: "*"` with an explicit allowlist driven by a new `TB_ALLOWED_ORIGINS` env var (comma-separated). When unset (the default), no cross-origin request is allowed — the Obsidian plugin (Electron `requestUrl`, not browser-CORS-bound) and MCP clients (Claude Desktop/Code, not browsers) do not need CORS at all; only a future web console (Step 17) would set it. **BREAKING** for any browser client that today relies on the wildcard (none ship in this repo).
- **`?key=` query-param retirement.** By default the server SHALL reject the `?key=` fallback and authenticate on the `x-tb-key` header only. A new opt-in flag `TB_ALLOW_KEY_IN_QUERY=1` restores the fallback for MCP clients that genuinely cannot set custom headers. **BREAKING** for any client currently relying on `?key=` without setting the flag (the README already documents `?key=` as deprecated; upgrade note added).
- **Docs + threat model.** Update `README.md` (env-var table, MCP-client config guidance) and `docs/upgrade.md` (new vars, key-in-query default change); revise `ThreatModel.md` T2 (query-param residual) and T7 (CORS "accepted by design").
- **Tests.** Denial tests for disallowed / absent origins; `?key=` rejected when the flag is off and accepted when on; header path unaffected either way.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `mcp-server`: the **CORS** requirement changes from wildcard to an env-configured allowlist defaulting to deny; the **Header-primary authentication with deprecated query-param fallback** requirement changes so the `?key=` fallback is rejected by default and only accepted under the `TB_ALLOW_KEY_IN_QUERY` opt-in flag. Spec file: `openspec/specs/mcp-server.md`.

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/index.ts` (CORS middleware config + auth key read); a small config seam reading `TB_ALLOWED_ORIGINS` / `TB_ALLOW_KEY_IN_QUERY` (parse-at-boundary).
- **Tests:** `tests/integration/auth.test.ts` (query-param cases flip to deny-by-default); new CORS denial/allow integration coverage.
- **Docs:** `README.md`, `docs/upgrade.md`, `ThreatModel.md` (T2, T7).
- **No schema/migration changes**; no database or plugin code changes (plugin already sends the header only).

## Non-goals

- Rate limiting / brute-force protection (T6 remains accepted).
- Changing the constant-time key comparison or the shared-secret model itself.
- Building the web console that would consume `TB_ALLOWED_ORIGINS` (Step 17).
- Plugin-side changes — the Obsidian plugin already authenticates via the `x-tb-key` header and does not use CORS.
