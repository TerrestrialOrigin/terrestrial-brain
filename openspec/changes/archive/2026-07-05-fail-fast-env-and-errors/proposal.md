## Why

Two latent failure modes ship silently in the MCP edge function today. (1) Required environment variables are read with the non-null assertion `Deno.env.get(...)!`, so a missing `OPENROUTER_API_KEY` becomes `Authorization: Bearer undefined` on the first paid API call and a missing `MCP_ACCESS_KEY` quietly breaks auth — the process starts "healthy" and fails far from the cause (finding X5). (2) Composite-query handlers and name-resolution blocks destructure only `{ data }` and ignore `{ error }`; a failed sub-query renders as "No open tasks." or empty-state prose, and `extractMetadata` swallows any API error into a `{ topics: ["uncategorized"] }` fallback with no log — a database or LLM outage looks identical to genuinely-empty data (finding C9).

## What Changes

- Add a shared `requireEnv(name): string` helper that throws a clear, named error at cold start, and replace every module-level `Deno.env.get(...)!` in the MCP function with it (`index.ts`, `helpers.ts`, `tools/thoughts.ts`, and the three LLM-calling extractor files). A missing required var now fails fast at startup instead of surfacing as a corrupt request later.
- `extractMetadata` (`helpers.ts`) gains the missing `response.ok` check (mirroring `getEmbedding`) and logs a warning whenever the `{ topics: ["uncategorized"] }` fallback is taken, so an LLM failure is distinguishable from a genuinely uncategorizable thought.
- `get_project_summary` and `get_recent_activity` (`tools/queries.ts`), plus the name-resolution blocks in `tools/tasks.ts`, `tools/ai_output.ts`, and `tools/documents.ts`, check the `error` channel of every Supabase call, `console.error` it, and render an explicit `(section unavailable: <reason>)` marker in place of false empty-state prose.

## Capabilities

### New Capabilities
- `startup-env-validation`: Required environment variables are validated once at cold start via a shared `requireEnv` helper that throws an error naming the missing variable; the function refuses to start rather than run degraded.
- `query-error-surfacing`: Database sub-query failures and external-API (LLM) failures are logged and rendered as explicit "unavailable" markers, never collapsed into an empty-state or success response — absence of data and failure to fetch data render differently.

### Modified Capabilities
<!-- No existing spec's requirements are being replaced; the two new capabilities add
     cross-cutting contracts that refine composite-queries behavior without contradicting it. -->

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/` — new `env.ts` (or shared helper) module; edits to `index.ts`, `helpers.ts`, `tools/thoughts.ts`, `tools/queries.ts`, `tools/tasks.ts`, `tools/ai_output.ts`, `tools/documents.ts`, `extractors/task-extractor.ts`, `extractors/people-extractor.ts`, `extractors/project-extractor.ts`.
- **Behavior refinement:** the existing `composite-queries` spec's "No open tasks / No recent thoughts" empty-state responses now apply only when a sub-query *succeeds with zero rows*; a *failed* sub-query renders the new unavailable marker instead. No successful-path behavior changes.
- **Tests:** new `tests/unit/` coverage for `requireEnv` (throws naming the var) and for the query-error "unavailable" marker (via an injected failing Supabase stub); Deno suite must stay green with no OpenRouter key required for the new unit tests.
- **No changes** to the Obsidian plugin, database migrations, or public HTTP contract. Repo has no terrestrial-core dependency.
