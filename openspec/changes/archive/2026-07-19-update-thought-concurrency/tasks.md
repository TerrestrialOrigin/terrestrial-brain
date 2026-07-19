# Tasks — update-thought-concurrency

## 1. Handler extraction (pure move)

- [x] 1.1 Extract `handleUpdateThought(aiProvider, thoughtRepository, args)` from the inline `update_thought` closure (behavior-preserving); register calls it; suite stays green

## 2. Replication tests (RED first)

- [x] 2.1 Unit: fake repository → assert handler passes `expectedUpdatedAt` from the read row and returns the concurrent-edit error on no-match; fresh-snapshot control; confirm RED
- [x] 2.2 Unit: fake Supabase client → guarded `update` chains `.eq("updated_at", …)` + `.select("id")`; unguarded chain unchanged; confirm RED
- [x] 2.3 Integration: stale-snapshot update against the real stack matches zero rows and preserves the first write; fresh re-read succeeds; confirm RED

## 3. Implementation

- [x] 3.1 `ThoughtRepository`: add `updated_at` to `ThoughtForUpdateRow` + `findForUpdate` select; add optional `options: { expectedUpdatedAt?: string }` to `update`; return matched-row-or-null
- [x] 3.2 `SupabaseThoughtRepository.update`: conditional `.eq("updated_at", …)` + `.select("id")`; `findForUpdate` selects `updated_at`
- [x] 3.3 `handleUpdateThought`: pass the guard; map no-match to the concurrent-edit error (D4 wording)
- [x] 3.4 All RED tests green; GATE 2b mutation check (drop the filter → red)

## 4. Testing & Verification

- [x] 4.1 `npx supabase db reset` + full `deno task test` — zero failures, zero skips
- [x] 4.2 `cd obsidian-plugin && npm test && npm run build` — green
- [x] 4.3 `scripts/validate-all.sh` — green
- [x] 4.4 Walk delta-spec scenarios; docs check
