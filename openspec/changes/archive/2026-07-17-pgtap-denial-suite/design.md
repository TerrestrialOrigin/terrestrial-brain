## Context

Two DB-level regression-net holes (SQL-5, SQL-6) plus partial Deno denial coverage (TEST-8). The trust model established by `20260704000001`: anon/authenticated hold no table DML grants and no function EXECUTE, so a denial attempt fails at the privilege level with SQLSTATE `42501` — verified empirically that `42501` fires before any constraint check, and for both tables and RPCs. All 8 public policies are already `{service_role}` after Step 9.

Public tables (8): `thoughts, projects, tasks, note_snapshots, ai_output, people, documents, function_call_logs`.
Exposed RPCs (7): `search_thoughts_by_embedding, thought_stats, increment_usefulness, increment_usefulness_weighted, purge_function_call_logs, get_pending_ai_output_metadata, normalize_thought_project_refs`. (`update_updated_at` is a trigger function, not directly callable — excluded.)

## Goals / Non-Goals

**Goals:**
- A pgTAP denial suite covering every table (SELECT+INSERT, anon+authenticated) and every RPC (EXECUTE, anon+authenticated), plus a generic `pg_policies` scope meta-assertion.
- `supabase test db` wired into both `validate-all.sh` and CI.
- Parameterized Deno anon-denial coverage over every brain-data table and every RPC.

**Non-Goals:**
- Any policy/grant change (Step 9 done); script port-offset/reset (Step 14); the stale CI comment (Step 14).

## Decisions

**D1 — Assert the SQLSTATE, not the message.** Denial assertions check `42501` (`insufficient_privilege`), not error text, so a Postgres version bump that rewords the message doesn't flake the suite. pgTAP `throws_ok(sql, '42501', NULL, desc)`; Deno checks HTTP 401/403 + body `code === "42501"` (the pattern already used for `people`).

**D2 — pgTAP role switching via `SET LOCAL ROLE` inside the test transaction, `RESET ROLE` between blocks.** `throws_ok` executes its SQL string in the current role; the whole file runs in one `BEGIN … ROLLBACK`, so no state escapes. `INSERT … DEFAULT VALUES` is sufficient because the privilege check precedes constraint evaluation (verified), keeping the assertions uniform across tables regardless of NOT NULL columns.

**D3 — Generic policy-scope meta-assertion.** `SELECT is((SELECT count(*)::int FROM pg_policies WHERE schemaname='public' AND roles <> '{service_role}'), 0, …)` fails the instant any future policy ships without a `to service_role` scope — the generic guard SQL-1 fix step 3 deferred here. This is the pgTAP home for the assertion that could not be expressed through PostgREST in Step 9.

**D4 — Deno layer keeps behavioral, transport-level denial; pgTAP keeps privilege-level denial.** The two layers are complementary: pgTAP proves the grant/policy posture at the DB; the Deno REST tests prove the anon **key** (publishable JWT) is rejected end-to-end through PostgREST. TEST-8 is satisfied by extracting `assertAnonDenied(table, seedRow)` and looping it, plus one RPC probe each, so a new table/RPC that ships without denial coverage is visible.

**D5 — Enumerate RPCs explicitly, not dynamically, in the committed tests.** The plan suggests enumerating via `pg_proc`; a hard-coded list is clearer and, combined with the pgTAP meta-assertion + the fact that a new RPC without a revoke would be caught by the blanket `revoke execute … from public, anon, authenticated` in `20260704000001`, gives defense without brittle reflection. A comment lists the enumeration query for maintainers adding an RPC.

### User error scenarios
- **A maintainer adds a table but forgets its denial test:** the pgTAP meta-assertion still guards the policy scope; the table list in both suites is commented as "keep in sync with `pg_tables`," and CI running `supabase test db` makes an omission visible on the next posture change.
- **A maintainer adds a permissive policy for debugging:** the meta-assertion goes red immediately.
- **CI environment lacks pg_prove:** verified locally that the current CLI image runs pgTAP (`Files=6, Tests=51 … PASS`); the CI step uses the same `supabase test db`, and `setup-cli` provides the pg_prove-capable CLI.

### Security analysis
- **Threat: silent anon re-grant (the historical `people` hole).** Covered per-table (SELECT+INSERT) and per-RPC at the privilege level, plus the generic policy-scope guard — the exact regression class now fails the pipeline.
- **Threat: coverage rot** (new table/RPC ships untested). Mitigated by the meta-assertion + blanket-revoke default privileges + in-sync comments; residual risk logged, not hidden.
- No new attack surface: tests only assert denial; no grants change.

### Test Strategy
- **pgTAP (`supabase test db`):** the new denial suite is itself the test; it runs in CI and validate. GATE 2b: reverting Step 9's `to service_role` on any table reddens the meta-assertion; granting anon SELECT on a table reddens that table's denial test.
- **Deno integration (real REST, anon key, zero mocks):** parameterized denial over all tables + RPC probes.
- Both run against a freshly reset stack. Zero skips.

## Risks / Trade-offs

- **[Hard-coded table/RPC lists drift from schema]** → Meta-assertion + blanket revoke provide a generic backstop; lists carry a "keep in sync" comment and the enumeration query. Chosen over reflection for readability.
- **[`supabase test db` adds ~1s + a step to CI/validate]** → Negligible; the DB regression net is worth it.
- **[pgTAP role switch leaking state]** → Contained by single-transaction `BEGIN…ROLLBACK` + `RESET ROLE`; the existing suite already relies on this rollback discipline.
