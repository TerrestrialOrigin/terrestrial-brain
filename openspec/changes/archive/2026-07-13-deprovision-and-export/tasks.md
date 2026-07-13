> All code tasks are in the SEPARATE PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting` (branch `feature/DeprovisionAndExport`), reusing Steps 10/11's seams, fakes, and single composition root. This public repo carries only the ThreatModel T27 entry, these OpenSpec artifacts, and the plan checkbox.

## 1. Config & the export seam

- [x] 1.1 Add `TB_EXPORT_DIR` to `HostingConfig` (hosting `src/config.ts`) — a non-secret, parse-at-boundary string (default `./exports`) for the export delivery destination. Unit test: default applied when unset; value trimmed/validated. It is NOT added to `secretValues`.
- [x] 1.2 Add `src/ports/data-exporter.ts` — `DataExporter` port with `export(params): Promise<ExportManifest>` (produce a complete logical dump, deliver it to the destination, return `{ location, sha256, byteCount, tableRowCounts }`) and `verify(manifest): Promise<VerifyResult>` (re-read the delivered artifact, confirm size + checksum). Define the typed `ExportManifest` / `VerifyResult`. Add a deterministic fake under `test/fakes/` (scriptable: normal, delivery-fail, tampered/truncated artifact).

## 2. Deprovision job state & store

- [x] 2.1 Add `src/deprovision/state.ts` — `DeprovisionJob` (own status set `pending|running|done|failed`, step cursor over `EXPORT_DATA → VERIFY_EXPORT → DELETE_PROJECT → FINALIZE`, persisted `exportManifest`, lease fields, `errorDetails`) plus pure `nextStep`/`isComplete`/`newDeprovisionJob`. Unit tests: cursor progression and `isComplete`.
- [x] 2.2 Add `src/ports/deprovision-job-store.ts` — `DeprovisionJobStore` port with an atomic `claim` (CAS on status + lease, mirroring `ProvisioningJobStore`), `save`, `load`. Add a file adapter `src/adapters/deprovision-job-store-file.ts` (own filename suffix, `0600`) and an in-memory fake under `test/fakes/`.
- [x] 2.3 Add `"deprovisioned"` to `ProvisioningStatus` (hosting `src/provisioning/state.ts`) — additive; confirm Step 11's `done`-only fleet filter already excludes it (no fleet-code change needed).

## 3. Export operation (non-destructive)

- [x] 3.1 Add `src/deprovision/export.ts` — `exportBrain(customerId, deps)`: load the provisioning job (guard not-found / non-`done` per design D7), run `DataExporter.export` then `verify`, return the manifest; fail loudly (non-success) if verify fails. No claim/lease (repeatable, side-effect-free). Reads `projectRef`/`dbPassword` from the provisioning record.

## 4. Deprovision state machine (destructive)

- [x] 4.1 Add `src/deprovision/pipeline.ts` — `deprovision(customerId, deps)`: guard provisioning state (not-found / non-`done` → refuse; already-`deprovisioned` → no-op success); atomically `claim` the deprovision job (concurrent → `in_progress`); run the cursor state machine persisting after each step. `EXPORT_DATA` runs the export and persists the manifest ON the job BEFORE advancing. `VERIFY_EXPORT` gates the delete — a verify failure records `failed` and never reaches `DELETE_PROJECT`.
- [x] 4.2 `DELETE_PROJECT` reuses `SupabaseManagementApi.deleteProject(projectRef)` for the single ref from the customer's own job (no bulk/wildcard); idempotent (a "not found" on re-run is success). `FINALIZE` flips the provisioning job to `deprovisioned` and marks the deprovision job `done`.
- [x] 4.3 Return a typed counted outcome `{ customerId, status: "deprovisioned"|"failed", exportManifest, deletedProjectRef, error }` — `deprovisioned` only when export verified AND delete succeeded; never a loop-end success (design D6).

## 5. Composition root & CLI

- [x] 5.1 Wire the `DataExporter` adapter and the `DeprovisionJobStore` file adapter into `src/composition-root.ts` from the existing `HostingConfig` + new `TB_EXPORT_DIR` (no new secret). Add a `DeprovisionDeps` bundle; reuse the shared `SupabaseManagementApi`, `ProvisioningJobStore`, clock, and redacting logger.
- [x] 5.2 Add the real `DataExporter` adapter `src/adapters/data-exporter-*.ts` — produces the logical dump via the chosen mechanism (design Open Question) passing the db password through the environment, NEVER argv/logs; delivers to `TB_EXPORT_DIR` (`0600`); computes `sha256` + byte count; `verify` re-reads the delivered artifact. Rows/manifest parsed at the boundary (typed, never cast). Only exercised on the opt-in live path.
- [x] 5.3 Add `export` and `deprovision` subcommands to `src/cli.ts` (`--customer`), delegating to the operations; non-zero exit on any failure / not-found / refusal. Print the manifest (content-free) as JSON.
- [x] 5.4 Add `deno.json` tasks: `export`, `deprovision`, and an opt-in fail-loud non-destructive `export:live` smoke.

## 6. Tests (unit + integration)

- [x] 6.1 Unit tests: deprovision cursor/`nextStep`/`isComplete`; export-manifest hashing/byte-count; `verify` pass vs tamper/truncation; the not-found / non-`done` / already-`deprovisioned` guards; counted-outcome/result mapping.
- [x] 6.2 Integration (real state machine + real job stores, fakes only at the external boundary): deprovision happy path (export delivered+verified → exactly one `deleteProject` → provisioning job flipped to `deprovisioned`); **delete gated on verify** (verify fails → `deleteProject` NEVER called, job `failed`, project intact); **crash-resume** (interrupt after `EXPORT_DATA` → re-run resumes at delete, no destructive re-export; interrupt after delete → idempotent no-op); idempotency/runs-twice (concurrent claim → one deletes, other `in_progress`; already-`deprovisioned` → no re-export/re-delete); guards (not-found → reported non-success; non-`done` → refused); export-only command (dump+verify, ZERO `deleteProject`, returns manifest, repeatable); no-secret/no-content in logs.
- [x] 6.3 GATE-2b mutation check: removing the verify-before-delete gate reddens the gated-delete test; removing "persist manifest before delete" reddens the crash-resume test; replacing the counted outcome with a loop-end success reddens the dishonest-completion test; removing the `done`-status guard reddens the non-`done` test; collapsing `verify` into "trust the manifest" reddens the tamper-detect test.
- [x] 6.4 Opt-in fail-loud `export:live` smoke that runs a real NON-destructive dump+verify against a throwaway project when creds are present and fails loudly (never silently skips) when absent. Document the destructive `deprovision` live path as a manual, throwaway-only smoke.

## 7. Docs & threat model

- [x] 7.1 Add ThreatModel **T27** (deprovision/export surface) to the PUBLIC repo's `ThreatModel.md` per design.md security analysis (content-bearing export handling, destructive delete with the privileged token, the verify-before-delete gate, honest completion, db-password-via-env, GDPR retention open item).
- [x] 7.2 Hosting repo `README.md`: deprovision/export section (`export` non-destructive usage, `deprovision` destructive usage + the verify-before-delete gate, GDPR portability/erasure framing, the retention consideration, cross-reference T27).

## 8. Verification & finalization

- [x] 8.1 Hosting repo suite green: `deno task test` (0 fail, 0 skip), `deno lint`, `deno fmt --check`, `deno check`.
- [x] 8.2 Public repo suite still green (no runtime code changed): `deno task test` + `cd obsidian-plugin && npm test && npm run build`.
- [x] 8.3 `openspec validate deprovision-and-export --strict` clean; commit in the hosting repo; check off Step 12 in `codeEval/Fable20260710-NewFeaturePlan.md`.
