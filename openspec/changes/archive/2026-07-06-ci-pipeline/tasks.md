## 1. Lint & format configuration

- [x] 1.1 Add `lint` and `fmt` blocks to root `deno.json` with `include: ["supabase/functions/", "tests/"]` and `exclude` for `obsidian-plugin/`, `dist`, `node_modules`, `**/node_modules`
- [x] 1.2 Add `@std/assert` (jsr) to the root `deno.json` imports map and to `supabase/functions/terrestrial-brain-mcp/deno.json`
- [x] 1.3 Add a versioned import-map entry for the Supabase edge-runtime type import and switch `index.ts:1` to a bare specifier

## 2. Fix lint findings (no rule disabling)

- [x] 2.1 Replace all 45 `https://deno.land/std@.../assert/mod.ts` test imports with the bare `@std/assert` specifier
- [x] 2.2 Remove the 10 unused vars/imports flagged by `no-unused-vars` (parse.test.ts, extractors.test.ts, thoughts.test.ts, ai-output-handlers.test.ts)
- [x] 2.3 Convert the 13 awaitless fake `Extractor.extract` implementations in extractors.test.ts from `async () =>` to `() => Promise.resolve(...)`
- [x] 2.4 Add a justified inline `// deno-lint-ignore no-control-regex` to the control-character regex in `validators.ts`
- [x] 2.5 Run `deno fmt` over the configured dirs to normalize formatting
- [x] 2.6 Verify `deno lint` and `deno fmt --check` both pass with zero problems

## 3. GitHub Actions CI workflow

- [x] 3.1 Create `.github/workflows/ci.yml` triggered on push and pull_request
- [x] 3.2 Backend job: setup Deno + Supabase CLI, `supabase start`, `TB_AI_PROVIDER=fake deno task test`, `deno lint`, `deno fmt --check`
- [x] 3.3 Plugin job (independent): `npm ci && npm test && npm run build` in `obsidian-plugin/`

## 4. One-command dev

- [x] 4.1 Create `scripts/dev.sh` that `supabase start`s the stack, runs the plugin watcher in the background (capturing its PID), and installs a `trap` that stops only that PID + `supabase stop` on EXIT/INT/TERM (no broad pkill)
- [x] 4.2 Add a `dev` task to `deno.json` invoking `scripts/dev.sh`; make the script executable

## 5. Validation script & docs

- [x] 5.1 Update `scripts/validate-all.sh` to use `deno task test` (deterministic, `TB_AI_PROVIDER=fake`) plus `deno lint` / `deno fmt --check`
- [x] 5.2 Document CI and `deno task dev` in `README.md`

## 6. Testing & Verification

- [x] 6.1 Start the local Supabase stack and run `deno task test` — 0 failures, 0 skips
- [x] 6.2 Run `deno lint` and `deno fmt --check` — 0 problems
- [x] 6.3 Run the plugin suite + build: `cd obsidian-plugin && npm test && npm run build`
- [x] 6.4 Verify `deno task dev` starts the stack and cleanly stops everything (scoped) on Ctrl-C
- [x] 6.5 Run `scripts/validate-all.sh` end-to-end
