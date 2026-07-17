## Why

Five local-dev-stack hygiene defects. (SCRIPT-2) Every port is the stock Supabase default, so any other local Supabase project collides — and `validate-all.sh` probed a hardcoded `:54321`, which could match a DIFFERENT project's stack and run the suite against the wrong database. (SCRIPT-3) `dev.sh` never reset/seeded the DB, and `validate-all.sh` ran against whatever leftover state existed — the documented dirty-stack dedup-collision / cold-start artifacts. (SCRIPT-4) `dev.sh` and the `gen:types` task used a bare global `supabase`, so a machine without a global CLI (or a different version) diverges from the `npx supabase` everything else uses. (SCRIPT-5) The CI comment declared the backend test step "red by design until Step 7", normalizing a red required job even though Step 7 has long landed. (SCRIPT-6) `"lock": false` disabled the Deno lockfile, removing dependency-integrity pinning for the code that holds the service-role key.

## What Changes

- Assign this project a unique, non-default port block in `config.toml` (api 55421, db 55422, shadow 55420, pooler 55429, studio 55423, inbucket 55424, analytics 55427, inspector 55483); update every `54321` reference in tests/helpers/docs/plugin config.
- `validate-all.sh`: derive the API URL from `npx supabase status --output json` (no hardcoded port), reset the DB to a blank slate before testing, and warm the edge function so the reset's cold-start doesn't race the suite.
- `dev.sh`: reset+seed by default (opt out with `TB_DEV_KEEP_DATA=1`) and call `npx supabase` everywhere; `gen:types` task likewise.
- CI: remove the stale "red by design until Step 7" comment/justification.
- `deno.json`: enable the lockfile (`"lock": true`) and commit `deno.lock`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `developer-workflow`: the local stack SHALL use unique non-default ports; validation and CI SHALL reset to a blank slate and derive the URL dynamically; all Supabase CLI calls SHALL go through `npx`; the dependency lockfile SHALL be enabled; CI documentation SHALL not describe a required job as intentionally red.

## Non-goals

- Broader test-fixture centralization of the base URL (Step 30 test hygiene) — this step updates the literals to the new fixed port.

## Impact

- `supabase/config.toml`, `scripts/dev.sh`, `scripts/validate-all.sh`, `deno.json` (+ `deno.lock`), `.github/workflows/ci.yml`, ~8 test files, `tests/helpers/mcp-client.ts`, `docs/api-frontend-guide.md`, `test-vault/.obsidian/plugins/.../data.json`, `obsidian-plugin/src/utils.test.ts`, `tests/unit/dev-scripts.test.ts` (new).
- Affected spec: `openspec/specs/developer-workflow/spec.md`.
