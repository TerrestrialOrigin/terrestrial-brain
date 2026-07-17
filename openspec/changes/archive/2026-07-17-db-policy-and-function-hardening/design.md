## Context

Three DB hardening defects (SQL-1, SQL-4, SQL-8 in `codeEval/Fable20260717RemediationPlan.md`) remain after the `20260704000001` security sweep. All are in the "one drift away from a real bug" category rather than currently-exploitable, but each degrades a defense the project already established elsewhere:

- **SQL-1** — `function_call_logs` policy (`20260404000002:16-18`) is `for all using (auth.role() = 'service_role')` with **no `to` clause**, so it attaches to every role and leans entirely on a deprecated, per-row predicate. The canonical hardened shape (used by `20260704000001` for `people`) is `for all to service_role using (true) with check (true)`.
- **SQL-4** — `increment_usefulness` (`20260404000001:13`), `increment_usefulness_weighted` (`20260712000001:84`), and the `update_updated_at()` trigger (`00000000000000_initial.sql`) pin `search_path` without `pg_temp` (or not at all). The retention migration `20260706000002:40` shows the hardened form `set search_path = public, pg_temp`.
- **SQL-8** — `increment_usefulness_weighted` runs `usefulness_score + weight` for any integer, no bounds.

Migrations are append-only. All fixes land in ONE new migration; existing files are never edited.

## Goals / Non-Goals

**Goals:**
- Normalize the `function_call_logs` policy to the `to service_role` canonical shape.
- Pin `search_path = public, pg_temp` on the three functions (create-or-replace, bodies otherwise unchanged), restating explicit revoke/grant for the two RPCs.
- Reject out-of-range `weight` in `increment_usefulness_weighted` before any mutation.
- Add Deno integration coverage for the weight bounds and the recreated policy shape.

**Non-Goals:**
- Wiring pgTAP into CI or the generic `pg_policies` meta-assertion (Step 10).
- Any behavior change to `increment_usefulness`/`update_updated_at` beyond the `search_path` pin.
- Archived-row retention/erasure (SQL-9, deferred).

## Decisions

**D1 — One new migration, create-or-replace, drop-then-create the policy.**
A policy cannot be altered to add a `to` clause in place, so we `drop policy … ; create policy …`. Functions use `create or replace` so signatures and dependents (the `thoughts_updated_at` trigger bound to `update_updated_at`) are preserved without a drop. Rationale: append-only discipline + zero downtime; `create or replace function` keeps the existing trigger binding intact (a `drop function` would fail on the dependent trigger).

**D2 — Weight bounds `[1, 100]`, raised exception (not silent clamp).**
The edge caller's weighting scheme produces small positive integers; anything outside `[1, 100]` signals a caller bug or a hallucinated value, which must fail loudly at the last boundary rather than persist a corrupted score. `raise exception 'weight must be between 1 and 100, got %', weight;` surfaces as a PostgREST error the repository already maps. Alternative considered: a CHECK-like clamp to the range — rejected because silently clamping hides the upstream bug (violates empty-vs-broken: a broken input must not render as a successful mutation).

**D3 — Test at the Deno integration layer, not pgTAP (yet).**
pgTAP is the natural home for policy-shape and RPC-denial assertions, but the suite is not wired into CI until Step 10. To avoid a green-nowhere gap, the weight-bounds behavior is asserted through the service-role RPC in `tests/integration/` (real DB, no mocks on the path). The policy-shape normalization is verified by the existing anon-denial coverage (function_call_logs remains inaccessible to anon) plus a direct `pg_policies` shape assertion added here; the generic meta-assertion moves to Step 10's pgTAP suite.

### User error scenarios
- **Caller passes `weight = 0` / negative / `> 100`** (edge bug or LLM-derived value): RPC raises, no rows mutated, repository surfaces the error. Covered by a mutation-check test (removing the guard turns it red).
- **Empty `thought_ids` array** with a valid weight: guard passes, `update … where id = any('{}')` affects 0 rows, returns 0 — unchanged, benign.
- **Re-run of the migration** (idempotent apply): `drop policy` uses the exact existing name; `create or replace function` is inherently idempotent. Safe under `supabase db reset` re-application.

### Security analysis
- **Threat: grant drift re-opens function_call_logs to anon.** The `to service_role` clause makes the policy inert for anon/authenticated regardless of table grants, closing the S1-class hole for this personal-data table. (A generic `pg_policies` guard against future missing-`to` policies is Step 10.)
- **Threat: temp-schema hijack of a `SECURITY DEFINER` UPDATE.** Without `pg_temp` last in `search_path`, a caller who can create a temp table named `thoughts` could have the definer resolve to it. EXECUTE is service_role-only so exploitability is low, but pinning `pg_temp` removes the class. No new attack surface is introduced.
- **Threat: ranking-signal corruption via unbounded weight.** The `[1,100]` guard caps blast radius of a single call and prevents `integer` overflow of `usefulness_score`.
- No secrets, no new external calls, no new roles/grants beyond restating existing service_role EXECUTE.

### Test Strategy
- **Integration (Deno, real DB):** weighted RPC rejects 0 / 101 / -5 (raises) and applies a valid weight (e.g. 3) to a seeded thought; `function_call_logs` policy row in `pg_policies` has `roles = {service_role}`. Mock-boundary: zero mocks on the DB path.
- **Migration replay:** `supabase db reset` applies the new migration cleanly (the gate run proves this).
- **GATE 2b mutation check:** deleting the weight guard reddens the out-of-range test; changing the policy back to no-`to` reddens the shape assertion.
- pgTAP-tier denial/meta assertions: deferred to Step 10 (documented, not silently skipped).

## Risks / Trade-offs

- **[Bounds `[1,100]` might be too tight for a future weighting scheme]** → The edge function's current scheme uses small positive integers; if a wider range is ever needed it is a one-line change in a later append-only migration. Chosen over an unbounded column to eliminate the corruption/overflow class now.
- **[`drop policy` fails if the policy name ever changed]** → Verified the exact current name is `"Service role full access"` in `20260404000002`; the migration will fail loudly (not silently) if that assumption is wrong, which the gate run surfaces.
- **[Recreating `update_updated_at` while a trigger depends on it]** → `create or replace function` preserves the dependency; verified the trigger references the function by name, not OID.
