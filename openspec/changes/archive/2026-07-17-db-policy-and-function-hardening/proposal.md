## Why

Three residual database hardening defects survive from earlier migrations, each one grant-drift or one bad input away from a real failure. The `function_call_logs` RLS policy was created without a `to service_role` clause — the exact structural shape of the historical `people` policy that leaked personal data — and this table holds personal data (serialized tool inputs with note content, plus `ip_address`). Three `SECURITY DEFINER`/trigger functions pin `search_path` without `pg_temp`, diverging from the project's own hardened convention. And `increment_usefulness_weighted` applies an unvalidated `weight` directly to a persistent ranking column, so a single edge-function bug or LLM-derived value could corrupt or integer-overflow every targeted thought's score in one call.

## What Changes

- Add ONE new append-only migration (`20260717000002_db_policy_and_function_hardening.sql`) that:
  - Drops the `function_call_logs` "Service role full access" policy and recreates it in the canonical shape: `for all to service_role using (true) with check (true)` (no reliance on the deprecated per-row `auth.role()` predicate).
  - Recreates `increment_usefulness(uuid[])`, `increment_usefulness_weighted(uuid[], int)`, and the `update_updated_at()` trigger function with `set search_path = public, pg_temp`; restates the explicit `revoke`/`grant execute` lines for the two RPCs.
  - Adds a bounds guard to `increment_usefulness_weighted`: reject `weight < 1 or weight > 100` with a raised exception before mutating.
- Add Deno integration coverage asserting the weighted RPC rejects out-of-range weights (0, 101, negative) and still applies valid weights.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `database-access-control`: the `function_call_logs` RLS policy MUST scope to `service_role` via a `to` clause (not a row predicate on all roles); all `SECURITY DEFINER` and trigger functions MUST pin `search_path = public, pg_temp`.
- `memory-hygiene`: the weighted usefulness-reinforcement RPC MUST validate `weight` is within `[1, 100]` and reject out-of-range values before any mutation.

## Non-goals

- Wiring the pgTAP suite into CI (Step 10 owns that; a `pg_policies` meta-assertion for the missing-`to` class is deferred there).
- Editing any existing migration file — migrations are append-only (`docs/upgrade.md`).
- Any change to `increment_usefulness`'s or `update_updated_at`'s behavior beyond the `search_path` pin.
- A retention/erasure sweep for archived personal-data rows (SQL-9, deferred pending a user decision).

## Impact

- `supabase/migrations/` — one new migration file (append-only).
- Runtime callers unaffected by signature: all three functions keep their existing signatures; `increment_usefulness_weighted` gains an input-validation error path that the edge caller already passes valid weights into.
- `tests/integration/` — new assertions for the weighted-RPC bounds and the recreated policy.
- No `supabase/schemas/` mirror files exist for these three functions, so no mirror update.
- Affected spec files: `openspec/specs/database-access-control/spec.md`, `openspec/specs/memory-hygiene/spec.md`.
