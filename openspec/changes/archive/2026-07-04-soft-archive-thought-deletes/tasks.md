## 1. Replicate the bugs (failing tests first)

- [x] 1.1 In `tests/integration/thoughts.test.ts`, add a failing test: ingest a note, then re-ingest with fully-replaced content so reconciliation marks the original thought for removal; assert the removed thought row STILL EXISTS with a non-null `archived_at` (direct service-role select, no archived filter). Confirmed it FAILS against current code (row is hard-deleted — vanishes entirely).
- [x] 1.2 In `tests/integration/documents.test.ts`, add a failing test: create a document with content + capture thoughts referencing it, then `update_document` with new content; assert the old thoughts STILL EXIST with non-null `archived_at`. Confirm it FAILS (thoughts are hard-deleted today).
- [x] 1.3 In `tests/integration/documents.test.ts`, add a failing test for the ordering bug: `update_document` with new content AND an invalid `project_id` (FK violation) so the document update fails; assert the tool returns an error AND the linked thoughts are UNTOUCHED (still active, `archived_at` null). Confirm it FAILS (today thoughts are deleted before the update fails).

## 2. Fix reconciliation soft-archive (C2)

- [x] 2.1 In `tools/thoughts.ts` reconciliation loop (~1057-1063), replace `.delete().eq("id", id)` with `.update({ archived_at: new Date().toISOString() }).eq("id", id)`; keep the error wording as an archive/removal failure. Preserve the `deleted++` counter and "removed" summary wording.
- [x] 2.2 Run test 1.1 and confirm it now PASSES.

## 3. Fix update_document ordering, soft-archive, and error surfacing (C2, C3)

- [x] 3.1 In `tools/documents.ts` `update_document`, reorder so the document `UPDATE` runs FIRST; move the thought-cleanup to AFTER a successful update.
- [x] 3.2 Replace the thought `.delete().contains(...)` with `.update({ archived_at: new Date().toISOString() }).contains("metadata", { references: { documents: [id] } })`.
- [x] 3.3 On a cleanup archive error, append a warning to the returned result text (do not only `console.error`); keep the tool's success status (document update already succeeded).
- [x] 3.4 Change the `thoughts_required` return line wording from "Previous thoughts were deleted" to "Previous thoughts were archived".
- [x] 3.5 Run tests 1.2 and 1.3 and confirm they now PASS.

## 4. Gates & verification

- [x] 4.1 Run the full Deno integration suite (`deno test --allow-net --allow-env tests/`) against the local Supabase stack; zero failures, zero skips.
- [x] 4.2 Run the plugin suite (`cd obsidian-plugin && npm test && npm run build`); zero failures.
- [x] 4.3 GATE 2b mutation check: revert each fix line mentally/temporarily and confirm the corresponding new test fails.
- [x] 4.4 `/opsx:verify`, then `/opsx:archive`; commit; open PR to `develop`; check off Step 4 in `codeEval/Fable20260704-fix-plan.md`.
