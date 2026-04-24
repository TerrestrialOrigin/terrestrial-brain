## 1. Reminder constants and helpers (supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts)

- [x] 1.1 Expand `USEFULNESS_REMINDER_LINES` to include a reinforcement line that repeats the "(if no thoughts were found useful, pass in an empty array)" parenthetical on both the NEVER-skip and ALWAYS-do clauses
- [x] 1.2 Add `USEFULNESS_REMINDER_LINES_SOFT` with softer `⚠️ BEFORE NEXT USER RESPONSE` wording that explicitly names browsing as a valid no-op
- [x] 1.3 Add `buildUsefulnessReminderSoft(thoughtIds)` helper that renders the soft reminder and appends a `Candidate IDs from this list:` JSON line
- [x] 1.4 Add `buildUsefulnessHeaderSoft(thoughtIds)` helper that wraps the soft reminder with a `\n\n--- Results ---\n\n` separator
- [x] 1.5 Verify the existing hard-tier `buildUsefulnessReminder` / `buildUsefulnessHeader` still compose correctly after the wording change

## 2. search_thoughts payload (tools/thoughts.ts)

- [x] 2.1 Update the `search_thoughts` handler to emit the hard reminder as both a header (existing) and a footer (new) around the results body
- [x] 2.2 Confirm no stray characters introduced in the header/footer concatenation (no leftover `"`, no stray `.` between results and footer)

## 3. list_thoughts payload (tools/thoughts.ts)

- [x] 3.1 Replace the legacy single-line `Reminder: If any of these thoughts were useful...` trailing note in `list_thoughts` with the soft header + footer pair built via `buildUsefulnessHeaderSoft` / `buildUsefulnessReminderSoft`
- [x] 3.2 Leave the empty-result branch (`"No thoughts found."`) unwrapped — no header, no footer, no reminder
- [x] 3.3 Append the CRITICAL usefulness-reminder paragraph to the `list_thoughts` tool description so the expectation is communicated at tool-selection time

## 4. get_thought_by_id auto-record (tools/thoughts.ts)

- [x] 4.1 After a successful fetch in the `get_thought_by_id` handler, call `supabase.rpc("increment_usefulness", { thought_ids: [data.id] })`
- [x] 4.2 On RPC error, log via `console.error` and continue — do not mark the response `isError: true`, do not alter the text payload
- [x] 4.3 Confirm the failed-fetch branch (PGRST116, DB error) returns early before the increment call, so misses never bump any score
- [x] 4.4 Confirm the visible text output of `get_thought_by_id` is unchanged (no reminder, no scoring mention)

## 5. record_useful_thoughts empty-array allowance (no code change)

- [x] 5.1 Confirm the Zod schema on `record_useful_thoughts.thought_ids` has no `.min(1)` (spot-check `tools/thoughts.ts`)
- [x] 5.2 Confirm the live JSON Schema emits no `minItems` (spot-check via MCP `tools/list`)
- [x] 5.3 Confirm the pre-existing integration test `record_useful_thoughts accepts empty array without error` passes

## 6. Testing & Verification

- [x] 6.1 Add integration test `list_thoughts payload is wrapped with soft usefulness header and footer`
- [x] 6.2 Add integration test `list_thoughts returns plain 'No thoughts found' without reminder when empty`
- [x] 6.3 Add integration test `get_thought_by_id auto-increments usefulness score by exactly 1`
- [x] 6.4 Add integration test `get_thought_by_id for unknown UUID does not increment any score`
- [x] 6.5 Add integration test `search_thoughts payload ends with a trailing usefulness reminder footer`
- [x] 6.6 Run `deno check tools/thoughts.ts index.ts tests/integration/thoughts.test.ts` — must be clean
- [x] 6.7 Run full integration suite (`deno test --allow-net --allow-env tests/integration/`) — must report 0 failed, 0 skipped
