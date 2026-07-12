## Context

The `lifecycle-rules-verification` harness (Step 6) left 23 deterministic tests
red-by-design, each naming a missing feature via `PENDING(step7:<slug>)`. This
change implements those features against the real architecture mapped in Step 7
planning:

- **Repository `insert`/`update` are passthrough** (`supabase-thought-repository.ts:158,168`)
  — new columns need only `NewThought` field additions; no impl edits.
- **Four thought-write paths** compute embedding+metadata and insert/update:
  `capture_thought` (`tools/thoughts.ts:652-663`), `freshIngest`
  (`helpers.ts:140-163`), `executeReconciliationPlan` (`tools/thoughts.ts:1039-1102`),
  and `buildThoughtUpdate` (`tools/thoughts.ts:93-116`) — the single re-embed seam.
- `search_thoughts_by_embedding` already filters `archived_at is null`
  (`migrations/20260710000001`); a canonical reference lives in `supabase/schemas/`.
- `increment_usefulness(uuid[])` adds +1 flat; `record_useful_thoughts` sees only
  the selected ids, not the result-set size.
- Migrations are append-only (`docs/upgrade.md`); apply locally via
  `supabase db reset` then `deno task gen:types`.

## Goals / Non-Goals

**Goals:** turn all 23 red deterministic tests green by implementing the 10
features; keep the pre-existing suite green; enforce every rule **server-side**
(not prompt-nudge); one append-only migration; strengthen the Step-6
capability-probe tests to assert real behavior where the surface now exists.

**Non-Goals:** the v1.5 sync connectors (still seam-gated); the eval tier's real
model behavior (opt-in, unchanged); the memory console (Step 17); tuning the
exact dedup number / down-weighting curve beyond the specced relative ordering;
fixing the unrelated latent fake-provider metadata-substring mismatch (out of
scope; my allowlist tests use the injectable unit fake).

## Decisions

### D1 — One append-only migration for all schema
`2026NNNN_memory_hygiene.sql` adds (all nullable / no NOT NULL on populated tables):
`thoughts.content_hash text`, `thoughts.superseded_by uuid references thoughts(id) on delete set null`,
`thoughts.last_retrieved_at timestamptz`, `thoughts.last_actor text`;
`projects.content_hash`, `tasks.content_hash`, `documents.content_hash`;
indexes `idx_thoughts_superseded_by`, `idx_thoughts_last_retrieved_at`;
recreates `search_thoughts_by_embedding` (full body + revoke/grant) adding
`and superseded_by is null`; adds `increment_usefulness_weighted(uuid[], int)`.
`database.types.ts` regenerated; the `search_thoughts_by_embedding` reference
file updated with a new "Last synced with:" note. **Why:** append-only + explicit
grants is the house convention; one migration keeps the change atomic.

### D2 — Write-time dedup gate reusing the in-hand embedding
In each create path, after computing the embedding, call
`matchByEmbedding({ embedding, threshold: DEDUP_SIMILARITY, count: 1 })` (a tight
band — cosine **similarity ≥ 0.90**, i.e. distance ≤ 0.10) plus an exact
`content_hash` check. On a hit: **within-note / same-source restatement → drop**
(keep existing, return its id); **cross-context → create the new thought but link
it as a supersession candidate** (`superseded_by` unset, flagged for the
contradiction path) so a genuinely new observation never vanishes. Byte-identical
(hash match) → always drop. **Why:** the embedding is already computed; a repo
query is far cheaper than a second AI call, and the policy is the Step-5 D2 rule,
not a model choice. A new `ThoughtRepository.findNearestActive(embedding, minSimilarity)`
and `findByContentHash(hash)` back it.

### D3 — Supersession: edge + contradiction check + resolve tool
`thoughts.superseded_by` points newer→older's replacement (older row kept,
excluded from default search via the recreated RPC, still `findById`-able). A new
`detectContradiction` helper (`helpers.ts`) makes one `AiProvider.completeJson`
call over the nearest existing thought(s); on a contradiction it stamps the older
thought's `superseded_by`. A `resolve_supersession` MCP tool clears/sets the edge
(reversible). The fake provider gains a responder keyed on the **exact** literal
of the new systemPrompt (avoiding the known substring-mismatch trap). **Why:**
deletion is unrecoverable; an edge is auditable and reversible (Step-5 D4).
Detection is `eval`; the *effect* (excluded from search, re-embed fires, edge
queryable) is `test`.

### D4 — content_hash + re-embed in the one update path (INVARIANT 1)
`hashContent(text) = sha256 hex` (Deno `crypto.subtle`), computed wherever content
is written: all four thought paths set `content_hash` alongside `embedding`;
`update_task`/`update_project`/`update_document` set `content_hash` in their
`updates` object (no embedding — only thoughts have one). Emptying content is a
valid edit: hash of `""` is stored, never swallowed. **Why:** INVARIANT 1 is the
disease this product cures; the hash must track current text so the sync dedup
gate operates on it.

### D5 — Actor model via `last_actor`, defaulted at the seam
`thoughts.last_actor` records the actor of the last mutation. `capture_thought`
and the contradiction path record `LLM`; `update_thought` gains an optional
`actor` param (enum `LLM|user|sync`, default `LLM`) threaded into the payload;
ingest paths record `sync`. **Why:** one column is Invariant 2's structural home
— the console/connectors (later) pass `user`/`sync` through the *same* path, no
fork.

### D6 — `last_retrieved_at` advanced on every retrieval
A `ThoughtRepository.touchRetrieved(ids: string[])` (`update({last_retrieved_at: now}).in("id", ids)`)
is called from `search_thoughts`, `list_thoughts`, and `get_thought_by_id` using
the `returnedIds` those handlers already compute for `meta`. Non-fatal (a touch
failure never breaks the read). **Why:** compliance-independent recency, built on
the Step-2b `returned_ids` precursor, feeds staleness/archival.

### D7 — Staleness / archival / reconciliation tools
`get_stale_thoughts`: thoughts old AND not recently retrieved (multi-signal),
never score-0 alone (a score-0 recently-retrieved thought is excluded).
`get_archival_queue`: the full conjunction (age ∧ score-0 ∧ `last_retrieved_at`
null ∧ not owned by a live `note_snapshot`), surfaced for consent (uses existing
`archive_thought` for the transition). `reconcile_tasks`: open tasks whose recent
thoughts suggest completion, returned as confirm-to-close candidates — never
auto-closes. Each is a bounded query behind a new repo method; all are review
surfaces, not auto-appliers. **Why:** Step-5 D5/D7 — human-queued, consent-based.

### D8 — Rubber-stamp down-weighting via an optional result-set param
`record_useful_thoughts` gains optional `returned_ids: string[]` (the set the
selection was drawn from). `ratio = selected/returned` (defaults to selected as
its own set when absent). `weight = ratio > RUBBER_STAMP_RATIO (0.75) ? 1 : 2`,
applied via `increment_usefulness_weighted(ids, weight)`. A selective pick
(few-of-N) gets +2/id; an all-of-N rubber-stamp gets +1/id. **Why:** an
"everything was useful" signal carries little information (Step-5 D6). The Step-6
usefulness test is updated to pass `returned_ids` (the specced result-set context)
— its manifest entry stays `test`, moved to `pass-now`.

### D9 — Extraction `type` allowlist parse
`THOUGHT_TYPES` extended to `[…, "instruction", "decision"]` (`enums.ts`); the
inline prompt list in `extractMetadata` updated to match; the parse callback
validates `type` against the allowlist and coerces out-of-allowlist/missing to
`observation` (logged via `console.warn`). **Why:** parse-don't-cast at the seam
(Step-5 D3); `instruction`/`decision` already appear in prod (Step-4 audit).

### Test Strategy
- Each feature's red test(s) flip green; run `deno task test` after each feature
  (real local stack, `TB_AI_PROVIDER=fake`, no mocks on the tested path).
- Strengthen Step-6 capability-probe tests (supersession effect, staleness
  advance, archival conjunction, reconciliation candidates) to assert behavior,
  not just `hasTool`/`columnExists`, now that the surface exists; update their
  manifest `expectation` to `pass-now`/`milestone: shipped`.
- The coverage bijection meta-test must stay green (scenario set unchanged).
- After all features: full gate `deno task test` GREEN (0 failed, 0 skipped) for
  the deterministic + lifecycle tiers; sync tier stays seam-gated (opt-in);
  plugin suite + build green.

### User-error scenarios
- **Double capture / paste-twice** → dedup gate drops the duplicate (D2).
- **Edit to empty/gibberish** → still re-hashed as a valid state (D4).
- **Model emits a hallucinated `type`** → coerced to `observation` (D9).
- **Model proposes a bad supersession** → edge is reversible via `resolve_supersession` (D3).
- **Rubber-stamp "everything useful"** → down-weighted, not inflating scores (D8).
- **Reconciliation misjudges a task** → consent gate; the human declines, nothing closes (D7).

### Security analysis (→ `ThreatModel.md`)
T16–T20 move *Specified → Mitigated* (the enforcement now exists and is
test-guarded): T16 bypass (INVARIANT-1 in the one path), T17 poisoned extraction
(allowlist parse), T19 destructive supersession (edge-not-delete), T18/T20 remain
*Specified* (sync is v1.5). New note: the contradiction AI call is best-effort and
degrades (a failure never blocks capture, mirroring `extractMetadata`), so an LLM
outage cannot wedge writes.

## Risks / Trade-offs

- **[Multiple insert paths]** dedup/hash must land in all four thought paths or a
  path leaks duplicates. → A shared helper (`prepareThoughtWrite`) computes
  embedding+hash+dedup once; every path calls it (Rule of Three).
- **[Recreated search RPC]** a wrong WHERE clause could hide non-superseded
  thoughts. → The recreate is byte-for-byte the current body plus one
  `and superseded_by is null`; existing search tests guard it.
- **[Added AI call per capture]** latency + a paid call. → One call, best-effort,
  behind the `AiProvider` seam; deterministic under the fake; degrades on failure.
- **[db reset re-seeds]** applying the migration locally wipes local data. →
  Expected for local dev; CI starts fresh anyway.
- **[Rubber-stamp needs result-set context]** absent `returned_ids`, the signal is
  weaker. → Optional param; default treats the selection as its own set (safe,
  no worse than today's flat +1).

## Migration Plan

One append-only migration (columns nullable, RPCs `create or replace`, explicit
revoke/grant). Deploy = apply migration + redeploy edge function. Rollback =
revert the edge code; the nullable columns are inert if unused (no down-migration,
per append-only policy). `database.types.ts` regenerated and committed.
