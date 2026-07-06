## Context

The MCP server (`supabase/functions/terrestrial-brain-mcp/`, Deno/Hono) registers ~31 tools whose input is validated with Zod. The eval (Fable20260704, findings 6.1, 6.3, 7.2, 7.3, 5.3) found the tool boundary loosely validated and inconsistently typed:

- `status`/`type`/`reliability` params are `z.string()` with valid values only in prose descriptions; `*_id` params mostly lack `.uuid()`; `limit` params lack `.max()`.
- Get-by-id tools disagree on the not-found response shape (`isError:true` vs `false`); update tools disagree on the zero-fields-update response; no update tool verifies affected rows, so updating a nonexistent UUID reports success.
- `ilike` searches interpolate raw user text, so `%` matches everything and `_`/`\` are wildcards.
- No generated DB row types exist; the `thoughts` row shape is hand-retyped inline; `thought_stats` loads every thought into memory to count client-side.

The repository layer (Steps 16–17) already sits between tools and supabase-js, so most DB-touching changes (affected-row detection, escaped search, typed rows, the stats RPC call) land in the repositories, with the tools owning Zod schema and response-shape decisions.

## Goals / Non-Goals

**Goals:**
- Reject malformed enum/UUID/over-limit input at the tool boundary with a clear message, before it reaches Postgres ("parse, don't cast").
- One consistent convention each for: not-found (get-by-id), zero-fields-update, and nonexistent-UUID update.
- Literal `ilike` search — user `%`/`_`/`\` match themselves, not act as wildcards.
- Real generated DB types (`SupabaseClient<Database>`), inline row shapes deleted, generation wired into the dev workflow.
- `thought_stats` computed in SQL, not by loading every row.

**Non-Goals:**
- No change to auth, RLS, or the extractor pipeline.
- No renaming of DB columns/indexes; no change to happy-path returned data beyond the deliberate convention unification.
- Not touching the plugin (it is a separate boundary; server-response validation there was Step 21).

## Decisions

### D1 — Enum values come from the DB, expressed as `z.enum`
Replace `z.string()` with `z.enum([...])` for `status`/`type`/`reliability` params, using the values already documented in each param's `.describe(...)` text (and cross-checked against the columns' CHECK constraints / usage in migrations). Zod v4 `z.enum` produces a clear "Invalid enum value" message listing allowed values, which is exactly the boundary rejection we want. *Alternative considered:* keep `z.string()` and validate against an allowlist inside the handler — rejected because it re-implements what Zod does and keeps the contract out of the schema.
- **Consistency guard:** the enum arrays must match the DB CHECK constraints. Where a column has no CHECK, the enum is derived from the descriptions and is the authoritative allowlist at the edge; document any value only enforced at the edge.

### D2 — UUID-format check on every id param, `.max(100)` on every limit
Every param that is a UUID (`id`, `*_id`, and each element of `ids` arrays) is validated as a UUID via a shared `uuidField()` helper (`zod-schemas.ts`); every `limit` gets `.min(1).max(100)` (100 matches the existing implicit ceilings and the owner's "bounded queries" rule). *Trade-off:* a caller passing a non-UUID string now gets a validation error instead of an empty result — the intended behavior (an invalid id is a caller bug, not "no rows").

**Lenient vs strict UUID:** `uuidField()` matches any canonical `8-4-4-4-12` hex string case-insensitively and does NOT enforce the RFC 4122 version/variant nibbles. Zod v4's built-in `z.string().uuid()` is strict-RFC and rejects the repo's hand-authored fixture/seed ids (e.g. `00000000-0000-0000-0000-000000000002`) and any non-v4 identifier — which would break the existing suite and could reject legitimate stored ids. The finding's intent is to reject *malformed* ids (`"not-a-uuid"`), not to police UUID versions, so the lenient check is the correct scope. Documented in `zod-schemas.ts`.

### D3 — Unified conventions (BREAKING for tests asserting the old shapes)
Reads and writes are treated as two consistent families (the eval's finding 7.2 is about tools *of the same kind* disagreeing, not reads-vs-writes):
- **Not-found (get-by-id reads):** standardize on `isError: false` with a plain "no <entity> found with ID …" text result. Rationale: "no such row" is a normal query outcome for a read, not a tool failure; the caller (an LLM) handles it as data. `get_thought_by_id`/`get_document` already did this; bring `get_project` and `get_person` (previously `isError:true`) into line. (`get_project_summary`/`get_note_snapshot` are composite queries, not simple get-by-id, and keep their own error semantics.)
- **Zero-fields-update:** standardize on an `isError:true` error whose message lists the updatable fields ("At least one of … must be provided."). Rationale: an update call with no changes is a caller mistake worth surfacing, and returning success would be misleading. `update_thought`/`update_document` already do this; bring `update_task`/`update_project`/`update_person` (previously a non-error "No fields to update.") into line.
- **Affected-row verification (update-miss):** every update selects the affected row back (`.update(...).eq("id", id).select("id").maybeSingle()`); if no row returned, the tool reports not-found as an `isError:true` error ("… not found: no <entity> with id …"), consistent with how `update_thought`/`update_document` already treat a missing target. Rationale: an update names a specific target to mutate — a missing target is a failed operation, distinct from a read that simply found nothing. This closes "update a nonexistent UUID reports success." The row-count seam lives in each repository's `update` (returns the updated row's id or `null`), so all tools inherit it.

### D4 — Shared `escapeLikePattern` helper
Add one helper (e.g. in a shared util module) that escapes `\`, `%`, and `_` (order matters — escape `\` first) and is used wherever user text feeds `ilike`/`like`. The Postgres pattern then uses the default `\` escape char. *Alternative:* switch those searches to full-text search — out of scope; escaping is the minimal correct fix. Escaping is applied inside the repository search methods so no tool can forget it.

### D5 — Generated types via `supabase gen types typescript`
Generate into a committed `database.types.ts` in the function source and type the client `SupabaseClient<Database>` at the composition root. Delete hand-retyped inline row shapes, letting the typed client infer rows. Wire `supabase gen types typescript --local > …/database.types.ts` into `scripts/dev.sh` (and/or a `deno task gen:types`) so it refreshes after migrations. *Trade-off:* the generated file is large and machine-owned — it is committed (so CI/type-check has it without a running DB) and never hand-edited. *Risk:* generation needs a running local stack; the dev script already starts one, and CI type-checks against the committed file.

### D6 — `thought_stats` as a SQL RPC
New append-only migration adds a `thought_stats()` SQL function returning the aggregate counts the tool currently computes in memory (total, by type, by reliability, archived, usefulness aggregates — exact shape matched to current output). The tool/repository calls `supabase.rpc("thought_stats")`. *Rationale:* pushes counting into the query per the "bounded queries" rule; removes the load-every-row scan. The function is `SECURITY INVOKER` (default) and, consistent with Step 1's hardening, EXECUTE is granted only to `service_role` (revoke from anon/authenticated).

### Test Strategy
- **Unit** (Deno, `tests/unit/`): `escapeLikePattern` (each metachar, `\` ordering, empty string); Zod schema rejection for enum/uuid/limit is exercised at the tool level in integration since schemas are wired into MCP registration.
- **Integration** (`tests/integration/`, real HTTP → edge → Postgres, `TB_AI_PROVIDER=fake`): invalid enum/uuid/over-limit → clear error, zero DB effect; nonexistent-UUID update → not-found (and no row created); unified not-found response for each get-by-id tool; zero-fields update → "No fields to update"; a document/search containing `%` matches only literal `%`, not everything; `thought_stats` returns correct aggregates via the RPC and matches a direct-DB count. Existing tests asserting the old inconsistent semantics are updated deliberately (each change noted in the commit).
- **Mutation check (GATE 2b):** deleting the `.max(100)` / `.uuid()` / enum / escaping / affected-row-check line must redden at least one test.

### User Error Scenarios
- Caller passes an invalid `status` (typo) → Zod rejects with allowed-values message; no write.
- Caller passes a non-UUID `id` → Zod rejects; not an empty-result masquerade.
- Caller passes `limit: 100000` → clamped by `.max(100)` rejection with clear message (does not silently fetch everything).
- Caller updates a nonexistent UUID → not-found, no phantom success.
- Caller sends an update with no fields → "No fields to update", not a false success.
- Caller searches for a literal `%` or `_` → matches that character, not every row.

### Security Analysis (see ThreatModel.md)
- **Wildcard/pattern injection via `ilike`** (finding 5.3): unescaped `%` returns the entire table (information disclosure / cost) — mitigated by D4 escaping. `\` and `_` similarly neutralized.
- **Unbounded fetch (DoS/cost)**: missing `.max()` lets a caller request unbounded rows — mitigated by D2.
- **Malformed value reaching DB**: un-enumerated status/type could persist an out-of-domain value that later breaks readers — mitigated by D1.
- **RPC privilege**: `thought_stats` RPC must not widen access — EXECUTE granted to `service_role` only, matching Step 1's policy hardening.
- No new secrets, network calls, or auth surface introduced.

## Risks / Trade-offs
- **[Breaking test/response-shape changes]** → the change is explicitly BREAKING for the unified conventions; every updated integration test is changed deliberately and the delta spec documents the new contract, so the suite stays the source of truth.
- **[Generated types drift from schema]** → regeneration wired into the dev workflow and documented; the committed file is refreshed on migration changes and never hand-edited.
- **[`thought_stats` RPC output must exactly match current tool output]** → an integration test asserts the RPC-backed output equals a direct DB aggregate, and the tool's formatting is unchanged.
- **[Enum lists could omit a legitimate value]** → enums are cross-checked against DB CHECK constraints and existing descriptions; any edge-only allowlist value is documented.

## Migration Plan
1. Land Zod/convention/escaping code changes + generated types behind the existing suite (no schema change required for these).
2. Add the append-only `thought_stats` RPC migration; apply locally via `supabase db reset`/`start`.
3. Regenerate `database.types.ts` against the updated schema; type the client.
4. Run full suite (`deno task test` + plugin build) green; deploy via existing prod scripts (migration is additive, RPC replace-safe).
- **Rollback:** the migration only adds a function (drop-if-exists safe); code changes revert cleanly; no data is mutated.

## Open Questions
- None blocking. The exact enum value lists and the precise `thought_stats` output shape are pinned during implementation against the live schema and current tool output (verified by test).
