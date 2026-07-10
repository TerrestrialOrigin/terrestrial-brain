## Context

Terrestrial Brain is a public repository being prepared for a hosted product. Three fragments still reproduce MIT-era Open Brain (OB1) *expression* rather than merely its ideas, and the legality analysis (Part 2 item 2) requires re-expressing them before any public listing:

1. The auth header name `x-brain-key` (server, plugin, README ×5, ThreatModel).
2. The metadata-extraction prompt in `supabase/functions/terrestrial-brain-mcp/helpers.ts` (`extractMetadata`), including the sentence "Only extract what's explicitly there."
3. The `match_thoughts` vector-search RPC name/shape (migrations, canonical schema file, repository, generated types, pgTAP + unit tests, and living specs).

All three are **behaviour-neutral**: after the change the system does exactly what it did before. The constraint that makes this non-trivial is that each fragment is referenced from several layers that must stay consistent, plus an append-only migration history (`docs/upgrade.md`) that forbids editing past migrations.

Standing legal rule for the whole plan: never copy anything further from OB1; reimplement independently. This step *removes* copied expression rather than adding any.

## Goals / Non-Goals

**Goals:**
- Remove the three OB1-derived fragments and replace them with original expression / renamed identifiers.
- Keep the entire test suite green with no behavioural change (search, ingest, extraction outputs identical).
- Produce a dated clean fingerprint grep saved to the external evidence bundle.
- Leave the specs (source of truth) naming the *current* identifiers.

**Non-Goals:**
- Retiring `?key=` or CORS lockdown (Step 9).
- Renaming metadata enum values or `thoughts` table columns (data-migration cost, thin-copyright benefit).
- Removing OB1/Nate references from marketing copy or the GitHub description (Step 3) or adding LICENSE/NOTICE (Step 2).

## Decisions

### D1 — New header name: `x-tb-key` (not `Authorization: Bearer`)

The plan offered `Authorization: Bearer <key>` as the "preferred standard" or `x-tb-key`. **Chosen: `x-tb-key`.**

- **Why not `Authorization: Bearer`:** the edge function runs behind the Supabase/Kong gateway, which treats the `Authorization` header as a Supabase JWT (or the `apikey`). Re-purposing `Authorization` to carry the raw `MCP_ACCESS_KEY` invites a gateway-level collision (the platform may attempt to validate it as a JWT) and conflates our app-level shared secret with Supabase's own auth channel. A dedicated custom header keeps our secret cleanly separated from the platform's auth.
- **Why `x-tb-key`:** it is a like-for-like rename of the existing custom header (`tb` = Terrestrial Brain), so the change is a single string swap on both ends with zero change to client mechanics beyond the name. It also keeps the door open for Step 9's CORS `allowHeaders` work to reference one final name.
- **Alternative considered — keep `Authorization` for future OAuth:** rejected for now; if the hosted product later adopts bearer tokens, that is a deliberate auth redesign, not a rename, and belongs in the control-plane/onboarding steps.

### D2 — Hard cut, not dual-header acceptance

The server will accept **only** `x-tb-key`; it will not also accept the legacy `x-brain-key`.

- **Why:** the stated goal is that the string `x-brain-key` no longer appears in the repo (except a dated upgrade note). Dual-acceptance would re-introduce the string into server code and blunt the fingerprint-grep result. The user base is self-hosted and small (pre-launch); an operator upgrades their own edge function and plugin together.
- **Mitigation for the out-of-lockstep case:** `docs/upgrade.md` gets an explicit dated note — "upgrade the edge function and the Obsidian plugin together; the `x-brain-key` header is no longer accepted; set the same `MCP_ACCESS_KEY`." The `?key=` fallback still works, giving a stop-gap for any MCP client mid-upgrade.
- **Alternative considered — accept both for N releases:** rejected; contradicts the fingerprint goal and adds a dead code path we would have to remember to remove later.

### D3 — Metadata prompt: rewrite prose, keep the enum values

The `extractMetadata` system prompt is rewritten in original wording. The five enum values (`observation, task, idea, reference, person_note`) are **kept**; the sentence "Only extract what's explicitly there." is **removed** and its intent folded into fresh wording ("infer only what the text supports").

- **Why keep the enum values:** renaming them forces a data migration over every stored thought's `metadata.type` plus every consumer that branches on it, for marginal legal benefit — short, generic enum tokens are thin copyright. Recorded here per the plan.
- **Contract stability:** the JSON output shape (`people`, `action_items`, `dates_mentioned`, `topics`, `type`) is unchanged, so `raw as Record<string, unknown>` parsing and all downstream extractors are unaffected. The `fake` AI provider stub does not depend on the prompt text, so stub-mode tests are unaffected.

### D4 — `match_thoughts` → `search_thoughts_by_embedding` via a new append-only migration

A single new migration `supabase/migrations/<ts>_rename_match_thoughts.sql`:
1. `drop function if exists match_thoughts(extensions.vector(1536), float, int, jsonb, text, text);` (the current 6-arg signature).
2. `create or replace function search_thoughts_by_embedding(...)` with the **identical body** (same args, return table, SELECT, filters, `archived_at is null`).

Past migrations are **not edited** (append-only). Then update, in lockstep:
- Rename `supabase/schemas/match_thoughts.sql` → `search_thoughts_by_embedding.sql`, refresh its header comment + "Last synced with" to the new migration.
- `docs/upgrade.md` canonical-file convention section (function name + file path).
- Repository call site `rpc("match_thoughts")` → `rpc("search_thoughts_by_embedding")` and the `Database["public"]["Functions"]["match_thoughts"]` type reference.
- `database.types.ts`: rename the `match_thoughts` key under `Functions` to `search_thoughts_by_embedding` (regenerate via the running local stack where possible; hand-edit is safe because the shape is unchanged).
- Rename pgTAP test `supabase/tests/match_thoughts.test.sql` → `search_thoughts_by_embedding.test.sql`; update all in-file function calls and assertion messages.
- Unit test `tests/unit/thought-repository.test.ts`: assert the new rpc name.
- Living specs that name the RPC (`thoughts`, `thought-repository`, `schema-conventions`, and the `ai-provider` passing reference) via delta specs.

- **Why a rename migration rather than editing `00000000000000_initial.sql`:** append-only history is a hard project rule; the initial migration and the four re-paste migrations stay as historical record. A fresh `db reset` applies them in order and the final rename migration leaves only `search_thoughts_by_embedding` defined.

### D5 — Do NOT rename `thoughts` table columns

The plan permitted column reorder/rename "only where cheap." **Decision: no column renames.** `thoughts` columns (`content`, `metadata`, `embedding`, `reliability`, `author`, `created_at`, `updated_at`, `archived_at`, `note_snapshot_id`, …) are referenced across the RPC, every repository, extractors, generated types, and stored `metadata` JSON. Renaming any is a churny data+code migration for no behavioural or meaningful legal gain (column names are functional, not expressive). Comments that carried copied phrasing are addressed by the prompt/RPC rewrites; no OB1-verbatim comment remains in the live `thoughts` DDL after this step (verified by the fingerprint grep).

### D6 — Fingerprint re-grep is a delivery artifact, outside the repo

After the code changes, run the marker grep (OB1/openbrain/Nate strings + the three rewritten fragments) across the repo and save the dated output to `~/Documents/PassiveIncomeChat/evidence/`. This is not committed to the repo; it feeds the legal evidence bundle. A clean result (only NOTICE/codeEval/openspec-archive historical mentions remain, per Step 3's later sweep boundary) is the acceptance signal.

## User-Error Scenarios

- **Operator upgrades the plugin but not the edge function (or vice-versa).** The new plugin sends `x-tb-key`; an un-upgraded server reads `x-brain-key` → the header is absent → HTTP 401 "Invalid or missing access key." Failure is loud and correct (not a silent empty result). Mitigation: the `docs/upgrade.md` note instructs upgrading both together; `?key=` remains as a stop-gap.
- **Operator sends the old `x-brain-key` header to a new server.** Header ignored → 401. Correct, documented.
- **MCP client cannot set custom headers.** Unchanged: `?key=` still works (untouched by this step).
- **Stale `database.types.ts` after rename.** If the generated types still name `match_thoughts`, the repository's typed `rpc(...)` call fails to compile → caught at build/typecheck (GATE 3), not at runtime.
- **Migration applied to a DB where a caller still references the old name.** Because the rename migration and all call sites land in the same change, a partial deploy would 404 the RPC → surfaced by integration tests and the `query-error-surfacing` path (an error state, never a fake-empty result).

## Security Analysis (ThreatModel.md updates)

- **No new attack surface.** The header rename is a string change to the same shared-secret-in-a-custom-header mechanism; the constant-time compare (`accessKeyMatches`) and the "secret in header, never URL" property are preserved. ThreatModel T1/T2 rows are updated to name `x-tb-key`.
- **Improved separation (minor).** Keeping the secret in a dedicated `x-tb-key` header rather than `Authorization` avoids conflating the app secret with the platform JWT channel (D1) — a small defense-in-depth win, noted in ThreatModel.
- **Prompt rewrite** does not change what the LLM is asked to return; the output is still validated/parsed downstream (no new injection surface). Enum values are unchanged so no allowlist widening.
- **RPC rename** does not change RLS or the service-role boundary; the function keeps `set search_path = public, extensions` and the same `security`/`stable` properties.
- ThreatModel.md gets: header name updated in the transport/T2 rows, and a one-line note that the app secret is deliberately carried in a custom header (not `Authorization`) to avoid gateway/JWT collision.

## Test Strategy

Per the mock-boundary and gate rules:

- **Unit (plugin, vitest):** `apiClient.test.ts` asserts the outgoing request carries `x-tb-key: <key>` and omits it when empty, and that the key never lands in the URL. `main.test.ts` / settings-migration test unchanged behaviour (the `?key=` → `accessKey` migration is orthogonal and stays green). These are the "auth accept/deny (client side)" tests for the new header.
- **Unit (Deno):** `tests/unit/thought-repository.test.ts` asserts `rpcName === "search_thoughts_by_embedding"` (fails first against the old name — proves the rename is exercised).
- **Integration / DB (pgTAP):** `search_thoughts_by_embedding.test.sql` runs against the local stack (`npx supabase start`) and calls the renamed function; a call to the old `match_thoughts` name would now error, confirming the drop. This is the server-side accept path for the RPC.
- **Server auth accept/deny:** the existing edge-function auth tests are updated to send `x-tb-key` for the accept case and assert 401 when the header is absent/wrong — real code path, no mocks on the auth check.
- **Behaviour-neutrality:** the full existing suite (`deno task test` with `TB_AI_PROVIDER=fake`, plus `cd obsidian-plugin && npm test && npm run build`) must stay green — this is the primary guard that the renames changed no behaviour.
- **Mutation check (GATE 2b):** deleting the header read, or leaving a call site on the old RPC name, must redden at least one test above.
- **Prompt rewrite:** no assertion on exact prompt text (that would be brittle); covered by the extraction integration tests that run under `fake` provider and by the unchanged output contract.

## Risks / Trade-offs

- **[Risk] Out-of-lockstep self-hosted upgrade → 401.** → Documented hard-cut in `docs/upgrade.md`; `?key=` stop-gap; loud failure not silent.
- **[Risk] `database.types.ts` drift if regenerated types differ from the hand-edit.** → Prefer regenerating against the running stack; if hand-edited, the only change is the Functions key name (shape identical), and the typecheck gate catches any mismatch.
- **[Risk] A missed `match_thoughts` / `x-brain-key` reference leaves a copied fragment behind.** → The fingerprint grep (D6) is the backstop and is the change's acceptance artifact; it must come back clean (excluding NOTICE/codeEval/openspec-archive historical records handled by later steps).
- **[Trade-off] Hard cut vs. compatibility.** Accepted deliberately (D2) — cleaner fingerprint result outweighs transitional convenience for a pre-launch, single-operator user base.

## Migration Plan

1. Land code + the new rename migration together on `feature/Ob1FragmentRewrite`.
2. `npx supabase db reset` locally → all migrations apply, only `search_thoughts_by_embedding` exists; pgTAP green.
3. Run both test suites green (gates).
4. Deploy order in production (documented, but out of this change's automation): apply migration, deploy edge function, distribute plugin update — all carrying the new header. Because the migration drops the old function, deploy the edge function build that calls the new name in the same window.
5. **Rollback:** revert the branch; a compensating migration would `create or replace function match_thoughts(...)` again (append-only). Low likelihood given behaviour-neutrality.

## Open Questions

- None blocking. `database.types.ts` regeneration vs. hand-edit is resolved in D4 (regenerate if the stack is up; hand-edit is safe otherwise).
