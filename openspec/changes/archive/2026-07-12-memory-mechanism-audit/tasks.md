## 1. Version-control the existing usefulness half

- [x] 1.1 Add the untracked `codeEval/Fable20260710-UsefulnessAudit.md` (usefulness half of Step 4) under version control unchanged
- [x] 1.2 Add the untracked `docs/usefulness-audit-runbook.md` under version control

## 2. Complete the dedup/extraction half (READ-ONLY prod queries)

- [x] 2.1 Extend `docs/usefulness-audit-runbook.md` with a dedup query set (exact-duplicate content groups; bounded HNSW nearest-neighbor near-duplicate probe over a recent sample with stated sample size/thresholds) and an extraction query set (`metadata->>'type'` distribution vs `THOUGHT_TYPES`; metadata-key coverage; `slack_ts` residue), all SELECT-only
- [x] 2.2 Run the dedup queries against prod `jhqhtryqjwzhnjaqtkui` READ-ONLY and record results (exact dupes, near-dup sample rate, concrete example pairs, same-note vs cross-note)
- [x] 2.3 Run the extraction queries READ-ONLY and record results (type distribution incl. out-of-allowlist `instruction`/`decision`, category null, slack residue, thoughts-per-note fan-out)

## 3. Consolidated Step 4 report

- [x] 3.1 Write `codeEval/Fable20260712-MemoryMechanismAudit.md`: consolidate usefulness (reference the existing doc, do not copy) + dedup + extraction, each with a code-location map and a server-side-enforced vs prompt-nudge/LLM classification
- [x] 3.2 Include the explicit "must move to server-side enforcement in Step 7" list (dedup on capture, near-dup on ingest, extraction `type` allowlist parse) and the retrieval-signal precursor note
- [x] 3.3 Reproduce the interpretation guards (epoch rule; "score 0 = no data"; multi-signal-only archival; sample-not-exhaustive framing for near-dup)
- [x] 3.4 Record actions/inputs handed to Step 5 (lifecycle rules) and Step 7 (hygiene), and the existing-bad-data inventory (11 out-of-allowlist types, 8 exact dupes, 2 slack residue) as report-only, not to be cleaned here

## 4. Close stale TB tasks + ThreatModel note

- [x] 4.1 Verify `update_thought` (tool exists, re-embeds on edit, 2 prod calls) and close/annotate its TB task with evidence
- [x] 4.2 Close the "usefulness-score / archival window" TB task, pointing at the audit's conclusion (no score-alone archival yet; revisit ~2026-10-01)
- [x] 4.3 Add the READ-ONLY / no-credential-leak audit constraint to `ThreatModel.md`

## 5. Testing & Verification

- [x] 5.1 Confirm no code/schema/migration was changed (docs + spec + ThreatModel only): `git diff --name-only` shows only markdown/spec files
- [x] 5.2 Run the full suite unchanged-green: `deno task test` (local stack, `TB_AI_PROVIDER=fake`) and `cd obsidian-plugin && npm test && npm run build` — zero failures, zero skips
- [x] 5.3 Confirm the branding-separation guard still passes (report + committed artifacts are provenance-clean)
- [x] 5.4 `/opsx:verify` the change against the delta specs, then `/opsx:archive`
- [x] 5.5 Check off Step 4 in `codeEval/Fable20260710-NewFeaturePlan.md` as part of this change's commit
