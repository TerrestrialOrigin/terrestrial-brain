## 1. Schema & Tool Description Changes

- [x] 1.1 Update `search_thoughts` tool description in `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` to append the CRITICAL directive (see design.md Decision 2 for exact wording).
- [x] 1.2 Relax `record_useful_thoughts` input schema in `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` by removing `.min(1)` from the `thought_ids` array Zod schema; confirm no other field enforces a lower bound.
- [x] 1.3 Update `record_useful_thoughts` tool description to state that an empty array is the correct input when no thought contributed, and that the call is required after every `search_thoughts`.

## 2. search_thoughts Response Layout

- [x] 2.1 Extract the existing footer-reminder builder into a new `buildUsefulnessHeader(thoughtIds: string[]): string` helper local to `tools/thoughts.ts`, returning the full multi-line header including the `⚠️ REQUIRED BEFORE NEXT USER RESPONSE:` prefix, numbered action items, `Candidate IDs from this search: [...]` line, and trailing `--- Results ---` separator.
- [x] 2.2 In the `search_thoughts` handler, prepend the header output of `buildUsefulnessHeader(thoughtIds)` to the results string and REMOVE the existing footer reminder line (the `\n\n---\nReminder: ...` concatenation at the current bottom).
- [x] 2.3 Leave the footer reminder in `list_thoughts` (tools/thoughts.ts) and in `queries.ts` (`get_project_summary`, `get_recent_activity`) unchanged — out of scope per proposal Non-goals.

## 3. capture_thought — builds_on Parameter

- [x] 3.1 Add `builds_on: z.string().uuid().array().optional().describe(...)` to the `capture_thought` input schema; description notes that listed UUIDs have their `usefulness_score` incremented as a side effect and that this is additive to `record_useful_thoughts`.
- [x] 3.2 In the `capture_thought` handler, after the `thoughts` insert succeeds, if `builds_on` is provided and `builds_on.length > 0`, call `supabase.rpc("increment_usefulness", { thought_ids: builds_on })`. On RPC failure, log the error to `console.error` (do NOT treat as fatal, do NOT roll back the insert).
- [x] 3.3 When `builds_on` is provided and non-empty, extend the confirmation string to append `credited N prior thought(s) as sources.` where N is the RPC's affectedCount; on RPC failure, append `— failed to credit sources: <error message>` instead.
- [x] 3.4 Update the `capture_thought` description to document the new `builds_on` parameter briefly (purpose + relationship to `record_useful_thoughts`).

## 4. Integration Tests

- [x] 4.1 In `tests/integration/thoughts.test.ts`, add a `record_useful_thoughts` test block (create if not already present) asserting: (a) calling with two real UUIDs bumps both scores by 1, (b) calling with an empty array returns `Recorded usefulness for 0 thought(s) out of 0 provided.` with no `isError`, (c) calling with a mix of real and unknown UUIDs bumps only the real one and reports the mismatched count.
- [x] 4.2 Add a `search_thoughts` layout test asserting: (a) the text payload starts with the `⚠️ REQUIRED BEFORE NEXT USER RESPONSE:` prefix, (b) the header contains `Candidate IDs from this search:` followed by a JSON array of the returned IDs, (c) the `--- Results ---` separator appears before the first result block, (d) the legacy footer `Reminder: If any of these thoughts were useful` substring is absent.
- [x] 4.3 Add a `capture_thought` test asserting that calling with `builds_on = [existingUuidA, existingUuidB]` inserts the new thought AND increments the `usefulness_score` of both prior thoughts by exactly 1 (read the rows back and assert the delta).
- [x] 4.4 Add a `capture_thought` regression test asserting that calling WITHOUT `builds_on` does NOT change any other thought's `usefulness_score` (capture a baseline score on a sentinel thought before the call and assert it is unchanged after).
- [x] 4.5 Add a `capture_thought` test asserting that `builds_on` containing an unknown UUID still inserts the new thought and reports `credited 1 prior thought(s) as sources.` when the other UUID does exist.
- [x] 4.6 Add a `capture_thought` test asserting that `builds_on = []` inserts the new thought, does NOT touch any score, and does NOT append the "credited N prior thought(s)" note to the confirmation.

## 5. Documentation

- [x] 5.1 Update `README.md` MCP tools section to document the new `record_useful_thoughts` empty-array behaviour and the new `capture_thought.builds_on` parameter.
- [x] 5.2 If `docs/api-frontend-guide.md` exists and documents either tool, update accordingly. (Confirmed absent at time of writing — skip if still missing.) — file still absent, skipped as planned.

## 6. Testing & Verification

- [x] 6.1 Run `deno test --allow-all tests/integration/thoughts.test.ts` against the local Supabase emulator and verify 0 failures, 0 skips. If an emulator is not running, start one with the project's standard supabase CLI commands before running. → 45 passed, 0 failed, 0 skipped.
- [x] 6.2 Run the full integration suite (`deno test --allow-all tests/integration/`) and verify 0 failures, 0 skips across all files (not just thoughts.test.ts). → 314 passed, 0 failed, 0 skipped.
- [x] 6.3 Typecheck / build the edge function package (`deno check supabase/functions/terrestrial-brain-mcp/index.ts` or the project's equivalent `npm run build`) and confirm zero errors. → Passed after fixing a pre-existing TS7006 in `tools/tasks.ts:296`.
- [x] 6.4 Walk through each scenario in `openspec/changes/usefulness-feedback-loop/specs/thoughts/spec.md` and confirm the implementation satisfies it; cross off any gaps before proceeding.
- [ ] 6.5 Deploy the edge function to the Supabase dev project (`supabase functions deploy terrestrial-brain-mcp`) and run a live smoke test: call `search_thoughts` from an MCP-connected model, confirm the `⚠️ REQUIRED BEFORE NEXT USER RESPONSE:` header appears first in the payload, and confirm the model follows up with a `record_useful_thoughts` call within the same turn.
- [x] 6.6 Run `openspec validate usefulness-feedback-loop` and confirm the change is still valid.
- [ ] 6.7 Run `/opsx:verify` then `/opsx:archive` to finalize the change.
