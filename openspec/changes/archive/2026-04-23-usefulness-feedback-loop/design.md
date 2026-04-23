## Context

The `usefulness_score` column and the `record_useful_thoughts` MCP tool were shipped in mid-March 2026 (migration `20260404000001_thoughts_usefulness_score.sql`) as a feedback mechanism: when a model uses a retrieved thought to answer a question, it calls `record_useful_thoughts` and the scores are incremented atomically via the `increment_usefulness(uuid[])` RPC. Over ~4 weeks of live usage against the production Supabase instance, only 8 thoughts have a `usefulness_score > 1`. The retrieval traffic volume from Obsidian-driven and MCP-driven conversations is far higher than that count implies, so the loop is under-closed — models read the thoughts, answer the user, and skip the feedback call.

The current placement of the reminder is a single line at the end of the `search_thoughts` response:

```
---
Reminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs: [...]
```

Empirically, by the time a model has read all result blocks it has already composed a user-facing response in its working memory and tends to discard the trailing instruction. The fix concentrates the nudge into moments of high attention:

1. The **tool description** (read at the moment of invocation).
2. The **top** of the response payload (read while results are still streaming in).
3. The `capture_thought` call itself (a call the model makes anyway when synthesizing from retrieved context).

## Goals / Non-Goals

**Goals:**

- Increase the rate at which `record_useful_thoughts` is called after `search_thoughts`, measured by the number of non-zero `usefulness_score` rows and calls to `record_useful_thoughts` per `search_thoughts` call.
- Make the feedback call always executable after a search, including when nothing was useful, so the model never has a reason to skip it.
- Give models a second, low-friction path to close the loop during thought synthesis via `builds_on` on `capture_thought`.
- Surface suspected contradictions or outdated thoughts to the user without taking destructive action on model judgment alone.

**Non-Goals:**

- Cross-call server-side session/pending-action state. Rejected: multiple models/conversations run concurrently with no shared session identifier; tracking pending actions server-side would misattribute activity.
- Auto-archive on suspected contradiction. Deferred: archive is effectively irreversible for user experience; v1 surfaces, v2 could act once we have false-positive data.
- `supersedes` / `contradicts` structured parameters on `capture_thought`. Deferred: manual archive + future auto-archive of stale/low-usefulness thoughts is expected to cover this.
- A two-phase `search_thoughts` → `hydrate_thoughts` protocol that forces recording on the critical path. Deferred: kept as a fallback if the softer header-based nudge underperforms.
- Rolling the header pattern out to `list_thoughts`, `get_project_summary`, and `get_recent_activity`. Deliberately scoped out; we measure the `search_thoughts`-only change first.

## Decisions

### Decision 1: Reminder moves to the HEADER of the `search_thoughts` response

The reminder is emitted as the first line of the text payload, above the `Found N thought(s):` summary and above the individual result blocks. The candidate IDs are listed in the header, so the model does not need to scroll back to collect them.

Chosen format:

```
⚠️ REQUIRED BEFORE NEXT USER RESPONSE:
1. Call record_useful_thoughts with IDs that contributed (or empty array).
2. Scan these results for contradictions/outdated data — surface to user, do NOT archive silently.

Candidate IDs from this search: ["…", "…"]

--- Results ---
<existing "Found N thought(s): …" block and result blocks>
```

**Alternatives considered:**

- *Leave reminder at footer, make text more urgent.* Rejected: the problem is positional, not tonal. Adding exclamation points to a footer does not move it up the attention budget.
- *Emit reminder both at header and footer.* Rejected: adds payload noise with no expected additional lift; header alone is sufficient to front-load the directive.
- *Return the reminder as a separate `content` block.* Rejected: MCP clients typically concatenate content blocks — no attention benefit, and some logging/telemetry pipelines only stringify the first block.

### Decision 2: Tool description for `search_thoughts` gains a CRITICAL directive

Appended to the existing description:

> CRITICAL: Before your next user-facing response, you MUST call `record_useful_thoughts` with the IDs of any thoughts that contributed to your answer. If none contributed, call it with an empty array to acknowledge the scan. Also scan the returned thoughts for contradictions or clearly outdated information — if you notice any, flag them to the user in your response (do NOT archive silently).

This is the highest-attention surface in the MCP flow — tool descriptions are read at the moment of tool selection, before the model has decided what arguments to pass, much less committed to a response shape.

**Alternatives considered:**

- *Put the directive only in the response payload.* Rejected: the description hits earlier in the decision path; both surfaces reinforce each other.
- *Add the directive to a system/meta tool.* Rejected: MCP has no canonical system-prompt mechanism for per-tool behavioural rules; the tool description is the mechanism.

### Decision 3: `record_useful_thoughts` accepts an empty `thought_ids` array

Change the Zod schema from `z.string().uuid().array().min(1)` to `z.string().uuid().array().min(0)` (equivalently `.array()` without `.min`). The handler passes the array straight to the `increment_usefulness(uuid[])` RPC, which is already safe with an empty array (the PostgreSQL function performs a `WHERE id = ANY(thought_ids)` update, which no-ops on an empty array).

Response when called with `[]`:

```
Recorded usefulness for 0 thought(s) out of 0 provided.
```

**Why this matters:** the directive in Decisions 1+2 tells the model to always call `record_useful_thoughts` after a search. If the schema rejects empty arrays, a rational model faced with "nothing was useful" will skip the call rather than fabricate IDs — re-creating the original under-utilisation we are fixing. Relaxing the schema makes the instruction always-satisfiable.

**Alternatives considered:**

- *Keep `minItems: 1` and tell models to pass a placeholder "no useful thoughts" sentinel UUID.* Rejected: invents a magic UUID, pollutes the `thoughts` table with a synthetic row, fragile.
- *Add a separate `acknowledge_search` tool.* Rejected: doubles the tool surface for a negligible UX gain; one tool that accepts `[]` is simpler.

### Decision 4: `capture_thought` gains optional `builds_on?: string[]`

New optional parameter, added to the Zod schema and to the handler. When provided and non-empty, after the new thought is inserted successfully, the handler calls `increment_usefulness(builds_on)` and includes the affected count in the confirmation message ("Captured as …; credited N prior thought(s) as sources."). On RPC failure, the capture is NOT rolled back — the new thought is primary, the score increment is a best-effort side-effect; an error is logged server-side and the confirmation notes the failure.

This is deliberately additive, not a replacement for `record_useful_thoughts`. A typical synthesis flow does BOTH: `search_thoughts` returns five candidates, the model records three as useful via `record_useful_thoughts`, and then writes a derived thought via `capture_thought` listing the same three in `builds_on`. The double-count is intentional — a thought that both helped answer the immediate question AND became a source for a new thought is genuinely twice as useful.

**Alternatives considered:**

- *Have `builds_on` replace `record_useful_thoughts` for synthesis.* Rejected: the two capture different signals; synthesis happens only in a subset of search flows.
- *Record `builds_on` as a structural relationship (e.g. `derived_from` column on `thoughts`).* Deferred: out of scope for v1, the usefulness score is sufficient signal; a structural edge would imply querying behaviour we are not building yet.
- *Increment `builds_on` scores atomically in the same transaction as the insert.* Rejected: the RPC cannot be chained inside the `.from('thoughts').insert()` call without a custom stored procedure; the operational benefit of a true transaction is low here (score drift of ±1 is acceptable).

### Decision 5: Contradiction detection is behavioural only, no new tool or column

The header reminder instructs the model to scan results for contradictions/outdated data and flag them in its user-facing response. No `contradicts` parameter, no `flag_contradiction` tool, no auto-archive. If the model is wrong about a "contradiction", surfacing to the user is the safe failure mode: the user can confirm or dismiss, nothing is destroyed.

This intentionally leaves the scaffolding for a future `flag_contradiction` tool, but we do not build it until we have data on false-positive rate.

**Alternatives considered:**

- *Add a `flag_contradiction(thought_id, reason)` tool now.* Rejected: no data yet on how often model-suspected contradictions are real; adding a tool implies we want the signal captured structurally, which we do not yet.
- *Auto-archive any thought the model tags as contradicted.* Rejected: destructive action on model judgment, irreversible user experience.

### Test Strategy

- **Integration tests (Deno test against real Supabase local emulator):**
  - `record_useful_thoughts` accepts `thought_ids: []` and returns the zero-count confirmation.
  - `record_useful_thoughts` with real UUIDs increments `usefulness_score` (already covered — keep green).
  - `search_thoughts` response payload has the `⚠️ REQUIRED BEFORE NEXT USER RESPONSE` header as the first characters of the text block, includes the candidate IDs array, and the `--- Results ---` separator appears before the first result.
  - `capture_thought` with `builds_on: [uuid1, uuid2]` inserts the new thought AND bumps both prior thoughts' `usefulness_score` by 1.
  - `capture_thought` without `builds_on` does not touch any other thought's score (regression guard).
  - `capture_thought` with `builds_on` containing a non-existent UUID still succeeds (the new thought is inserted, confirmation notes 0 credited).
- **Unit tests:** none new. The Zod schema changes are exercised end-to-end by the integration tests; a dedicated unit test for `.min(0)` would be tautological.
- **No E2E tests needed:** there is no browser surface for this change. The Obsidian plugin does not call `record_useful_thoughts` or `capture_thought` from the UI side; the flow is model → MCP only.
- **Manual smoke test:** after deploy, run a live session that calls `search_thoughts`, observe that a frontier model (Claude 4.x or GPT-4o) actually calls `record_useful_thoughts` unprompted within the same turn, for both the "found useful thoughts" and "nothing useful" cases.

### User Error Scenarios

The "user" for the MCP tools is an AI model, so user error is model error:

- **Model passes non-UUID strings to `record_useful_thoughts.thought_ids` or `capture_thought.builds_on`.** Zod `z.string().uuid()` rejects at the MCP boundary; the tool returns a validation error before hitting the RPC.
- **Model passes real-looking UUIDs that do not exist in `thoughts`.** `increment_usefulness` performs `UPDATE ... WHERE id = ANY(thought_ids)`; non-matching IDs are silently skipped. Confirmation reports `Recorded usefulness for X thought(s) out of N provided` so the mismatch is visible in the model's next turn.
- **Model calls `record_useful_thoughts` with an empty array.** After this change, supported; handler returns `Recorded usefulness for 0 thought(s) out of 0 provided`.
- **Model passes `builds_on` containing the UUID of a thought being created in the same call.** Impossible by construction — the new thought's UUID is generated on insert, so the model cannot reference it. `builds_on` only references prior thoughts.
- **Model passes the same UUID multiple times in `builds_on`.** `increment_usefulness` treats the input as `uuid[]`; PostgreSQL's `ANY(thought_ids)` matches once per matching row in the `thoughts` table, so duplicates in the input do not cause over-increment. Documented behaviour; no de-dup needed in the handler.
- **Model ignores the directive and does not call `record_useful_thoughts`.** No failure — we degrade gracefully to today's under-reporting behaviour. The point of the change is to shift the distribution, not to enforce.
- **Model incorrectly flags a contradiction.** By design, contradictions are surfaced to the user, not acted on. The user can correct the model in the conversation; no destructive operation occurs.

### Security Analysis

Threats evaluated (no new ThreatModel.md entry required — the attack surface is unchanged):

- **Score inflation via `builds_on`.** A model authenticated with the correct `x-brain-key` already has unrestricted access to `record_useful_thoughts`; `builds_on` does not widen the attack surface. Mitigation: authentication is unchanged; no additional rate limiting needed.
- **Data exfiltration via header candidate IDs.** The header block includes thought UUIDs already present in the response body — no new data leaks.
- **Prompt injection via reminder text.** The header text is a static server-controlled string; no user or thought content is interpolated into the directive portion. Only the `Candidate IDs` list is dynamic, and those are UUIDs that have already been validated when written.
- **DoS via large empty `record_useful_thoughts` calls.** Empty-array calls cost one RPC round-trip and no DB writes; not a new vector. If abuse becomes real, add a per-key rate limit at the edge function — not part of this change.

No changes to `MCP_ACCESS_KEY` handling, no new endpoints, no changes to RLS.

### API Contract

This change is MCP-only; there are no new HTTP routes and no changes to existing HTTP routes under `supabase/functions/terrestrial-brain-mcp/index.ts`. The Obsidian plugin does not call `record_useful_thoughts` or `capture_thought` and is not affected. No front-end guide update needed beyond noting the schema relaxation in the MCP tools section of `README.md`.

## Risks / Trade-offs

- **Risk: Models still ignore the header directive.** → **Mitigation:** the change is cheap and observable; if 2 weeks of post-deploy telemetry show no uplift in `record_useful_thoughts` call rate, escalate to the deferred two-phase `hydrate_thoughts` protocol.
- **Risk: False-positive contradiction flags annoy the user.** → **Mitigation:** surface-don't-act keeps the cost to one line of chat text; collect examples to decide whether a structural `flag_contradiction` tool is worth building.
- **Risk: `builds_on` double-counts artificially inflate scores.** → **Accepted trade-off:** a thought used both to answer and as a source is genuinely twice as useful; no correction needed.
- **Risk: Schema relaxation is a visible (if compatible) MCP contract change.** → **Mitigation:** any existing caller that passed `minItems >= 1` continues to work; only new callers gain the ability to pass `[]`.
- **Risk: `capture_thought` `builds_on` RPC failure leaves an inserted thought without credited sources.** → **Accepted trade-off:** the new thought is the primary durable state; credit is best-effort. Handler logs and confirmation message reports the failure so the model can retry via `record_useful_thoughts`.

## Migration Plan

No database migration. Deployment is an edge-function redeploy:

1. Merge the feature branch, run `supabase functions deploy terrestrial-brain-mcp`.
2. The next `search_thoughts` call by any model surfaces the new header.
3. Rollback: revert the single commit and re-deploy; no data change to undo.

## Open Questions

None blocking implementation. Measurement question for post-deploy: what threshold of `record_useful_thoughts` call rate per `search_thoughts` call do we treat as "success" before deciding whether to roll the header pattern out to `list_thoughts` / `get_project_summary` / `get_recent_activity`?
