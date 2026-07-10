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
| **GitHub repo description** | ❌ Still says "An extended version of Nate B Jones' 'open brain'…" | GitHub API, verified 2026-07-10 |
| **README branding** | ❌ `README.md:3` still markets via "Open Brain" / Nate reference | |
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
- [ ] 3. Branding separation (`feature/BrandingSeparation`)
- [ ] L1. [Anastasia] Substack tutorial capture
- [ ] L2. [Anastasia] Trademark knockout + domain check
- [ ] L3. [Anastasia] Goodwill email to Nate (after 1–2)
- [ ] L4. [Anastasia] IP attorney review (before paid listing)

**Phase 1 — Memory integrity**
- [ ] 4. Memory-mechanism audit (`feature/MemoryMechanismAudit`)
- [ ] 5. Lifecycle rules spec (`feature/MemoryLifecycleRulesSpec`)
- [ ] 6. Rules test suite + eval harness (`feature/LifecycleRulesTestHarness`)
- [ ] 7. Memory hygiene implementation (`feature/MemoryHygiene`)
- [ ] 8. Marketing statement finalized

**Phase 2 — Hosted infrastructure**
- [ ] 9. Security hardening residual (`feature/EdgeSecurityResidual`)
- [ ] 10. Provisioning automation (`feature/ProvisioningAutomation`)
- [ ] 11. Fleet operations tooling (`feature/FleetOperations`)
- [ ] 12. Deprovisioning + data export (`feature/DeprovisionAndExport`)

**Phase 3 — Commercial shell**
- [ ] 13. Control plane (`feature/ControlPlane`)
- [ ] 14. Paddle billing (`feature/PaddleBilling`)
- [ ] 15. Managed AI + metering (`feature/ManagedAiMetering`)
- [ ] 16. Onboarding flow (`feature/OnboardingFlow`)

**Phase 4 — Product surface**
- [ ] 17. Memory console MVP (`feature/MemoryConsole`)
- [ ] 18. GDPR paperwork
- [ ] 19. Plugin store submission (`feature/PluginStoreSubmission`)
- [ ] 20. Status page + alerting (`feature/StatusPageAlerting`)
