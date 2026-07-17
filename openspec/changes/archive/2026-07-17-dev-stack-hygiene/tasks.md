## 1. SCRIPT-2 — unique ports
- [x] 1.1 config.toml unique port block (api 55421, db 55422, shadow 55420, pooler 55429, studio 55423, inbucket 55424, analytics 55427, inspector 55483).
- [x] 1.2 Update every `54321` reference in tests/helper/docs/plugin config to the new port.
- [x] 1.3 validate-all.sh derives the API URL via `supabase status --output json`.

## 2. SCRIPT-3 — blank slate
- [x] 2.1 validate-all.sh resets the DB + warms the edge function before testing.
- [x] 2.2 dev.sh resets by default with `TB_DEV_KEEP_DATA=1` opt-out.

## 3. SCRIPT-4 — npx everywhere
- [x] 3.1 dev.sh + `gen:types` task use `npx supabase`.

## 4. SCRIPT-5 — CI honesty
- [x] 4.1 Remove the stale "red by design until Step 7" comment/justification.

## 5. SCRIPT-6 — lockfile
- [x] 5.1 deno.json `"lock": true`; commit `deno.lock`.

## 6. Tests & gates
- [x] 6.1 tests/unit/dev-scripts.test.ts static guards; GATE 2b by mutation; `bash -n` scripts.
- [x] 6.2 Restart stack on new ports; full validate-all.sh green (pgTAP + Deno + plugin + build).

## 7. Finalize
- [x] 7.1 `/opsx:verify`, sync delta spec, `/opsx:archive`.
- [x] 7.2 Check off Step 14 in the plan.
- [x] 7.3 Commit on branch, merge into develop, push.
