## Context

Terrestrial Brain stores thoughts, projects, tasks, and documents and exposes them to AI agents
over an MCP server. It accumulates memory well but **curates it poorly**: the Step 4 audit
(`codeEval/Fable20260712-MemoryMechanismAudit.md`) showed that dedup, near-dup avoidance, and
extraction-`type` validation are prompt-nudge only and drift in production. Before Step 7 writes
any enforcement code — and before Step 6 writes the tests/eval harness — the **rules** must exist
as an exhaustive, testable specification.

Current relevant state (grounding, from migrations — unchanged by this step):
- `thoughts`: `usefulness_score int not null default 0`, `archived_at timestamptz null`,
  `embedding vector`, `metadata jsonb` (holds `type`, **no DB CHECK**). No `content_hash`, no
  `supersedes` edge, no `last_retrieved_at` — those are Step 7 to *build*, Step 5 to *specify*.
- `tasks`: `status in ('open','in_progress','done','deferred')`, `archived_at`. No external ref,
  no origin/actor columns yet.
- `projects`, `people`: `archived_at`. `note_snapshots`: exact whole-note content match (the one
  server-side dedup that works today, narrow by design).
- `function_call_logs.returned_ids` (jsonb, ids-only) — added in Step 2b, the retrieval-signal
  precursor for `last_retrieved_at`.

This design is **specification-only**. It defines target behavior and the decisions that shape the
scenarios; it changes no code, schema, or data. Every decision below becomes one or more
GIVEN/WHEN/THEN scenarios in the delta specs, each tagged `test` or `eval`.

## Goals / Non-Goals

**Goals:**
- Specify the complete condition→outcome ruleset for every mutation of thoughts/projects/tasks/
  documents: supersession, staleness/decay, usefulness reinforcement, archival, task
  reconciliation, write-time dedup, extraction-`type` validation, re-embed/re-hash.
- Make the `actor` (LLM | user | sync) a first-class dimension on every mutation rule — one
  ruleset, no console/connector fork (Invariant 2).
- Classify every scenario `test` (deterministic) or `eval` (LLM-behavior, thresholded), and bias
  the design so as many rules as possible are `test` via server-side enforcement.
- Resolve the three Step-4 handoff decisions (dedup threshold, `type` allowlist, rubber-stamp
  down-weighting) with rationale, so Step 6/7 inherit choices, not questions.
- Spec the PMS↔TB sync rules now (implementation deferred to v1.5+ connectors) so status
  ownership and the actor model are defined once.

**Non-Goals:**
- No implementation, migration, schema, or data change (Step 7). No tests written (Step 6). No
  connector, OAuth, webhook endpoint, or console UI built.
- No production cleanup of the audit's bad-data inventory.
- Not re-specifying already-correct mechanisms (server-side usefulness increment, entity
  extraction, exact re-sync guard) beyond referencing them as the baseline.

## Decisions

### D1 — One ruleset with an `actor` dimension; the console is not special
Every mutation scenario is written once and parameterized by `actor ∈ {LLM, user, sync}`. The
memory console (Step 17) and future connectors do **not** get their own rules; they invoke the
same rules with `actor: user` / `actor: sync`. **Why:** Invariant 2 — a separate, more-permissive
UI path is exactly how "TB doesn't match my Jira" returns as a bug. *Alternative rejected:* a
console-specific ruleset — silently diverges from the LLM path and doubles the surface to verify.
Where an outcome legitimately depends on actor (e.g. consent prompts render as UI for `user`, as a
tool-call question for `LLM`), the scenario states the actor-conditioned outcome explicitly rather
than forking the rule.

### D2 — Write-time deduplication is a server-side gate; threshold band 0.05–0.10 cosine distance
Dedup moves from prompt-nudge to a server-side embedding-distance check on every write path that
creates a thought (`capture_thought`, the ingest reconciliation `add` branch, the fresh-ingest
fallback). The **gate distance is a tight 0.05–0.10 cosine-distance band** — distinct from the
read-side 0.5 *retrieval* threshold, which is a relevance cutoff, not an identity cutoff. **Why:**
the Step 4 sample showed effectively-identical restatements clustered at < 0.05 and clear near-twins
< 0.10, while 0.15+ already includes legitimately distinct thoughts; a read threshold used as a
dedup gate would collapse unrelated memories. *Alternatives considered:* content-hash exact match
only (misses the ~13% near-dup rate — restatements differ by a word); a single fixed 0.5 (far too
loose — mass false-merge). The **outcome on a hit** is specified as a rule, not left to the model:
within-note near-dup → keep existing, drop the new (the intra-note restatement case that dominates
the audit); cross-context near-dup → surface as a supersession candidate rather than silent drop
(see D4), because a genuinely new observation that happens to be worded like an old one must not
vanish. The exact numeric threshold and the keep/merge policy are `eval`-observable at the margin
but the **gate-exists / exact-dup-blocked** behavior is `test`.

### D3 — Extraction `type`: parse against the allowlist; extend it with `instruction` and `decision`
`extractMetadata` output is parsed (not cast) against `THOUGHT_TYPES`. The allowlist is **extended**
to add `instruction` and `decision` (the two out-of-allowlist values the audit found in prod, both
plausibly useful and clearly intended by the splitter prompt), giving:
`observation, task, idea, reference, person_note, instruction, decision`. Any value **outside** the
extended allowlist maps to the documented fallback **`observation`** and the coercion is logged.
**Why:** `parse, don't cast` is a hard project rule; extending is cheaper than coercing away signal
the model reliably produces, and both new values already exist in prod data. *Alternative rejected:*
coerce `instruction`/`decision` → `observation` (discards real distinctions the model already draws;
still needs the same parse gate anyway). The **parse-and-fallback** behavior is `test`; whether the
model picks the "right" type for ambiguous content is `eval`.

### D4 — Supersession: an explicit `supersedes` edge + capture-time contradiction check
When new content contradicts an existing thought (not merely duplicates it), the rule is
**supersede, don't delete**: mark the older thought superseded-by the newer via an explicit edge,
keep both for audit/history, and exclude superseded thoughts from default retrieval. Detection is
one added AI call in the existing capture pipeline via the `AiProvider` seam; the model may also
invoke an explicit **resolve** tool. **Why:** deletion is unrecoverable and loses the "what did we
believe before" trail; an edge makes contradiction handling inspectable and reversible.
*Alternative rejected:* overwrite-in-place (violates INVARIANT 1's audit intent and destroys
history). Contradiction *detection* is `eval` (model judgment); the *effect* of a recorded
supersession (superseded thought leaves default search, edge is queryable, re-embed fires) is
`test`.

### D5 — Staleness/decay and archival are multi-signal and human-queued — never score-alone
Per the Step 4 archival verdict: `usefulness_score = 0` means "no data," not "not useful." Archival
is gated on a **conjunction** — age AND score-still-0 AND no retrieval signal
(`last_retrieved_at` / `returned_ids`) AND not owned by a live synced note — and even then it lands
in a **review queue** surfaced via an MCP tool, not auto-applied. **Why:** the deliberate score
reset + one-time vault import make any score-alone window archive live reference material.
*Alternative rejected:* score-threshold auto-archive (the audit explicitly forbids it before
~2026-10-01 and ≥200 clean increments). Queue construction (the conjunction query) is `test`; the
decision to actually archive a queued item is a consented `user`/`LLM` action, itself a `test` on
the state transition.

### D6 — Usefulness reinforcement keeps the server-side ledger; add rubber-stamp down-weighting
The existing server-side increment stays. New rule: a `record_useful_thoughts` call that lists
**nearly all** returned ids (a rubber-stamp) counts for **less** than a selective one. **Why:** the
audit found high but indiscriminate compliance; an "everything was useful" signal carries little
information and would otherwise inflate scores uniformly. The exact down-weighting curve is a
`design` constant; the **observable rule** — a call selecting all-of-N increments less than a call
selecting few-of-N — is specified as a scenario. Reinforcement remains `actor: LLM`-only
(auto-recorded server-side for `get_thought_by_id`); `user`/`sync` do not reinforce.

### D7 — Task reconciliation is consent-based; status has one owner
The reconciliation sweep proposes "these open tasks look done per recent thoughts" and **asks
before closing** — never auto-closes. For PMS-origin tasks, **PMS owns status**: closing in TB
surfaces the consented-close choice ("close it upstream too / I'll do it there"); on decline or
upstream-failure the TB task **stays open** so the two systems can never silently disagree.
Locally-born tasks are fully TB-owned. **Why:** single-owner-per-task is the integrations
invariant; consent keeps the human in the loop for irreversible closes. *Alternative rejected:*
auto-close on inferred completion (double-owner divergence + surprise). Consent-prompt-exists and
stays-open-on-failure are `test`; whether the sweep correctly *identifies* done-looking tasks is
`eval`.

### D8 — Re-embed + re-hash on every content edit, in the ONE server-side update path (INVARIANT 1)
Any edit changing stored text — thought/project/task/document, by any actor — MUST re-embed and
re-hash in the single server-side update path; never in caller/UI code. The canonical scenario:
*"GIVEN an entity edited via any path, WHEN searched by its new wording, THEN it matches — AND its
stored hash equals the hash of the new content."* `update_thought` already does this for thoughts
(Step 4 verified); the spec **extends the guarantee** to projects/tasks/documents. This is the
highest-value `test` in the change — it is the disease this product claims to cure.

### D9 — Integration sync rules specced now, implemented later
PMS→TB ingest (map native `statusCategory`, never board columns), no autonomous TB→PMS push,
consented close, ask-first creation, status precedence, and **webhook at-least-once idempotency**
(cursor + content-hash gate so retries/dupes/trivial-edit events don't re-trigger extraction) are
all specced under `integration-sync-rules` with `actor: sync`. **Why:** the plan mandates specing
them once alongside the memory rules even though connectors are v1.5+; the actor model and the
dedup/hash gate are shared, so specing them together prevents a later parallel ruleset. All are
tagged `test` where the outcome is deterministic (idempotent replay, stays-open-on-failure) and
`eval` only where model judgment enters (ask-first phrasing).

### Test Strategy
- **`test` (deterministic, must always pass):** every rule whose outcome is a pure function of
  state — dedup gate exists and blocks exact/near-dup at threshold, `type` parse+fallback,
  supersession *effect*, archival-queue conjunction, re-embed/re-hash invariant, consent-prompt
  presence, stays-open-on-failure, webhook idempotent replay, rubber-stamp relative down-weighting.
  In Step 6 these map to integration tests on the real local stack (`TB_AI_PROVIDER=fake`), no
  mocks on the tested path.
- **`eval` (LLM-behavior, pass-rate ≥ threshold):** every rule needing model judgment —
  contradiction *detection*, correct `type` on ambiguous content, near-dup keep/merge choice at the
  margin, reconciliation *identification* of done-looking tasks, ask-first phrasing. In Step 6 these
  run in a scored, thresholded eval harness (opt-in task, never a silent skip).
- **Design bias (explicit):** wherever a rule *could* be either, push it to `test` by moving the
  decision server-side. The `eval` set is minimized by construction; each remaining `eval` names
  why it cannot be deterministic.

### User-error scenarios (specced as scenarios)
- **Double capture / double sync** (user pastes twice, webhook redelivers) → dedup gate (D2) +
  idempotency (D9) absorb it; no duplicate row, no re-extraction.
- **User edits a thought to gibberish / empties it** → still re-embeds + re-hashes (D8); empty
  content is a valid "loaded but empty" state, not an error swallow; the mutation is recorded.
- **User closes a PMS-origin task in the console expecting it gone** → consented-close prompt (D7),
  not a silent local-only close that diverges from Jira.
- **Model emits a hallucinated `type`** → parsed to fallback (D3), never stored raw.
- **Model proposes superseding a thought that is actually still valid** → supersession is an edge,
  reversible via the resolve tool (D4); nothing is deleted.
- **Reconciliation misjudges an open task as done** → consent gate (D7) means the human declines;
  no data lost.

### Security analysis (→ `ThreatModel.md`)
This ruleset **is** the authorization/integrity surface for mutations, so its threats are
data-integrity threats:
- **T-lifecycle-1 — bypass path.** A future console or connector writing directly (skipping the
  one server-side update path) would evade re-embed/re-hash and the dedup gate → stale search +
  duplicate leak. *Mitigation:* Invariant 1/2 specced as `test`; every actor routes through the one
  path; no direct-write surface is authorized.
- **T-lifecycle-2 — poisoned extraction.** A hallucinated/injected `type` (or other metadata)
  flowing unvalidated into a stored mutation. *Mitigation:* D3 parse-against-allowlist with logged
  fallback; the write is validated at the seam.
- **T-lifecycle-3 — silent status divergence.** A UI shortcut closing a PMS-origin task locally
  only, so TB and the PMS disagree without anyone consenting. *Mitigation:* D7 consented close +
  stays-open-on-failure; PMS owns status.
- **T-lifecycle-4 — destructive supersession.** Contradiction handling that deletes the older
  belief loses the audit trail and is unrecoverable. *Mitigation:* D4 edge-not-delete; superseded
  rows retained and queryable.
- **T-lifecycle-5 — webhook replay/forgery.** At-least-once delivery re-triggering extraction or a
  forged event mutating memory. *Mitigation:* D9 cursor + content-hash idempotency; connector
  secret validation (deferred to implementation but specced).
A `ThreatModel.md` note records these as spec-integrity threats owned by this ruleset.

## Risks / Trade-offs

- **[Spec drift from deferred implementation]** The integration rules are specced ~a release or
  two before they're built; the PMS landscape may shift. → Keep them behavior-level (map native
  `statusCategory`, one owner, consented close) not provider-specific; revisit at connector time.
- **[Threshold set on a 150-row sample]** The 0.05–0.10 dedup band comes from a recent sample, not
  the whole corpus. → Specified as a **band** with the gate behavior as `test` and the exact number
  as an `eval`-tunable `design` constant Step 7 can calibrate against fuller data before shipping.
- **[Over-strict dedup drops real memories]** A tight gate could reject a genuinely new thought
  worded like an old one. → Cross-context near-dups surface as supersession candidates (D4), not
  silent drops; only within-note restatements are dropped outright.
- **[Eval flakiness]** Model-judgment scenarios can regress silently. → They run thresholded, are
  opt-in but never silently skipped (Step 6), and the design bias minimizes their count.
- **[Actor model adds specification surface]** Parameterizing every rule by actor is more scenarios
  up front. → Cheaper than a second ruleset later; it is the whole point of Invariant 2.

## Migration Plan

No runtime migration — spec-only. Deployment = merging the delta specs; on `/opsx:archive` the two
new capability specs land in `openspec/specs/`. Rollback = revert the change; no data or schema is
touched. The scenarios become the acceptance criteria that gate Step 6 (tests/eval) and Step 7
(implementation) — those steps carry the append-only DB migrations for `content_hash`,
`supersedes`, `last_retrieved_at`, task origin/`external_ref`, and the `type` allowlist enforcement.

## Open Questions

- Exact dedup gate number within 0.05–0.10, and the within-note vs cross-context split point — set
  by Step 7 against fuller corpus data; specced here as a band + policy.
- Exact rubber-stamp down-weighting curve (linear in selected/returned ratio vs stepped) — a Step 7
  `design` constant; the relative-ordering rule is fixed here.
- Whether `document` and `person` edits get the same supersession semantics as thoughts, or only
  the re-embed/re-hash guarantee — leaning re-embed/re-hash for all, supersession for thoughts/tasks
  first; confirm in Step 7.
- First connector choice (Linear/Todoist/Notion) is a v1.5 product decision, out of scope here;
  the sync rules are provider-neutral.
