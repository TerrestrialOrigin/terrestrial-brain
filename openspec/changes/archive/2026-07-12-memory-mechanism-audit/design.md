## Context

New-Feature-Plan Step 4 is a **data-driven audit whose deliverable is a REPORT, not code**. The
*usefulness half* is already done (untracked `codeEval/Fable20260710-UsefulnessAudit.md`, with a
repeatable `docs/usefulness-audit-runbook.md`). The *dedup/extraction half* is open. This change
completes it and consolidates both halves into one Step 4 report, then closes two stale TB tasks.

Current state established during this change (READ-ONLY prod `jhqhtryqjwzhnjaqtkui`, 1,668 thoughts,
+ a full code map of `supabase/functions/terrestrial-brain-mcp/`):

- **Dedup — capture path:** `tools/thoughts.ts` `capture_thought` calls `thoughtRepository.insert`
  unconditionally. No similarity query, no hash, no "already exists" lookup. **No server-side dedup.**
- **Dedup — ingest path:** `checkUnchanged` does an exact whole-note `content === content` compare
  against `note_snapshots` (blocks only byte-identical re-sync). Near-duplicate avoidance is a system-
  prompt instruction ("Do NOT duplicate…") in `requestReconciliationPlan` — **prompt-nudge only**; an
  LLM-emitted near-dup under `add` is inserted verbatim, and an unparseable plan falls back to a full
  fresh ingest that can itself duplicate.
- **Embedding similarity** (`match_thoughts` / HNSW cosine, default threshold 0.5) exists **only for
  read-side search**, never consulted on write.
- **Extraction `type`:** `helpers.ts` `extractMetadata` parses the LLM response with a bare
  `raw as Record<string, unknown>` cast — **no allowlist validation, no DB CHECK**. The
  `THOUGHT_TYPES` enum is applied only at the read-tool boundary.
- **Prod corroboration:** 8 exact-duplicate active thoughts; ~13% of the 150 most-recent active
  thoughts have a near-dup twin at cosine < 0.10 (4% < 0.05); `type` distribution includes
  out-of-allowlist `instruction`×6 and `decision`×5; `category` 100% null; 2 `slack_ts` residue rows.
- **Stale tasks:** `update_thought` exists and re-embeds on edit (2 prod calls ever, last 2026-04-23);
  the usefulness-score/archival-window question is answered by the usefulness audit.

## Goals / Non-Goals

**Goals:**
- Produce one evidence-backed Step 4 report classifying every memory mechanism as **server-side-enforced**
  vs **prompt-nudge/LLM-dependent**, with the explicit "move server-side in Step 7" list.
- Make the audit reproducible: extend the runbook with the dedup/extraction query set.
- Version-control the previously-untracked usefulness artifacts.
- Close the two stale TB tasks with evidence.

**Non-Goals:**
- Any code, schema, migration, or behavior change (findings feed Steps 5–7).
- Any production write or data cleanup (audit is strictly READ-ONLY).
- Re-deriving the usefulness half (complete; referenced, not duplicated).

## Decisions

- **Report-only OpenSpec change, spec = a process capability.** *Why:* the plan mandates a report, but
  the repo's paradigm is spec-driven. A `memory-mechanism-audit` process spec (like the existing
  `developer-workflow` spec) captures the durable requirement — "a reproducible READ-ONLY audit + a
  current report exists and classifies mechanisms" — without inventing product behavior. *Alternative
  rejected:* skip the spec and ship a bare markdown file — loses the OpenSpec acceptance trail and the
  READ-ONLY safety requirement has no home.
- **One consolidated report, referencing (not copying) the usefulness half.** *Why:* single source of
  truth for Step 5/7; avoids the two-copies-drift bug. *Alternative rejected:* a second standalone
  dedup/extraction doc — leaves Step 4 fragmented across three files.
- **Findings are reported, not fixed.** *Why:* Step 4's charter is measurement; each fix (dedup check,
  `type` allowlist parse, residue cleanup) is a distinct Step 5/7 spec scenario with its own tests.
  Fixing here would smuggle untested behavior change into a docs change.
- **Near-duplicate probe = bounded HNSW nearest-neighbor over a recent sample**, not a full O(n²) scan.
  *Why:* bounded query rule; 150-row lateral NN using the existing index is cheap and representative.
  Reported as a sample rate with the sample size stated (never presented as an exhaustive count).
- **Extraction allowlist adherence measured directly** as the `metadata->>'type'` distribution vs
  `THOUGHT_TYPES`. *Why:* the cast-not-parse gap is only visible in the data, not the code.

### Test Strategy

No product code changes → no unit/integration/E2E product tests are added or required. The audit's
own correctness is protected by: (1) the runbook, whose queries are all `SELECT` and are re-runnable
and self-checking (Step 5 integrity gate must be ~100% post-epoch before any usage conclusion);
(2) the `memory-mechanism-audit` spec scenarios, which assert the report exists, is provenance-clean,
and records the classification; (3) the existing full suite (`deno task test`, `cd obsidian-plugin &&
npm test && npm run build`) must stay green — a docs/spec change must not redden it. Every numeric claim
in the report is traceable to a query in the runbook so it can be independently reproduced.

## Risks / Trade-offs

- **[Running the audit could mutate or leak from prod.]** → Ground rule enforced in the runbook and
  ThreatModel: every query is `SELECT`; the access token is read from the keyring into a shell variable
  and never echoed, written to a file, or committed. No `UPDATE/DELETE/INSERT` during an audit.
- **[Near-dup rate is a sample, could be read as exhaustive.]** → Report states sample size (150),
  method (HNSW cosine NN), and thresholds; never claims a whole-corpus duplicate count.
- **[Score-0 = "not useful" misread → premature archival.]** → The report carries the usefulness audit's
  epoch rule and the "score 0 = no data" interpretation guard; archival stays multi-signal + human-queued
  (Step 7), never score-alone.
- **[Findings drift as prod grows.]** → Report is dated and epoch-stamped; the runbook's "when to run"
  (before archival policy, after mechanism changes, quarterly) keeps it refreshable rather than stale.

## User-Error Scenarios

- **Auditor runs a mutating query by mistake** → runbook Ground Rule 1 (READ-ONLY, SELECT-only) + this
  design forbid it; the Management API token is the CLI token, but the discipline is procedural — flagged
  in ThreatModel so it is a conscious constraint, not an accident.
- **Auditor pastes the access token into the report / a file / shell history** → runbook Ground Rule 2
  (never print or persist credentials); token stays in a variable, `secret-tool lookup` output is never
  echoed.
- **Reader treats 97% score-0 as "97% useless"** → interpretation guide point 2 reproduced in the report.
- **Reader treats the 150-row near-dup sample as the whole-corpus dedup count** → method + sample size
  stated inline.

## Migration Plan

None — docs + spec only, no deploy, no schema change. Rollback = revert the commit (removes the report,
spec, runbook additions, and the committed usefulness artifacts); production is untouched throughout.

## Open Questions

- None blocking. The dedup-enforcement threshold and the `type` allowlist-parse mechanism are
  deliberately deferred to Step 5 (rules) / Step 7 (implementation), where they get delta specs + tests.
