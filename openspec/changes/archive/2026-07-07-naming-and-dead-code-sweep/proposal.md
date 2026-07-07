## Why

The codebase grew in two naming generations: newer files (`people.ts`, `documents.ts`, `queries.ts`, the extractors) follow the owner's self-documenting-names rule, while older files (`thoughts.ts`, `tasks.ts`, `projects.ts`, `helpers.ts`) and some plugin code still carry single-letter/cryptic variables, magic numbers, stale comments, and small cruft. This is fix-plan Step 26 (findings server 7.1, theme-8 cruft, plugin N1/D2/D3). It is the last of the structural-cleanup phase and is deliberately sequenced after the big refactors (Steps 14–19), so it only has to sweep what survived them.

## What Changes

- Rename remaining single-letter/cryptic/over-abbreviated local variables and parameters in the older server files and plugin stragglers to descriptive names matching the newer files' convention (numeric loop counters `i`/`j` excepted).
- Replace magic numbers with named constants where the literal's meaning is non-obvious (server-side result caps/thresholds; plugin-side `60000` ms timeouts and `2000` truncation length).
- Fix the misleading server self-identifier `name: "open-brain"` (`index.ts`) to the actual product name.
- Fix stale/misplaced comments: any "top N" comment that no longer matches its slice/limit; the misplaced/orphaned JSDoc above `buildEndpointUrl` (or wherever it now lives) in the plugin.
- Replace the awkward `if (!content && content !== "")` guard with the clearer `content === undefined`.
- Add an acknowledging comment to `simpleHash` documenting its 32-bit collision trade-off (accepted, per the eval).
- Remove any stray syntax cruft (e.g. a stray leading semicolon).
- No dead-code left over from Step 26's original scope (`inferDatesFromContent`, `containsDateLikeWords`, `logFunctionError`, `projectsFolderBase`) is re-removed here — those were already handled by earlier steps; this step removes only cruft that still exists.

This is a **pure, zero-behavior-change refactor**. The existing test suites are the safety net and must stay green untouched.

## Capabilities

### New Capabilities
- `code-naming-conventions`: codifies the self-documenting-naming, named-constant, and accurate-internal-identifier invariants this sweep enforces across the older server files and plugin stragglers. It documents a code-quality standard (verified by the existing suites staying green), not any new runtime behavior.

### Modified Capabilities
<!-- None. No existing spec-level requirement changes — this is a rename/cleanup-only sweep with identical runtime behavior. -->

## Non-goals

- No behavior changes, no new features, no bug fixes. If a rename would change behavior, it is out of scope.
- No re-litigating accepted trade-offs (e.g. `simpleHash` stays a 32-bit hash; only a comment is added).
- No renaming of existing DB indexes, migrations, or public API surface.
- No test additions beyond what is needed to confirm the suite still passes; assertions are not tightened here.

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/` older files (`tools/thoughts.ts`, `tools/tasks.ts`, `tools/projects.ts`, `helpers.ts`, `index.ts`, `tools/queries.ts`) and `obsidian-plugin/src/*`.
- **Tests:** Deno suite (`deno task test`) and plugin vitest (`obsidian-plugin`) must remain green with no modifications (any required test change is a red flag to investigate).
- **APIs / dependencies / DB:** none. The `"open-brain"` string is an internal MCP server-info name, not a routing key.
