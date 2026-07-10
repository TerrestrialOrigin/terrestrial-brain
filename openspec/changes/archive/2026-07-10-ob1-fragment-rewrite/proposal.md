## Why

The public repository still carries a handful of fragments whose *expression* (not just idea) traces to the MIT-era Open Brain (OB1) source: the `x-brain-key` auth header name, the verbatim metadata-extraction prompt in `helpers.ts` (including the tell-tale sentence "Only extract what's explicitly there."), and the `match_thoughts` RPC name/shape. The legality analysis (Part 2 item 2) calls for re-expressing these in original words *before* any public product listing, so the codebase stops reproducing copied expression and the provenance evidence bundle can be re-grepped clean. These are behaviour-neutral renames/rewrites — the system does exactly the same thing afterward — so the risk is low and the payoff (a clean fingerprint grep) is a hard precondition for launch.

## What Changes

- **Auth header rename** — `x-brain-key` → `x-tb-key` everywhere it appears: the edge function (`index.ts` CORS `allowHeaders` + the auth-key read), the Obsidian plugin (`apiClient.ts` header construction, `settings.ts` help copy, all plugin tests), `README.md` (×5), and `ThreatModel.md`. **BREAKING** for self-hosted installs that upgrade the edge function and plugin out of lockstep — this is a hard cut (the server no longer accepts the old header). The `?key=` query fallback is untouched here (its retirement is Step 9). Goal: the string `x-brain-key` no longer appears in the repo except in a dated `docs/upgrade.md` note.
- **Metadata-extraction prompt rewrite** (`helpers.ts` `extractMetadata`) — rewrite the prompt prose in original wording; **keep the enum values** (`observation, task, idea, reference, person_note`) unchanged; **delete** the sentence "Only extract what's explicitly there." Output contract (the JSON shape and enum) is unchanged, so downstream parsing is unaffected.
- **`match_thoughts` RPC rename** → `search_thoughts_by_embedding`, via a new append-only migration (drop the old function, create the identically-bodied new-named one). Rename the canonical reference file `supabase/schemas/match_thoughts.sql` → `search_thoughts_by_embedding.sql`, update `docs/upgrade.md`, the repository RPC call site, `database.types.ts`, the pgTAP test, and the unit test. `thoughts` table columns are **not** renamed (see design.md — not cheap; would force a data migration for thin benefit).
- **Provenance re-grep** — re-run the fingerprint grep (legality markers + the three rewritten fragments) and save the dated clean output into `~/Documents/PassiveIncomeChat/evidence/` (outside the repo; a delivery step, not code).
- **Tests** — existing suite stays green (renames are behaviour-neutral); add/adjust plugin settings + auth accept/deny tests for the new header name.

## Capabilities

### New Capabilities

<!-- none — this change re-expresses existing behaviour without introducing new capabilities -->

### Modified Capabilities

- `ai-output-http-api`: direct HTTP endpoints authenticate via `x-tb-key` instead of `x-brain-key` (`openspec/specs/ai-output-http-api/spec.md`).
- `obsidian-plugin`: the plugin sends the access key as an `x-tb-key` request header (`openspec/specs/obsidian-plugin/spec.md`).
- `note-deletion`: `forget_note` / `POST /forget-note` require the `x-tb-key` access key (`openspec/specs/note-deletion/spec.md`).
- `thoughts`: the vector-search RPC is renamed `match_thoughts` → `search_thoughts_by_embedding` (`openspec/specs/thoughts/spec.md`).
- `thought-repository`: the repository's vector-match method wraps `rpc("search_thoughts_by_embedding")` (`openspec/specs/thought-repository/spec.md`).
- `schema-conventions`: the canonical reference file is `supabase/schemas/search_thoughts_by_embedding.sql`, mirroring the renamed function (`openspec/specs/schema-conventions/spec.md`).

## Impact

- **Edge function**: `supabase/functions/terrestrial-brain-mcp/index.ts` (CORS allowHeaders, auth read), `helpers.ts` (prompt), `repositories/thought-repository.ts` + `repositories/supabase-thought-repository.ts` (RPC name), `database.types.ts` (Functions type key).
- **Database**: one new append-only migration in `supabase/migrations/`; renamed canonical file `supabase/schemas/search_thoughts_by_embedding.sql`; renamed pgTAP test `supabase/tests/search_thoughts_by_embedding.test.sql`.
- **Plugin**: `obsidian-plugin/src/apiClient.ts`, `settings.ts`, and their tests (`apiClient.test.ts`, `main.test.ts`).
- **Docs / legacy specs**: `README.md`, `ThreatModel.md`, `docs/upgrade.md`, and the legacy non-capability doc `openspec/specs/mcp-server.md` (edited directly — it is not a tooling-recognized capability, so it carries no delta spec). The incidental `match_thoughts` mention in `openspec/specs/ai-provider/spec.md` (explanatory prose, not a behavioural requirement) is likewise corrected in place.
- **Tests**: `tests/unit/thought-repository.test.ts`; plugin auth-header tests.
- **No API contract change** for callers beyond the header string; no data migration (enum values and table columns unchanged).

## Non-goals

- Retiring the `?key=` query-param fallback or locking down CORS `origin: "*"` — that is Step 9 (`feature/EdgeSecurityResidual`).
- Renaming the metadata enum values or any `thoughts` table columns (would force a data migration for marginal benefit).
- Renaming other functions or removing OB1/Nate references from `README.md` marketing copy or the GitHub repo description — that is Step 3 (`feature/BrandingSeparation`) and the LICENSE/NOTICE work is Step 2.
- Any behavioural change to search, ingestion, or extraction output.
