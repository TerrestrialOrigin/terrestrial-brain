## 1. New seams (ports) and fleet enumeration

- [x] 1.1 Extend `ProvisioningJobStore` (hosting repo `src/ports/job-store.ts`) with `listAll(): Promise<ProvisioningJob[]>`; implement it in the file-store adapter (read the `*.jobstore.json` directory) and in the in-memory fake (return map values). Unit test: `listAll` returns all jobs regardless of status.
- [x] 1.2 Add `src/ports/fleet-inspector.ts` — `FleetInspector` port with `getAppliedMigrationVersions(projectRef)` and `getErrorStats(projectRef, sinceMs): Promise<ProjectErrorStats>` (purpose-specific, no generic SQL). Add a deterministic fake under `test/fakes/`.
- [x] 1.3 Add `src/ports/migration-source.ts` — `MigrationSource` port with `localVersions(): Promise<string[]>`. Add a deterministic fake under `test/fakes/`.
- [x] 1.4 Add `src/fleet/fleet.ts` — `listFleet(store)` returning only `done` jobs; unit test: filters out `failed`/`running`, empty fleet is a clean empty result.

## 2. Drift detection

- [x] 2.1 Add `src/fleet/drift.ts` — pure `computeDrift(localVersions, appliedVersions): string[]` (set difference, sorted). Unit tests: no drift, some drift, all drift, applied-ahead-of-local edge.
- [x] 2.2 Wire per-project detection: `detectProjectDrift(job, deps)` using `MigrationSource.localVersions` + `FleetInspector.getAppliedMigrationVersions`; fail fast if the local source is missing/empty (must not read as `in_sync`).

## 3. Apply-migrations-to-all-projects sweep

- [x] 3.1 Add `src/fleet/migrate-fleet.ts` — for each fleet project: detect drift; if drift and not dry-run, apply via the reused `DeployRunner.pushMigrations(ref, dbPassword)`; produce a `ProjectMigrationOutcome` (`in_sync|migrated|failed`, `driftBefore`, `appliedNow`, `error`). Idempotent (no drift → no push); per-project independent (one failure does not abort the sweep).
- [x] 3.2 Aggregate into a `FleetMigrationReport` with a summary counting each status; overall failure iff any project is `failed`; count successes from projects that actually ended in sync (never loop-end). Support a `--dry-run` flag (no pushes) and an optional `--customer <id>` scope (not-found → reported, non-success).

## 4. Health / error monitoring

- [x] 4.1 Add `src/fleet/monitor.ts` — for each fleet project collect `SupabaseManagementApi.getProjectHealth` + `FleetInspector.getErrorStats(ref, sinceMs)` (window + limit via named constants, computed from the `Clock`); classify per-project status `healthy|degraded|unhealthy|unreachable` (a thrown probe/query → `unreachable` with detail, never `healthy`-0). Bounded, content-free reads.
- [x] 4.2 Aggregate into a `FleetHealthReport` with a summary bucketing each status. Unit test the classifier; error-threshold and window are single named constants.

## 5. Adapters, composition root & CLI

- [x] 5.1 Add `src/adapters/fleet-inspector-http.ts` — real `FleetInspector` over the Management API database-query endpoint (Bearer token, project ref path-encoded, fixed hosting-authored bounded SQL, rows parsed at the boundary with Zod). Only run on the opt-in live path.
- [x] 5.2 Add `src/adapters/migration-source-fs.ts` — real `MigrationSource` reading `${TB_MIGRATIONS_SOURCE}/supabase/migrations/` filenames → version tokens.
- [x] 5.3 Wire both new adapters into `src/composition-root.ts` from the existing `HostingConfig` (no new required env). Add `fleet:migrate` and `fleet:monitor` subcommands to `src/cli.ts` (`--dry-run`, `--customer`, `--json`) with a non-zero exit on any project failure.
- [x] 5.4 Add `deno.json` tasks: `fleet:migrate`, `fleet:monitor`, and an opt-in fail-loud `fleet:live` smoke.

## 6. Tests (unit + integration)

- [x] 6.1 Unit tests: drift computation, migration-source version extraction, fleet-inspector row parsing (well-formed + malformed→boundary error), health-bucket classifier, outcome/summary counting.
- [x] 6.2 Integration (real fleet logic + real job store, fakes only at the external boundary): migrate happy path (mixed fleet, only drifted pushed), `--dry-run` (zero pushes), idempotency (second run no pushes), partial failure (one push throws → that project `failed`, other `migrated`, overall failure), empty fleet (no external calls), monitor (healthy / unreachable≠healthy / degraded), no-secret-in-logs.
- [x] 6.3 GATE-2b mutation check: removing the `done` filter reddens a fleet-scope test; removing the drift set-difference (always-apply) reddens the idempotency/in_sync test; collapsing `unreachable` into `healthy` reddens the monitor test; replacing the counted outcome with a loop-end success reddens the partial-failure test.
- [x] 6.4 Opt-in fail-loud live smoke (`fleet:live`) that runs a real read against a throwaway org when creds are present and fails loudly (never silently skips) when absent.

## 7. Docs & threat model

- [x] 7.1 Add ThreatModel **T26** (fleet-operations surface) to the PUBLIC repo's `ThreatModel.md` per design.md security analysis.
- [x] 7.2 Hosting repo `README.md`: fleet-operations section (drift/migrate + monitor usage, `--dry-run`, the no-per-project-lease trade-off, cross-reference T26).

## 8. Verification & finalization

- [x] 8.1 Hosting repo suite green: `deno task test` (0 fail, 0 skip), `deno lint`, `deno fmt --check`.
- [x] 8.2 Public repo suite still green (no runtime code changed): `deno task test` + `cd obsidian-plugin && npm test && npm run build`.
- [x] 8.3 `openspec validate fleet-operations --strict` clean; commit in the hosting repo; check off Step 11 in `codeEval/Fable20260710-NewFeaturePlan.md`.
