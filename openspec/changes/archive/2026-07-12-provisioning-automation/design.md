## Context

Onboarding one customer today = the seven hand-run steps in `docs/fresh-install.md`. Step 10 automates them into a single idempotent, resumable pipeline driven by the **Supabase Management API** (project lifecycle, secrets, function deploy) plus the **Supabase CLI** (`db push`, `functions deploy`).

**Where the code lives — recorded decision (project owner, 2026-07-12):** the implementation goes in a NEW SEPARATE PRIVATE repo, `terrestrial-brain-hosting`, a sibling of this repo (`~/Documents/Dev/terrestrial-brain-hosting`). It is a **local git repo for now**; the owner adds a private GitHub remote later. This repo (`terrestrial-brain`, FSL-1.1-MIT, public) keeps ONLY the OpenSpec planning artifacts for this change plus the plan checklist and one ThreatModel entry — no hosted-business logic. Rationale: the pipeline encodes the hosted-business model (per-customer project fan-out, the privileged Management token, secret handling) and must never ship under FSL in a public tree. Stack is Deno + TypeScript to match the existing edge function, so the seam/fake discipline and tooling carry over.

**Inputs the pipeline consumes from the public repo, never forks:** the migration set in `supabase/migrations/` and the `terrestrial-brain-mcp` edge function. The hosting repo drives the *published* project as a build input (a checked-out/pinned copy path passed in config), it does not vendor or copy those files, and it copies nothing from OB1.

**Constraints:** runs-twice / crashes-halfway / interleaves invariant applies in full (CLAUDE.md); every external dependency behind a seam so the whole pipeline runs in tests with no network, no live Supabase org, no paid API; secrets in headers not URLs, constant-time where compared, 0600 on disk, never logged.

## Goals / Non-Goals

**Goals:**
- One call provisions one customer's brain end-to-end: create → await-healthy → migrate → set-secrets → deploy → health-check → return `{ mcpUrl, accessKey }`.
- Region is a validated parameter (EU customers → EU project).
- Idempotent (re-run never double-creates), resumable (crash resumes from last completed step), interleave-safe (concurrent runs for the same customer → one wins).
- Every external dependency injected behind a 3–5 method interface with a deterministic fake; the full pipeline is covered by integration tests that touch zero live external systems.
- Secret-safe: privileged Management token and per-customer keys never logged, never in URLs.

**Non-Goals:**
- Durable customer registry / control plane (Step 13) — Step 10 uses a minimal `ProvisioningJobStore` behind a seam so it runs standalone.
- Billing (14), onboarding UI (16), fleet ops (11), deprovisioning/export (12), usage metering (15).
- Live-Supabase E2E in the default suite (needs a paid org + Management token) — provided as an opt-in, fail-loud smoke, never a silent skip.
- No change to the public repo's runtime (no migration, no edge-function behavior, no plugin).

## Decisions

### D1: Pipeline as an explicit step-cursor state machine, not a linear script
Steps: `CREATE_PROJECT → AWAIT_HEALTHY → APPLY_MIGRATIONS → SET_SECRETS → DEPLOY_FUNCTION → HEALTH_CHECK → DONE`. The job persists a `cursor` (last completed step). Resume = load job, continue at `cursor + 1`. Each step is a short single-purpose function taking injected deps and the job, returning the advanced job.
- **Why:** a linear script cannot resume after a half-way crash without re-doing side-effectful, already-completed steps (double project create). An explicit cursor makes "crashes-halfway → resume" a first-class, testable property.
- **Alternative considered:** a durable workflow engine (Temporal/Inngest). Rejected for Step 10 — heavyweight, an external dependency of its own, and overkill before a control plane exists. The seam design lets Step 13 swap the store without touching step logic.

### D2: Idempotency key = customer id; atomic CLAIM in the job store
`ProvisioningJobStore.claim(customerId)` performs a compare-and-swap: a job in state `absent | failed | lease-expired` transitions to `running` with an owner + lease timestamp and is returned; a job already `running` with a live lease returns `null` (caller reports "already in progress"); a `done` job is returned as-is (caller returns existing connection details, creates nothing).
- **Why:** guards all three failure modes at once — runs-twice (claim is a CAS), interleaves (only one owner holds the lease), and completed-idempotency (`done` short-circuits). One active brain per customer.
- **Alternative:** rely on Supabase project-name uniqueness as the idempotency guard. Rejected — that surfaces as an opaque API error after we've already tried to create, and races between two of our own workers still both call create.

### D3: Persist the external project ref BEFORE marking CREATE_PROJECT complete; mint the MCP key ONCE and persist at mint time
`CREATE_PROJECT` writes the returned project ref into the job (and flushes the store) *before* the step is marked done. The MCP access key is minted and persisted the first time `SET_SECRETS` runs, then reused on every resume.
- **Why:** honours CLAUDE.md's "persist an external id before confirming so recovery can dedup" and "never delete-then-write." A crash immediately after the API returns still leaves us knowing the project exists (no forgotten orphan); a resume reuses the same key instead of rotating the customer's credential mid-provision.

### D4: Failure leaves a recoverable `failed` job; rollback is explicit, not automatic
On terminal step failure the job is marked `failed` with `cursor` + `errorDetails` + the persisted project ref. Auto-teardown of the half-created project is **off by default**; a separate `rollback(customerId)` operation (and an opt-in `--auto-rollback` flag) performs best-effort project deletion.
- **Why:** deleting is destructive and irreversible; defaulting to "leave it visible for review" is the safe-by-default choice. At provision time the project holds no customer data, so opt-in auto-rollback is available for unattended runs.
- **Alternative:** always auto-delete on failure. Rejected as the default — a transient health-check flake would nuke an otherwise-good project.

### D5: Region validated with a parse-don't-cast allowlist
`config.ts` / a `regions.ts` Zod enum validates the region against a maintained allowlist of supported Supabase regions before it ever reaches the Management API. EU customers map to an EU region. Unknown region → boundary validation error.
- **Why:** parse-don't-cast (CLAUDE.md); also the anti-SSRF/anti-injection control — an unvalidated region string must never be interpolated into an API host/path.

### D6: Seams (ports) + adapters, wired at one composition root
Ports (interfaces, 3–5 methods each): `SupabaseManagementApi` (createProject, getProjectStatus, setSecrets, [deployFunction]), `DeployRunner` (pushMigrations, deployFunction), `ProvisioningJobStore` (claim, save, load, release), `Clock` (now, sleep), `KeyGenerator` (mintAccessKey), `Logger` (redacting). Adapters: HTTP Management API, CLI-shelling DeployRunner, file-backed JobStore (0600), system Clock, crypto KeyGenerator. `composition-root.ts` wires the real adapters from validated env; `cli.ts` is a thin entrypoint.
- **Why:** the litmus test — the full pipeline must run in a unit/integration test with fakes, no network, no live DB, no paid API. Each external dependency is genuinely external, so it gets a seam. Step 13 later swaps `ProvisioningJobStore` for a control-plane-backed implementation with no change to step logic.

### D7: Config is parse-at-boundary (Zod) with fail-fast required secrets
`config.ts` validates env once into a known-good typed object: `TB_MGMT_API_TOKEN` (required), `OPENROUTER_API_KEY` (required), `TB_SUPABASE_ORG_ID` (required), `TB_MIGRATIONS_SOURCE` path (required), region allowlist, optional store path. Missing/empty required secret → throws naming the variable at cold start (mirrors the public repo's `requireEnv`).

### D8: Where the ThreatModel entry lives
The provisioning threat entry (T24) is added to the **public repo's** `ThreatModel.md`. It documents security *posture*, not business logic, and keeps the single project-wide threat register intact. The hosting repo's README cross-references it.

## User-error & edge scenarios (and how the system handles each)

| Scenario | Handling |
|---|---|
| Unsupported/misspelled region | Boundary validation (D5) rejects with the allowlist; never calls the API. |
| Missing/empty `TB_MGMT_API_TOKEN` or `OPENROUTER_API_KEY` | Fail-fast at composition root (D7), names the variable, exits non-zero. |
| Re-provision a customer whose brain is already `done` | `claim` returns the `done` job (D2); pipeline returns existing `{ mcpUrl, accessKey }`, creates nothing. |
| Re-run a `failed` job | Resumes from `cursor` (D1/D3); no duplicate project, same minted key. |
| Two concurrent provisions, same customer | One wins the CAS claim; the other returns "already in progress" (D2). |
| Empty/malformed customer id | Rejected at the boundary before any claim. |
| Crash / Ctrl-C mid-run | Lease expiry (D2) makes the job re-claimable; resume continues at `cursor`. |
| Project healthy-poll never succeeds | Bounded poll count + deadline (Clock seam) → job `failed` with a clear timeout error, project ref persisted for review/rollback. |
| Migration/deploy step fails | Job `failed` at that `cursor`; re-run resumes (both `db push` and `functions deploy` are idempotent). |

## Security analysis (feeds ThreatModel T24)

- **Leaked Management API token → full control of every customer project.** Mitigations: env-only secret (never committed/logged), least-privilege token scoped to the hosting org, sent as `Authorization: Bearer`, rotation documented.
- **Region / customer-id injection or SSRF.** Mitigations: region allowlist (D5), customer-id format validation, no untrusted interpolation into API host/path.
- **Weak or reused customer MCP key.** Mitigations: CSPRNG mint (≥32 bytes, base64url), unique per customer, minted once and persisted (D3).
- **Secret leakage via logs.** Mitigations: redacting `Logger`; a test asserts no secret value appears in emitted logs.
- **Orphaned projects from crashes (cost + data-residency).** Mitigations: persist project ref before confirming (D3), explicit `rollback` op + failed-job visibility (D4).
- **Interim file JobStore holds the minted key in plaintext.** Mitigations: 0600 file mode; documented as interim until Step 13's control plane provides proper secret storage; store path outside any repo tree.
- **Provisioning with stale/insecure schema.** Mitigation: the pipeline always applies the full current migration set from the pinned public-repo source, so every new brain starts on the latest hardened schema (RLS, default-deny CORS, header-only auth).

## Test Strategy

Layers that apply (per CLAUDE.md gates), all in the hosting repo's own suite (`deno task test`):
- **Unit:** region validation, key mint + redaction, config parse (missing-secret fail-fast), each step function against fakes, state-machine transitions.
- **Integration (real pipeline, fakes ONLY at the genuine external boundary):** the Management API, Supabase CLI, network, clock and disk are the real external systems — faking *them* is legitimate; the pipeline ↔ steps ↔ job-store path under test is REAL and unmocked (mock-boundary rule). Cases: happy-path full provision; **idempotency** (run twice → exactly one `createProject` call, one project ref); **resume-after-crash** (inject a fault at each step, re-run, assert completion, no duplicate create, same key); **interleave** (two concurrent `claim`s → one wins); **failure + rollback**; **no-secret-in-logs**.
- **GATE-2b mutation check:** deleting the "persist ref before confirm" line must redden the resume-no-duplicate test; deleting the CAS in `claim` must redden the interleave test; deleting region validation must redden the bad-region test.
- **Live smoke (opt-in, fail-loud, NOT in the default suite):** `deno task provision:live` runs the real pipeline against a throwaway Supabase org when `TB_MGMT_API_TOKEN` + org are present; absent creds → fails loudly with a clear message, never a silent skip. This is the honest analogue of GATE-1 E2E for a headless hosting tool with a paid external dependency — the deterministic full-pipeline integration test is the always-run end-to-end coverage; the live smoke is the manual real-system confirmation.

The public repo's suite (`deno task test`, plugin) is unaffected and must stay green — this change adds no runtime code there.

## Risks / Trade-offs

- **[Interim file JobStore is not a real registry]** → acceptable for standalone Step 10; seam lets Step 13 replace it. Documented; store is 0600 and outside repo trees.
- **[No default live E2E]** → mitigated by the opt-in fail-loud live smoke + exhaustive fake-backed integration coverage; the alternative (a paid Supabase org wired into CI) is deferred to when the control plane exists.
- **[Management API surface may drift]** → the `SupabaseManagementApi` port isolates the blast radius to one adapter; version the API base path in config.
- **[Two repos to keep in step]** → the hosting repo pins the public-repo migration/function source by path/ref in config; a mismatch is caught by the health-check step.

## Migration Plan

- **Deploy:** none to shared infra. "Install" = clone/pull the private `terrestrial-brain-hosting` repo, set env (`TB_MGMT_API_TOKEN`, `OPENROUTER_API_KEY`, `TB_SUPABASE_ORG_ID`, `TB_MIGRATIONS_SOURCE`), run `deno task provision --customer <id> --region <r>`.
- **Rollback (a bad provision):** `deno task provision:rollback --customer <id>` (best-effort project delete) or manual delete via the Supabase dashboard; the `failed` job record makes the target explicit.
- **Public repo:** merges only the OpenSpec artifacts, the ThreatModel T24 entry, and the plan checkbox — reversible by revert with zero runtime impact.

## Open Questions

- Exact final region allowlist (pull from the current Supabase Management API `list regions` at implementation time; seed with at least one US + one EU region).
- Whether the health-check step should call the MCP `initialize`/a lightweight tool vs a plain HTTP liveness probe — resolve during apply; the port supports either.
- Long-term home of the minted key before Step 13 lands (interim: 0600 file store) — confirmed acceptable by owner for standalone Step 10.
