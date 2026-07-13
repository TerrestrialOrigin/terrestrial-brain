## Why

Step 10 (`provisioning-automation`) can now build one customer brain end-to-end, but nothing operates the fleet **after** provisioning. Two recurring operational needs are unmet: (1) when the public repo ships a new migration, every already-provisioned customer project must be brought up to date — today that means re-running `db push` by hand against each project with no way to see which projects are behind; (2) there is no cross-fleet view of health or errors, so a customer whose project is unhealthy or whose edge function is throwing errors is invisible until they complain. Step 11 adds fleet-wide operations tooling — apply-migrations-to-all-projects with drift detection, and centralized health/error monitoring — so the growing fleet can be kept current and watched from one place.

## What Changes

- **New hosted-side capability, in the SAME SEPARATE PRIVATE repo as Step 10** (`terrestrial-brain-hosting`). Fleet operations are hosted-business logic (they fan out across every customer project using the privileged Management token) and must never ship in the FSL-1.1-MIT public tree. This public repo keeps only the OpenSpec artifacts, one `ThreatModel.md` entry (T26), and the plan checkbox — no fleet code.
- **Fleet enumeration from the provisioning job store** — the authoritative fleet is the set of `done` provisioning jobs (the projects TB actually created), not "every project in the org" (which could sweep in unrelated projects). Extends the existing `ProvisioningJobStore` seam with a bounded `listAll()`.
- **Apply-migrations-to-all-projects with drift detection** — for each fleet project, compute migration **drift** (local migration versions from the pinned public-repo source vs the versions applied on that project), then apply the missing migrations. Idempotent: a project with no drift is a no-op. A `--dry-run` mode reports drift across the fleet without applying anything. The sweep is per-project independent and returns a **counted outcome** (in-sync / migrated / failed per project) — it never reports success merely because the loop finished, and a failure on one project does not abort the others.
- **Centralized health/error monitoring** — for each fleet project, aggregate Supabase platform health (reusing the Management API health call) plus **bounded** recent error statistics read from that project's `function_call_logs`, into one fleet health report. A project that cannot be reached is a distinct `unreachable` state, never conflated with "healthy with zero errors."
- **New narrow seams, reusing Step 10's composition root:** a `FleetInspector` port for bounded, read-only, hosting-authored per-project queries (applied-migration versions; recent error stats), and a `MigrationSource` port for the local migration version list — each with a deterministic fake so the whole fleet flow runs in tests with no network, no live Supabase org, and no paid API.
- **CLI additions:** `fleet:migrate` (with `--dry-run`, optional `--customer` scope) and `fleet:monitor` (fleet health/error report).
- **A ThreatModel entry (T26)** for the fleet-operations surface (fan-out with the privileged token, read-only cross-project queries, partial-failure honesty, bounded reads).

## Capabilities

### New Capabilities
- `fleet-operations`: fleet-wide operation of already-provisioned customer projects — the drift-detection contract (local vs applied migration versions), the apply-migrations-to-all-projects sweep with its idempotency / partial-failure / counted-outcome guarantees, the centralized health + bounded-error monitoring report with its explicit `unreachable` vs `healthy` distinction, the fleet enumeration source (job store `listAll`), and the seams every external dependency sits behind. Owned by the sibling `terrestrial-brain-hosting` repo; specced here.

### Modified Capabilities
<!-- None. Step 11 adds a new hosted-side capability in the separate private repo; it changes no existing terrestrial-brain (public repo) behavior or spec. The `provisioning-automation` capability is reused (its `ProvisioningJobStore` seam gains a `listAll` method) but that seam lives in the hosting repo, not in this public repo's specs. -->

## Impact

- **Repo touched (code):** `~/Documents/Dev/terrestrial-brain-hosting` (the private hosting repo, on branch `feature/FleetOperations`) — new `src/fleet/` logic, new `FleetInspector` + `MigrationSource` ports and adapters, `ProvisioningJobStore.listAll` extension (+ fakes), new `fleet:migrate` / `fleet:monitor` CLI commands and `deno.json` tasks, new unit + integration tests, README fleet section.
- **Public repo touched (this repo):** `openspec/changes/fleet-operations/**` (artifacts), `ThreatModel.md` (new T26 entry), `codeEval/Fable20260710-NewFeaturePlan.md` (Step 11 checkbox). **No** `supabase/`, `obsidian-plugin/`, or `tests/` runtime changes — the public repo's behavior is unchanged.
- **External APIs consumed:** Supabase Management API — reuses project health (Step 10) and adds the read-only database-query endpoint for applied-migration versions and `function_call_logs` error stats; Supabase CLI (`db push`) for applying drift, reusing Step 10's `DeployRunner`.
- **Secrets handled:** the same privileged Supabase Management API token (env-only, `Authorization: Bearer`, never in a URL, never logged) and the per-customer db password persisted by Step 10 (needed only to apply migrations). Fleet ops mints no new secret.
- **Reuses, does not fork:** the drift check reads the *published* public-repo migration set (via the pinned `TB_MIGRATIONS_SOURCE` path) as an input; it never copies or vendors those files, and copies nothing from OB1.
