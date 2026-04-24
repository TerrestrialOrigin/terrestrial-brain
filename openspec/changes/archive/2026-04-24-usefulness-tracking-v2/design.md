## Context

The prior `usefulness-feedback-loop` change landed the first layer of the scoring signal: a header reminder on `search_thoughts`, an empty-array allowance on `record_useful_thoughts`, and a synthesis-side `builds_on` parameter on `capture_thought`. Post-deployment observation shows two residual failure modes:

1. Even with the header present, models reliably skip the call when the search returns nothing useful — they don't map "nothing useful" onto "pass empty array." The existing reminder says so, but the message is one line deep in a block the model skims.
2. The reminder only lives on `search_thoughts`. `list_thoughts` carries a weak one-line footer ("Reminder: If any of these thoughts were useful…"), and `get_thought_by_id` carries nothing. So models learn a lopsided habit: score search results, ignore everything else.

The code was already written this session (four edits in `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` plus four new integration tests). This design doc is retroactive and exists to capture the rationale so future iterations don't re-litigate settled choices.

The existing `increment_usefulness` RPC in `supabase/migrations/20260404000001_thoughts_usefulness_score.sql` accepts a `uuid[]` and is already used by both `record_useful_thoughts` and `capture_thought`'s `builds_on` path, so no new DB surface is needed.

## Goals / Non-Goals

**Goals:**
- Raise the score capture rate on scans that turn up nothing useful (the empty-array path) by reinforcing the "empty array is the correct answer" wording and duplicating it across header and footer positions.
- Extend the reminder pattern to `list_thoughts` with softer wording that treats browsing as a first-class no-op.
- Eliminate model cooperation as a requirement on `get_thought_by_id` by server-enforcing the score bump when a fetch succeeds.
- Preserve a *layered-defense* architecture: model-cooperative signals (tool descriptions, header/footer reminders) combined with server-enforced signals (auto-record on unambiguous-intent tools). Future changes should preserve the mix rather than collapse to one layer.

**Non-Goals:**
- Do not extend auto-record to multi-result tools (`search_thoughts`, `list_thoughts`). A returned candidate is not a picked candidate; auto-recording every returned ID would over-credit.
- Do not introduce cross-call state tracking of "which IDs this session has already scored." Concurrent independent models hit the same MCP server; session-scoped state would misattribute.
- Do not touch `get_project_summary` or `get_recent_activity` yet. Measure the `list_thoughts` extension first.
- Do not surface `get_thought_by_id`'s auto-record in the tool's text output. The whole point is to make the signal free — advertising it would invite the model to "helpfully" also call `record_useful_thoughts` and double-count.

## Decisions

### Two reminder tiers (hard + soft), not one

**Decision:** Keep the existing `USEFULNESS_REMINDER_LINES` as the "hard" tier for `search_thoughts`, and introduce a parallel `USEFULNESS_REMINDER_LINES_SOFT` for `list_thoughts`. They share the same shape (header + footer wrapping around a `--- Results ---` separator) but differ in tone: hard opens with `⚠️ REQUIRED BEFORE NEXT USER RESPONSE`, soft opens with `⚠️ BEFORE NEXT USER RESPONSE` and explicitly names browsing as a valid no-op case.

**Why over a single shared reminder:** `search_thoughts` is nearly always a targeted query where the model expected *some* result to contribute. `list_thoughts` is often exploratory — asking the user the same forceful "REQUIRED" question after a neutral "show me what's here" call is a false signal about criticality that dulls the reminder when it actually matters. Two tiers preserves the calibration of the hard-tier warning.

**Alternatives considered:**
- Single reminder used everywhere — rejected for the calibration reason above.
- No reminder on `list_thoughts`, auto-record everything returned instead — rejected because many `list_thoughts` results never get used, and over-crediting is worse than under-crediting.

### Duplicated parenthetical across NEVER and ALWAYS clauses

**Decision:** The closing reminder line reads:

> NEVER skip the record_useful_thoughts step (if no thoughts were found useful, pass in an empty array)! ALWAYS do the record_useful_thoughts step (if no thoughts were found useful, pass in an empty array)!!!

The parenthetical is repeated on both clauses on purpose. Do not deduplicate.

**Why:** The empty-array path is the most commonly skipped step. The reminder appears twice in the `search_thoughts` payload (header + footer), so the parenthetical shows up four times across a single response. That density is the point — it's the same reason "REQUIRED" is in caps. Deduplicating trades observed behavior for a readability preference.

### Server-enforce on `get_thought_by_id`, not on the multi-result tools

**Decision:** On successful `get_thought_by_id`, call `increment_usefulness` with `[data.id]` before building the response. Swallow RPC errors via `console.error` so the fetch itself cannot break. Do not change the text output.

**Why this tool and not others:** A `get_thought_by_id` call requires the model to have picked a specific UUID — typically one it just read out of a `search_thoughts` or `list_thoughts` result and decided was worth expanding. The signal "this ID is useful" is already implicit in the fetch. By contrast, `search_thoughts` returns N candidates — some used, some not — and the model's picks are not observable server-side, so auto-record would over-credit.

**Why swallow the RPC error:** The fetch is the primary operation the model is waiting on. A score-bump failure is telemetry, not correctness. Returning an error payload from a successful fetch because a secondary bookkeeping call failed would be worse than losing one score increment.

**Alternatives considered:**
- Keep `get_thought_by_id` model-cooperative and add a reminder footer. Rejected: a reminder on a tool that returns a single already-identified thought is just noise — the model won't skip recording *this specific ID*, it'll skip recording *other IDs that also contributed*.
- Auto-record on `search_thoughts` / `list_thoughts` as well. Rejected: over-credits candidates the model ignored.

### Empty-result `list_thoughts` is not wrapped

**Decision:** When `list_thoughts` returns no data, respond with the unchanged plain `"No thoughts found."` — no header, no footer, no reminder.

**Why:** An empty browse is not a useful event to score. Wrapping it would train the model to associate "scanned nothing" with "must call `record_useful_thoughts` with empty array," which is low-signal noise that dilutes the useful cases.

### Documentation-only treatment of Change 1 (empty-array allowance)

**Decision:** The prior archived change already removed `minItems: 1` from `record_useful_thoughts`. Inspection confirmed the Zod schema has no `.min(1)`, the live JSON Schema emits no `minItems`, and the integration test `record_useful_thoughts accepts empty array without error` already passes. No code edit is made in this change.

**Why capture it anyway:** Making the behaviour a spec requirement (see `specs/thoughts/spec.md`) guards against a future refactor silently re-adding the minimum because "why would anyone pass an empty array." The spec records *why* empty arrays are valid.

## Risks / Trade-offs

- **Payload verbosity.** Every non-empty `list_thoughts` and `search_thoughts` response now carries the reminder twice. For consumers piping output into bounded context windows, this is measurable overhead. → Mitigated by empty-result responses staying unwrapped, and by the payloads already being small relative to model context. If it becomes an issue, the footer is the cheaper one to drop first (the header has primacy).
- **Asymmetric signal between tools.** A model that exclusively uses `get_thought_by_id` will see its score-bumps invisibly; a model that exclusively uses `search_thoughts` will see the nagging reminder. Over time this may lead to surprise when operators read scoring patterns and find "nobody ever called record_useful_thoughts on the IDs fetched by get_thought_by_id" — which is correct behaviour now. → Mitigated by this design doc; anyone confused by the gap can read here.
- **Over-crediting from self-reinforcing fetches.** If a model fetches the same thought by ID repeatedly in a single conversation (e.g., re-reading to answer follow-up questions), each fetch bumps the score. This slightly inflates scores for thoughts that happen to be long-running reference material. → Accepted. The scoring signal is about usefulness, and "used five times in one conversation" is genuinely more useful than "used once." Cross-session de-dup is a non-goal above.
- **RPC swallow hides real outages.** If `increment_usefulness` starts failing globally, `get_thought_by_id` silently stops scoring. → Mitigated by `console.error` landing in the edge-function log stream; the existing `function_call_logs` telemetry is untouched and still records the fetch itself.

## Migration Plan

No DB migration. Deployment is the standard `supabase functions deploy terrestrial-brain-mcp` (handled by `scripts/deploy-update-prod.sh`). Rollback is a revert of the `tools/thoughts.ts` commit and a redeploy — no data cleanup, no forward-incompatible state written.

## Open Questions

None outstanding. The measurement question (does the `list_thoughts` extension plus the `get_thought_by_id` auto-record measurably raise the proportion of thoughts with `usefulness_score > 1`?) is an observation task for the next iteration, not a blocker for this one.
