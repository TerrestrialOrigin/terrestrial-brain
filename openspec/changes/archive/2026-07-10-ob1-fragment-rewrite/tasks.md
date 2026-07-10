## 1. Auth header rename (`x-brain-key` → `x-tb-key`)

- [x] 1.1 Edge function `supabase/functions/terrestrial-brain-mcp/index.ts`: update CORS `allowHeaders` (`x-brain-key` → `x-tb-key`) and the auth-key read (`context.req.header("x-brain-key")` → `"x-tb-key"`), including the explanatory comment.
- [x] 1.2 Plugin `obsidian-plugin/src/apiClient.ts`: set the request header to `x-tb-key` and update the JSDoc comment.
- [x] 1.3 Plugin `obsidian-plugin/src/settings.ts`: update the access-key field help copy ("Sent as an x-tb-key request header…").
- [x] 1.4 Update plugin tests `obsidian-plugin/src/apiClient.test.ts` (assert `x-tb-key` sent / omitted-when-empty / not-in-URL) and any `main.test.ts` references; keep the `?key=` migration test unchanged.
- [x] 1.5 Update `README.md` (all 5 references) and `ThreatModel.md` (T1/T2 transport rows + add the D1 note: app secret carried in a custom header, not `Authorization`, to avoid gateway/JWT collision).
- [x] 1.6 Add a dated hard-cut note to `docs/upgrade.md`: `x-brain-key` is no longer accepted; upgrade the edge function and plugin together; `?key=` remains as a stop-gap.
- [x] 1.7 Update the legacy doc `openspec/specs/mcp-server.md` (auth requirement, CORS headers line) to name `x-tb-key`.

## 2. Metadata-extraction prompt rewrite

- [x] 2.1 `supabase/functions/terrestrial-brain-mcp/helpers.ts` (`extractMetadata`): rewrite the system-prompt prose in original wording, keep the five enum values, delete "Only extract what's explicitly there." (fold intent into fresh wording). Output JSON contract unchanged.

## 3. `match_thoughts` RPC rename → `search_thoughts_by_embedding`

- [x] 3.1 Add append-only migration `supabase/migrations/<ts>_rename_match_thoughts_to_search_thoughts_by_embedding.sql`: `drop function if exists match_thoughts(extensions.vector(1536), float, int, jsonb, text, text);` then `create or replace function search_thoughts_by_embedding(...)` with the identical body from the canonical file.
- [x] 3.2 Rename `supabase/schemas/match_thoughts.sql` → `supabase/schemas/search_thoughts_by_embedding.sql`; update the header comment, function name, and "Last synced with" to the new migration filename.
- [x] 3.3 Update `docs/upgrade.md` canonical-file convention section (function name + file path).
- [x] 3.4 Update repository `supabase/functions/terrestrial-brain-mcp/repositories/supabase-thought-repository.ts` (`rpc("match_thoughts")` → `rpc("search_thoughts_by_embedding")`) and `repositories/thought-repository.ts` type reference/comments.
- [x] 3.5 Update `supabase/functions/terrestrial-brain-mcp/database.types.ts`: rename the `match_thoughts` key under `Functions` to `search_thoughts_by_embedding` (regenerate against the running local stack if available; hand-edit is safe — shape unchanged).
- [x] 3.6 Rename pgTAP test `supabase/tests/match_thoughts.test.sql` → `search_thoughts_by_embedding.test.sql`; update all in-file function calls and assertion messages.
- [x] 3.7 Update Deno unit test `tests/unit/thought-repository.test.ts` to assert `rpcName === "search_thoughts_by_embedding"`.
- [x] 3.8 Correct the incidental `match_thoughts` mention in `openspec/specs/ai-provider/spec.md` (explanatory prose) to `search_thoughts_by_embedding`.

## 4. Testing & Verification

- [x] 4.1 Start the local stack (`npx supabase start`) and run `npx supabase db reset` — confirm all migrations apply, only `search_thoughts_by_embedding` exists, and the pgTAP test passes.
- [x] 4.2 Run the Deno suite green with `TB_AI_PROVIDER=fake` (`deno task test`); confirm the renamed-RPC unit test and the auth accept/deny tests pass with zero skips/failures.
- [x] 4.3 Run the plugin suite + build green: `cd obsidian-plugin && npm test && npm run build` (auth-header tests updated, zero skips/failures).
- [x] 4.4 Mutation check (GATE 2b): confirm reverting the header read or leaving a call site on `match_thoughts` reddens at least one test.
- [x] 4.5 Re-run the fingerprint grep (OB1/openbrain/Nate markers + the three rewritten fragments) across the repo; confirm only NOTICE/codeEval/openspec-archive historical mentions remain, and save the dated clean output into `~/Documents/PassiveIncomeChat/evidence/`.
- [x] 4.6 Update `scripts/validate-all.sh` / `npm run validate` if needed, then run it green.
- [x] 4.7 Walk each delta-spec scenario and confirm the implementation satisfies it (behaviour-neutral: search, ingest, extraction outputs unchanged).
