# Tasks — Step 14 Paddle billing (`paddle-billing`)

> All code lands in the PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting` (branch `feature/PaddleBilling`). This public repo gets only: this artifact set, `ThreatModel.md` T29, and the Step-14 checkbox. Follow the Steps 10–13 seam/fake, parse-at-boundary, runs-twice/crashes-halfway/interleaves discipline. Tests are written to fail RED first where they assert new behavior, then made green.

## 1. Config (parse-at-boundary)

- [x] 1.1 Extend `src/config.ts`: add `TB_PADDLE_WEBHOOK_SECRET` (nonEmpty, optional at the schema level, required via `.superRefine` when the `billing` command runs) and `TB_PADDLE_DEFAULT_REGION` (parsed against the region allowlist, sensible default) to the Zod schema + `HostingConfig`; add the webhook secret to `secretValues()`.
- [x] 1.2 Update `.env.example` + README env table with the two new vars and a "the webhook secret comes from the Paddle dashboard" note.

## 2. Signature verification seam

- [x] 2.1 Add `src/ports/paddle-signature-verifier.ts`: `PaddleSignatureVerifier.verify(rawBody, signatureHeader, nowMs): Promise<boolean>` (or sync) — the narrow seam.
- [x] 2.2 Add `src/adapters/paddle-signature-verifier-hmac.ts`: real Web-Crypto HMAC-SHA256 over `"<ts>:<rawBody>"`, parse the `ts=…;h1=…` header, constant-time digest compare (full-length, no early return), reject on malformed header / mismatch / stale timestamp (bounded freshness window). Use `@std/encoding` for hex.
- [x] 2.3 Add a deterministic `FakePaddleSignatureVerifier` in `test/fakes/fakes.ts` (scriptable verified/rejected).

## 3. Paddle event parsing (parse-at-boundary)

- [x] 3.1 Add `src/billing/paddle-event.ts`: a Zod parser mapping the raw webhook JSON into a `PaddleEvent` discriminated union — `provision` (`transaction.completed`/`subscription.activated`), `pause` (`transaction.payment_failed`/`subscription.past_due`), `resume` (`subscription.resumed`), `deprovision` (`subscription.canceled`), and `ignored` (any other type). Resolve `{ customerId, region, email }` from `custom_data` (region falls back to `TB_PADDLE_DEFAULT_REGION`); a missing customer id yields a refusal (a distinct parse result, not an exception that loses the event id).

## 4. Idempotency: the `webhook_events` claim

- [x] 4.1 Add the `webhook_events` table (`event_id` PK, `event_type`, `received_at_ms`) to `control-plane/schema.sql` (idempotent `create table if not exists`; RLS enabled, no policies, grants revoked — service-role only, matching the other tables).
- [x] 4.2 Add `claimWebhookEvent(eventId, eventType, nowMs): Promise<boolean>` to the `ControlPlaneClient` port; implement it in `SupabaseControlPlaneClient` as a single `insert … on conflict do nothing returning` (true = claimed, false = already seen); model the same insert-if-absent guard in `InMemoryControlPlaneClient`.

## 5. Management-API pause/restore

- [x] 5.1 Add `pauseProject(projectRef)` / `restoreProject(projectRef)` to the `SupabaseManagementApi` port; implement them in `HttpManagementApi` (Bearer token in header, ref never in a logged URL); record the calls in `FakeManagementApi`.

## 6. Pipeline trigger seams

- [x] 6.1 Add `src/ports/provisioning-trigger.ts` (`request(customerId, region): Promise<void>`) and `src/ports/deprovision-trigger.ts` (`request(customerId): Promise<void>`); real adapters wrap the Step 10 `provision` / Step 12 `deprovision` pipelines (out-of-band execution per design D5); recording fakes in `test/fakes/fakes.ts`.

## 7. Transport-neutral billing service (the mapping)

- [x] 7.1 Add `src/billing/service.ts` (`BillingService`): `handleWebhook(rawBody, signatureHeader, nowMs): Promise<WebhookOutcome>` = verify → parse → `claimWebhookEvent` → dispatch; `WebhookOutcome` = `ok | ignored | duplicate | rejected-signature | bad-request` + detail.
- [x] 7.2 Implement the event → action dispatch (design D6): provision-branch (ensureCustomer+active+trigger, restore if was paused), pause-branch (pauseProject+paused), resume-branch (restoreProject+active), deprovision-branch (canceled+trigger). All idempotent; unknown customer refused, never invented.

## 8. HTTP receiver + composition root + CLI

- [x] 8.1 Add `src/billing/receiver.ts`: a `Deno.serve` handler that reads the raw body + `Paddle-Signature` header, calls `handleWebhook`, and maps the outcome to a status code (ok/ignored/duplicate → 200, rejected-signature → 401, bad-request → 400) with a small non-secret JSON body — no billing logic in the HTTP layer.
- [x] 8.2 Wire a `billingDeps` bundle in `src/composition-root.ts` (verifier, triggers, `controlPlane.service`, `controlPlane.client`, management API, logger, config); require the control-plane backend for `billing serve` (fail fast otherwise).
- [x] 8.3 Add a `billing serve` command to `src/cli.ts` (thin argv adapter, mirroring the `control-plane` block) and the `billing:live` opt-in smoke task; add `deno.json` tasks.

## 9. Testing & Verification

- [x] 9.1 Unit tests (`test/unit/`): real HMAC adapter against a known `(secret, ts, body) → digest` vector (pass) + tampered body/secret/stale-ts (fail); Paddle event parser (each acted-on type, missing-customer refusal, unknown-type ignored); config parse (secret conditional requirement, default-region); `claimWebhookEvent` fake (first true, redelivery false).
- [x] 9.2 Integration tests (`test/integration/billing.test.ts`, real `BillingService` + real control-plane service/store, fakes only at the boundary): checkout→provision, payment-failure→pause, cancellation→deprovision, resume→restore, idempotent redelivery (one set of side effects), signature-reject (zero side effects), no-customer→bad-request, unknown-type→ignored, and a no-secret-in-logs assertion.
- [x] 9.3 GATE-2b mutation checks: (1) verifier always-true → signature-reject test reddens; (2) `claimWebhookEvent` always-true → idempotency test reddens; (3) drop the pause call → pause test reddens; (4) short-circuit the no-customer refusal → bad-request test reddens. Record the results; revert the probes.
- [x] 9.4 Add the opt-in fail-loud `billing:live` smoke (`test/live/billing-smoke.test.ts`): real signature over a real body against a throwaway control-plane project; fails loudly without creds, never a silent skip; non-destructive.
- [x] 9.5 Full hosting gate: `deno task test` (unit + integration) GREEN, `deno lint` + `deno fmt --check` + `deno check` clean.
- [x] 9.6 Public-repo gate (unchanged runtime, must stay green): `deno task test` on a freshly `db reset` + seeded local stack (`TB_AI_PROVIDER=fake`), and `cd obsidian-plugin && npm test && npm run build`. Paste the final counts.
- [x] 9.7 Public-repo docs: add `ThreatModel.md` T29 (webhook surface) and tick the Step-14 checkbox in `codeEval/Fable20260710-NewFeaturePlan.md`.
- [x] 9.8 `openspec validate paddle-billing --strict` clean; `/opsx:verify`.
