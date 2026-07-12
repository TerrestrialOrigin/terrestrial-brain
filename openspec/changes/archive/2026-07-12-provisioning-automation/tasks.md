## 1. Scaffold the hosting repo

- [x] 1.1 Create the sibling repo `~/Documents/Dev/terrestrial-brain-hosting`, `git init` (local only — no remote yet), add `.gitignore` (node_modules, `.env`, job-store data dir), `deno.json` with tasks (`test`, `test:unit`, `lint`, `fmt`, `provision`, `provision:rollback`, `provision:live`), and a `README.md` noting FSL-exclusion, cross-referencing the public repo's `ThreatModel.md` T25, and documenting the required env vars.
- [x] 1.2 Add the src/test folder layout from design.md (`src/ports`, `src/adapters`, `src/provisioning`, `src/config.ts`, `src/composition-root.ts`, `src/cli.ts`, `test/fakes`, `test/unit`, `test/integration`).

## 2. Ports (seams) and domain types

- [x] 2.1 Define `ProvisioningJob`, `ProvisioningStep` (the ordered cursor enum), and job status (`pending|running|done|failed|rolled_back`) in `src/provisioning/state.ts`.
- [x] 2.2 Define port interfaces (3–5 methods each): `SupabaseManagementApi`, `DeployRunner`, `ProvisioningJobStore` (with atomic `claim`), `Clock`, `KeyGenerator`, `Logger` (redacting) under `src/ports/`.
- [x] 2.3 Implement in-memory/deterministic fakes for every port under `test/fakes/` (fake Management API that records calls, fake DeployRunner, in-memory JobStore with CAS claim, fixed Clock, deterministic KeyGenerator, capturing Logger).

## 3. Boundary validation & secrets

- [x] 3.1 `src/provisioning/regions.ts`: region allowlist + Zod parse-don't-cast validator (≥1 US + ≥1 EU region); unit tests for accept/reject.
- [x] 3.2 `src/config.ts`: Zod parse-at-boundary of env into a typed config with fail-fast required secrets (`TB_MGMT_API_TOKEN`, `OPENROUTER_API_KEY`, `TB_SUPABASE_ORG_ID`, `TB_MIGRATIONS_SOURCE`); unit test for missing-secret fail-fast.
- [x] 3.3 `src/provisioning/secrets.ts`: CSPRNG access-key mint (≥32 bytes, base64url) + redaction helper; unit tests for entropy/format and redaction.

## 4. Pipeline state machine

- [x] 4.1 Implement each step as a short single-purpose function (`CREATE_PROJECT` persisting the project ref before completion; `AWAIT_HEALTHY` bounded poll via Clock; `APPLY_MIGRATIONS`; `SET_SECRETS` minting+persisting the key once; `DEPLOY_FUNCTION`; `HEALTH_CHECK`) in `src/provisioning/steps.ts`.
- [x] 4.2 Implement `src/provisioning/pipeline.ts`: claim → resume-at-cursor loop → advance/persist per step → return connection details on `DONE`, or mark `failed` with cursor+error.
- [x] 4.3 Implement the explicit `rollback(customerId)` operation (best-effort project delete) + opt-in `--auto-rollback` wiring.

## 5. Adapters & composition root

- [x] 5.1 `src/adapters/management-api-http.ts`: real Management API over `fetch` (Bearer header, no secrets in URLs), region-parameterized create, status poll, set-secrets, project delete.
- [x] 5.2 `src/adapters/deploy-runner-cli.ts`: shell out to the Supabase CLI for `db push` and `functions deploy` against the pinned `TB_MIGRATIONS_SOURCE`.
- [x] 5.3 `src/adapters/job-store-file.ts` (0600 file, path outside repo tree), `clock-system.ts`, `key-generator-crypto.ts`, redacting logger adapter.
- [x] 5.4 `src/composition-root.ts` wiring real adapters from validated config; `src/cli.ts` thin entrypoint (`--customer`, `--region`, `--auto-rollback`).

## 6. Tests (unit + integration)

- [x] 6.1 Unit tests: region validation, config fail-fast, key mint/redaction, each step function against fakes, state-machine transitions.
- [x] 6.2 Integration (real pipeline, fakes only at the external boundary): happy-path full provision; idempotency (run twice → one create); resume-after-crash at each step (no duplicate create, same key); interleave (concurrent claim → one wins); failure + explicit rollback; no-secret-in-logs.
- [x] 6.3 GATE-2b mutation check: confirm removing "persist ref before confirm" reddens resume-no-duplicate; removing the CAS reddens interleave; removing region validation reddens bad-region.
- [x] 6.4 Opt-in fail-loud live smoke task (`provision:live`) that runs the real pipeline against a throwaway org when creds are present and fails loudly (never silently skips) when they are absent.

## 7. Docs & threat model

- [x] 7.1 Add ThreatModel T25 (provisioning surface) to the PUBLIC repo's `ThreatModel.md` per design.md security analysis.
- [x] 7.2 Hosting repo `README.md`: usage, env vars, rollback runbook, and the interim-JobStore → Step 13 control-plane note.

## 8. Verification & finalization

- [x] 8.1 Hosting repo suite green: `deno task test` (0 fail, 0 skip), `deno lint`, `deno fmt --check`.
- [x] 8.2 Public repo suite still green (no runtime code changed): `deno task test` + `cd obsidian-plugin && npm test && npm run build`.
- [x] 8.3 `openspec validate provisioning-automation --strict` clean; make the initial commit in the hosting repo; check off Step 10 in `codeEval/Fable20260710-NewFeaturePlan.md`.
