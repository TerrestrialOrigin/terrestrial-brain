## Context

The repo has no `.github/` and no single startup command. Tests only run if a human remembers to `supabase start`, build the plugin, and invoke `deno test` with the right flags. Steps 15 (AiProvider seam) and 22 (`TB_AI_PROVIDER=fake` stub) already made the suite deterministic and key-free, and `deno.json` already exposes `test`/`test:unit`/`test:integration`/`test:live-llm` tasks. What is missing is (a) a headless CI that runs those tasks plus lint/format/plugin-build on every push/PR, and (b) a one-command `deno task dev` with clean teardown.

Two edge-function import maps exist: the root `deno.json` (used by tests) and `supabase/functions/terrestrial-brain-mcp/deno.json` (referenced by `config.toml` as the deploy import map). Both must stay in sync for any import change.

## Goals / Non-Goals

**Goals:**
- Green CI on every push/PR that runs the full deterministic backend suite (no paid API), lint, format check, and the plugin test + build.
- Deno lint + fmt configured over `supabase/functions/` and `tests/`, with the checked-in tree already clean.
- `deno task dev` starts Supabase + serves functions + watches the plugin, and tears its own stack down on exit.
- `scripts/validate-all.sh` uses the same deterministic task commands as CI.

**Non-Goals:**
- Deployment/publishing automation, live-LLM tier in CI, multi-OS matrix, or any application-behavior change beyond formatting normalization.

## Decisions

**1. Single workflow, two jobs (backend + plugin).**
`ci.yml` runs on `push` and `pull_request`. Job `backend` (ubuntu): install Deno (`denoland/setup-deno`) and the Supabase CLI (`supabase/setup-cli`), `supabase start` (excluding unneeded services to speed cold start), export `TB_AI_PROVIDER=fake`, then `deno task test`, `deno lint`, `deno fmt --check`. Job `plugin` (ubuntu, independent, no Supabase): `npm ci && npm test && npm run build` in `obsidian-plugin/`. Two jobs so the plugin (which needs no stack) isn't gated on Supabase boot. *Alternative considered:* one monolithic job — rejected, slower and couples unrelated failures.

**2. Fix lint findings honestly rather than disabling recommended rules.** Per the owner's "never disable the safety tools" rule, the 71 current `deno lint` problems are fixed, not silenced:
- `no-import-prefix`/`no-unversioned-import` (46): add `@std/assert` to **both** deno.json import maps and replace the 45 `https://deno.land/std@.../assert/mod.ts` test imports with the bare `@std/assert` specifier; give the single edge-runtime type import a bare specifier backed by a versioned import-map entry.
- `no-unused-vars` (10): delete the unused imports/vars in the test files.
- `require-await` (13): the awaitless fake `Extractor.extract` implementations return `Promise.resolve(...)` instead of `async () =>` — keeps the async interface contract without an empty async body.
- `no-control-regex` (1): `validators.ts` intentionally scans for control characters (`\x00-\x1F`) in filenames; this one gets an inline `// deno-lint-ignore no-control-regex` with a justification comment — the single defensible local suppression.

**3. Lint/fmt scope via `deno.json`.** Add `"lint"` and `"fmt"` blocks with `include: ["supabase/functions/", "tests/"]` and `exclude` for `obsidian-plugin/`, `node_modules`, `dist`, and any `**/node_modules`. Then run `deno fmt` once to normalize the ~23 unformatted files (pure whitespace/formatting; the suite is the safety net).

**4. `deno task dev` → `scripts/dev.sh` with scoped teardown.** The script `supabase start`s the stack, launches the plugin esbuild watcher (`npm run dev` in `obsidian-plugin/`) in the background capturing its PID, and installs a `trap 'cleanup' EXIT INT TERM` that kills **only** that captured PID and runs `supabase stop`. It never uses broad `pkill` name matches (owner's shared-machine rule). Functions are served by `supabase start` (Edge Runtime), so no separate serve process is needed. *Alternative considered:* a Deno-native orchestrator — rejected, a bash trap is the established pattern in `scripts/` and simplest for signal-based cleanup.

**5. `validate-all.sh` mirrors CI.** Replace the raw `deno test --allow-net --allow-env tests/` line with `deno task test` (which already sets `TB_AI_PROVIDER=fake`), and add the `deno lint`/`deno fmt --check` calls so local validation matches CI exactly.

## Risks / Trade-offs

- **[Large formatting diff obscures review]** → It is isolated to a single "run deno fmt" commit-step and is pure formatting; the full green suite afterward proves no behavior change.
- **[Changing the deployed `index.ts` import could break edge deploy]** → the bare specifier is backed by a versioned entry in the function's own deploy import map (`supabase/functions/terrestrial-brain-mcp/deno.json`), and the change is verified by running the local stack (`supabase start`) + the integration suite before merge.
- **[`supabase start` is slow/flaky on CI cold start]** → use the official `supabase/setup-cli` action and exclude unneeded services; the deterministic fake provider removes network dependence from the tests themselves.
- **[User error: contributor runs `deno task dev` with the stack already up or ports busy]** → `supabase start` reports the existing stack rather than double-starting; the trap's `supabase stop` is idempotent. Ctrl-C during startup still triggers the trap.

## Migration Plan

Additive tooling only — no data migration, no rollback concerns. New files: `.github/workflows/ci.yml`, `scripts/dev.sh`. Edited: `deno.json` (lint/fmt + `dev` task), both import maps, the flagged test/source files (lint fixes + formatting), `scripts/validate-all.sh`, `README.md`. Rollback = revert the branch; nothing is deployed.

## Open Questions

None — scope, rule-handling, and teardown approach are decided above.
