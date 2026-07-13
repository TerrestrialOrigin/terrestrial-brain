## Context

Step 10 (`provisioning-automation`, shipped in the private `terrestrial-brain-hosting` repo) provisions ONE customer brain end-to-end and records each run as a `ProvisioningJob` in a job store keyed by customer id. Step 11 operates the resulting **fleet** — every already-provisioned project — for two recurring needs:

1. **Keep every project on the latest schema.** When the public repo ships a new migration, all `done` projects must receive it. Doing this by hand does not scale and gives no visibility into which projects are behind.
2. **Watch the fleet.** There is no cross-project view of health or edge-function errors; an unhealthy or erroring customer project is invisible until the customer reports it.

**Where the code lives — recorded decision (project owner, 2026-07-12, unchanged from Step 10):** the implementation goes in the SAME separate PRIVATE repo, `terrestrial-brain-hosting` (`~/Documents/Dev/terrestrial-brain-hosting`, local git for now, private GitHub remote later). This public repo (`terrestrial-brain`, FSL-1.1-MIT) keeps ONLY the OpenSpec artifacts, one `ThreatModel.md` entry (T26), and the plan checkbox. Rationale: fleet operations fan out across every customer project with the privileged Management token — hosted-business logic that must never ship under FSL in a public tree. Stack is Deno + TypeScript, reusing Step 10's seam/fake discipline and composition root.

**Inputs consumed from the public repo, never forked:** the migration set in `supabase/migrations/` (the pinned `TB_MIGRATIONS_SOURCE` from Step 10 config) — read to compute drift, never vendored or copied. Copies nothing from OB1.

**Constraints:** runs-twice / crashes-halfway / interleaves invariant applies in full (CLAUDE.md); every external dependency behind a seam so the whole fleet flow runs in tests with no network, no live Supabase org, no paid API; secrets in headers not URLs, never logged; bounded queries; never swallow an error into an empty/healthy result; a partially-failing sweep returns a counted outcome, never "✅ all done" because a loop finished.

## Goals / Non-Goals

**Goals:**
- Enumerate the fleet from the authoritative source (the job store's `done` jobs), bounded.
- Detect per-project migration **drift** (local versions vs applied versions) and apply the missing migrations idempotently; a `--dry-run` reports drift fleet-wide without applying.
- Produce one fleet **health/error report**: per project, platform health + bounded recent error stats, aggregated with an explicit `unreachable` state distinct from `healthy`.
- Every new external dependency injected behind a 3–5 method interface with a deterministic fake; the whole fleet flow is covered by integration tests touching zero live external systems.
- Reuse Step 10's seams and composition root; add only narrow new seams.

**Non-Goals:**
- **Not deprovisioning / data export** (Step 12) — this change never deletes a project or dumps data.
- **Not a control plane / durable registry** (Step 13) — the fleet source is Step 10's interim job store via a new `listAll`; Step 13 later swaps the store implementation with no change to fleet logic.
- **Not alerting / status page** (Step 20) — Step 11 produces the report; routing it to alerts/paging is later. `fleet:monitor` prints/returns the report; it does not page anyone.
- **Not usage metering / quotas** (Step 15) — error stats are for operational health, not billing.
- **Not schema-diff drift** (column/policy divergence) — "drift" here means *migration-version* drift (which migrations have been applied), the actionable unit for `db push`. Deeper structural drift detection is out of scope.
- **No change to the public repo's runtime** (no migration, no edge-function behavior, no plugin).

## Decisions

### D1: The fleet is the set of `done` provisioning jobs — enumerated via `ProvisioningJobStore.listAll()`
Extend the existing `ProvisioningJobStore` seam with `listAll(): Promise<ProvisioningJob[]>`; fleet ops filter to `status === "done"` (a project only counts once its provision completed). The file-store adapter implements `listAll` by reading its directory of `*.jobstore.json` files; the in-memory fake returns its map values.
- **Why:** the job store already records exactly the projects TB created, with their `projectRef` and persisted `dbPassword`. It is the authoritative, self-owned fleet list. Using the Management API's "list all projects in the org" would sweep in non-TB or non-customer projects and risk applying migrations to something we do not own.
- **Alternative considered:** enumerate via `SupabaseManagementApi.listProjects()`. Rejected as the fleet source — it is not authoritative for "TB customer projects" and widens blast radius. (A future reconciliation check that *compares* the two is a separate, out-of-scope concern.)

### D2: "Drift" = migration-version set difference; detection is read-only and needs no db password
For each fleet project, drift = local migration versions (from `MigrationSource`) **minus** the versions already applied on that project (from `FleetInspector.getAppliedMigrationVersions`). Detection uses the Management API's read-only database-query endpoint (privileged token, no per-project db password). A project with an empty difference is **in sync**.
- **Why:** migration version is the unit `db push` acts on and the honest signal of "is this project current?". Reading applied versions via the Management token keeps *detection* credential-light (no db password, no CLI link) so `--dry-run` is cheap and safe fleet-wide.
- **Alternative considered:** `supabase migration list --linked` via the CLI. Rejected for detection — it requires linking + the db password per project just to read; the SQL read is lighter and reuses the token we already hold. The CLI is still used to *apply* (D3).

### D3: Applying drift reuses Step 10's `DeployRunner.pushMigrations` — idempotent, per-project independent
When drift is non-empty (and not `--dry-run`), apply via the existing `DeployRunner.pushMigrations(projectRef, dbPassword)` (the job carries the persisted db password). `db push` applies only unapplied migrations, so it is idempotent: re-running the sweep after a partial run brings the remaining projects up without re-touching synced ones. Each project is applied independently.
- **Why:** reuse the audited Step 10 seam; idempotency of `db push` gives runs-twice/crash-resume safety for free (a re-run just finds less drift). No new destructive operation is introduced.
- **Interleave note:** two concurrent fleet-migrate runs could both `db push` the same project. `db push` is idempotent and additive (never delete-then-write), so concurrent sweeps converge to the same applied set; at worst one run's push is a redundant no-op. A per-project lease is deliberately **not** added — it would duplicate Step 13's job-level claim and add coordination for an already-idempotent, non-destructive op. Documented in the ThreatModel/README as an accepted trade-off.

### D4: The migrate sweep returns a per-project counted outcome; a single failure never aborts the fleet or fakes success
The sweep produces a `FleetMigrationReport` with one `ProjectMigrationOutcome` per project: `{ customerId, projectRef, status: "in_sync" | "migrated" | "failed", driftBefore: string[], appliedNow: string[], error: string | null }`, plus a summary counting each status. A project whose detection or push throws is recorded `failed` with its error; the loop **continues** to the next project. The command's exit status is non-zero if any project is `failed`. Success is counted from projects that actually ended in sync — never asserted because the loop reached its end.
- **Why:** CLAUDE.md — "a function that can partially fail must RETURN its outcome and count successes from what ACTUALLY succeeded; never print '✅ complete' just because a loop reached its end." One bad project must not hide behind a green sweep, nor stop the healthy ones from updating.

### D5: The health report distinguishes `unreachable` from `healthy` — an error is never swallowed into a zero/empty
For each project the monitor collects platform health (`SupabaseManagementApi.getProjectHealth`) and bounded error stats (`FleetInspector.getErrorStats`). Per-project status is one of `healthy` (reachable, platform healthy), `degraded` (reachable, platform healthy, but recent error rate over a threshold), `unhealthy` (platform reports unhealthy), or `unreachable` (a probe/query threw). `unreachable` carries the error detail. The aggregate summary counts each bucket; a project that failed to answer is **never** reported as "healthy, 0 errors."
- **Why:** CLAUDE.md — "distinguish empty from broken; never swallow an error into a success or empty state." A monitoring tool that turns a failed probe into a clean bill of health is worse than no monitor.

### D6: Bounded, hosting-authored, read-only queries behind a purpose-specific `FleetInspector` port — no generic SQL through the seam
New port `FleetInspector` with exactly two purpose-specific methods: `getAppliedMigrationVersions(projectRef)` and `getErrorStats(projectRef, sinceMs)`. The concrete adapter issues fixed, hosting-authored SQL via the Management API database-query endpoint; the only inputs are `projectRef` (a validated ref, path-encoded) and a numeric `sinceMs` the adapter formats into an ISO literal. The error-stats query is bounded (a time window + explicit `LIMIT`/aggregate, ids/counts only — never note or thought content).
- **Why:** exposing a generic `runSql(sql)` through the port would create an injection surface and let call sites write unbounded queries. Purpose-specific methods keep the SQL server-side in the adapter, the port narrow (2 methods), and every read bounded and content-free. Parse-at-boundary: rows are validated into typed results (Zod), never cast.
- **Alternative considered:** add the two reads to Step 10's `SupabaseManagementApi` port. Rejected — that port is about *project lifecycle* (create/health/secrets/delete) and is already at 4 methods; fleet reads are a separate concern and adding them there would push it past the 3–5 method guideline and couple two capabilities. A focused new port is cleaner and leaves Step 10 untouched.

### D7: Local migration versions behind a `MigrationSource` seam
New port `MigrationSource` with `localVersions(): Promise<string[]>`. The adapter reads migration filenames from `${TB_MIGRATIONS_SOURCE}/supabase/migrations/` and extracts the leading version token; the fake returns a scripted list. Versions are compared as opaque sorted strings (Supabase migration versions are lexicographically ordered timestamps).
- **Why:** the local file read is an external dependency (filesystem) — seaming it keeps drift-detection tests deterministic (no disk, no dependence on the checked-out public repo) and matches Step 10's "seam every external dependency" rule.

### D8: Reuse Step 10's composition root and config; add fleet wiring there only
`composition-root.ts` gains the two new adapters (`FleetInspector`, `MigrationSource`) wired from the same validated `HostingConfig` (they need only the existing `TB_MGMT_API_TOKEN`, `TB_MGMT_API_BASE`, and `TB_MIGRATIONS_SOURCE` — no new required env). `cli.ts` gains `fleet:migrate` and `fleet:monitor` subcommands. No new secrets, no second composition root.
- **Why:** one composition root (CLAUDE.md); fleet ops reuse the exact credentials and store Step 10 already validates, so there is nothing new to configure.

### D9: Where the ThreatModel entry lives
The fleet threat entry (**T26**) is added to the **public repo's** `ThreatModel.md`, next to Step 10's T25 — it documents security posture, not business logic, and keeps the single project-wide threat register intact. The hosting README cross-references it.

## User-error & edge scenarios (and how the system handles each)

| Scenario | Handling |
|---|---|
| Fleet is empty (no `done` jobs yet) | `listAll` returns none; both commands report an empty fleet as a **success with zero projects** (distinct from an error), never a crash. |
| `TB_MIGRATIONS_SOURCE` path missing / has no migrations dir | `MigrationSource.localVersions` fails fast at the boundary with a clear error naming the path; the migrate sweep aborts before touching any project (a bad local source must not be read as "no drift anywhere"). |
| One project unreachable during monitor | Recorded `unreachable` with the error detail (D5); the report still covers every other project; summary counts it separately. |
| One project's `db push` fails mid-sweep | Recorded `failed` with the error (D4); the sweep continues; exit status non-zero; other projects still updated. |
| A project already fully migrated | Drift is empty → `in_sync`, no `db push` issued (idempotent no-op). |
| `--dry-run` requested | Drift is detected and reported per project; **no** `db push` is issued for any project. |
| `--customer <id>` scope on a customer not in the fleet | Reported as "not found in fleet" (not a silent empty success); exit non-zero. |
| Two concurrent fleet-migrate runs | Per-project `db push` is idempotent/additive (D3); both converge; no destructive op. Documented trade-off. |
| Malformed/oversized error-stats result | Rows validated at the boundary (Zod, D6); an unparseable result surfaces as `unreachable` for that project, never a silent zero. |

## Security analysis (feeds ThreatModel T26)

- **Fan-out with the privileged Management token → the blast radius is now the whole fleet.** Mitigations: same env-only, `Authorization: Bearer`, never-in-URL, never-logged handling as Step 10; the token is read once at the composition root; least-privilege + rotation documented. Fleet reads are read-only; the only mutation is `db push` (additive migrations), never a delete.
- **Read-only cross-project queries could be an injection or content-leak surface.** Mitigations: `FleetInspector` exposes no generic SQL (D6); SQL is fixed and hosting-authored; the only inputs are a validated project ref (path-encoded) and a numeric timestamp; queries are bounded (time window + `LIMIT`/aggregate) and return ids/counts only — never thought/note content, so no customer content is pulled into the hosting host or logs.
- **Dishonest monitoring (swallowing a failed probe into "healthy").** Mitigation: the explicit `unreachable` bucket (D5); a probe/query error is preserved, never coerced to a clean result.
- **Dishonest sweep (a green run hiding a failed project).** Mitigation: the counted per-project outcome + non-zero exit on any failure (D4); success is counted from projects that actually ended in sync.
- **Applying a stale/wrong migration set.** Mitigation: drift is computed against the pinned `TB_MIGRATIONS_SOURCE`; the same source feeds `db push`, so detection and application agree; `--dry-run` lets an operator review drift before applying.
- **Interim job store still holds per-project db passwords in plaintext (0600).** Mitigation: unchanged from Step 10 (accepted interim, replaced by Step 13's control plane); fleet ops read those passwords only to apply migrations and never log them (redacting logger reused).

## Test Strategy

Layers (per CLAUDE.md gates), all in the hosting repo's own suite (`deno task test`):
- **Unit:** drift computation (pure set difference: no drift, some drift, all drift, applied-ahead-of-local edge); `MigrationSource` version extraction; `FleetInspector` row parsing (well-formed, malformed → boundary error); health-bucket classification (healthy / degraded / unhealthy / unreachable); the per-project outcome/summary counting.
- **Integration (real fleet logic + real job store, fakes ONLY at the genuine external boundary — Management API/inspector, deploy runner, migration source, clock, logger):** the fleet enumeration ↔ drift ↔ sweep ↔ report path under test is REAL and unmocked (mock-boundary rule). Cases:
  - **migrate happy path:** mixed fleet (one in-sync, one drifted) → the drifted project gets exactly one `pushMigrations`, the in-sync one gets none, summary counts `in_sync:1, migrated:1`.
  - **`--dry-run`:** drift reported, **zero** `pushMigrations` calls.
  - **idempotency:** run the sweep twice → the second run finds no drift and issues no `pushMigrations` (proves re-run safety).
  - **partial failure:** one project's push throws → that project is `failed`, the other still `migrated`, the sweep completes, exit status reflects failure (never "all done").
  - **empty fleet:** zero `done` jobs → success-with-zero, no external calls.
  - **monitor:** mixed fleet → healthy project reported healthy, an unreachable project (inspector throws) reported `unreachable` with detail (NOT healthy-0-errors), a project over the error threshold reported `degraded`; summary buckets correct.
  - **no-secret-in-logs:** a full fleet run emits no Management token / db password value.
- **GATE-2b mutation check:** deleting the `status === "done"` filter reddens a fleet-scope test; deleting the drift set-difference (always-apply) reddens the idempotency/`in_sync` test; collapsing `unreachable` into `healthy` reddens the monitor test; replacing the counted outcome with a loop-end "success" reddens the partial-failure test.
- **Live smoke (opt-in, fail-loud, NOT in the default suite):** a `fleet:monitor`-style read against a throwaway org when `TB_MGMT_API_TOKEN` + a real project are present; absent creds → fails loudly, never a silent skip. The deterministic full-flow integration test is the always-run end-to-end coverage.

The public repo's suite (`deno task test`, plugin) is unaffected and must stay green — this change adds no runtime code there.

## Risks / Trade-offs

- **[Fleet source is the interim file job store]** → acceptable; `listAll` is a thin directory read and the seam lets Step 13 swap the store with no fleet-logic change. Bounded by the number of provisioned customers.
- **[No per-project lease on concurrent sweeps]** → mitigated by `db push` idempotency/additivity (D3); documented. Revisit if a non-idempotent fleet mutation is ever added.
- **[Management database-query endpoint shape may drift]** → isolated to the one `FleetInspector` adapter; rows are parsed at the boundary so a shape change fails loudly rather than silently mis-reporting.
- **[No default live E2E]** → mitigated by exhaustive fake-backed integration coverage + the opt-in fail-loud live smoke (same posture as Step 10).
- **[Migration-version drift ≠ full structural drift]** → explicitly scoped out (D-Non-Goals); version drift is the actionable unit for `db push` and the honest "is this project current" signal.

## Migration Plan

- **Deploy:** none to shared infra. "Use" = pull the private `terrestrial-brain-hosting` repo, set the same env as Step 10 (`TB_MGMT_API_TOKEN`, `TB_MGMT_API_BASE?`, `TB_MIGRATIONS_SOURCE`, `TB_JOBSTORE_DIR`), then `deno task fleet:migrate [--dry-run]` / `deno task fleet:monitor`.
- **Rollback:** fleet ops apply only additive migrations (never delete/downgrade); there is no destructive state to roll back. A bad migration is a public-repo concern (fix forward with a new migration), not a fleet-ops rollback.
- **Public repo:** merges only the OpenSpec artifacts, the ThreatModel T26 entry, and the plan checkbox — reversible by revert with zero runtime impact.

## Open Questions

- Exact recent-error-rate threshold that flips a project to `degraded` (seed with a conservative default, tune once real telemetry volume is known) — resolve during apply; the classifier makes it a single named constant.
- The error-stats time window default (e.g. last 24h) — a named constant, tunable; must stay bounded.
- Long-term fleet source once Step 13 lands (control-plane registry vs. job store) — the `listAll` seam keeps this swappable; confirmed acceptable to use the interim store for standalone Step 11.
