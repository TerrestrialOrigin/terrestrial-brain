# Tasks — Step 13 Control plane (`control-plane`)

> All code lands in the PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting` (branch `feature/ControlPlane`). This public repo gets only: this artifact set, `ThreatModel.md` T28, and the Step-13 checkbox. Follow the Steps 10–12 seam/fake, parse-at-boundary, runs-twice/crashes-halfway/interleaves discipline.

## 1. Config & schema (parse-at-boundary + the control-plane project)

- [x] 1.1 Extend `src/config.ts` (hosting): add `TB_STORE_BACKEND` (enum `file | control-plane`, default `file`), `TB_CONTROL_PLANE_URL`, `TB_CONTROL_PLANE_SERVICE_KEY`, `TB_EXPORT_RETENTION_DAYS` (int, default 30) to the zod schema; when backend is `control-plane`, require the URL + service key (fail fast naming the missing var); add the service-role key to `secretValues`.
- [x] 1.2 Add `control-plane/schema.sql`: idempotent `create table if not exists` for `customers`, `customer_projects`, `project_secrets`, `deprovision_jobs`, `export_artifacts` per design D6; enable RLS deny-by-default on every table (no anon/authenticated grants); comment each table as service-role-only.
- [x] 1.3 Update `.env.example` + README env table with the four new vars and a "control plane is created once out-of-band" bootstrap note.

## 2. The `ControlPlaneClient` seam + fakes

- [x] 2.1 Add `src/ports/control-plane-client.ts`: the narrow port — intent-named methods only (no generic `query(sql)`): `claimProvisioningJob`, `saveProvisioningJob`, `loadProvisioningJob`, `listProvisioningJobs`, `releaseProvisioningJob`, `claimDeprovisionJob`, `saveDeprovisionJob`, `loadDeprovisionJob`, `putSecret`, `getSecret`, `upsertCustomer`, `getCustomer`, `listCustomers`, `setSubscriptionStatus`, `recordExportArtifact`, `listExportArtifacts`, `listExpiredExportArtifacts`, `deleteExportArtifact`, `applySchema`.
- [x] 2.2 Add `src/adapters/control-plane-client-supabase.ts`: implement the port over `@supabase/supabase-js` with the service-role key; the claim methods issue a single conditional write (`update ... where <claimable> returning`, or an RPC/upsert-on-conflict) so the DB decides the race winner (design D2).
- [x] 2.3 Add the deterministic `InMemoryControlPlaneClient` fake in `test/fakes/`: model rows + a guarded conditional-mutate that returns the row only when the guard matches (faithful to D2), plus an injectable clock for lease expiry.

## 3. Parse-at-boundary row schemas

- [x] 3.1 Add zod schemas that validate each control-plane row (`customer_projects`, `deprovision_jobs`, `customers`, `export_artifacts`) into the known-good `ProvisioningJob` / `DeprovisionJob` / domain types on read; a malformed/legacy row is a loud parse error, never an `as` cast (design D9).

## 4. Database-backed job stores (implement the EXISTING ports)

- [x] 4.1 Add `src/adapters/job-store-control-plane.ts` (`ControlPlaneProvisioningJobStore implements ProvisioningJobStore`): claim/save/load/listAll/release via the client; on `save` split `accessKey`/`dbPassword` out to `project_secrets` (via `SecretStore`) and store the rest in `customer_projects`; on `load` rejoin the secrets so the in-memory `ProvisioningJob` shape is byte-for-byte unchanged (design D6 mapping note).
- [x] 4.2 Add `src/adapters/deprovision-job-store-control-plane.ts` (`ControlPlaneDeprovisionJobStore implements DeprovisionJobStore`): same claim/save/load contract backed by `deprovision_jobs`.
- [x] 4.3 Confirm (by types + a no-op diff) that NO provisioning/fleet/deprovision step or pipeline module changed — only the store implementation behind the seam.

## 5. Secret store seam

- [x] 5.1 Add `src/ports/secret-store.ts` (`putSecret(customerId, {accessKey, dbPassword})` / `getSecret(customerId)`) and `src/adapters/secret-store-control-plane.ts` backed by `project_secrets` via the client; document the platform-vs-app-level-encryption trade-off (design D5); add an in-memory fake for tests.

## 6. Export retention + purge

- [x] 6.1 Add `recordExportArtifact` wiring so Step 12's exporter records each delivered dump content-free with `retention_until = delivered_at + TB_EXPORT_RETENTION_DAYS` (via the service layer).
- [x] 6.2 Add `src/control-plane/purge-exports.ts`: list expired artifacts (bounded DB query), delete each file + row, return a counted outcome (`purged`/`failed`/`skipped-missing`), idempotent, overall-fail if any delete failed (design D7).

## 7. Transport-neutral service layer

- [x] 7.1 Add `src/control-plane/service.ts` (`ControlPlaneService`): `listCustomers`, `getCustomerConnection` (no secrets), `getSubscriptionStatus`, `setSubscriptionStatus` (idempotent upsert, refuse unknown customer), `recordExportArtifact`, `listExportArtifacts` — written once so Step 14 webhook + Step 16/17 dashboard are thin adapters (design D8).

## 8. Composition root + CLI

- [x] 8.1 Update `src/composition-root.ts`: build the `ControlPlaneClient` + `SecretStore` + service when `TB_STORE_BACKEND=control-plane`, wire the DB-backed stores into the existing `StepDeps`/`DeprovisionDeps` bundles; keep the file stores for `file`; add the client's secret to the redacting logger.
- [x] 8.2 Add a `control-plane` CLI command (`apply-schema`, `purge-exports`) to `src/cli.ts` and `deno.json` tasks (`control-plane:apply-schema`, `control-plane:purge-exports`).
- [x] 8.3 Add the opt-in fail-loud `control-plane:live` smoke task + `test/live/control-plane-smoke.test.ts` (real conditional-write claim race → one winner; record + purge a dummy artifact); fails loudly without `TB_CONTROL_PLANE_URL`/`_SERVICE_KEY`.

## 9. Docs (public repo) — artifacts, ThreatModel, plan

- [x] 9.1 Add `ThreatModel.md` T28 (control-plane surface: secret concentration, service-role-only access, DB-enforced claim, export retention); note it resolves T25's interim-plaintext-store and T27's deferred-export-retention open items.
- [x] 9.2 Update hosting `README.md` with a Step-13 control-plane section (backend selection, secret storage, retention, service layer) and mark the "interim job store → control plane" section resolved.

## 10. Testing & Verification

- [x] 10.1 Unit tests: config parse-at-boundary (backend enum, missing-secret fail-fast, retention parse); fake conditional-write guard; export-retention due/not-due selection; malformed-row rejection; secret split/rejoin round-trip.
- [x] 10.2 Integration tests (real store+service, fake only at the DB boundary): DB-backed provisioning store claim (`claimed`/`already_done`/`in_progress`/lease-expired-reclaim), save→load with secrets rejoined, listAll, release; **interleave** (two claims → one winner); **crash-resume** (reload at cursor, access key intact); deprovision store contract; `SecretStore` round-trip; **no-secret-in-logs**; `ControlPlaneService` (secret omission, idempotent status upsert, refuse-unknown, record/list artifacts); `purge-exports` (only-due, counted, idempotent, zero-due clean).
- [x] 10.3 GATE-2b mutation checks: drop the CAS guard → interleave test reddens; drop the `retention_until < now` filter → purge-not-due reddens; leak a secret in a service read → secret-omission reddens; skip secret rejoin on load → crash-resume/round-trip reddens. Document the four confirmations.
- [x] 10.4 Run the full hosting suite (`deno task test`), `deno lint`, `deno fmt --check`, `deno check` — all green, zero skips.
- [x] 10.5 Public-repo gates unchanged & green: `deno task test` (backend, local stack, `TB_AI_PROVIDER=fake`) and `cd obsidian-plugin && npm test && npm run build`.
- [x] 10.6 `openspec validate control-plane --strict` clean; walk each delta-spec scenario and confirm a covering test; check the Step-13 box in `codeEval/Fable20260710-NewFeaturePlan.md`.
