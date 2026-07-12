## Why

New-Feature-Plan **Step 4** requires a data-driven audit of the memory mechanisms so that
Step 5 (lifecycle rules spec) and Step 7 (memory hygiene) know **which hygiene mechanisms rely
on prompt-nudge / LLM compliance and must move to server-side enforcement**. The *usefulness
half* of that audit already exists (untracked `codeEval/Fable20260710-UsefulnessAudit.md` +
`docs/usefulness-audit-runbook.md`), but the plan explicitly states "the dedup/extraction half
remains open." Without the dedup/extraction findings, Step 5 cannot decide its enforcement
points and two stale TB tasks (`update_thought`, "usefulness-score / archival window") cannot be
closed with evidence.

## What Changes

- **Complete the open dedup/extraction half** of the audit against read-only production data
  (project `jhqhtryqjwzhnjaqtkui`, Management API query endpoint, per the existing runbook's
  READ-ONLY ground rules) plus a code map of the capture/ingest pipeline. Key confirmed findings:
  - **Dedup is not server-side enforced.** `capture_thought` inserts unconditionally (no
    similarity/hash/"already exists" check). The only server-side guard is an exact whole-note
    `content === content` re-sync check on `ingest-note`; near-duplicate avoidance on ingest is
    **prompt-nudge only**. Production corroborates: 8 exact-duplicate active thoughts and ~13% of a
    recent sample carry a near-duplicate twin at cosine distance < 0.10 despite an HNSW index that
    is used for search but never consulted on write.
  - **Extraction `type` is not validated against the allowlist.** `helpers.ts` casts the LLM
    metadata response unchecked (no allowlist filter, no DB CHECK), so production holds
    out-of-allowlist `type` values (`instruction`×6, `decision`×5) alongside the five documented
    ones. This is the `parse, don't cast` / "allowlist LLM output" boundary rule, unmet.
- **Consolidate everything into ONE Step 4 report** (`codeEval/Fable20260712-MemoryMechanismAudit.md`)
  that classifies every memory mechanism as **server-side-enforced** or **prompt-nudge/LLM-dependent**
  and hands Step 5/Step 7 an explicit "move to server-side enforcement" list.
- **Commit the existing untracked usefulness artifacts** (`Fable20260710-UsefulnessAudit.md`,
  `usefulness-audit-runbook.md`) so the audit trail is version-controlled, and reference them from
  the consolidated report rather than duplicating them.
- **Verify and close two stale TB tasks:** `update_thought` (tool exists, re-embeds on edit, 2 prod
  calls ever — confirmed shipped) and "usefulness-score / archival window" (answered by the usefulness
  audit: score 0 = "no data", not "not useful"; do not drive archival from score alone yet).
- **No code, schema, or behavior changes.** Findings that call for code become inputs to Step 5/Step 7,
  not fixes in this change.

## Capabilities

### New Capabilities
- `memory-mechanism-audit`: the project SHALL maintain a reproducible, READ-ONLY audit of its memory
  mechanisms (usefulness scoring, deduplication, extraction) and a current audit report that classifies
  each mechanism as server-side-enforced vs prompt-nudge/LLM-dependent, so downstream hygiene work has
  an evidence base. Covers the runbook procedure, the report's required contents, and the READ-ONLY /
  no-credential-leak safety constraints on running it against production.

### Modified Capabilities
<!-- none — this change adds a documentation/process capability and makes no requirement changes to
     thoughts, extractor-pipeline, or function-call-logging behavior. Findings feed Steps 5 and 7. -->

## Non-goals

- **No hygiene implementation.** Supersession, staleness/decay, dedup enforcement, and allowlist
  validation of extracted `type` are Steps 5–7. This change only produces the evidence that motivates
  them; it does not add a dedup check, a DB CHECK constraint, or an allowlist parser.
- **No cleanup of existing bad data.** The 11 out-of-allowlist thoughts, the 8 exact duplicates, and the
  2 `slack_ts` residue rows are reported, not deleted (prod is untouched — audit is READ-ONLY).
- **No re-derivation of the usefulness half.** It is complete; this change commits and references it.
- **No new production writes of any kind.** Every query in the audit is a `SELECT`.

## Impact

- **Docs (the deliverable):** new `codeEval/Fable20260712-MemoryMechanismAudit.md`; commit existing
  `codeEval/Fable20260710-UsefulnessAudit.md` and `docs/usefulness-audit-runbook.md`; extend the runbook
  with the dedup/extraction query set so the audit is repeatable.
- **Spec:** new `openspec/specs/memory-mechanism-audit/spec.md` (process/documentation capability).
- **ThreatModel:** note the READ-ONLY / no-credential-leak constraint for running the audit against prod.
- **TB tasks:** `update_thought` and "usefulness-score / archival window" verified and closed with evidence.
- **Code / schema / API / migrations:** none.
- **Downstream:** feeds Step 5 (lifecycle rules — the prompt-nudge→server-side list) and Step 7 (dedup +
  extraction allowlist enforcement, retrieval-signal decay).
