## 1. Failing tests first (bug replication)

- [x] 1.1 Add `tests/unit/env.test.ts`: assert `requireEnv` returns a set value, and throws an error naming the variable when the var is unset and when it is an empty string. Confirm it FAILS (no `requireEnv` exists yet).
- [x] 1.2 Add `tests/unit/query-error-surfacing.test.ts`: exercise the pure section-builder helper — given a simulated `{ error }` it produces `(section unavailable: <reason>)`; given `{ data: [] }` it produces the empty-state prose. Confirm it FAILS against current code (no helper / current code renders empty-state on error).

## 2. Fail-fast env handling (X5)

- [x] 2.1 Create `supabase/functions/terrestrial-brain-mcp/env.ts` exporting `requireEnv(name: string): string` — reads `Deno.env.get(name)`, throws `Error` naming the variable when undefined or empty, else returns the value.
- [x] 2.2 Replace the `Deno.env.get(...)!` reads with `requireEnv(...)` in `index.ts` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MCP_ACCESS_KEY), `helpers.ts` (OPENROUTER_API_KEY), and `tools/thoughts.ts` (OPENROUTER_API_KEY).
- [x] 2.3 Replace the `Deno.env.get("OPENROUTER_API_KEY")!` reads in `extractors/task-extractor.ts`, `extractors/people-extractor.ts`, and `extractors/project-extractor.ts` with `requireEnv(...)`. Leave `date-parser.ts` (`?? "UTC"`) untouched.
- [x] 2.4 Verify `env.test.ts` now passes.

## 3. External-API failure observability (C9 — extractMetadata)

- [x] 3.1 In `helpers.ts` `extractMetadata`, add a `response.ok` check (mirror `getEmbedding`) and `console.warn` with status/body before returning the `{ topics: ["uncategorized"] }` fallback; also warn when the JSON parse fails. Keep the fallback (still capture the thought).

## 4. Query error surfacing (C9 — queries.ts)

- [x] 4.1 Add a shared section-builder helper (pure, unit-testable) that, given a Supabase `{ data, error }` result plus an empty-state string, returns either the rows for formatting or the `(section unavailable: <reason>)` marker; log via `console.error` on error. Place it where `query-error-surfacing.test.ts` imports it.
- [x] 4.2 `tools/queries.ts` `get_project_summary` (steps 3–6b): capture and check `error` on the parent/children/tasks/thoughts/snapshots/people sub-queries; render the unavailable marker on error, keep empty-state prose only on successful-empty.
- [x] 4.3 `tools/queries.ts` `get_recent_activity`: same treatment for every sub-query (thoughts, tasks created/completed, projects created/updated, ai outputs, people created/updated, project name resolution).

## 5. Name-resolution error surfacing (C9 — tools)

- [x] 5.1 `tools/tasks.ts`, `tools/ai_output.ts`, `tools/documents.ts`: for each `{ data: ... }`-only name/project/person resolution query, capture and check `error`, `console.error` it, and fall back to the raw id rather than a silently-empty map.

## 6. Testing & Verification

- [x] 6.1 Confirm `query-error-surfacing.test.ts` passes; apply GATE 2b — deleting the error-check in the section helper reddens the marker test.
- [x] 6.2 Run the Deno unit suite (`deno test --allow-net --allow-env tests/unit/`) — zero failures, zero skips.
- [x] 6.3 Run the full Deno suite (`deno test --allow-net --allow-env tests/`) against the local Supabase stack — zero failures, zero skips. Add one integration assertion that a genuinely-empty `get_project_summary` section still shows empty-state prose (not the marker).
- [x] 6.4 `deno lint` + `deno fmt --check` clean on the touched files.
- [x] 6.5 Update the fix-plan checklist (Step 10) and record evidence (final passing summary line).
