# Memory-Mechanism Audit — Step 4 (consolidated)

**Date:** 2026-07-12
**Auditor:** agent (Fable) · **Method:** READ-ONLY SQL against live prod `jhqhtryqjwzhnjaqtkui` via the
Supabase Management API query endpoint (CLI keyring token, never printed), + a full code map of
`supabase/functions/terrestrial-brain-mcp/`. All queries are `SELECT`; production was not modified.
**Runbook:** `docs/usefulness-audit-runbook.md` (Steps 0–6b reproduce every number below).
**Covers:** New-Feature-Plan Step 4 in full — the *usefulness half* (already reported 2026-07-10,
referenced not duplicated) **plus** the previously-open *dedup half* and *extraction half*.

---

## 0. Purpose and headline

Step 4's charter: measure the memory mechanisms and decide **which hygiene mechanisms rely on
prompt-nudge / LLM compliance and must move to server-side enforcement in Step 7.** The answer:

| Mechanism | Enforcement today | Move server-side in Step 7? |
|---|---|---|
| Usefulness scoring (increment ledger) | Server-side, working since 2026-05-01 | No — keep; add retrieval signal |
| Dedup — `capture_thought` | **None** | **Yes** — add a write-time similarity check |
| Dedup — `ingest-note` near-duplicate | **Prompt-nudge only** | **Yes** — back the "do not duplicate" rule with an embedding check |
| Dedup — `ingest-note` exact re-sync | Server-side (exact `===`, note-level) | No — already correct for its narrow job |
| Extraction `type` | **Prompt-nudge only** (cast, not validated) | **Yes** — parse against the `THOUGHT_TYPES` allowlist |
| Extraction reference/entity (projects/people/tasks) | Server-side (real DB writes, name matching) | No — already enforced |

Three mechanisms are prompt-nudge and produce measurable drift in production. They are the Step 7
enforcement list. **This report reports; it does not fix — every fix is a Step 5 rule + Step 7 change
with its own tests.** No production data was cleaned.

---

## 1. Usefulness half (reference)

Fully covered in **`codeEval/Fable20260710-UsefulnessAudit.md`** (now version-controlled). Summary
so this report stands alone; that document is the source of truth for the numbers:

- Corpus 1,666 thoughts (1,668 as of 2026-07-12); **97% carry `usefulness_score = 0`**.
- The mechanism is **server-side and verified at 100% since 2026-05-01** (the clean-signal epoch).
  Pre-epoch zeros are a **deliberate manual reset** (Anastasia, ~Apr 23), not a bug — confirmed by
  reconstructing scores from the post-epoch increment ledger.
- Nudge compliance is currently **high** (82% of searches / 94% of lists are followed by a
  `record_useful_thoughts` within 10 min) — but this is compliance-dependent and usage is small and
  declining (searches/month 34→19→15→3, Apr→Jul).
- **`records_returned` telemetry was broken** (logged MCP content-block count, ~always 1) — fixed in
  Step 2b (`records-returned-telemetry`); the clean-signal epoch for row counts + `returned_ids`
  starts at that deploy.

**Archival-window verdict (answers the "usefulness-score / archival window" TB task):** do NOT drive
archival from `usefulness_score` today. Score 0 means "no data," not "not useful" (deliberate reset +
one-time vault import of reference material). Use usefulness only as a mild additive search-ranking
boost until ~3 months of clean signal AND ~200 increments exist; archival must be **multi-signal +
human-queued** (age AND score 0 AND no retrieval signal AND not owned by a synced note). Revisit a
score-driven window ~2026-10-01. This is Step 7's staleness/decay design, not a job to add now.

---

## 2. Dedup half (was open)

### 2.1 Code map — where dedup does and doesn't live

| Path | Behavior | Enforcement |
|---|---|---|
| `tools/thoughts.ts` `capture_thought` → `thoughtRepository.insert` | Unconditional insert — no similarity/hash/"already exists" lookup | **NONE** |
| `tools/thoughts.ts` `checkUnchanged` (invoked by `handleIngestNote`) | Exact whole-note `existing.content === content` vs `note_snapshots`, keyed by `note_id` | Server-side, **exact-match only**, note-level; blocks byte-identical re-sync only |
| `tools/thoughts.ts` `requestReconciliationPlan` system prompt ("Do NOT duplicate. Same idea expressed differently = keep the existing one.") | LLM classifies keep/update/add/delete; a near-dup emitted under `add` is inserted verbatim; unparseable plan → full fresh ingest (can itself duplicate) | **PROMPT-NUDGE / LLM-dependent** |
| `match_thoughts` RPC / HNSW cosine, default threshold 0.5 | Read-side search ranking | Never consulted on write |

The HNSW cosine index (`thoughts_embedding_idx`) that would make a write-time dedup check cheap
**already exists** — it is used for search and never for dedup.

### 2.2 Production corroboration (READ-ONLY, 2026-07-12)

- **Exact duplicates:** 8 duplicate-content groups among active thoughts → **8 redundant rows**
  (e.g. "Add a way to edit the project details…", "Make the signup code mandatory…", "/remote-control",
  "Claude's project-memory" — each present twice).
- **Semantic near-duplicates** (bounded HNSW NN over the **150 most-recent active thoughts** — a
  sample, not a whole-corpus count): **19/150 (~13%)** have a nearest twin at cosine distance
  **< 0.10**; **6/150 (4%)** at **< 0.05** (effectively identical); 27/150 (18%) < 0.15; mean NN
  distance 0.32.
- **Near-dups are mostly *within the same source note*** (`same_note = true` on every < 0.06 pair):
  restated lines from note re-ingest / the fresh-ingest fallback, e.g. *"Leased vehicles: …"* vs
  *"Leased vehicles include: …"* (dist 0.044), *"Non-leased vehicles listed on the lot are: …"* vs
  *"Non-leased vehicles include: …"* (dist 0.051). This points the finger at the **ingest
  reconciliation / fresh-ingest fallback**, not cross-note capture collisions.

### 2.3 Verdict

Dedup is **not enforced server-side on any write that matters.** `capture_thought` has none; the
ingest near-dup guard is prompt-only and demonstrably leaks. **Step 7 enforcement list, items 1–2:**
(1) a write-time embedding-distance check on `capture_thought`; (2) back the ingest "do not duplicate"
rule with the same check so the reconciliation `add` branch and the parse-failure fresh-ingest fallback
cannot insert a near-twin. The threshold is a **Step 5 lifecycle-rule decision** (the read-side 0.5 is a
retrieval threshold, not a dedup threshold — a dedup gate wants something much tighter, ~0.05–0.10 on
this data). The 8 exact + sampled near-dups are reported, **not deleted** here.

---

## 3. Extraction half (was open)

### 3.1 Code map

Two LLM extraction layers run on capture, via the `AiProvider` seam (`ai/ai-provider.ts`,
real `openrouter-provider.ts`, fake `fake-provider.ts`):

| Layer | Path | Enforcement |
|---|---|---|
| Metadata extraction (`type`, `topics`, `people`, `action_items`, `dates_mentioned`) | `helpers.ts` `extractMetadata` → `aiProvider.completeJson`, parsed with a bare `raw as Record<string, unknown>` cast | **PROMPT-NUDGE** — the `THOUGHT_TYPES` enum is *named in the prompt* but the response is **cast, never validated**; no allowlist filter, no DB CHECK |
| Note→thoughts splitting (ingest only) | `helpers.ts` `freshIngest` splitter prompt ("prefix decisions with 'Decision:', tasks with 'TODO:'") | LLM; unparseable → whole note becomes one thought |
| Reference/entity extraction (projects/people/tasks) | `extractors/pipeline.ts` + `extractors/*` (Project→People→Task, order load-bearing) | **SERVER-SIDE** — real DB writes with name-matching allowlist logic |

The `THOUGHT_TYPES` allowlist (`enums.ts`) is applied **only at the read-tool boundary**
(`list_thoughts`/`search_thoughts` filters). `enums.ts` even documents the gap:
*"THOUGHT_TYPES — edge-only allowlist. `thoughts.type` lives in the metadata JSONB with no DB CHECK."*
On any extraction failure, metadata degrades to `{ topics: ["uncategorized"], type: "observation" }`
(logged, non-fatal).

### 3.2 Production corroboration (READ-ONLY, 2026-07-12)

`metadata->>'type'` distribution across all 1,668 thoughts:

| type | n | in allowlist? |
|---|---|---|
| observation | 949 | ✅ |
| task | 322 | ✅ |
| reference | 225 | ✅ |
| idea | 160 | ✅ |
| **instruction** | **6** | ❌ **out-of-allowlist** |
| **decision** | **5** | ❌ **out-of-allowlist** |
| person_note | 1 | ✅ |

**11 thoughts carry a `type` outside the documented allowlist** — direct proof that the cast-not-parse
gap reaches production. `decision` is almost certainly the splitter prompt's own *"prefix decisions with
'Decision:'"* instruction bleeding into the type field. Additional findings:

- **`category` is 100% null** (1,668/1,668) — a dead metadata key nothing populates.
- **2 `slack_ts` residue** rows from the deleted Slack integration (metadata only; harmless, reported).
- **Extraction fan-out** (thoughts per ingested note): 128 notes→1, 135→2–3, 61→4–6, 32→7–10, **28→11+**.
  The long tail (11+/note) is where the intra-note near-duplication in §2.2 concentrates.

### 3.3 Verdict

Metadata `type` extraction is **prompt-nudge and violates the project's own boundary rule** ("validate
LLM outputs against allowlists so a hallucinated value can't flow into a mutation"). **Step 7 enforcement
list, item 3:** parse the `extractMetadata` response against `THOUGHT_TYPES` at the seam — an
out-of-allowlist `type` maps to the documented fallback (`observation`) or a Step 5-decided bucket,
never stored raw. Whether to *add* `instruction`/`decision` to the allowlist (they're plausibly useful)
or coerce them is a **Step 5 decision**; either way the write must be validated. The 11 existing rows are
reported, **not migrated**, here. Reference/entity extraction is already server-side and needs no change.

---

## 4. Stale-task verifications (folded into Step 4)

- **`update_thought` TB task** — **verified shipped, closing.** The MCP tool exists
  (`tools/thoughts.ts`), and on a content change it **re-runs extraction and re-embeds**
  (`extractMetadata` at the update path) — i.e. it already honors the Step 7 INVARIANT-1 "edits
  re-embed + re-hash" direction for thoughts. Production: **2 calls ever** (last 2026-04-23), 0 errors —
  exercised, low-traffic, not broken. Nothing to build; the guarantee just needs *extending* to
  projects/tasks/documents in Step 7.
- **"Usefulness-score / archival window" TB task** — **answered, closing.** See §1: no score-alone
  archival yet; multi-signal human-queued review is Step 7; revisit ~2026-10-01.

## 5. Hand-off to Steps 5 & 7

**Step 5 (lifecycle rules spec) inputs:**
- Dedup threshold + policy (tight write-time gate vs the 0.5 read threshold; what "same idea" means).
- `type` allowlist decision: coerce vs extend with `instruction`/`decision`; the fallback rule.
- Rubber-stamp down-weighting (a `record` call listing nearly every returned id counts for less — from
  the usefulness half).
- Retrieval-signal precursor: Step 2b's `returned_ids` now logs which thoughts were returned; Step 7's
  `last_retrieved_at` builds the compliance-independent decay signal on top of it.

**Step 7 (memory hygiene) enforcement list (the point of this audit):**
1. Write-time dedup check on `capture_thought` (server-side, embedding distance).
2. Embedding-backed near-dup guard on the `ingest-note` reconciliation `add` branch + fresh-ingest fallback.
3. `type` allowlist parse at the `extractMetadata` seam (parse, don't cast).

**Existing-bad-data inventory (report-only; clean-up is a separate, human-confirmed Step 7 task, never
from this READ-ONLY audit):** 11 out-of-allowlist `type` rows, 8 exact-duplicate active thoughts, ~13%
recent-sample near-dup rate, 2 `slack_ts` residue rows, 1,668×`category = null`.

---

## Appendix — reproducing this report

Every number above comes from `docs/usefulness-audit-runbook.md`: Steps 1–6 (usefulness), Step 6a
(dedup), Step 6b (extraction). Run READ-ONLY per the runbook Ground Rules; never print or persist the
access token. The near-dup figures are a **150-row recent sample via HNSW cosine NN**, stated as a rate,
not an exhaustive corpus count.
