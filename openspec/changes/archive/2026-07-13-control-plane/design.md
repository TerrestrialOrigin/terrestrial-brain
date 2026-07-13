## Context

Steps 10–12 (all in the private `terrestrial-brain-hosting` repo) provision, operate, and end a customer's brain. Each persists its state through a **seam** — `ProvisioningJobStore` (Step 10) and `DeprovisionJobStore` (Step 12) — whose only production implementation today is a **file-backed store**: one 0600 JSON file per customer under `TB_JOBSTORE_DIR`, holding the minted MCP access key and the project db password **in plaintext**. Both the code comments and ThreatModel T25/T27 label this "an accepted interim until Step 13's control plane," and Step 12 explicitly deferred the retention policy for delivered export artifacts to "Step 13's control plane."

The file store has three structural limits that block the commercial phase:
1. **Its atomic claim is process-local.** `FileJobStore.claim` reads then writes; two provisioning hosts racing on one customer could both claim. Fine for a single standalone host, not for a hosted service.
2. **Secrets sit in world-persisted plaintext files.** There is no proper secret storage.
3. **There is no durable map of customer → project → tokens → subscription status**, and no backend the dashboard (Steps 16/17) or Paddle webhooks (Step 14) can read/write.

Step 13 introduces "**one ordinary Supabase project**" (a normal project, not a per-customer one) as the durable **control plane**: the map, the secret store, the export-retention record, and a transport-neutral backend service — swapping the file stores' *implementation* behind their existing seams with **zero change to step/pipeline logic**. Constraints inherited from Steps 10–12: Deno + TypeScript; every external dependency behind a narrow injected seam wired at the one composition root; a deterministic fake so the full suite runs with no live Supabase and no paid API; parse-at-boundary config and external data; runs-twice/crashes-halfway/interleaves designed for; secrets env-only, `Authorization: Bearer`, never in a URL, never logged; the code lives only in the private repo (this public repo gets artifacts + one ThreatModel entry + the plan checkbox).

## Goals / Non-Goals

**Goals:**
- A durable control-plane data model — `customers`, `customer_projects` (the durable provisioning record incl. resume cursor + subscription status), a service-role-only secret store, `deprovision_jobs`, `export_artifacts` — as the schema of one ordinary Supabase project.
- DB-backed `ProvisioningJobStore` + `DeprovisionJobStore` whose atomic claim is enforced by a **Postgres conditional write**, replacing the file stores with **no change to any step or pipeline logic**.
- Proper secret storage for the minted access key + db password (out of plaintext files), behind a `SecretStore` seam so a stronger backend can be swapped in later.
- The export-artifact retention/rotation policy Step 12 deferred: record every delivered dump (content-free) + a `purge-exports` operation.
- A transport-neutral backend service (list/get customers, connection + subscription status reads, subscription-status write, export-artifact record/list) the future dashboard and billing webhooks consume.
- The whole thing runs deterministically in tests via an in-memory `ControlPlaneClient` fake that models the conditional-write claim; opt-in fail-loud live smoke for real-system confidence.

**Non-Goals:**
- The Paddle billing integration (Step 14): signature verification, webhook payloads, checkout — out of scope. Step 13 lands the data model + service methods those consume.
- The dashboard / onboarding UI (Steps 16/17): Step 13 is the backend they call; no UI ships.
- Customer-facing auth / RLS on the control plane: operator/backend-only (service-role) in this step.
- Managed-AI metering (Step 15).
- Rewriting provisioning/fleet/deprovision logic — unchanged behind the seam.
- A KMS / Vault / envelope-encryption secret backend — the `SecretStore` seam allows it later; this step lands a service-role-only DB store with the trade-off documented.
- Migrating existing 0600 file-store data — that store is throwaway dev/interim; no data migration.

## Decisions

### D1 — "One ordinary Supabase project," reached via `@supabase/supabase-js` with the service-role key
The control plane is a normal Supabase project (Postgres + a service-role key), matching the plan's exact phrasing. **Why Supabase over a bespoke DB:** (a) it is the same platform the rest of the product runs on (one vendor, one ops story); (b) Postgres gives the DB-enforced conditional write D2 needs; (c) it is the natural backend for the Step 14 webhooks and Step 16/17 dashboard (they get a ready service-role/anon split and edge functions later). **Alternative considered:** reuse a customer-style per-customer project via the Management API — rejected: the control plane is org-wide operator data, not a tenant, and must not be provisioned by the very pipeline it backs (bootstrap cycle). It is created once, by hand/live-smoke, and its URL + service key are config.

### D2 — Atomic claim enforced by a Postgres conditional write (not a process-local check)
The file store's claim is read-then-write (process-local). The DB store's claim is a **single conditional `UPDATE ... WHERE <claimable> RETURNING`** (equivalently an RPC / upsert-on-conflict), so the database — not the app — decides the winner of a race. `<claimable>` = row absent (insert), or `status IN ('failed')`, or lease expired (`lease_expires_at < now`), or already this owner. A row already `running` under a live lease yields zero updated rows → `in_progress`; a `done` row → `already_done`. This is the runs-twice/interleaves invariant moved from "hope one host runs it" to "the DB guarantees one winner." **The `ControlPlaneClient` fake models exactly this** (a guarded mutate that returns the row only if the guard matched), so interleave tests are meaningful against the fake and identical semantics hold live. **Alternative:** an advisory lock — rejected, the conditional write is simpler, is also the persistence, and needs no separate lock lifecycle.

### D3 — One narrow `ControlPlaneClient` seam; everything DB goes through it; deterministic in-memory fake
A single port exposes the minimal operation set the stores + service + secret store need — expressed as **intent-named methods** (`claimProvisioningJob`, `saveProvisioningJob`, `loadProvisioningJob`, `listProvisioningJobs`, `putSecret`, `getSecret`, `upsertCustomer`, `setSubscriptionStatus`, `recordExportArtifact`, `listExpiredExportArtifacts`, `deleteExportArtifact`, …), **never a generic `query(sql)`** (no SQL-injection surface, testable, and the fake can't drift from the contract). The production adapter (`SupabaseControlPlaneClient`) implements them over `@supabase/supabase-js`; the fake (`InMemoryControlPlaneClient`) models rows + the conditional-write guard in memory. **Why not let the stores hold a Supabase client directly:** that would re-introduce an un-fakeable dependency mid-logic (violates the seam rule) and couple three consumers to the client shape.

### D4 — DB-backed stores implement the EXISTING ports; backend selected by config; file store retained as dev fallback
`ControlPlaneProvisioningJobStore` and `ControlPlaneDeprovisionJobStore` implement the **unchanged** `ProvisioningJobStore` / `DeprovisionJobStore` interfaces. The composition root picks the implementation from `TB_STORE_BACKEND` (`control-plane` for hosted; `file` — the current 0600 store — for standalone dev, kept as a documented fallback). **No provisioning, fleet, or deprovision code changes** — this is the payoff of the seam discipline from Steps 10–12. Selecting `control-plane` without the control-plane env configured fails fast at the composition root (parse-at-boundary), never silently.

### D5 — Secret storage: a service-role-only secret store behind a `SecretStore` seam (trade-off documented)
The minted access key + db password move from plaintext 0600 files into a `project_secrets` table readable/writable **only** by the service role (RLS deny-by-default; no anon/authenticated grant). At-rest protection is **Supabase platform-level** (disk encryption) plus strict access control — **not** app-level envelope encryption in this step. **Why:** app-level envelope encryption needs a KMS/key-custody story that is its own project; landing it now would balloon Step 13. The `SecretStore` port isolates every read/write of a secret, so a stronger backend (Supabase Vault, or envelope encryption with a KMS-held DEK) is a later swap with no caller change. **Recorded trade-off in T28.** Secrets are **never** returned by the customer-facing service reads (D8) and never logged (the redacting logger already covers them; the service-role key is added to `secretValues`).

### D6 — Data model (control-plane schema)
Applied as SQL under `control-plane/schema.sql` in the hosting repo (idempotent `create table if not exists`; not a per-customer Supabase migration — this is the operator project). Parse-at-boundary: every row read back is validated with zod into the known-good `ProvisioningJob` / `DeprovisionJob` / domain type before use.

- `customers` — `id` (customer id, PK), `email`, `created_at`, `subscription_status` (`enum: active | past_due | paused | canceled | none`, default `none`).
- `customer_projects` — the durable `ProvisioningJob`: `customer_id` (PK/FK, the idempotency key), `region`, `status`, `cursor`, `project_ref`, `mcp_url`, `lease_owner`, `lease_expires_at`, `error_details`, timestamps. Secrets are **not** here — they live in `project_secrets`.
- `project_secrets` — `customer_id` (PK/FK), `access_key`, `db_password`. Service-role-only.
- `deprovision_jobs` — the durable `DeprovisionJob` (its cursor/status/manifest fields), keyed by `customer_id`.
- `export_artifacts` — `id`, `customer_id`, `location`, `sha256`, `byte_size`, `row_count`, `delivered_at`, `retention_until`. **Content-free** (D7).

Mapping note: today's `ProvisioningJob` carries `accessKey`/`dbPassword` inline. The DB-backed store **splits** those into `project_secrets` on save and **rejoins** them on load, so the in-memory `ProvisioningJob` shape the pipeline sees is byte-for-byte unchanged (seam integrity), while at rest the secrets are isolated.

### D7 — Export-artifact retention + `purge-exports` (closes Step 12's open item)
Every delivered export is recorded content-free in `export_artifacts` with `retention_until = delivered_at + TB_EXPORT_RETENTION_DAYS` (parse-at-boundary; sensible default e.g. 30). Step 12's exporter gains a hook (via the service layer) to record the artifact when it delivers one. A new `purge-exports` operation: `listExpiredExportArtifacts(now)` (bounded, DB-side `where retention_until < now`), delete each delivered file + its row, return a **counted outcome** (`purged` / `failed` / `skipped-missing`), overall-fail if any delete failed. Idempotent (an already-gone file is a successful purge). **Why a pull-based purge op over a DB TTL/cron:** the artifact is a delivered *file*, not just a row — deleting the row wouldn't delete the data; the op deletes both and reports honestly.

### D8 — Transport-neutral control-plane service layer
A `ControlPlaneService` exposes typed, transport-neutral methods — `listCustomers`, `getCustomerConnection(customerId)` (region, mcp_url, status — **never secrets**), `getSubscriptionStatus`, `setSubscriptionStatus(customerId, status)` (idempotent upsert, refuses an unknown customer), `recordExportArtifact`, `listExportArtifacts`. **Why transport-neutral (per the Rule-of-Three / two-entry-points rule):** Step 14's Paddle webhook handler and Steps 16/17's dashshboard are two entry points onto the same operations; the logic is written **once** here and each becomes a thin adapter, so they can never drift. `setSubscriptionStatus` is a keyed idempotent upsert so an at-least-once webhook (Step 14) replaying is a no-op — the idempotency structure is built in now even though the webhook is later.

### D9 — Parse-at-boundary on every control-plane read
Control-plane rows are external data (they cross the DB boundary). Each `ControlPlaneClient` read validates the row(s) with a zod schema into the known-good type before returning; a malformed/legacy row is a loud parse error, never an `as` cast that crashes downstream. Config (`TB_CONTROL_PLANE_URL`, `TB_CONTROL_PLANE_SERVICE_KEY`, `TB_EXPORT_RETENTION_DAYS`, `TB_STORE_BACKEND`) is validated once in the existing `loadConfig` zod schema; `TB_STORE_BACKEND` is an enum (`file | control-plane`), region/status are enums — parse, don't cast.

### D10 — CLI: a `control-plane` maintenance command
`control-plane apply-schema` (idempotently applies `control-plane/schema.sql` to the configured project) and `control-plane purge-exports` (D7). Provisioning/fleet/deprovision commands are unchanged — they just get the DB-backed store when `TB_STORE_BACKEND=control-plane`. An opt-in fail-loud `control-plane:live` smoke provisions nothing real but exercises the real conditional-write claim + purge against a throwaway control-plane project.

## Risks / Trade-offs

- **[The control plane concentrates every customer's secrets + mapping in one project — a high-value target]** → Service-role key is env-only, never logged (added to `secretValues`/redacting logger), never in a URL; every table is service-role-only with RLS deny-by-default (no anon/authenticated grant); secrets live in a dedicated table never returned by customer-facing reads (D5/D8); parse-at-boundary on all reads. Covered by ThreatModel **T28**.
- **[Secrets are protected at rest by platform disk-encryption + access control, not app-level envelope encryption]** → Accepted, documented interim; the `SecretStore` seam makes a KMS/Vault backend a later swap with no caller change (mirrors how the file store was an accepted interim behind the store seam).
- **[DB-enforced claim is only truly atomic against real Postgres; the fake models it]** → Same discipline as Steps 10–12 (fake models the guarantee; live smoke confirms it against a real project). The conditional write is a single statement, so there is no app-side window to get wrong.
- **[Switching `TB_STORE_BACKEND` to control-plane without applying the schema, or with a stale schema, would fail mid-op]** → `apply-schema` is idempotent and run first; selecting `control-plane` validates the env at the composition root (fail-fast); reads parse-at-boundary so a missing column surfaces as a loud error, not corruption.
- **[Export retention could delete a file a customer still needs, or leave stale personal data]** → Retention window is an explicit configured value; `purge-exports` is pull-based, counted, and only deletes artifacts strictly past `retention_until`; it is the operator's deliberate action, logged, never an implicit cron in this step.
- **[Bootstrap: the control plane can't be provisioned by the pipeline it backs]** → It is created once out-of-band (documented; live smoke uses a throwaway project) and referenced by config — never by `customer_projects`.

## User-error scenarios

- **Operator selects `TB_STORE_BACKEND=control-plane` but omits `TB_CONTROL_PLANE_URL`/`_SERVICE_KEY`** → `loadConfig` fails fast naming the missing variable (parse-at-boundary); no partial wiring.
- **Operator runs any hosted command before `control-plane apply-schema`** → the first control-plane read/write surfaces a clear "relation does not exist / schema not applied" error, not a silent success; `apply-schema` is the documented first step.
- **`purge-exports` with zero artifacts, or zero *due* artifacts** → a clean counted zero (`purged=0`), never an error and never a false "done" (empty ≠ broken).
- **Two provisioning runs for one customer race** → the DB conditional-write claim yields exactly one `claimed`; the other gets `in_progress` and backs off (interleave invariant).
- **`setSubscriptionStatus` for a customer with no `customer_projects`/`customers` row** → refused with a not-found error (never a silent create — a webhook for an unknown customer is a signal, not a row to invent).
- **A malformed/legacy control-plane row** → parse-at-boundary rejects it loudly at read time, isolating the bad row instead of casting it into a downstream crash.
- **Resuming a crashed provision under the DB store** → the persisted cursor + rejoined secrets drive the resume identically to the file store (crash-halfway invariant); the once-minted access key is reused, never rotated.

## Security analysis (ThreatModel T28)

New surface: the control plane is one project holding **every** customer's secrets (access keys, db passwords) and the full customer→project→subscription map — the single highest-value target in the hosted system. Threats & controls:
- **Service-role key compromise → total control-plane access.** Env-only, never logged (redacting logger + `secretValues`), `Authorization: Bearer` never in a URL; least-privilege/rotatable; documented as the crown-jewel credential.
- **Secret-at-rest exposure.** Secrets in a dedicated `project_secrets` table, RLS deny-by-default (service-role only), never returned by customer-facing service reads (D8), never logged. Trade-off (platform vs app-level encryption) recorded; `SecretStore` seam for a stronger backend.
- **Injection via a generic query path.** None — `ControlPlaneClient` exposes only intent-named, parameterized methods (no `query(sql)`); inputs (customer id, region, status) are validated/enum-parsed.
- **Double-provision / race → two projects or two charges.** DB-enforced conditional-write claim (D2) guarantees one winner.
- **Stale personal data in delivered exports.** `export_artifacts` retention + counted `purge-exports` (D7); manifest content-free.
- **Malformed external data crashing far from cause.** Parse-at-boundary on every control-plane read (D9).
This entry lands in the public repo's `ThreatModel.md` as **T28**; T25's "interim plaintext store" and T27's "export retention deferred to Step 13" open items are resolved by it.

## Test Strategy

All deterministic tests run against the `InMemoryControlPlaneClient` fake — **no live Supabase, no network, no paid API** — exactly the Steps 10–12 discipline. Layers:
- **Unit (`test/unit/`):** config parse-at-boundary for the new env (backend enum, missing-secret fail-fast, retention-days parse); the fake's conditional-write guard semantics; export-retention due/not-due selection; parse-at-boundary rejects a malformed row; secret split/rejoin round-trip.
- **Integration (`test/integration/`, real store + service logic, fake only at the DB boundary):**
  - DB-backed `ProvisioningJobStore`: `claim` returns `claimed` / `already_done` / `in_progress` / lease-expired-reclaim; `save`→`load` round-trips the full job **with secrets rejoined**; `listAll`; `release`.
  - **Interleave:** two concurrent `claim`s for one customer → exactly one `claimed`, one `in_progress` (the DB-CAS guarantee, via the fake).
  - **Crash-resume:** a partially-advanced job reloads at its cursor with the once-minted access key intact.
  - DB-backed `DeprovisionJobStore`: same claim/save/load contract.
  - `SecretStore`: put/get round-trip; **no-secret-in-logs** test (secrets never appear in captured log output; service-role key redacted).
  - `ControlPlaneService`: `listCustomers`/`getCustomerConnection` **omit secrets**; `setSubscriptionStatus` idempotent upsert + refuses unknown customer; `recordExportArtifact`/`listExportArtifacts`.
  - `purge-exports`: purges only due artifacts, counted outcome (purged/failed/skipped-missing), idempotent re-run, empty/zero-due clean result.
- **GATE-2b mutation checks** (confirm non-vacuous): (1) drop the CAS guard condition → the interleave test reddens; (2) drop the `retention_until < now` filter → purge-not-due test reddens; (3) let a service read return the secret column → the secret-omission test reddens; (4) split secrets but skip rejoin on load → crash-resume/round-trip reddens.
- **Opt-in fail-loud live smoke (`control-plane:live`):** against a throwaway control-plane project — apply schema, exercise the real Postgres conditional-write claim (two racing claims → one winner), record + purge a dummy artifact; fails loudly if `TB_CONTROL_PLANE_URL`/`_SERVICE_KEY` absent (never a silent skip). Destructive nothing (it's the operator project).
- **Public repo suite unchanged and green:** `deno task test` (backend, local stack, `TB_AI_PROVIDER=fake`) + `cd obsidian-plugin && npm test && npm run build` — Step 13 changes no public-repo runtime.
- **Every scenario in the delta spec is tagged `test`** (deterministic) — there is no LLM behavior in the control plane, so there is no `eval` tier here.
