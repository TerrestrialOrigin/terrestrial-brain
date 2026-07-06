## Why

The MCP server's tool boundary is under-validated and inconsistently typed. `status`/`type`/`reliability` params are `z.string()` with valid values documented only in prose, so a hallucinated or malformed value flows straight to Postgres; most `*_id` params lack `.uuid()` and `limit` params lack `.max()`, allowing malformed ids and unbounded fetches. Get-by-id and update tools disagree on conventions: not-found is `isError:false` in some tools and `isError:true` in others, zero-field updates are an error in some and a friendly no-op in others, and updating a nonexistent UUID reports success because no tool checks affected rows. `ilike` searches interpolate raw user input, so a `%` matches everything and `_`/`\` behave as wildcards. Finally there are no generated DB row types — the `thoughts` row shape is hand-retyped inline in several places — and `thought_stats` loads every thought into memory to count client-side. These are exactly the boundary-validation and consistency gaps the owner's "parse, don't cast" and "bounded queries" rules exist to prevent (eval findings 6.1, 6.3, 7.2, 7.3, 5.3).

## What Changes

- **Zod tightening at the tool boundary**: replace `z.string()` with `z.enum([...])` for `status`/`type`/`reliability` params (using the values already documented in their descriptions); add `.uuid()` to every id param; add `.max(100)` to every `limit`. Invalid input is rejected at the door with a clear message instead of reaching the DB.
- **Unified tool conventions**: one not-found semantic for all get-by-id tools, one zero-fields-update semantic for all update tools, and affected-row verification so updating a nonexistent UUID reports not-found instead of success. **BREAKING** for callers/tests that relied on the previous inconsistent responses.
- **`ilike` wildcard escaping**: escape `%`, `_`, and `\` in user-supplied search text before it feeds an `ilike`/`like` pattern, so search matches literally.
- **Generated DB types**: generate `supabase gen types typescript` into the function source, type the client as `SupabaseClient<Database>`, and delete hand-retyped inline row shapes. Wire type regeneration into the dev workflow so it refreshes on migration changes.
- **`thought_stats` as SQL**: move the load-every-row client-side aggregation into a SQL RPC (new append-only migration); the tool calls the RPC.

## Capabilities

### New Capabilities
- `input-validation`: the cross-cutting contract for how the MCP server validates tool input (enums, UUIDs, bounded limits, escaped search patterns) and the unified conventions for not-found, zero-field-update, and affected-row verification across get-by-id and update tools.

### Modified Capabilities
<!-- No existing capability spec's requirements change beyond what the new input-validation capability captures. DB type generation and the thought_stats RPC are implementation details recorded in design.md/tasks.md, not spec-level behavior changes. -->

## Impact

- **Code**: `supabase/functions/terrestrial-brain-mcp/tools/*.ts` (zod schemas, get-by-id + update handlers), `repositories/*` (affected-row/typed returns, escaped search), a new shared `ilike`-escaping helper, `index.ts`/client construction (typed client), a generated `database.types.ts`.
- **Migrations**: one new append-only migration adding the `thought_stats` SQL RPC (function-call-logs/thoughts unchanged otherwise).
- **Dev workflow**: `scripts/dev.sh` / `deno task` gains a types-regeneration step.
- **Tests**: new/updated unit + integration tests for enum/uuid/limit rejection, unified not-found, nonexistent-UUID update → not-found, and `%`-search literal matching; existing integration tests that assert the old inconsistent semantics are updated deliberately.
- **Non-goals**: no change to auth, RLS, or the extractor pipeline; no renaming of existing DB columns/indexes; no change to what data tools return on the happy path (aside from the deliberate convention unification).
