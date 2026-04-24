## Why

The `usefulness-feedback-loop` change (archived 2026-04-23) moved the reminder to a header and added `builds_on`, but on-going usage still shows two failure modes: (1) models read the header while the tool call is streaming, then miss the empty-array path when the search returns nothing useful and skip `record_useful_thoughts` entirely; (2) only `search_thoughts` carries the reminder, so models learn an asymmetric habit of scoring only search results and ignoring equally-useful thoughts surfaced by `list_thoughts` or fetched by `get_thought_by_id`. The signal needs to be reinforced in more moments of high attention, extended to sibling tools, and — where it can be — shifted from model-cooperative to server-enforced.

## What Changes

- Reinforce the `USEFULNESS_REMINDER_LINES` block with a repeated, explicit parenthetical on both the NEVER-skip and ALWAYS-do clauses calling out that an empty array is the correct input when no thought was useful. The duplication across clauses is intentional — this is the step models skip most, and the reminder appears twice (header + footer) in the `search_thoughts` payload, so strengthening each copy compounds.
- Add a `USEFULNESS_REMINDER_LINES_SOFT` variant (softer `⚠️ BEFORE NEXT USER RESPONSE` wording that explicitly treats browsing as a valid no-op), with `buildUsefulnessReminderSoft` / `buildUsefulnessHeaderSoft` helpers, and apply a symmetric header + footer wrapping to `list_thoughts` non-empty results. Empty-result responses (`"No thoughts found."`) are left unwrapped so the model is not trained to score empty scans. The legacy one-line `Reminder: If any of these thoughts were useful` footer is removed from `list_thoughts` and replaced by the soft header/footer pair.
- Append the same CRITICAL usefulness-reminder paragraph to the `list_thoughts` tool description that `search_thoughts` already carries, so the expectation is communicated at tool-selection time as well as in the response.
- **Server-enforced on `get_thought_by_id`:** after a successful single-thought fetch, the handler auto-increments the usefulness score for the fetched ID by calling the existing `increment_usefulness` RPC. Rationale: a model explicitly fetching a thought by ID has almost certainly already found it useful, so requiring a separate `record_useful_thoughts` call is redundant cognitive overhead the model frequently skips. RPC failures are logged via `console.error` and swallowed — the fetch is the primary operation, scoring is secondary. No visible change in the tool's text output.
- Documentation-only: the `record_useful_thoughts` empty-array allowance is already in effect. The prior change's `minItems: 1 → 0` relaxation was already merged; the Zod schema has no `.min(1)`, the live JSON Schema emits no `minItems`, and the pre-existing integration test `record_useful_thoughts accepts empty array without error` already passes. This proposal captures that behaviour as a spec requirement so a future refactor cannot silently re-introduce the minimum.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `thoughts`: expands `search_thoughts` reminder wording; adds a symmetric soft header/footer reminder + CRITICAL tool-description directive to `list_thoughts`; adds server-side auto-record of usefulness on successful `get_thought_by_id`; asserts that `record_useful_thoughts` accepts an empty `thought_ids` array as a first-class "scan acknowledged, nothing useful" signal. Affected spec file: `openspec/specs/thoughts/spec.md`.

## Non-goals

- **Per-thought inline reminder tags** inside each rendered result block in `search_thoughts`/`list_thoughts`. Rejected: attention erosion — interleaving reminder text with result content dilutes both.
- **Server-side usefulness inference based on content overlap** between the query and each candidate thought (e.g., "mark anything with >N keyword matches as useful"). Rejected: a text-overlap heuristic is not qualified to judge whether a thought genuinely contributed to the model's reasoning; over-crediting pollutes the signal worse than under-crediting.
- **Cross-session receipt tracking** that remembers which thoughts a given session has already recorded and suppresses re-recording. Rejected: state-management cost, cache invalidation surface, and privacy posture outweigh the benefit over the simpler "idempotent-ish increment" model.
- **Extending the reminder to `get_project_summary` and `get_recent_activity`.** Deferred: same scoping principle the prior change followed — measure whether `list_thoughts` parity moves the needle before rolling further.
- **Converting any more tools to server-enforced auto-record.** `get_thought_by_id` is the only tool where "you asked for exactly this UUID" is a strong enough signal to skip the model. `search_thoughts` and `list_thoughts` return candidates, not picks, so auto-recording every returned ID would over-credit.

## Impact

- **Affected code:**
  - `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` — new `USEFULNESS_REMINDER_LINES_SOFT` / `buildUsefulnessReminderSoft` / `buildUsefulnessHeaderSoft`; expanded wording in `USEFULNESS_REMINDER_LINES`; `list_thoughts` handler wraps non-empty results with soft header/footer and drops the legacy trailing line; `list_thoughts` tool description gains the CRITICAL paragraph; `get_thought_by_id` handler calls `increment_usefulness` on success, log-and-swallow on RPC failure.
- **Affected tests** (`tests/integration/thoughts.test.ts`):
  - `list_thoughts payload is wrapped with soft usefulness header and footer`
  - `list_thoughts returns plain 'No thoughts found' without reminder when empty`
  - `get_thought_by_id auto-increments usefulness score by exactly 1`
  - `get_thought_by_id for unknown UUID does not increment any score`
  - `search_thoughts payload ends with a trailing usefulness reminder footer`
- **Database:** no migrations. `get_thought_by_id` reuses the existing `increment_usefulness` RPC from `supabase/migrations/20260404000001_thoughts_usefulness_score.sql`.
- **API compatibility:** `list_thoughts` text payload shape changes — the legacy one-line footer is replaced by a header + footer block. Consumers that parse by string-matching the old `Reminder: If any of these thoughts were useful` line will need to update (in practice: only AI tool callers, which the reminder is explicitly designed to retrain). No JSON-schema-level breakage; all fields are unchanged. `get_thought_by_id` observable output is unchanged.
- **Documentation:** none required for this change — reminder text is generated in-code and visible in-payload.
