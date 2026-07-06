## Why

The repo has no automated CI and no one-command startup: contributors must manually run `supabase start`, build the plugin, and run `deno test`, so "all test layers, every time" depends entirely on human discipline and nothing verifies a PR before merge (finding X8). The `AiProvider` seam (Step 15) and deterministic stub mode (Step 22) now make the suite key-free and reproducible, so a headless CI run and a single dev command are finally possible.

## What Changes

- Add a GitHub Actions workflow that, on push/PR, starts a minimal local Supabase stack with `TB_AI_PROVIDER=fake`, runs `deno task test`, `deno lint`, and `deno fmt --check`, then runs the plugin's `npm ci && npm test && npm run build`.
- Add Deno lint + fmt configuration to `deno.json` (scoped to include `tests/`, `supabase/functions/`, and to exclude generated/vendor dirs) and normalize the existing sources so `deno fmt --check` and `deno lint` pass cleanly.
- Add a one-command `deno task dev` (backed by a root script) that starts the Supabase stack, serves the edge functions, and builds/watches the plugin — with matching cleanup that stops the stack on exit (Ctrl-C or normal termination), scoped to this repo's ports.
- Update `scripts/validate-all.sh` to invoke the deterministic task-based commands (`deno task test` with `TB_AI_PROVIDER=fake`) instead of the raw `deno test ... tests/` line, keeping it consistent with CI.

## Capabilities

### New Capabilities
- `developer-workflow`: The project's continuous-integration pipeline and one-command local development/teardown contract — what CI verifies on every push/PR, and how a contributor starts and cleanly stops the full stack with a single command.

### Modified Capabilities
<!-- None: no existing spec's runtime requirements change; this adds tooling/process capability only. -->

## Non-goals

- No deployment/publish automation (prod deploy stays in `scripts/deploy-update-prod.sh`; CI only verifies, it does not release).
- No live-LLM tier in CI — the opt-in `deno task test:live-llm` (requiring `OPENROUTER_API_KEY`) is deliberately excluded from the default pipeline.
- No change to test behavior, application code, or migrations beyond formatting normalization required for `deno fmt`/`deno lint` to pass.
- No matrix/multi-OS build; a single Linux runner is sufficient for this single-tenant project.

## Impact

- New files: `.github/workflows/ci.yml`, a root dev script (e.g. `scripts/dev.sh`) wired to `deno task dev`.
- Modified: `deno.json` (lint/fmt config + `dev` task), `scripts/validate-all.sh`, `README.md` (document the CI badge/flow and `deno task dev`), and formatting-only diffs across `tests/` and `supabase/functions/` sources.
- Dependencies: GitHub Actions `supabase/setup-cli` (or CLI install) and `denoland/setup-deno`; Node for the plugin job. No new runtime dependencies.
- Affected spec: new `openspec/specs/developer-workflow/spec.md`.
