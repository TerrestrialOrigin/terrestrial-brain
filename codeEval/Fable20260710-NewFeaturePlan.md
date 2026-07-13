# Terrestrial Brain — Hosted Product Feature Plan

**Date:** 2026-07-10
**Sources:**
- `codeEval/Fable20260704-fix-plan.md` — **all 28 steps complete** (verified against git history 2026-07-10; every step merged to `develop`, last merge `a1d1966`)
- Hosted-product work plan (project-per-customer architecture, phases 0–4) — `~/Documents/PassiveIncomeChat/`
- Legal position & action plan (`TerrestrialBrainMonitizationLegality.md`) — MIT-era provenance analysis + Part 2 action items
**Structure:** Same protocol as the fix-plan — each numbered step is exactly ONE OpenSpec (opsx) change on its own feature branch. Steps marked **[Anastasia]** are manual/human tasks, not code changes. Context will be cleared between steps; each step is self-contained.

---

## Protocol for Every Code Step (identical to the fix-plan protocol)

1. **Read first:** this file (the step you're executing) plus the source docs it references.
2. **Branch:** create the step's `feature/…` or `bug/…` branch off `develop`. Never work on `develop` directly.
3. **OpenSpec:** `/opsx:ff` (or `/opsx:new` + `/opsx:continue` for the less-understood steps) → `/opsx:apply`. Never implement manually, never use plan mode. design.md MUST include user-error scenarios, security analysis (update `ThreatModel.md`), and a test-strategy subsection.
4. **Bug-fix steps replicate first:** failing test before the fix.
5. **Gates:** full suite green — `deno task test` (local stack via `npx supabase start`, `TB_AI_PROVIDER=fake`) AND `cd obsidian-plugin && npm test && npm run build`. Zero failures, zero skips.
6. **Finish:** `/opsx:verify`, `/opsx:archive`, commit, PR to `develop`. Do not delete the branch.
7. **Track progress:** check the step off in the checklist at the bottom of THIS file as part of the step's commit.
8. **Migrations are append-only** (see `docs/upgrade.md`).
9. **Standing legal rule:** never copy anything further from the OB1 repo (all-FSL until ~March 2028 per-version MIT conversion). Reimplement concepts independently only.

---

## Current-state audit (performed 2026-07-10)

What the fix-plan already delivered toward Phase 0/2, and what it did NOT:

| Legal/security item | Status | Evidence |
|---|---|---|
| `"open-brain"` MCP server name string | ✅ Done (fix-plan Step 26) | `index.ts:112` → `name: "terrestrial-brain"` |
| Slack ingest deletion | ✅ Done (fix-plan Step 2 / `remove-slack-integration`) | |
| Key out of URL, constant-time compare | ✅ Done (fix-plan Step 3) — but header is still named `x-brain-key` | `index.ts:385,395` |
| Provenance evidence bundle | ✅ Mostly done (2026-07-04, `PassiveIncomeChat/evidence/`) | Remaining: Substack capture (Step L1) |
| **`x-brain-key` header rename** | ✅ Done (Step 1) — now `x-tb-key`, hard cut | `index.ts`, plugin, README, `ThreatModel.md`, upgrade note |
| **Metadata-extraction prompt rewrite** | ✅ Done (Step 1) — prose re-expressed, sentence removed, enum values kept | `helpers.ts` |
| **`thoughts` DDL / `match_thoughts` re-expression** | ✅ Done (Step 1) — RPC now `search_thoughts_by_embedding`; `thoughts` columns intentionally unchanged | migration `20260710000001`, canonical schema file, repositories |
| **Fingerprint re-grep saved to evidence bundle** | ✅ Done (Step 1) | `PassiveIncomeChat/evidence/fingerprint-grep-2026-07-10-ob1-fragment-rewrite.txt` |
| **LICENSE file (FSL-1.1-MIT)** | ✅ Done (Step 2, `license-and-notice`) — `LICENSE.md` at repo root, FSL-1.1-MIT, Terrestrial Origin 2026 | repo root |
| **NOTICE.md (MIT attribution)** | ✅ Done (Step 2, `license-and-notice`) — `NOTICE.md` attributes Open Brain / Nate B. Jones (MIT through `f3e45e1`), MIT text reproduced | repo root |
| **GitHub repo description** | ⏳ Pending [Anastasia] (Step 3) — new provenance-free text decided/recorded ("An AI-powered second brain that connects Obsidian to a Supabase knowledge base…"); apply in GitHub settings (gh unavailable to the agent) | GitHub API, verified 2026-07-10 |
| **README branding** | ✅ Done (Step 3, `branding-separation`) — `README.md:3` marketing line replaced with a neutral product tagline; guarded by `tests/unit/branding-separation.test.ts` | |
| **CORS lockdown** | ❌ Not done — `origin: "*"` | `index.ts:383` |
| **`?key=` query fallback retirement** | ❌ Still present (deprecated) | `index.ts:395-398` |

Existing TB tasks that overlap this plan (do not duplicate; fold into the steps noted):
- "Audit the usefulness score of thoughts / archival window" → subsumed by Step 4 (mechanism audit) + Step 7 (staleness decay).
- "Project and task audit with the human" → subsumed by Step 7's task-reconciliation sweep.
- "Add `update_thought` MCP function" → appears already shipped (tool exists); verify and close during Step 4.
- "Code review of the entire project" → satisfied by the completed fix-plan; confirm with Anastasia and close.

---

## Phase 0 — Legal & licensing (BEFORE any public listing; Steps 1–3 before the Nate email)

### Step 1: Rewrite the remaining OB1 verbatim fragments
**Source:** legality doc Part 2 item 2 · **Branch:** `feature/Ob1FragmentRewrite` · **Size:** M · **Depends on:** nothing

- **Auth header rename** (`x-brain-key` → decide in design.md: standard `Authorization: Bearer` preferred, or `x-tb-key`): server (`index.ts:385` CORS allowHeaders + `:395` auth read), plugin (`apiClient.ts` header construction + settings migration), README (×5 references), `ThreatModel.md`. Decide the deprecation path for existing installs (accept old header for N releases vs hard cut — this is a self-hosted user base; document in `docs/upgrade.md`). The goal is that the string `x-brain-key` no longer appears in the repo except possibly in a dated upgrade note.
- **Metadata-extraction prompt** (`helpers.ts:52-53`): rewrite the prose in original words. Keep the enum *values* (`observation, task, idea, reference, person_note`) — renaming them means a data migration for marginal benefit, and short generic enums are thin copyright; record that decision in design.md. The sentence "Only extract what's explicitly there." must go.
- **`thoughts` DDL / `match_thoughts` re-expression:** new migration renaming `match_thoughts` (e.g. `search_thoughts_by_embedding`), update the canonical `supabase/schemas/match_thoughts.sql` (rename the file), `database.types.ts` regeneration, repository call sites, pgTAP test. Reorder/rename `thoughts` columns only where cheap; rewrite all comments. Migrations append-only.
- **Re-run the fingerprint grep** (all markers from legality doc Part 1 Arg 2 + the five fragments) and save the dated clean output into `~/Documents/PassiveIncomeChat/evidence/`.
- **Tests:** existing suite green (renames are behavior-neutral); plugin settings-migration test for the header change; auth accept/deny tests updated to the new header.

### Step 2: LICENSE (FSL-1.1-MIT) + NOTICE.md
**Source:** legality doc items 3 & 7; work-plan Phase 0 item 7 · **Branch:** `feature/LicenseAndNotice` · **Size:** S · **Depends on:** nothing (do FIRST if sequencing freely — the missing NOTICE is a live MIT-compliance gap on a public repo)

- Add `LICENSE.md`: FSL-1.1-MIT text, copyright Anastasia Rohner / Terrestrial Origin, 2026.
- Add `NOTICE.md`: portions of the schema/server derive from Open Brain by Nate B. Jones, published under MIT 2026-03-11 (repo `NateBJones-Projects/OB1`, through commit `f3e45e1`); reproduce the MIT text with "Copyright (c) 2026 Nate B. Jones." Keep the NOTICE permanently, even after Step 1's rewrite.
- README licensing section explaining the FSL tier split (free self-host, non-compete, 2-year MIT conversion).
- No code paths — gates are docs-consistency + suite still green.

### Step 2b: Fix records_returned telemetry (+ log returned ids)
**Source:** 2026-07-10 usefulness audit (`codeEval/Fable20260710-UsefulnessAudit.md`); TB task `2a9a3882` · **Branch:** `bug/RecordsReturnedTelemetry` · **Size:** S–M · **Depends on:** nothing

- `withMcpLogging` (`supabase/functions/terrestrial-brain-mcp/logger.ts`) sets `recordsReturned = result.content.length` — the MCP content-block count, which is always 1 for text results, never the DB row count. Confirmed wrong in current develop code AND prod; the column is useless for the audits Step 4 depends on.
- Fix: have handlers supply the real returned-row count to the logging layer — the decorator cannot know it; decide the seam in design.md (e.g. handlers return an optional `meta: { recordsReturned }` alongside the MCP result, defaulted when absent).
- While in there: **log the returned thought ids** for search/list (bounded, ids only — no content), so retrieval analytics become possible. This is the precursor to Step 7's `last_retrieved_at` retrieval signal; decide in design.md whether ids go in `function_call_logs` or a leaner dedicated column/table.
- **Tests (failing first, per the bug-fix rule):** integration test asserting a `search_thoughts` call returning N thoughts logs `records_returned = N` (must fail against current code); a zero-result call logs 0, an error logs 0 with `error_details` set.

### Step 3: Branding separation sweep
**Source:** legality doc item 4 · **Branch:** `feature/BrandingSeparation` · **Size:** S · **Depends on:** Step 2 (NOTICE exists so attribution has a proper home)

- `README.md:3`: replace the "extension of Open Brain / Nate B Johnes" marketing line with a neutral factual attribution pointing at NOTICE.md (fix the "Johnes" typo while at it; keep the thank-you tone in NOTICE/docs, not marketing copy).
- **GitHub repo description** (currently *"An extended version of Nate B Jones' 'open brain'…"*): change to a product description with no Open Brain/OB1/Nate reference. (Settings change — Anastasia or `gh api` with a PAT; record the new text in the opsx change.)
- Sweep all remaining repo strings for `open.?brain`/`OB1`/Nate outside NOTICE.md, `codeEval/`, and openspec archives (which are historical records — leave them).

### Step L1 [Anastasia]: Capture the original Substack tutorial
Browser history / newsletter archive / Wayback Machine → dated capture into `PassiveIncomeChat/evidence/`. Corroborates legality Argument 4.

### Step L2 [Anastasia]: Product-name trademark knockout + domain check
USPTO/EUIPO knockout search + domain availability for the chosen product name (presumably "Terrestrial Brain" — verify it's clean).

### Step L3 [Anastasia]: Goodwill email to Nate
After Steps 1–2 land, before launch. Outline is in the legality doc Part 2 item 5.

### Step L4 [Anastasia]: 1-hour IP attorney review
Before the paid listing goes live (end of Phase 3 at the latest). Hand over: legality doc, evidence bundle, Step 1's clean fingerprint grep, proposed tier split. Questions to ask are listed in legality doc item 6.

---

## Phase 1 — Memory integrity (the product-polish phase; runs after or in parallel with Phase 0 code steps)

### Step 4: Memory-mechanism audit (data-driven)
**Source:** work plan Phase 1 item 1 · **Branch:** `feature/MemoryMechanismAudit` · **Size:** S–M (~1 day) · **Depends on:** nothing

- Query production `function_call_logs`: what % of `search_thoughts`/`list_thoughts` calls are followed by `record_useful_thoughts` in the same session window? (`get_thought_by_id` auto-records server-side — the baseline.) Audit dedup and extraction behavior in practice.
- Deliverable is a REPORT (markdown in `codeEval/` or `docs/`), not code: which hygiene mechanisms rely on prompt-nudge compliance and must move to server-side enforcement in Step 7.
- Fold in the existing TB task "Audit the usefulness score of thoughts and decide on the archival window" — its answer comes out of this data. Also verify/close the stale `update_thought` TB task.

### Step 5: Memory & task lifecycle rules spec
**Source:** work plan Phase 1 item 2 · **Branch:** `feature/MemoryLifecycleRulesSpec` · **Size:** M (2–3 days, spec-only) · **Depends on:** Step 4 (audit data decides enforcement points)

- Exhaustive condition→outcome table as OpenSpec delta specs (GIVEN/WHEN/THEN): contradiction handling (thought A vs newer B → supersession), staleness/decay, usefulness reinforcement, archival, task reconciliation, and **the integrations sync rules** (PMS→TB ingest, consented close, ask-first creation, status precedence) so they're specced once even though connectors come later.
- Every scenario tagged **test** (deterministic, must always pass) or **eval** (LLM-behavior, pass-rate ≥ threshold). Design bias: push rules from eval-land into test-land via server-side enforcement.
- **Include an `actor` column (LLM | user | sync) on every mutation rule** — this is Invariant 2's structural home; the memory console (Step 17) gets NO separate ruleset.

### Step 6: Test suite + eval harness for the lifecycle rules
**Source:** work plan Phase 1 item 3 · **Branch:** `feature/LifecycleRulesTestHarness` · **Size:** L (1½–2½ weeks) · **Depends on:** Step 5

- Integration tests (real local stack, `TB_AI_PROVIDER=fake` where the rule is deterministic, no mocks on the tested path) for every **test**-tagged scenario.
- Separate eval harness for **eval**-tagged scenarios: scripted, scored pass-rate, thresholded — runs as an explicit opt-in task (like `test:live-llm`), never a silent skip. Wire a CI job that runs the deterministic tier.

### Step 7: Implement memory hygiene
**Source:** work plan Phase 1 item 4 · **Branch:** `feature/MemoryHygiene` · **Size:** L (2–3 weeks) · **Depends on:** Steps 5–6 (specs and tests first — this is TDD at phase scale)

- **Supersession:** `supersedes` edge + capture-time contradiction check (one more AI call in the existing pipeline via the `AiProvider` seam) + a resolve tool the model can invoke.
- **Temporal validity + staleness decay:** review queue surfaced via MCP tool (console UI consumes it in Step 17).
- **Task-reconciliation sweep:** "which open tasks look done per recent thoughts? confirm to close" — consent-based, per the lifecycle rules. Subsumes the existing TB "project and task audit" task.
- 🚨 **INVARIANT 1 lands here structurally:** re-embed + re-hash MUST live in the ONE server-side update path every actor goes through. Write the delta-spec scenario + integration test FIRST: *"GIVEN an entity edited via any path, WHEN searched by its new wording, THEN it matches — and its stored hash equals the hash of the new content."* (`update_thought` already re-embeds; extend the guarantee to projects/tasks/documents and every future edit surface.)

### Step 8: Marketing statement finalized
**Source:** work plan Phase 1 item 5 · **[Anastasia + agent]** · **Size:** ~1 day · **Depends on:** nothing (iterate alongside)

- Iterate the elevator pitch ("long-term memory for your AI…"); landing-page copy skeleton. Feature litmus test goes in the copy doc: *does this help the AI give better answers without the user re-explaining things?*

---

## Phase 2 — Hosted infrastructure

### Step 9: Security hardening residual (CORS + query-param retirement)
**Source:** work plan Phase 2 item 1 (the parts fix-plan Steps 1/3 didn't cover) · **Branch:** `feature/EdgeSecurityResidual` · **Size:** S · **Depends on:** Step 1 (auth header rename — do the CORS allowHeaders change once, with the new name)

- Lock down CORS (`index.ts:382-387`): `origin: "*"` → explicit allowlist (configurable env var; the Obsidian plugin and MCP clients are not browsers — decide in design.md what actually needs CORS at all).
- Decide the fate of the deprecated `?key=` fallback (`index.ts:395-398`): retire fully, or keep behind an explicit opt-in env flag for MCP clients that cannot set headers. Record the trade-off in ThreatModel.md.
- **Tests:** denial tests for disallowed origins; key-in-URL rejected (or flag-gated) per the decision.

### Step 10: Provisioning automation
**Source:** work plan Phase 2 item 2 · **Branch:** `feature/ProvisioningAutomation` · **Size:** L (1–2 weeks) · **Depends on:** Phase 0 complete (don't automate deploying a repo with licensing gaps)

- Supabase Management API pipeline: create project → apply migrations → deploy MCP edge function → set secrets → mint access token → health-check. Region as a parameter (EU customers get EU projects). Idempotent + resumable (the work-plan's runs-twice/crashes-halfway invariant applies in full: claim provisioning jobs atomically, persist external project id before confirming).
- Lives in a new `hosting/` workspace or separate repo — decide in design.md (it must NOT ship in the FSL public repo if it contains hosted-business logic; discuss with Anastasia).

### Step 11: Fleet operations tooling
**Source:** work plan Phase 2 item 3 · **Branch:** `feature/FleetOperations` · **Size:** M (3–5 days) · **Depends on:** Step 10

- Apply-migration-to-all-projects with drift detection; centralized health/error monitoring across customer projects.

### Step 12: Deprovisioning + data export
**Source:** work plan Phase 2 item 4 · **Branch:** `feature/DeprovisionAndExport` · **Size:** M (2–3 days) · **Depends on:** Step 10

- Cancel → full dump delivered → project deleted. Doubles as GDPR export/erasure (builds on fix-plan Step 25's per-note erasure with a whole-account pathway).

---

## Phase 3 — Commercial shell

### Step 13: Control plane
**Source:** work plan Phase 3 · **Branch:** `feature/ControlPlane` · **Size:** L (~1 week) · **Depends on:** Step 10

- One ordinary Supabase project mapping customers → projects/tokens/subscription status; backend for dashboard + billing webhooks.

### Step 14: Billing (Paddle)
**Branch:** `feature/PaddleBilling` · **Size:** L (~1 week) · **Depends on:** Step 13

- Checkout → webhook → provision. Payment failure → pause project; cancellation → deprovision (Step 12 pathway). Webhook signature verification, idempotent webhook handling (at-least-once delivery).

### Step 15: Managed AI + usage metering
**Branch:** `feature/ManagedAiMetering` · **Size:** M (3–5 days) · **Depends on:** Step 10

- Shared OpenRouter key as per-project secret; per-customer quotas enforced in the edge function using existing `function_call_logs` telemetry. Bounded queries; quota-exceeded is a distinct, user-visible state (never a silent empty result).

### Step 16: Onboarding flow
**Branch:** `feature/OnboardingFlow` · **Size:** L (~1 week) · **Depends on:** Steps 13–15

- Signup → payment → "your brain is being built…" (~2 min provisioning) → MCP endpoint + Claude config + Obsidian token. This screen is the pitch.

---

## Phase 4 — Product surface

### Step 17: Memory console (web dashboard MVP)
**Source:** work plan Phase 4 · **Branch:** `feature/MemoryConsole` · **Size:** XL (3–4 weeks; split into sub-changes at opsx time) · **Depends on:** Step 7 (it surfaces the hygiene queues)

- NOT a PM UI. Screens: stale-item review queue, contradiction/supersession resolution, task-reconciliation sweep, usefulness/compliance stats, browse + search, **direct editing**. Plain React/Ionic + Supabase — NOT a TerrestrialCore app (TC is Firebase-based; recorded decision).
- 🚨 **INVARIANT 1:** every console edit goes through the same server-side update path that re-embeds + re-hashes. NEVER a UI-side write that skips it.
- 🚨 **INVARIANT 2:** console mutations carry `actor: user` through the ONE lifecycle ruleset from Step 5. Closing a PMS-origin task surfaces the consented-close choice — never a bare "mark done."
- Doubles as the dev audit dashboard for the Phase 1 rules (one build, two audiences).

### Step 18: GDPR paperwork
**[Anastasia + agent]** · **Size:** M (2–3 days) · **Depends on:** Steps 12, 13

- Privacy policy + DPA. Export/erasure/EU-hosting are already structural (per-customer projects, Step 12, fix-plan Step 25).

### Step 19: Obsidian plugin polish + community-store submission
**Branch:** `feature/PluginStoreSubmission` · **Size:** L (~1 week) · **Depends on:** Steps 1, 3 (branding + auth header settled first — the store listing is public)

- Obsidian community-plugin guidelines compliance review, listing copy, release workflow (`versions.json` exists from fix-plan Step 27). Free distribution channel.

### Step 20: Status page + alerting
**Branch:** `feature/StatusPageAlerting` · **Size:** M (2–3 days) · **Depends on:** Step 11

---

## Explicitly out of scope (recorded so nobody "helpfully" adds them)

- Full bidirectional PM sync; connectors are v1.5+, demand-driven (sync RULES are specced in Step 5, implementation deferred)
- Teams / shared brains; weekly digests; mobile wrapper
- Slack ingest (deleted, not deferred)
- TB becoming a PM system itself; embedded console chatbot; self-hosted droplet infrastructure (all parked — see work plan "Parked ideas" with rationale)

## Progress Checklist

**Phase 0 — Legal & licensing**
- [x] 1. OB1 fragment rewrite (`feature/Ob1FragmentRewrite`) — done 2026-07-10 (opsx `ob1-fragment-rewrite`): `x-brain-key`→`x-tb-key` (hard cut), metadata prompt re-expressed, `match_thoughts`→`search_thoughts_by_embedding`; fingerprint grep saved to evidence bundle; full suite green.
- [x] 2. LICENSE + NOTICE (`feature/LicenseAndNotice`) — done 2026-07-10 (opsx `license-and-notice`): added `LICENSE.md` (FSL-1.1-MIT, Terrestrial Origin 2026), `NOTICE.md` (MIT attribution to Open Brain / Nate B. Jones through `f3e45e1`, MIT text reproduced), rewrote README `## License` section (bare "MIT" → FSL tier split + NOTICE reference), ThreatModel compliance note. Docs-only; full suite green (backend 594, plugin 123, plugin build OK).
- [x] 2b. Fix records_returned telemetry (`bug/RecordsReturnedTelemetry`) — done 2026-07-10 (opsx `records-returned-telemetry`): added a `meta` seam on the response envelope so row-returning handlers report the real DB row count; `withMcpLogging` now logs `records_returned` from `meta` (was `content.length`, always 1) and forces 0 on the error path; new nullable `function_call_logs.returned_ids` (jsonb, ids-only) logs returned thought ids for `search_thoughts`/`list_thoughts`/`get_thought_by_id` (Step 7 `last_retrieved_at` precursor); `meta` stripped from the MCP client payload. Failing unit test written RED first; new integration test on the real stack. ThreatModel T14 added. Full suite green (backend 603, plugin 123, plugin build OK, 0 skips).
- [x] 3. Branding separation (`feature/BrandingSeparation`) — done 2026-07-12 (opsx `branding-separation`): replaced the `README.md:3` marketing line ("extension of Open Brain by Nate B Johnes / subscribe to his youtube channel") with a neutral product tagline (no Open Brain/OB1/Nate, no endorsement); added `ThreatModel.md` compliance note; new deterministic guard `tests/unit/branding-separation.test.ts` (asserts README tagline is provenance-free, sweeps the repo for `open.?brain`/`OB1`/`Nate` with an allowlist for NOTICE/License-section/ThreatModel/migrations/codeEval/openspec/tests, and asserts NOTICE.md retains attribution) — written RED first, now green; `--allow-read` added to the `test`/`test:unit` deno tasks. Retained (deliberate): `NOTICE.md`, README `## License` attribution pointer, ThreatModel factual `ob1-fragment-rewrite` refs, and the append-only migration comment. Full suite green (backend 606, plugin 123, plugin build OK, lint/fmt clean, 0 skips). **PENDING [Anastasia]:** update the GitHub repo description (gh CLI unavailable here) to *"An AI-powered second brain that connects Obsidian to a Supabase knowledge base and exposes your notes to AI agents through an MCP server."* — recorded in the archived change, task 3.1, left unchecked until applied in GitHub settings.
- [ ] L1. [Anastasia] Substack tutorial capture
- [ ] L2. [Anastasia] Trademark knockout + domain check
- [ ] L3. [Anastasia] Goodwill email to Nate (after 1–2)
- [ ] L4. [Anastasia] IP attorney review (before paid listing)

**Phase 1 — Memory integrity**
- [x] 4. Memory-mechanism audit (`feature/MemoryMechanismAudit`) — done 2026-07-12 (opsx `memory-mechanism-audit`): completed the open dedup/extraction half via READ-ONLY prod queries + a code map, and consolidated both halves into `codeEval/Fable20260712-MemoryMechanismAudit.md`. Findings: **dedup is not server-side enforced** (`capture_thought` inserts unconditionally; ingest near-dup guard is prompt-only — prod shows 8 exact dupes + ~13% near-dup rate on a recent sample); **extraction `type` is cast, not validated vs the `THOUGHT_TYPES` allowlist** (prod holds out-of-allowlist `instruction`×6 / `decision`×5); usefulness scoring is server-side and clean since the 2026-05-01 epoch (archival must stay multi-signal, never score-alone). Report hands Step 7 a 3-item server-side-enforcement list and Step 5 the threshold/allowlist decisions. Version-controlled the prior untracked usefulness half (`Fable20260710-UsefulnessAudit.md` + `docs/usefulness-audit-runbook.md`, extended with dedup/extraction query sets); added ThreatModel T15 (READ-ONLY audit constraint). Verified+closed the `update_thought` TB task (shipped, re-embeds on edit) and the folded-in usefulness/archival question. **No code/schema/migration changed.** Full suite green (backend 606, plugin 123, plugin build OK, branding guard green, 0 skips).
- [x] 5. Lifecycle rules spec (`feature/MemoryLifecycleRulesSpec`) — done 2026-07-12 (opsx `memory-lifecycle-rules-spec`): specification-only change. Added two new capability delta specs — `memory-lifecycle-rules` (actor model [LLM|user|sync], write-time dedup gate 0.05–0.10 band, extraction-`type` parse-against-allowlist extended with `instruction`/`decision` + `observation` fallback, supersession-not-deletion via a `supersedes` edge, usefulness reinforcement + rubber-stamp down-weighting, temporal/staleness signal, multi-signal human-queued archival, consent-based task reconciliation, and the INVARIANT-1 re-embed/re-hash guarantee) and `integration-sync-rules` (PMS→TB ingest mapping native status, single-owner/status precedence, no autonomous push, consented close + stays-open-on-failure, ask-first creation, at-least-once webhook idempotency — specced now, implemented v1.5+). Every scenario tagged `test` (deterministic) or `eval` (LLM-behavior), with the design bias documented (push rules eval→test via server-side enforcement); every mutation carries an `actor` (Invariant 2's structural home — the memory console gets NO separate ruleset). `design.md` records the three Step-4 handoff decisions with rationale + alternatives, user-error scenarios, and the test strategy; `ThreatModel.md` gains T16–T20 (spec-integrity threats owned by this ruleset). **No code, schema, migration, or behavior changed** — every rule is an input to Step 6 (tests/eval harness) and Step 7 (implementation). `openspec validate --strict` clean; full suite green (backend 606, plugin 123, plugin build OK, 0 skips, 0 failures).
- [x] 6. Rules test suite + eval harness (`feature/LifecycleRulesTestHarness`) — done 2026-07-12 (opsx `lifecycle-rules-test-harness`): built the executable acceptance harness for all 47 Step-5 scenarios as **TDD at phase scale** (project-owner decision: literal gated tests, red-by-design until Step 7). New capability `lifecycle-rules-verification` (8 requirements, synced). **Deterministic tier** (`tests/integration/lifecycle/`, in `deno task test`): 28 memory `test`-scenarios as real integration tests on the local stack (`TB_AI_PROVIDER=fake`, no mocks on the tested path except the LLM seam), asserting durable DB state — **5 pass-now** (INVARIANT-1 re-embed on thoughts, `get_thought_by_id` auto-record, user-edit-no-reinforce, distinct-content write, allowlisted-type-as-is) and 23 red-by-design, each failing for one documented `PENDING(step7:<slug>)` reason (dedup gate, supersession/`superseded_by`, `content_hash`, `last_actor`, `last_retrieved_at`, stale/archival/reconcile tools, rubber-stamp, allowlist parse). **Opt-in eval tier** (`tests/eval/`, `deno task test:eval`): 5 `eval`-scenarios, scored/thresholded (0.8), fail-loud without `OPENROUTER_API_KEY`. **Opt-in sync tier** (`tests/sync-rules/`, `deno task test:sync-rules`): 14 `test`-scenarios routed through a single v1.5 `syncConnector` seam (all fail `PENDING(v1.5:connectors-unimplemented)`, never gated so Step 7's burn-down stays reachable). **Coverage manifest** + bijection meta-test (`tests/lifecycle-coverage.manifest.ts` + `tests/unit/lifecycle-coverage.test.ts`, green) enforce scenario↔test 1:1 and log the burn-down (`pass-now=5 pending-step7=27 pending-v1.5=15 total=47`). CI keeps lint/fmt on `if: always()` so signal survives the intentional red; ThreatModel T21–T23 (vacuous-green/dishonest-red/silent-coverage-gap); `docs/lifecycle-test-harness.md` hands Step 7 the burn-down guide. GATE-2b mutation spot-check confirmed the 2 shipped-behavior pass-now tests are non-vacuous. Full gate: **backend 620 passed / 23 failed (all red-by-design) / 0 skipped**, plugin 123 passed + build OK, deno lint/fmt clean. **No production code/schema/migration changed** (a temporary mutation-check edit to `tools/thoughts.ts` was reverted). ⚠️ **By design `deno task test` (and CI's backend job) is RED until Step 7 implements the features** — the accepted TDD-at-phase-scale outcome.
- [x] 7. Memory hygiene implementation (`feature/MemoryHygiene`) — done 2026-07-12 (opsx `memory-hygiene`): implemented the Step-5 rules whose Step-6 acceptance tests were red-by-design, turning the **deterministic lifecycle tier fully green (28/28)**. New capability `memory-hygiene` (8 requirements, synced). One append-only migration `20260712000001_memory_hygiene.sql`: `content_hash` on thoughts/projects/tasks/documents, `thoughts.superseded_by`/`last_retrieved_at`/`last_actor`, recreated `search_thoughts_by_embedding` (excludes `superseded_by`), `increment_usefulness_weighted` RPC (+ reference-file sync + `database.types.ts` regen). Features: **write-time dedup gate** (`resolveDedup` on capture — byte-identical via `content_hash` + within-band via embedding ≥0.90; drops duplicates server-side); **supersession mechanism** (edge + `resolve_supersession` tool + default-search exclusion — auto-detection is eval-tier/deferred); **INVARIANT 1** (`hashContent` sha256 re-hash in the one update path across all four entities, thoughts also re-embed; emptying is a valid re-hashed edit); **actor model** (`last_actor` recorded LLM/user/sync through the one path, `update_thought` gains an `actor` param); **retrieval recency** (`touchRetrieved` advances `last_retrieved_at` on search/list/get_by_id) + **`get_stale_thoughts`/`get_archival_queue`/`reconcile_tasks`** review tools (multi-signal, human-queued, never auto-applied); **rubber-stamp down-weighting** (`record_useful_thoughts` optional `returned_ids` → weighted increment, selective out-weights all-selecting); **extraction-type allowlist** (`THOUGHT_TYPES` + `instruction`/`decision`, `coerceThoughtType` parses out-of-allowlist/missing → `observation`). Step-6 probe tests strengthened to real behavior (INVARIANT-1 hash across entities, supersession search-exclusion, dedup counts, recency advance, actor recording, rubber-stamp ordering); manifest flipped 23 entries → pass-now (burn-down: **pass-now=28, pending-step7=4 eval, pending-v1.5=15 sync**). ThreatModel T16/T17/T19 → **Mitigated**. Full gate GREEN: **backend 643 passed / 0 failed / 0 skipped**, plugin 123 + build OK, deno lint/fmt clean; sync tier still all-pending-v1.5 (opt-in), eval tier fail-loud without a key (opt-in).
- [ ] 8. Marketing statement finalized

**Phase 2 — Hosted infrastructure**
- [x] 9. Security hardening residual (`feature/EdgeSecurityResidual`) — done 2026-07-12 (opsx `edge-security-residual`): closed the two residual edge-boundary gaps. New pure config seam `security-config.ts` (parse-at-boundary): **CORS now defaults to deny** — `origin: "*"` replaced with an allowlist resolver driven by `TB_ALLOWED_ORIGINS` (unset ⇒ no cross-origin; wildcard `*` never emitted), and the **deprecated `?key=` query-param auth fallback is rejected by default**, re-enablable only via `TB_ALLOW_KEY_IN_QUERY=1` (exact `"1"`), with the `x-tb-key` header always winning. Wired once at the composition root. **Discovery:** the local Supabase dev gateway (Kong) injects permissive `*` CORS on `/functions/v1/*`, masking the app on the network path (hosted deployments are app-authoritative, since functions own their CORS) — so the CORS reflect-vs-deny behavior is verified **in-process** against the real Hono middleware (`tests/unit/cors-middleware.test.ts`) rather than through the local stack; the `?key=` default-reject is verified end-to-end on the real stack (`tests/integration/auth.test.ts`). All integration test helpers migrated off `?key=` to the `x-tb-key` header (the breaking change surfaced as the shared helper authenticated via query param). Removed a broken `"hono/"` trailing-slash import map from the root `deno.json` (aligned with the function's own deno.json; fixed `hono/cors` subpath resolution for tests). Docs: README env table + MCP-client config (header-primary), `docs/upgrade.md` breaking-change note, `ThreatModel.md` T2 → **Mitigated (default)** + T7 → **Mitigated**, canonical `openspec/specs/mcp-server.md` reconciled. **No schema/migration/plugin change.** Full gate GREEN: backend **664 passed / 0 failed / 0 skipped**, deno lint + fmt clean, plugin 123 passed + build OK, `openspec validate --strict` clean.
- [x] 10. Provisioning automation (`feature/ProvisioningAutomation`) — done 2026-07-12 (opsx `provisioning-automation`): built the idempotent, resumable per-customer provisioning pipeline that automates the `docs/fresh-install.md` runbook (create project → await-healthy → apply migrations → set secrets → deploy `terrestrial-brain-mcp` → mint access key → health-check → return `{ mcpUrl, accessKey }`). **Owner decision (recorded in design.md): the implementation lives in a NEW SEPARATE PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting`** (local git for now; private GitHub remote added later) so hosted-business logic never ships in this FSL public tree — this repo keeps only the OpenSpec artifacts, the plan checkbox, and one ThreatModel entry. Pipeline is a step-cursor state machine: region is a parse-don't-cast allowlist parameter (EU customers → EU project); idempotency keyed on customer id via an atomic CAS `claim` (runs-twice → one project, interleave → one wins); the external project ref + db password + once-minted access key are persisted BEFORE their step confirms so a crash resumes without duplicating work or rotating the key; failure leaves a recoverable `failed` job with an explicit `rollback` op (opt-in `--auto-rollback`). Every external dependency (Management API, Supabase CLI deploy runner, job store, clock, key generator, endpoint health checker) sits behind a 3–5 method seam wired at one composition root, with deterministic fakes so the full pipeline runs with no network/live-Supabase/paid-API. Secrets: Management token env-only + `Authorization: Bearer` (never URL), CSPRNG 256-bit per-customer key minted once, redacting logger + no-secret-in-logs test, 0600 interim file job store (replaced by Step 13's control plane). ThreatModel **T25** added (public repo). Hosting suite **30 passed / 0 failed** (unit + integration: happy-path, idempotency, crash-resume, interleave, failure/rollback, no-secret-in-logs), `deno lint`/`fmt` clean, full typecheck clean; **GATE-2b mutation checks** confirmed the three core guarantees (persist-ref→D3, region→region tests, CAS→interleave) are non-vacuous; opt-in fail-loud live smoke (`provision:live`) for real-system confidence. Public repo unchanged at runtime (only ThreatModel + openspec artifacts) — full gate GREEN: backend **675 passed / 0 failed / 0 skipped** (on a freshly `db reset` blank+seeded stack), plugin **123 passed** + build OK. **PENDING [Anastasia]:** add the private GitHub remote for `terrestrial-brain-hosting` when ready.
- [x] 11. Fleet operations tooling (`feature/FleetOperations`) — done 2026-07-13 (opsx `fleet-operations`): built the two fleet-wide operations that operate the fleet AFTER Step 10 provisions it, in the SAME separate PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting` (public repo keeps only the OpenSpec artifacts + ThreatModel T26 + this checkbox — no fleet code). New capability `fleet-operations` (6 requirements). **(1) Apply-migrations-to-all-projects with drift detection:** the fleet is the job store's `done` jobs (`ProvisioningJobStore.listAll` added — authoritative, never "every org project"); per-project drift = local migration versions (pinned `TB_MIGRATIONS_SOURCE`) minus versions applied on the project (read read-only via the Management API database-query endpoint — no db password needed for detection); drifted projects get `db push` via the reused `DeployRunner`; `--dry-run` reports drift without applying. The sweep is per-project independent and returns a **counted outcome** (`in_sync`/`migrated`/`failed` + summary), overall-fails (non-zero exit) if any project failed, and counts success only from projects that actually ended in sync — never a green loop-end. **(2) Centralized health/error monitoring:** per project, Supabase platform health + a **bounded** recent-error count from `function_call_logs` (24h window + aggregate, counts only, no content), classified `healthy`/`degraded`/`unhealthy`/`unreachable` — a failed probe/query is `unreachable` with its error, **never** conflated with healthy-0. New narrow seams reusing Step 10's composition root: `FleetInspector` (two purpose-specific bounded reads, NO generic SQL — no injection surface) + `MigrationSource` (local versions), each with a deterministic fake. New `fleet:migrate`/`fleet:monitor` CLI + tasks + opt-in fail-loud `fleet:live` smoke. All CLAUDE.md invariants honored (idempotent re-run, unreachable≠empty, counted partial failure, bounded queries, Bearer-not-URL, no-secret-in-logs); GATE-2b mutation checks confirmed the counted-outcome and drift guarantees are non-vacuous. Hosting suite **59 passed / 0 failed** (unit + integration; real fleet logic + real job store, fakes only at the external boundary), `deno lint`/`fmt`/`check` clean. Public repo unchanged at runtime — full gate GREEN: backend **675 passed / 0 failed / 0 skipped** (freshly `db reset` stack), plugin **123 passed** + build OK. ThreatModel **T26** added.
- [x] 12. Deprovisioning + data export (`feature/DeprovisionAndExport`) — done 2026-07-13 (opsx `deprovision-and-export`): built whole-account deprovisioning + data export that ends a tenancy — cancel → full **verified** dump delivered → project deleted — doubling as GDPR data portability (Art. 20) + erasure (Art. 17, complementing fix-plan Step 25's per-note `forget_note`). In the SAME separate PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting` (public repo keeps only the OpenSpec artifacts + ThreatModel T27 + this checkbox — no deprovision/export code). New capability `deprovision-and-export` (6 requirements, synced). **Two operations, one shared exporter:** `export` (non-destructive — dump → deliver → verify, repeatable, side-effect-free) and `deprovision` (destructive state machine `EXPORT_DATA → VERIFY_EXPORT → DELETE_PROJECT → FINALIZE`). 🚨 **The destructive delete is STRUCTURALLY gated on a verified export:** `DELETE_PROJECT` is unreachable until `VERIFY_EXPORT` re-reads the delivered artifact and confirms size+SHA-256, and the manifest is persisted BEFORE the delete — so a crash resumes at the delete rather than losing the export (**never delete-then-write**). Idempotent + resumable (dedicated `DeprovisionJobStore` with atomic CAS `claim` → runs-twice deletes once; already-`deprovisioned` → clean no-op; delete scoped to the single ref from the customer's OWN provisioning record, no bulk/wildcard). Honest counted outcome (`deprovisioned` ONLY when export verified AND delete succeeded, else recoverable `failed` + non-zero exit); on success flips the provisioning job to a new `deprovisioned` status so Step 11's `done`-only fleet enumeration excludes it. Guards: not-found → reported, non-`done` → refused (orphans are Step 10 rollback's job). New narrow `DataExporter` seam (real `pg_dump`/`psql` adapter passes the db password via `PGPASSWORD` env, NEVER argv/logs; content-free manifest; artifact `0600`) + `TB_EXPORT_DIR` config, wired at the one composition root; new `export`/`deprovision` CLI + tasks + opt-in fail-loud NON-destructive `export:live` smoke (destructive path is manual/throwaway-only). **GATE-2b mutation checks confirmed all 5 core guarantees non-vacuous** (remove verify-gate → gated-delete test reddens; ignore persisted cursor → crash-resume test reddens; dishonest loop-end success → counted-outcome test reddens; remove `done`-guard → refusal test reddens; trust-the-manifest → tamper-detect tests redden). Hosting suite **84 passed / 0 failed** (was 59; unit + integration: real state machine + real job stores, fakes only at the external boundary — verify-before-delete gate, crash-resume, idempotency/runs-twice, guards, export-only non-destructive, no-secret/no-content-in-logs), `deno lint`/`fmt`/`check` clean. Public repo unchanged at runtime — full gate GREEN: backend **675 passed / 0 failed / 0 skipped** (freshly `db reset` stack), plugin **123 passed** + build OK. ThreatModel **T27** added. **Open item:** the delivered export is itself retained personal data — its retention/rotation policy is deferred to Step 13's control plane.

**Phase 3 — Commercial shell**
- [x] 13. Control plane (`feature/ControlPlane`) — done 2026-07-13 (opsx `control-plane`): built the durable control plane — **one ordinary Supabase project** mapping customers → projects → tokens → subscription status — in the SAME separate PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting` (public repo keeps only the OpenSpec artifacts + ThreatModel T28 + this checkbox — no control-plane code). New capability `control-plane` (6 requirements, synced). **Replaces the interim 0600 file job stores** (`ProvisioningJobStore`/`DeprovisionJobStore`) with durable control-plane-backed stores selected by `TB_STORE_BACKEND`, with **NO change to any provisioning/fleet/deprovision step or pipeline logic** (verified: only config/composition-root/cli/deno.json among existing files changed — the stores are seams). **Atomic claim is DB-enforced:** a single Postgres conditional write (`claim_*_job` functions in `control-plane/schema.sql`) so two racing claims for one customer yield exactly one winner — not a process-local check. **Proper secret storage:** the minted MCP access key + db password move out of plaintext files into a service-role-only `project_secrets` table, split off the provisioning row on save and rejoined only on load (in-memory job shape byte-for-byte unchanged), never returned by a customer-facing read, never logged — behind a `SecretStore` seam (platform-vs-app-encryption trade-off documented). **Export retention** (closes Step 12's open item): content-free `export_artifacts` records + a counted, idempotent `control-plane purge-exports`. **Transport-neutral `ControlPlaneService`** (list/get customers no-secrets, idempotent subscription upsert refusing unknown customers, record/list artifacts) — written once so Step 14 billing webhooks + Step 16/17 dashboard are thin adapters (NOT the Paddle integration, NOT the UI). Everything sits behind a narrow intent-named `ControlPlaneClient` seam (no generic SQL) with a deterministic `InMemoryControlPlaneClient` fake modelling the conditional-write claim; every row is parsed at the boundary (Zod). New `control-plane apply-schema`/`purge-exports` CLI + tasks + opt-in fail-loud `control-plane:live` smoke. All CLAUDE.md invariants honored (runs-twice→one-winner CAS, crash-halfway→cursor+secret-rejoin resume, parse-don't-cast, bounded retention query, secrets in headers/never-URL/never-logged, empty≠broken). GATE-2b mutation checks confirmed all 4 core guarantees non-vacuous (drop CAS guard → interleave reddens; drop retention filter → purge-not-due reddens; leak secret in a service read → omission reddens; skip secret rejoin → crash-resume/round-trip reddens). Hosting suite **114 passed / 0 failed** (was 84; unit + integration: real stores/service, fake only at the DB boundary), `deno lint`/`fmt`/`check` clean. Public repo unchanged at runtime — full gate GREEN: backend **675 passed / 0 failed / 0 skipped** (freshly `db reset` stack), plugin **123 passed** + build OK. ThreatModel **T28** added; resolves T25's interim-plaintext-store and T27's deferred-export-retention open items. **PENDING [Anastasia]:** create the one ordinary control-plane Supabase project out-of-band and set `TB_CONTROL_PLANE_URL`/`_SERVICE_KEY` (+ `TB_STORE_BACKEND=control-plane`) to activate the durable backend in the hosted deployment.
- [x] 14. Paddle billing (`feature/PaddleBilling`) — done 2026-07-13 (opsx `paddle-billing`): built the hosted billing webhook that maps a customer's Paddle payment lifecycle onto the fleet, in the SAME separate PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting` (public repo keeps only the OpenSpec artifacts + ThreatModel T29 + this checkbox — no billing code). New capability `paddle-billing` (6 requirements, synced). **Verified webhook → lifecycle:** every inbound webhook's `Paddle-Signature` (`ts=…;h1=…`) is verified as a constant-time HMAC-SHA256 over the timestamped **raw** body against `TB_PADDLE_WEBHOOK_SECRET` with a freshness window (replay defence) — no valid signature ⇒ 401, zero side effect (new `PaddleSignatureVerifier` seam + Web-Crypto adapter + fake). **At-least-once idempotency:** each Paddle `event_id` is claimed via a single atomic insert-if-absent into a new service-role-only `webhook_events` table (`ControlPlaneClient.claimWebhookEvent`), so a redelivery is a 200 no-op and each side effect runs exactly once. **Parse-at-boundary** (Zod) into a discriminated union — an event with no `custom_data.customer_id` is refused (400, never invents a customer), an unrecognised type is acknowledged-and-ignored (200). **Transport-neutral `BillingService`** (`handleWebhook` = verify→parse→claim→dispatch): `transaction.completed`/`subscription.activated` → ensure customer + `active` + provision (Step 10, idempotent — only when not already `done`); `transaction.payment_failed`/`past_due` → pause the project (new Management-API `pauseProject`/`restoreProject`) + `paused`; `subscription.resumed` → restore + `active`; `subscription.canceled` → `canceled` + deprovision (Step 12, export-then-delete). Long pipelines run out-of-band through narrow `ProvisioningTrigger`/`DeprovisionTrigger` seams so the webhook acks fast; the `Deno.serve` receiver is a thin adapter mapping the outcome to a status code (ok/ignored/duplicate → 200, rejected-signature → 401, bad-request → 400). New `billing serve` CLI + `billing:serve`/`billing:live` tasks; new config `TB_PADDLE_WEBHOOK_SECRET` (redacted crown-jewel) + `TB_PADDLE_DEFAULT_REGION`; README billing section + `.env.example`. Builds on Step 13's `ControlPlaneService.setSubscriptionStatus` (unchanged); NO change to provisioning/deprovision pipeline logic (invoked via seams). All CLAUDE.md invariants honored (signature-gated destructive actions, runs-twice→one-claim idempotency, ack-fast/execute-out-of-band, secrets in headers/never-URL/never-logged, empty≠broken). **GATE-2b mutation checks confirmed all 4 core guarantees non-vacuous** (verifier bypass → signature-reject reddens; always-claim → idempotency reddens; dropped pause → pause reddens; dropped no-customer refusal → bad-request reddens). Hosting suite **145 passed / 0 failed** (was 114; unit + integration: real BillingService + real ControlPlaneService, fakes only at the external boundaries), `deno lint`/`fmt`/`check` clean; opt-in fail-loud NON-destructive `billing:live` smoke (real HMAC + real `webhook_events` idempotency, throwaway control-plane project). Public repo unchanged at runtime — full gate GREEN: backend **675 passed / 0 failed / 0 skipped** (freshly `db reset` stack), plugin **123 passed** + build OK. ThreatModel **T29** added. **PENDING [Anastasia]:** create the Paddle webhook destination + set `TB_PADDLE_WEBHOOK_SECRET` in the hosted deployment to activate the receiver.
- [ ] 15. Managed AI + metering (`feature/ManagedAiMetering`)
- [ ] 16. Onboarding flow (`feature/OnboardingFlow`)

**Phase 4 — Product surface**
- [ ] 17. Memory console MVP (`feature/MemoryConsole`)
- [ ] 18. GDPR paperwork
- [ ] 19. Plugin store submission (`feature/PluginStoreSubmission`)
- [ ] 20. Status page + alerting (`feature/StatusPageAlerting`)
