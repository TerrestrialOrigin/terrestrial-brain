## Context

Step 13 built the durable control plane in the private `terrestrial-brain-hosting` repo: `customers` (with a `subscription_status` of `active | past_due | paused | canceled | none`), `customer_projects` (the provisioning record), `project_secrets`, `deprovision_jobs`, `export_artifacts`, plus a transport-neutral `ControlPlaneService`. That service already exposes `setSubscriptionStatus(customerId, status)` — an idempotent upsert that refuses an unknown customer — and its header comment explicitly reserves it for "the Paddle billing webhooks (Step 14)." Steps 10 and 12 provide the two pipelines a billing lifecycle must drive: `provision(request, deps)` → `{ customerId, projectRef, mcpUrl, accessKey }` (idempotent, resumable, interleave-safe via an atomic claim + lease) and `deprovision(request, deps)` (export → verify → delete → finalize, the destructive delete structurally gated on a verified export).

What is missing is the bridge: a receiver for Paddle's webhooks that verifies they are genuine, handles Paddle's at-least-once redelivery without acting twice, and maps each payment-lifecycle event onto those pipelines and the subscription status. Constraints inherited from Steps 10–13: Deno + TypeScript; every external dependency behind a narrow injected seam wired at the one composition root; a deterministic fake so the whole suite runs with no live Supabase, no network, and no paid API; parse-at-boundary on all external data; runs-twice / crashes-halfway / interleaves designed for; secrets env-only, `Authorization: Bearer`, never in a URL, never logged; the code lives only in the private repo (this public repo gets artifacts + one ThreatModel entry + the plan checkbox).

## Goals / Non-Goals

**Goals:**
- Verify every inbound webhook's Paddle signature (HMAC-SHA256, constant-time, freshness-bounded) before any parsing or side effect.
- Parse the webhook body at the boundary into a known-good discriminated union; refuse an event with no resolvable customer; ignore-and-acknowledge unrecognised event types.
- Handle Paddle's at-least-once delivery idempotently: a redelivered event id is a no-op that still acknowledges (200).
- Map the payment lifecycle onto the existing pipelines and control plane: checkout/activation → provision + `active`; payment failure → pause project + `paused`; cancellation → deprovision + `canceled`; resume → restore + `active`.
- Write the mapping logic **once** in a transport-neutral `BillingService` so the HTTP receiver (and any future dashboard action) is a thin adapter.
- Run the whole flow deterministically in tests via fakes (signature verifier, triggers, management API, control-plane client); opt-in fail-loud live smoke for real-system confidence.

**Non-Goals:**
- **Paddle checkout / catalog / API calls** — Step 14 is webhook-inbound only. No Paddle REST client, no price/product management, no client-side checkout (that is Step 16 onboarding). No Paddle API key is introduced.
- **The onboarding UI** (Step 16) and **the dashboard** (Step 17) — Step 14 is the backend the webhook drives; no UI ships.
- **Managed-AI usage metering / quota billing** (Step 15).
- **Dunning / grace-period policy design** — we map the events Paddle emits after its own dunning; we do not implement our own retry schedule. The pause-vs-cancel timing is Paddle's.
- **Rewriting the provisioning/deprovision pipelines** — unchanged; invoked through trigger seams.
- **A durable outbound job queue / worker framework** — provisioning is already a resumable, idempotent pipeline; the trigger seam decides inline-vs-worker execution (D5) without a new queue system.

## Decisions

### D1 — Signature verification is a seam; HMAC-SHA256 over `ts:rawBody`, constant-time, freshness-bounded
Paddle signs each webhook with a `Paddle-Signature: ts=<unix>;h1=<hex-hmac>` header, where `h1` is `HMAC-SHA256(secret, "<ts>:<rawBody>")`. Verification MUST run on the **raw** request body (not a re-serialised parse — re-serialisation changes bytes and breaks the HMAC). A new `PaddleSignatureVerifier` port (`verify(rawBody, signatureHeader, nowMs): boolean`) isolates this: the real adapter uses Web Crypto (`crypto.subtle.importKey`/`sign`) + `@std/encoding` (already a dependency) for hex, compares in **constant time** (compare full-length digests, never an early-return `===`), and rejects when the header is malformed, the digest mismatches, or `|nowMs − ts|` exceeds a bounded window (replay defence). The fake lets tests drive verified/rejected deterministically without real signatures. **Why a seam:** signing is an external-contract dependency; putting it behind a port keeps the whole webhook flow unit-testable and means a future signing-scheme change is one adapter, not a rewrite.

### D2 — Parse-at-boundary into a discriminated union; refuse no-customer; ignore-and-ack unknown types
The webhook JSON is external data. After signature verification it is parsed **once** with Zod into a known-good `PaddleEvent` discriminated union carrying only the fields we use: `eventId`, `eventType`, and the resolved `{ customerId, region, email }`. The internal `customerId` (our key, threaded from onboarding) and `region` are read from Paddle `custom_data`; an event whose `custom_data` yields no customer id is a **refusal** (a loud, non-acting error — never invent a customer, per the same rule as `setSubscriptionStatus`). Event types we do not act on parse to `{ kind: "ignored" }` and are **acknowledged (200)**, so Paddle stops redelivering them; only a signature failure or an unparseable/refused body is a non-200. **Why parse-don't-cast:** a hallucinated or malformed payload must fail at the door, not flow an `as`-cast value into `provision`/`deprovision`.

### D3 — At-least-once idempotency via a `webhook_events` claim (atomic insert-if-absent)
Paddle delivers at least once and retries on any non-2xx. A new control-plane table `webhook_events (event_id primary key, event_type, received_at_ms)` records processed events; `ControlPlaneClient.claimWebhookEvent(eventId, eventType, nowMs): Promise<boolean>` performs a **single atomic insert-if-absent** (Postgres `insert … on conflict do nothing returning`), returning `true` on the first delivery (claimed → process) and `false` on every redelivery (already processed → skip, still 200). This is the runs-twice invariant moved to the database: the DB, not the app, decides which delivery is first. The in-memory fake models the same guard (insert only if the id is absent). **Why a dedicated events table over relying on downstream idempotency:** provisioning and the subscription upsert are already idempotent, but pause/resume/deprovision-trigger are side effects whose *repetition* we want to suppress cheaply and audibly; the event claim is the single, uniform idempotency boundary for all of them, and it doubles as an audit trail.

### D4 — Transport-neutral `BillingService`; the HTTP receiver is a thin adapter (Rule of Three)
All webhook logic lives in `BillingService.handleWebhook(rawBody, signatureHeader, nowMs): Promise<WebhookOutcome>`: verify (D1) → parse (D2) → claim-event (D3) → dispatch (D6), returning a transport-neutral `WebhookOutcome` (`{ status: "ok" | "ignored" | "duplicate" | "rejected-signature" | "bad-request", detail }`). The `billing serve` `Deno.serve` handler is the **only** HTTP code: it reads the raw body + `Paddle-Signature` header, calls `handleWebhook`, and maps the outcome to a status code (`ok`/`ignored`/`duplicate` → 200; `rejected-signature` → 401; `bad-request` → 400). **Why:** the webhook handler and any future dashboard/manual-replay entry point are two entry points onto the same lifecycle logic; writing it once (transport-neutral) means they can never drift and the logic is fully testable with no HTTP.

### D5 — Pipeline invocation through narrow `ProvisioningTrigger` / `DeprovisionTrigger` seams; ack fast, execute out-of-band
Provisioning takes ~2 minutes and Paddle expects a prompt 2xx (it retries otherwise). So the webhook MUST NOT block on a full provision. Two narrow ports — `ProvisioningTrigger.request(customerId, region)` and `DeprovisionTrigger.request(customerId)` — decouple "the payment lifecycle requests provisioning/deprovisioning" from "the pipeline runs." The billing service does the **fast** control-plane writes (ensure customer, set status, claim event) inline and returns 200; the trigger kicks off the long pipeline out-of-band. Because `provision`/`deprovision` are already idempotent + resumable (customer-id-keyed atomic claim, persisted cursor), a trigger that fires-and-forgets and dies is recovered by a re-delivery or an operator re-run — no work is lost or duplicated. In tests the fake trigger **records** the request (so "checkout triggered provisioning for customer X in region Y" is asserted directly); the real adapter wires to the Step 10/12 pipelines. **Why a seam and not a direct call:** a direct `provision(...)` call would couple the billing service to the whole `StepDeps` bundle and make the "was it triggered?" assertion depend on the entire pipeline; the one-method trigger is the right test seam and the natural place to choose inline-vs-worker execution later. *(Counter-rule check: these are not speculative — the billing service genuinely needs to invoke a long external pipeline without blocking or pulling in its full deps; that is a real boundary today.)*

### D6 — The event → action mapping
Dispatch on the parsed event kind, all writes idempotent:
- **`transaction.completed` / `subscription.activated`** → `ensureCustomer(customerId, email)`; `setSubscriptionStatus(active)`; if the customer's provisioning row is not `done`, `provisioningTrigger.request(customerId, region)` (idempotent — a `done` job returns its result); if the customer was `paused`, also `managementApi.restoreProject(ref)` (recovered subscription). New customers thus get provisioned; a recovered paused customer is restored.
- **`transaction.payment_failed` / `subscription.past_due`** → resolve the customer's `projectRef` via the control-plane service; if present, `managementApi.pauseProject(ref)`; `setSubscriptionStatus(paused)`. (Plan: "Payment failure → pause project.")
- **`subscription.resumed`** → same as activation's recovered branch: `restoreProject(ref)` if paused, `setSubscriptionStatus(active)`.
- **`subscription.canceled`** → `setSubscriptionStatus(canceled)`; `deprovisionTrigger.request(customerId)` (Step 12 pathway — exports-then-deletes, so the data is preserved in the verified export before deletion).
- **anything else** → ignored + 200.
An action targeting a customer with no control-plane record surfaces `CustomerNotFoundError` from the service (for status writes) and a refusal from the parser (for missing custom_data) — never a silent create.

### D7 — Config: `TB_PADDLE_WEBHOOK_SECRET` (secret, conditionally required) + `TB_PADDLE_DEFAULT_REGION`
Added to the existing `loadConfig` Zod schema. `TB_PADDLE_WEBHOOK_SECRET` is required only when the `billing` command runs (mirroring how the control-plane vars are conditionally required via `.superRefine`), is added to `secretValues()` so the redacting logger scrubs it, and travels only in the verifier (never a URL, never logged). `TB_PADDLE_DEFAULT_REGION` (parsed against the existing region allowlist) is the fallback when `custom_data` omits a region. Parse-don't-cast throughout.

### D8 — Management-API pause/restore added to the existing seam
`pauseProject(projectRef)` and `restoreProject(projectRef)` are added to the `SupabaseManagementApi` port (the real adapter calls the Management API pause/restore endpoints with the Bearer token in a header; the `FakeManagementApi` records the calls). This extends one existing seam rather than inventing a new one, and keeps the billing service infra-neutral: it asks the management API to pause/restore, and asserts against the fake in tests.

## Risks / Trade-offs

- **[An internet-facing webhook triggers money-relevant + destructive actions]** → Signature verification (D1) gates everything: no valid HMAC over the raw body, no action. Freshness window bounds replay; the event-claim (D3) bounds redelivery. Covered by ThreatModel **T29**.
- **[Cancellation → deprovision deletes a customer's project]** → The deprovision pathway (Step 12) **exports and verifies before it deletes**, so cancellation never destroys data that wasn't first captured in a verified export; the delete is scoped to the customer's own `projectRef`. The pause-then-cancel *timing* is Paddle's dunning, not ours (a failed payment pauses first; only a terminal cancellation deprovisions).
- **[Webhook must ack fast but provisioning is slow]** → D5: fast inline control-plane writes + 200, long pipeline out-of-band through the trigger seam; idempotent + resumable pipelines make a lost trigger recoverable by redelivery/re-run.
- **[Pausing a running project is disruptive]** → Pause is driven only by Paddle's payment-failure events (post-dunning), is reversible (`restoreProject` on resume/recovered payment), and the subscription status tracks it (`paused`↔`active`) so the state is always legible.
- **[Signature verify is only truly meaningful against real Paddle signatures]** → Same discipline as Steps 10–13: the fake models the verified/rejected outcomes for logic tests, and an opt-in fail-loud `billing:live` smoke verifies the real HMAC path end-to-end. The real adapter's HMAC is also unit-tested against a known secret/body/expected-digest vector (a self-contained crypto test, no network).
- **[A malformed / spoofed-shape payload]** → Parse-at-boundary (D2) rejects it with a 400 before any side effect; unknown event types are ignored-and-acked, not errored.

## User-error scenarios

- **Operator runs `billing serve` without `TB_PADDLE_WEBHOOK_SECRET`** → `loadConfig` fails fast naming the missing variable (conditional requirement, parse-at-boundary); the server never starts half-wired.
- **A request arrives with a missing/garbled `Paddle-Signature` header** → rejected as `rejected-signature` (401) before parsing; no side effect.
- **A replayed (captured) request outside the freshness window** → rejected on the timestamp check even if the HMAC once matched.
- **The same event delivered twice (Paddle at-least-once, or an operator manual re-send)** → the first claims and processes; the second is a `duplicate` no-op that still returns 200 (D3).
- **A webhook for a customer with no `custom_data` customer id** → refused as `bad-request` (400); no customer invented, no pipeline triggered.
- **A `subscription.canceled` for a customer who was never provisioned** → deprovision's own guard (`resolveTarget` → not-found / not-deprovisionable) reports it; nothing is deleted, and the status still moves to `canceled`.
- **A `transaction.completed` redelivered after provisioning already finished** → the event-claim skips it; even absent that, `provision`'s claim returns `already_done` (double idempotency).
- **An unrecognised Paddle event type** (e.g. `address.updated`) → ignored + 200, so Paddle stops retrying and no noise is logged as an error.

## Security analysis (ThreatModel T29)

New surface: an internet-facing HTTP endpoint whose events cause provisioning (spend), pausing, and **deprovisioning (data deletion)**. Threats & controls:
- **Forged webhook → unauthorised provision/deprovision.** HMAC-SHA256 signature verification over the raw body with the configured secret, constant-time compare (D1); no valid signature ⇒ 401, no side effect.
- **Replay of a captured valid webhook.** Bounded timestamp-freshness window (D1) + the at-least-once event-claim (D3) so even a same-event replay is a no-op.
- **Event / customer spoofing to deprovision a victim.** The customer id comes from signed `custom_data`; a forged body fails the signature; deprovision is scoped to the customer's own `projectRef` and Step 12 exports-then-verifies before deleting (no unverified destruction).
- **Webhook-secret exposure.** `TB_PADDLE_WEBHOOK_SECRET` is env-only, in `secretValues()` (redacted from all logs), never in a URL, used only inside the verifier.
- **Malformed payload crashing far from cause.** Parse-at-boundary (D2) rejects at the door; unknown types ignored-and-acked.
- **DoS via unbounded redelivery / retries.** Idempotent claim makes redelivery cheap; the receiver does only fast writes inline (long work is out-of-band, D5), so a retry storm doesn't fan out into duplicate provisions.
This entry lands in the public repo's `ThreatModel.md` as **T29**; it consumes T28's control plane and complements T27's deprovision surface (the webhook is a new *trigger* for the Step 12 pathway, whose delete-after-verified-export guarantee is unchanged).

## Test Strategy

All deterministic tests run against fakes (`FakePaddleSignatureVerifier`, `FakeProvisioningTrigger`, `FakeDeprovisionTrigger`, `FakeManagementApi`, `InMemoryControlPlaneClient`) — **no live Paddle, no live Supabase, no network, no paid API** — exactly the Steps 10–13 discipline. Layers:
- **Unit (`test/unit/`):** the real HMAC adapter against a known `(secret, ts, body) → digest` vector (verified pass) and tampered body/secret/ts (verified fail, freshness-window reject); constant-time compare exercised; the Paddle event parser (each acted-on type → its union member; missing-customer → refusal; unknown type → ignored); config parse (secret conditionally required, default-region parse); the `webhook_events` claim fake (first → true, redelivery → false).
- **Integration (`test/integration/billing.test.ts`, real `BillingService` + real control-plane service/store, fakes only at the external boundaries):**
  - **checkout → provision:** a verified `transaction.completed` for a new customer ensures the customer, sets `active`, and records a provisioning-trigger request for `(customerId, region)`; the connection read shows `active`.
  - **payment failure → pause:** a verified `transaction.payment_failed` pauses the project (fake management API records `pauseProject(ref)`) and sets `paused`.
  - **cancellation → deprovision:** a verified `subscription.canceled` sets `canceled` and records a deprovision-trigger request.
  - **resume → restore:** a verified `subscription.resumed` for a paused customer restores the project and sets `active`.
  - **idempotency:** the same event id delivered twice → one set of side effects, both calls report success (second = `duplicate`).
  - **signature reject:** an unverified webhook → `rejected-signature`, zero side effects, no event claimed.
  - **bad request:** a verified event with no customer id → `bad-request`, zero side effects.
  - **unknown type:** a verified unrecognised event → `ignored`, zero side effects, still claimed-or-acked.
- **GATE-2b mutation checks** (confirm non-vacuous): (1) make the verifier always return true → the signature-reject test reddens; (2) make `claimWebhookEvent` always return true → the idempotency test reddens (side effects run twice); (3) drop the pause call in the payment-failure branch → the pause test reddens; (4) short-circuit the parser's no-customer refusal → the bad-request test reddens.
- **Opt-in fail-loud live smoke (`billing:live`):** against a throwaway control-plane project + a locally-computed real Paddle-style signature — starts the receiver, posts a genuinely-signed event, asserts the mapped outcome; fails loudly if `TB_PADDLE_WEBHOOK_SECRET` / control-plane creds are absent (never a silent skip). Non-destructive (uses fake triggers or a throwaway customer).
- **Public repo suite unchanged and green:** `deno task test` (backend, local stack, `TB_AI_PROVIDER=fake`) + `cd obsidian-plugin && npm test && npm run build` — Step 14 changes no public-repo runtime.
- **Every scenario in the delta spec is tagged `test`** (deterministic) — the billing mapping has no LLM behavior, so there is no `eval` tier.

## API contract

The webhook receiver is the only external interface. `POST /` (the `billing serve` endpoint):
- **Request:** raw JSON body (a Paddle webhook event); header `Paddle-Signature: ts=<unix-seconds>;h1=<hex-hmac-sha256>`.
- **Responses:** `200` for a handled, ignored, or duplicate event (Paddle stops retrying); `400` for a verified-but-unparseable or no-customer event; `401` for a missing/invalid/stale signature. The body is a small JSON `{ outcome, detail }` for operator/debugging visibility (never echoing secrets or customer content).
- **Idempotency:** keyed on the Paddle `event_id`; safe under at-least-once redelivery.
This contract is internal to the hosting repo (Paddle → the receiver); it introduces no new public-repo API and no change to the MCP edge function.
