## Context

Step 10 (`provisioning-automation`, in the private `terrestrial-brain-hosting` repo) provisions ONE customer brain end-to-end and records each run as a `ProvisioningJob` (with `projectRef` + `dbPassword`) in a job store keyed by customer id. Step 11 (`fleet-operations`) operates the resulting fleet (drift/migrate + monitor). Nothing yet **ends** a tenancy. Step 12 closes the lifecycle: when a customer cancels or exercises GDPR rights, deliver a complete, verified export of their data and then permanently delete their project.

This is the one operation in the whole product that is genuinely irreversible — deleting the wrong thing, or deleting before the customer has actually received their data, is unrecoverable. So the CLAUDE.md runs-twice / crashes-halfway / interleaves discipline is not optional here; it is the whole point.

**Where the code lives — recorded decision (project owner, unchanged from Steps 10 & 11):** the implementation goes in the SAME separate PRIVATE repo, `terrestrial-brain-hosting` (`~/Documents/Dev/terrestrial-brain-hosting`, local git for now, private GitHub remote later). This public repo (`terrestrial-brain`, FSL-1.1-MIT) keeps ONLY the OpenSpec artifacts, one `ThreatModel.md` entry (T27), and the plan checkbox. Rationale: deprovisioning deletes customer projects with the privileged Management token and reads *all* customer content into an export — hosted-business logic that must never ship under FSL in a public tree. Stack is Deno + TypeScript, reusing Steps 10/11's seam/fake discipline and single composition root.

**GDPR framing.** The `export` operation is data portability (Art. 20): the customer receives a complete, machine-readable dump. The `deprovision` operation's project deletion is erasure (Art. 17): the entire project — every table, every row of personal data — is destroyed. Together they complement fix-plan Step 25's per-note `forget_note` (the public repo's `note-deletion` capability) with a whole-account pathway. Neither adds a requirement to `note-deletion`; they sit alongside it.

**Constraints:** every external dependency behind a seam so the whole flow runs in tests with no network, no live Supabase org, no paid API; secrets in headers/env not URLs, never logged; bounded work; never swallow an error into a success; a partially-failing run returns its actual outcome; and — uniquely for this change — **never delete before a verified export, and never report success on the basis of a loop finishing.** Copies nothing from OB1.

## Goals / Non-Goals

**Goals:**
- A non-destructive `export`: produce a complete logical dump of a customer's brain, deliver it to the customer's configured destination, and **verify** the delivered artifact (checksum + byte count) before reporting success. Repeatable and side-effect-free.
- A destructive `deprovision`: export + verify + **then** delete the project, as an idempotent, resumable step-cursor state machine whose destructive step is gated on a verified export.
- Honest counted outcome: `deprovisioned` is reported only when the export verified AND the delete succeeded; any failure leaves a recoverable `failed` job with its error.
- Fleet consistency: a completed deprovision flips the provisioning job to a new `deprovisioned` status so Step 11's `done`-only fleet enumeration excludes the deleted project.
- Every new external dependency injected behind a 3–5 method interface with a deterministic fake; the whole flow is covered by integration tests touching zero live external systems.
- Reuse Steps 10/11's seams and composition root; add only the narrow new `DataExporter` port and a dedicated `DeprovisionJobStore`.

**Non-Goals:**
- **Not billing / cancellation triggers** (Steps 13–14) — Step 12 provides the `deprovision` operation; *what* invokes it on a payment cancellation (the control plane / Paddle webhook) is later. `deprovision` is a callable operation + CLI command, not a subscription listener.
- **Not restore / re-provision from an export** — the export is a portability/safety deliverable, not a backup TB itself restores. Re-provisioning a returning customer is a fresh Step 10 provision.
- **Not per-note or partial erasure** — that is the public repo's `forget_note` (fix-plan Step 25). Step 12 is whole-account only.
- **Not long-term export storage / lifecycle management** — Step 12 delivers to a destination and records a retention consideration; a full retention/rotation policy for delivered artifacts is a control-plane concern (Step 13) and is documented, not built here.
- **No change to the public repo's runtime** (no migration, no edge-function behavior, no plugin).

## Decisions

### D1: Two operations — non-destructive `export` and destructive `deprovision` — sharing one exporter
`export(customerId)` runs dump → deliver → verify and returns the manifest; it makes **no** destructive change and needs no claim/lease (re-running just delivers a fresh dump — inherently idempotent). `deprovision(customerId)` runs the full state machine (below) and is the only path that deletes.
- **Why:** an active customer can lawfully request their data (Art. 20) without ending their tenancy, and separating the two keeps the destructive path small and auditable. Both reuse the one `DataExporter`, so there is no duplicated dump logic (Rule of Three / transport-neutral core).
- **Alternative considered:** a single `deprovision --export-only` flag. Rejected — overloading the destructive command with a non-destructive mode invites a wrong-flag catastrophe (an operator omits the flag and deletes when they meant to export). Two named commands make intent explicit.

### D2: The deprovision state machine — `EXPORT_DATA → VERIFY_EXPORT → DELETE_PROJECT → FINALIZE` — with the destructive step gated on a verified export
`deprovision` is a step-cursor state machine (mirroring Step 10's `ProvisioningJob`) over a dedicated `DeprovisionJob`. `DELETE_PROJECT` is **unreachable** until `VERIFY_EXPORT` has completed on the persisted cursor. The export manifest is persisted ON the job when `EXPORT_DATA` completes, BEFORE the delete.
- **Why:** the CLAUDE.md multi-step-mutation rule, applied to the one irreversible operation. Ordering export-then-delete so a crash leaves a RECOVERABLE state (never delete-then-write): crash before a verified export ⇒ project intact, re-run re-exports; crash after the manifest is persisted ⇒ re-run resumes at delete without redoing the export; crash mid-delete ⇒ re-run's delete is idempotent (D5). The gate makes "we deleted before the data was safely out" structurally impossible, not merely unlikely.
- **Alternative considered:** delete first, export from a final backup. Rejected outright — it is the delete-then-write anti-pattern on customer data; any failure to produce the post-delete export is unrecoverable data loss.

### D3: A dedicated `DeprovisionJob` + `DeprovisionJobStore` seam; the provisioning record is read, not overloaded
Deprovision owns its own job type and store (own status set `pending|running|done|failed`, own cursor, its own atomic `claim` for idempotency, and the persisted `exportManifest`). It reads the customer's `projectRef` + `dbPassword` once from the injected `ProvisioningJobStore.load(customerId)` (the authoritative record of what Step 10 built) and, on `FINALIZE`, flips that provisioning job's status to `deprovisioned`.
- **Why:** the provisioning `claim` semantics (absent/failed → running) are about *provisioning*; reusing them for a different lifecycle would muddy both state machines. A separate store keeps each claim honest and each job small. The provisioning store remains the single source of truth for `projectRef`/`dbPassword` (no copy drift), and flipping its status is the minimal change that keeps the fleet (Step 11) consistent.
- **Alternative considered:** add deprovision fields + statuses onto `ProvisioningJob` and reuse `ProvisioningJobStore.claim`. Rejected — it couples two lifecycles and forces `claim` to serve two masters. The only cross-store touch (`ProvisioningStatus` gains `deprovisioned`) is additive and required for fleet consistency regardless.

### D4: `DataExporter` port — `export` delivers a complete dump + returns a verifiable manifest; `verify` re-reads to confirm integrity
New port `DataExporter` with exactly two purpose-specific methods: `export(params): Promise<ExportManifest>` (produce a complete logical dump of the project, deliver it to the customer's destination under `TB_EXPORT_DIR`, and return `{ location, sha256, byteCount, tableRowCounts }`) and `verify(manifest): Promise<VerifyResult>` (re-read the delivered artifact and confirm its size + checksum match the manifest). The real adapter runs a full logical dump (`pg_dump`/`supabase db dump`) using the persisted db password, streamed to the destination; the fake produces a deterministic manifest and can be scripted to fail or to deliver a tampered/truncated artifact.
- **Why:** producing the dump (a subprocess against the project DB) and confirming the delivered bytes are intact are two real external interactions, but they are one concern (the export subsystem) — one narrow port with two methods keeps it seamed and testable without over-splitting for an M-sized change. The manifest carries only location + checksum + counts (never content) so it is safe to persist and log. Parse-at-boundary: any adapter output is validated into the typed `ExportManifest`, never cast.
- **Alternative considered:** stream every table through the Management API database-query endpoint (like Step 11's `FleetInspector`) and assemble JSON in the hosting host. Rejected as the primary path — it pulls all content through the hosting process (a larger content-exposure and memory surface) and re-implements what a logical dump already does correctly and restorably. `FleetInspector`'s content-free reads stay content-free; the content-bearing export is a distinct, purpose-built seam.
- **Alternative considered:** verify by trusting the exporter's return value. Rejected — a truncated or failed delivery that still "returned a manifest" must not unlock the delete. `verify` re-reads the *delivered* artifact so the gate tests reality, not a promise.

### D5: `DELETE_PROJECT` reuses `SupabaseManagementApi.deleteProject` — idempotent, single-ref, best-effort-safe on re-run
The destructive step calls the existing `deleteProject(projectRef)` for the single `projectRef` read from the customer's own provisioning job — no bulk, no wildcard. Supabase project deletion is idempotent from our side: a re-run after a partial delete either deletes the remaining project or finds it already gone; a "not found" on re-run is treated as success (the erasure goal is met).
- **Why:** reuse the audited Step 10 seam; idempotency gives crash-resume safety for free. Scoping to the one ref from the customer's own record makes a mis-targeted delete structurally impossible.

### D6: Honest counted outcome — `deprovisioned` only when export verified AND delete succeeded
The operation returns a typed result: `{ customerId, status: "deprovisioned" | "failed", exportManifest, deletedProjectRef, error }`. `deprovisioned` is set only after `FINALIZE`; any step throwing records `failed` with the error on the persisted cursor and the CLI exits non-zero. Success is never asserted from the loop reaching its end.
- **Why:** CLAUDE.md — "a function that can partially fail must RETURN its outcome and count successes from what ACTUALLY succeeded; never print '✅ complete' just because a loop reached its end." For a destructive op this is the difference between "the customer's data is safely out and the project is gone" and a silent half-done state.

### D7: Guards on the customer's provisioning state — not-found and non-`done` are reported, never a silent skip or a blind delete
`deprovision`/`export` first load the provisioning job. **No provisioning record** ⇒ reported "customer not found," non-success, nothing deleted. Provisioning status **not `done`** (still `running`/`failed`/`rolled_back`) ⇒ refused with a clear message (an orphaned/failed provision is Step 10 `rollback`'s job, not deprovision's) — nothing deleted. Status **already `deprovisioned`** ⇒ idempotent success (no re-export, no re-delete).
- **Why:** distinguish empty from broken (CLAUDE.md); a deprovision must never guess a `projectRef` or act on an incomplete provision, and a repeat request on an already-erased customer must be a clean no-op, not an error or a double-delete.

### D8: Reuse Steps 10/11's composition root and config; add `TB_EXPORT_DIR` and wire the exporter + deprovision store there only
`composition-root.ts` gains the `DataExporter` adapter and the `DeprovisionJobStore` file adapter, wired from the same validated `HostingConfig`. One new **non-secret** config value, `TB_EXPORT_DIR` (parse-at-boundary, default `./exports`), sets the delivery destination. `cli.ts` gains `export` and `deprovision` subcommands (with `--customer`). No new secret, no second composition root.
- **Why:** one composition root (CLAUDE.md); deprovision reuses the exact Management token + db password Step 10 already validates. The only new configuration is where dumps are delivered.

### D9: Where the ThreatModel entry lives
The deprovision/export threat entry (**T27**) is added to the **public repo's** `ThreatModel.md`, next to Steps 10/11's T25/T26 — it documents security posture, not business logic, and keeps the single project-wide threat register intact. The hosting README cross-references it.

## User-error & edge scenarios (and how the system handles each)

| Scenario | Handling |
|---|---|
| Deprovision a customer with **no provisioning record** | Reported "customer not found," non-success exit; nothing exported, nothing deleted (D7). |
| Deprovision a customer whose provisioning status is **not `done`** (running/failed/rolled_back) | Refused with a clear message pointing at Step 10 `rollback` for orphans; nothing deleted (D7). |
| Deprovision a customer **already `deprovisioned`** | Idempotent success — no re-export, no second delete (D7, D5). |
| **Export delivery fails or is truncated** (verify mismatch) | `VERIFY_EXPORT` fails ⇒ job `failed`, `DELETE_PROJECT` never reached, project intact; error surfaced; re-run re-exports (D2, D4). |
| **Export destination unwritable** | `EXPORT_DATA` fails at the boundary with a clear error naming the destination; nothing deleted (D4, D8). |
| **Crash after a verified export, before delete** | Manifest persisted on the job ⇒ re-run resumes at `DELETE_PROJECT`; the export is not redone destructively (D2). |
| **Crash mid-delete** | Re-run's `deleteProject` is idempotent; a "not found" is treated as success (D5). |
| **Two concurrent deprovision runs** for one customer | Atomic `claim` on the deprovision job ⇒ one runs, the other gets `in_progress`; never two deletes (D3). |
| **`export` (non-destructive) requested repeatedly** | Each run delivers a fresh, verified dump; no state machine, no lock; side-effect-free (D1). |
| **Manifest/verify result malformed** | Parsed at the boundary (typed `ExportManifest`/`VerifyResult`); an unparseable result fails `VERIFY_EXPORT` (⇒ no delete), never a silent pass (D4). |

## Security analysis (feeds ThreatModel T27)

- **Content-bearing export is a new personal-data flow (contrast fleet ops' content-free reads).** Mitigations: the dump is delivered to a controlled, access-restricted per-customer destination (`TB_EXPORT_DIR`, artifact written `0600`); the persisted/logged manifest records only location + `sha256` + byte/row counts, never note or thought content; the redacting logger (reused) plus a no-secret/no-content-in-logs test keep both secrets and content out of log output.
- **Destructive delete with the privileged Management token.** Mitigations: the token is env-only, `Authorization: Bearer`, never in a URL, never logged (reused Step 10 handling); the delete is scoped to the single `projectRef` from the customer's own provisioning job (no bulk/wildcard); it is idempotent and gated behind a verified export (D2/D4/D5), so the blast radius is exactly one already-exported project.
- **Deleting before the data is safely out (the catastrophic failure).** Mitigation: the `VERIFY_EXPORT`-before-`DELETE_PROJECT` gate (D2) makes delete-then-lose-data structurally impossible; verification re-reads the delivered artifact, so a truncated/failed delivery cannot unlock the delete.
- **Dishonest completion (a green run hiding a half-done deprovision).** Mitigation: the counted outcome + non-zero exit on any failure (D6); `deprovisioned` is set only after both export-verified and delete-succeeded.
- **db password handling for the dump subprocess.** Mitigation: the per-customer db password is passed to the dump process via the environment (`PGPASSWORD`-style), never as a command-line argument (argv is world-readable via `ps`) and never logged; it is read from the provisioning store, used, and discarded.
- **GDPR retention of the delivered export.** Consideration (documented, not a runtime control here): the delivered artifact is itself personal data held by the hosting side; the retention/rotation policy for delivered exports is a control-plane concern (Step 13). Step 12 minimizes by delivering to the customer's destination and recording only a content-free manifest; the ThreatModel notes the open retention item.
- **Wrong-customer / wrong-project targeting.** Mitigation: `projectRef` is never an operator free-text input to the delete — it is read from the named customer's provisioning record (D5/D7); a not-found or non-`done` customer is refused, never guessed.

## Test Strategy

Layers (per CLAUDE.md gates), all in the hosting repo's own suite (`deno task test`):
- **Unit:** deprovision cursor/`nextStep` progression and `isComplete`; export-manifest hashing/byte-count; `verify` pass vs tamper/truncation detect; the not-found / non-`done` / already-`deprovisioned` guards (D7); the counted-outcome/result mapping (D6).
- **Integration (real deprovision state machine + real job stores, fakes ONLY at the genuine external boundary — `DataExporter`, `SupabaseManagementApi`, clock, logger; no mock on the tested path):**
  - **deprovision happy path:** export delivered + verified ⇒ `deleteProject` called exactly once ⇒ provisioning job flipped to `deprovisioned` ⇒ result carries the manifest and `deprovisioned` status.
  - **delete gated on verify (the core safety property):** `verify` fails ⇒ `deleteProject` is **never** called, job `failed`, project intact.
  - **crash-resume (never delete-then-lose-data):** interrupt after `EXPORT_DATA` (manifest persisted) ⇒ re-run resumes at `VERIFY_EXPORT`/`DELETE_PROJECT` and does not re-export destructively; interrupt after delete ⇒ re-run is an idempotent no-op.
  - **idempotency / runs-twice:** concurrent `claim` ⇒ exactly one run deletes, the other reports `in_progress`; a second full run on an already-`deprovisioned` customer neither re-exports nor re-deletes.
  - **guards:** not-found customer ⇒ reported, non-success, no delete; non-`done` provisioning ⇒ refused, no delete.
  - **export-only command:** dump + verify, **zero** `deleteProject` calls, returns the manifest; repeatable.
  - **no-secret / no-content in logs:** a full deprovision emits no Management token, no db password, and no dumped content.
- **GATE-2b mutation check:** removing the `VERIFY_EXPORT`-before-`DELETE_PROJECT` gate (delete regardless) reddens the gated-delete test; removing "persist the manifest before delete" reddens the crash-resume test; replacing the counted outcome with a loop-end "success" reddens the dishonest-completion test; removing the `done`-status guard reddens the non-`done` test; collapsing `verify` into "trust the manifest" reddens the tamper-detect test.
- **Live smoke (opt-in, fail-loud, NOT in the default suite):** `export:live` runs a **non-destructive** real dump+verify against a throwaway project when `TB_MGMT_API_TOKEN` + a real project are present; absent creds ⇒ fails loudly, never a silent skip. The destructive `deprovision` live path is documented as a manual, throwaway-only smoke (never automated in the default opt-in) because it deletes.

The public repo's suite (`deno task test`, plugin) is unaffected and must stay green — this change adds no runtime code there.

## Risks / Trade-offs

- **[The delivered export is itself retained personal data]** → mitigated by content-free manifests + delivery to the customer's destination + `0600` at rest; a full retention/rotation policy is deferred to Step 13's control plane and recorded as an open item (T27).
- **[Deprovision job store is the interim file store]** → acceptable; mirrors Step 10's interim store and is swapped by Step 13's control plane with no state-machine change. Bounded by the number of deprovisioning customers.
- **[`pg_dump`/CLI shape or auth may drift]** → isolated to the one `DataExporter` adapter; the manifest is parsed at the boundary so a shape/format change fails loudly rather than silently delivering a bad dump; the deterministic fake-backed tests are the always-run coverage and the opt-in `export:live` gives real-system confidence.
- **[No default live E2E for the destructive path]** → deliberate (it deletes); mitigated by exhaustive fake-backed integration coverage of the gate/resume/idempotency properties plus the non-destructive `export:live` smoke. The destructive smoke is manual and throwaway-only.
- **[`deprovisioned` status added to `ProvisioningStatus`]** → additive; Step 11's `done`-only fleet filter already excludes it, and no existing code branches on the absence of the new value. Required for fleet consistency regardless.

## Migration Plan

- **Deploy:** none to shared infra. "Use" = pull the private `terrestrial-brain-hosting` repo, set the same env as Steps 10/11 plus `TB_EXPORT_DIR` (delivery destination), then `deno task export --customer <id>` (non-destructive) or `deno task deprovision --customer <id>` (destructive).
- **Rollback:** `export` is non-destructive (nothing to roll back). `deprovision`'s project deletion is intentionally irreversible (that is the erasure guarantee) — the safety mechanism is the pre-delete verified export, not a post-delete undo. A deprovision that failed before delete leaves a recoverable `failed` job that a re-run completes; a returning customer is a fresh Step 10 provision.
- **Public repo:** merges only the OpenSpec artifacts, the ThreatModel T27 entry, and the plan checkbox — reversible by revert with zero runtime impact.

## Open Questions

- Exact dump mechanism for the real adapter (`supabase db dump` via the CLI vs direct `pg_dump` with a pooler connection string) — resolve during apply; both sit behind the same `DataExporter` seam and the fake-backed tests are mechanism-agnostic. The choice must keep the db password out of argv (environment only).
- Delivery destination beyond a local directory (customer-supplied object-storage bucket / signed URL) — `TB_EXPORT_DIR` (local) is the Step 12 target; a pluggable delivery sink is a natural later extension behind the same port.
- Retention/rotation policy for delivered export artifacts — deferred to Step 13's control plane; recorded as the T27 open item.
