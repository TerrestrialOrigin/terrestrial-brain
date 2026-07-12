## Why

Onboarding a paying customer currently means running the seven manual steps in `docs/fresh-install.md` by hand (create a Supabase project, push migrations, set secrets, deploy the edge function, mint an access key, health-check). That does not scale to a per-customer-project hosted product, is error-prone, and — because the steps are not atomic or resumable — a half-finished run leaves an orphaned project or a live project with no auth key. Step 10 of the hosted-product plan replaces the manual runbook with an automated, idempotent, resumable provisioning pipeline so a customer's "brain" can be built end-to-end from a single call.

## What Changes

- **New standalone hosting workspace, in a SEPARATE PRIVATE repo** (`terrestrial-brain-hosting`, a sibling of this repo), so hosted-business logic never ships in the FSL-1.1-MIT public tree. This repo keeps only the OpenSpec planning artifacts (proposal/design/specs/tasks) and the plan checklist; the implementation code lands in the sibling repo. Decision recorded in `design.md`.
- **A provisioning pipeline** that, given a customer identifier and a region, drives the Supabase Management API through: create project → wait until healthy → apply all migrations → set per-project secrets → deploy the `terrestrial-brain-mcp` edge function → mint a fresh per-customer MCP access key → health-check the deployed endpoint → return the customer-facing connection details (MCP URL + access key).
- **Region as a first-class parameter** — EU customers get an EU-region project; the region is validated against an allowlist of supported Supabase regions.
- **Idempotency + resumability** — provisioning is modelled as a job with an atomically-claimed status and a persisted step cursor. Running the same job twice never creates two projects (the external project id is persisted before the create is confirmed); a job that crashed mid-way resumes from its last completed step rather than starting over or leaving an orphan.
- **Every external dependency behind a narrow seam** — the Management API, the migration/deploy runner (Supabase CLI), the clock, secret generation, and the job store are each injectable interfaces wired at one composition root, with deterministic fakes so the whole pipeline runs in unit/integration tests with no live Supabase account, no network, and no paid API.
- **A ThreatModel entry** for the new provisioning surface (privileged Management API token, per-customer secret handling, SSRF/region-injection, orphaned-project cleanup).

## Capabilities

### New Capabilities
- `provisioning-automation`: the end-to-end per-customer provisioning pipeline — its ordered steps, the region-parameter contract, the idempotency/resumability guarantees (runs-twice / crashes-halfway / interleaves), the seams every external dependency sits behind, secret-handling rules, and the failure/rollback behavior. Owned by the sibling `terrestrial-brain-hosting` repo; specced here.

### Modified Capabilities
<!-- None. Step 10 adds a new hosted-side capability in a separate repo; it changes no existing terrestrial-brain (public repo) behavior or spec. -->

## Non-goals

- **Not a control plane.** Persisting the customer→project→token→subscription mapping is Step 13; Step 10 depends on a `ProvisioningJobStore` seam and ships a minimal concrete store so it can run standalone, but the durable customer registry is out of scope here.
- **Not billing or onboarding UI.** Steps 14/16. Step 10 exposes a callable pipeline, not a signup screen or a payment trigger.
- **Not fleet operations.** Applying-migrations-to-all-existing-projects with drift detection is Step 11; Step 10 provisions ONE project per invocation.
- **Not deprovisioning/export.** Cancel → dump → delete is Step 12. Step 10 does implement compensating cleanup for a *failed* provision (best-effort teardown of a partially-created project) but not customer-initiated deprovisioning.
- **Not managed-AI metering.** Per-customer quotas are Step 15. Step 10 sets the `OPENROUTER_API_KEY` secret but does not meter usage.
- **No changes to the public repo's runtime.** No migration, no edge-function behavior change, no plugin change. The public repo gains only OpenSpec artifacts + the plan checkbox.

## Impact

- **New repo:** `~/Documents/Dev/terrestrial-brain-hosting` (local git for now; a private GitHub remote is added later by the owner). Deno + TypeScript to match the existing stack.
- **External APIs consumed:** Supabase Management API (project create, secrets, function deploy or CLI-driven deploy), Supabase CLI (`db push`, `functions deploy`).
- **Secrets handled:** a privileged Supabase Management API access token (the pipeline's own credential), and per-customer `MCP_ACCESS_KEY` (minted) + `OPENROUTER_API_KEY` (shared, injected as a per-project secret).
- **Public repo touched:** `openspec/changes/provisioning-automation/**` (artifacts), `ThreatModel.md` (new provisioning threat entry), `codeEval/Fable20260710-NewFeaturePlan.md` (Step 10 checkbox). No `supabase/`, `obsidian-plugin/`, or `tests/` code changes.
- **Reuses, does not fork:** the pipeline drives the *published* migrations and edge function from the public repo as inputs; it never copies or vendors them, and never copies anything from OB1.
