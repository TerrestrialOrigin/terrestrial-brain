# Tasks — Step 16 Onboarding flow (`onboarding-flow`)

> All code lands in the PRIVATE repo `~/Documents/Dev/terrestrial-brain-hosting` (branch `feature/OnboardingFlow`). This public repo gets only: this artifact set, `ThreatModel.md` T31, and the Step-16 checkbox. Follow the Steps 10–14 seam/fake, parse-at-boundary, transport-neutral-service + thin-HTTP-adapter discipline. Tests are written to fail RED first where they assert new behavior, then made green.

## 1. Config (parse-at-boundary)

- [x] 1.1 Extend `src/config.ts`: add `TB_PADDLE_CLIENT_TOKEN` + `TB_PADDLE_PRICE_ID` (public — NOT added to `secretValues`), `TB_ONBOARDING_SESSION_TTL_DAYS` (`z.coerce.number().int().positive().default(7)`), and `TB_PUBLIC_BASE_URL` (`z.string().url()`, optional) to the Zod schema + `HostingConfig`. Require the two Paddle-client vars via `.superRefine` only when relevant (parse-time optional; the `onboarding serve` wiring re-narrows).
- [x] 1.2 Update `.env.example` + README env table with the new vars and a "client token + price id come from the Paddle dashboard and are public" note.

## 2. Token seam + hashing

- [x] 2.1 Add `src/ports/onboarding-tokens.ts`: `OnboardingTokens.mintCustomerId(): string` + `mintSessionToken(): string` (the narrow seam).
- [x] 2.2 Add `src/adapters/onboarding-tokens-crypto.ts`: CSPRNG (`crypto.getRandomValues`) → url-safe base64url, ≥256-bit session token, a distinct customer id.
- [x] 2.3 Add a small pure `sha256Hex(value)` helper (Web Crypto) in `src/onboarding/hash.ts` for token hashing.
- [x] 2.4 Add a deterministic `FakeOnboardingTokens` in `test/fakes/fakes.ts` (sequential, so tests assert binding/reuse).

## 3. Session storage (control plane)

- [x] 3.1 Add the `onboarding_sessions` table (`token_hash` PK, `customer_id`, `created_at_ms`, `expires_at_ms`) to `control-plane/schema.sql` (idempotent `create table if not exists`; RLS enabled, no policies, grants revoked — service-role only, matching the other tables).
- [x] 3.2 Add `createOnboardingSession(tokenHash, customerId, createdAtMs, expiresAtMs)` and `resolveOnboardingSession(tokenHash, nowMs): Promise<string | null>` (returns the customer id only when a row exists AND `expires_at_ms > nowMs`) to the `ControlPlaneClient` port; implement in `SupabaseControlPlaneClient` (insert + a single bounded select); model both in `InMemoryControlPlaneClient` (expiry honored).

## 4. Connection-package assembly

- [x] 4.1 Add `src/onboarding/connection.ts`: `buildConnectionPackage({ mcpUrl, accessKey })` → `{ mcpUrl, header:"x-tb-key", obsidianToken, accessKey, claudeDesktopConfig, claudeCodeConfig }` using the exact README JSON shapes. NEVER reads/embeds the db password. Pure + unit-tested.

## 5. Transport-neutral onboarding service

- [x] 5.1 Add `src/onboarding/service.ts` (`OnboardingService`): `startSignup(input)` (Zod-validate email+region → `ensureCustomer` status `none` → mint session (hash + store with TTL) → return `{ customerId, sessionToken, checkout }`, NO provisioning trigger); `getStatus(token)` (resolve token → customer, else `unauthorized`; map provisioning-row status × subscription status → onboarding state); `getConnection(token)` (resolve → `unauthorized`; require `done` else `not-ready`; read `getSecret` → `error` if no key; else `buildConnectionPackage`). Return transport-neutral outcomes (discriminated union), never throw for expected states.
- [x] 5.2 Implement the state mapping as a small pure function over `(ProvisioningStatus | null, SubscriptionStatus)` → `awaiting-payment | building | ready | failed | paused | canceled`; unit-test every case.

## 6. HTTP receiver + served screens + composition root + CLI

- [x] 6.1 Add `src/onboarding/receiver.ts`: `onboardingHandler(deps)` routing `POST /onboarding/signup`, `GET /onboarding/status`, `GET /onboarding/connection`, `GET /onboarding` (HTML); a pure `statusForOutcome` map (created→201, ok→200, not-ready→409, unauthorized→401, bad-request→400, error→500, wrong method→405); reads the `x-tb-onboarding-token` header; holds NO onboarding logic. Plus `serveOnboarding(deps, { port })` (`Deno.serve`).
- [x] 6.2 Add `src/onboarding/screens.ts`: minimal self-contained accessible HTML (signup form + `aria-live` "building…" poll + "ready" pitch screen with copy-buttons for MCP URL / Claude config / Obsidian token). Loads Paddle.js, posts to `/onboarding/signup`, opens checkout with the returned `custom_data`, polls `/onboarding/status`, fetches `/onboarding/connection` on `ready`. Uses `TB_PUBLIC_BASE_URL`.
- [x] 6.3 Wire an `onboardingDeps`/`OnboardingWiring` bundle in `src/composition-root.ts` (service built from `controlPlane.client` + `controlPlane.service` + `OnboardingTokens` + clock + logger + config); non-null ONLY when the control-plane backend is wired.
- [x] 6.4 Add an `onboarding serve` command to `src/cli.ts` (thin argv adapter mirroring `billing serve`; require the control-plane backend, fail fast otherwise) + a `DEFAULT_ONBOARDING_PORT`; add `onboarding:serve` + `onboarding:live` `deno.json` tasks.

## 7. Testing & Verification

- [x] 7.1 Unit tests (`test/unit/`): `FakeOnboardingTokens` determinism; `sha256Hex` known vector; config parse (new vars, TTL positivity, client-token/price-id public not-in-secrets, base-url validity); `buildConnectionPackage` (Claude Desktop/Code JSON shape, `x-tb-key`, `obsidianToken===accessKey`, NO dbPassword field); state-mapping every `ProvisioningStatus × SubscriptionStatus` case; `statusForOutcome` pure map; handler routing + status codes with a stub service.
- [x] 7.2 Integration tests (`test/integration/onboarding.test.ts`, real `OnboardingService` + real `ControlPlaneService` + `InMemoryControlPlaneClient`, fakes only at the boundary): signup creates customer + resolvable session; status `awaiting-payment` before payment; drive the real Step-10 pipeline (fakes) to `done`; status `ready`; connection returns the actually-minted access key + correct URL; unauthorized/absent/expired/forged token → `unauthorized`; connection-before-`done` → `not-ready`; ready-but-no-secret → `error`; no-token/no-key in logs (`CapturingLogger`).
- [x] 7.3 Compose-with-Step-14 integration test: signup → real `BillingService.handleWebhook` of a `transaction.completed` body (fake verifier accept) → assert the provisioning trigger fired once for that customer → complete provisioning (fakes) → onboarding status `ready` → connection package retrievable.
- [x] 7.4 GATE-2b mutation checks: (1) drop the `done`-gate → not-ready test reddens; (2) accept any token (skip resolve) → unauthorized/forged test reddens; (3) include/return `dbPassword` → no-secret test reddens; (4) skip TTL/expiry → expired-token test reddens. Record results; revert the probes.
- [x] 7.5 Add the opt-in fail-loud `onboarding:live` smoke (`test/live/onboarding-smoke.test.ts`): real CSPRNG token + real control-plane round-trip; fails loudly without creds, never a silent skip; non-destructive.
- [x] 7.6 Full hosting gate: `deno task test` (unit + integration) GREEN, `deno lint` + `deno fmt --check` + `deno check` clean. Paste the counts.
- [x] 7.7 Public-repo gate (unchanged runtime, must stay green): `deno task test` on a freshly `db reset` + seeded local stack (`TB_AI_PROVIDER=fake`), and `cd obsidian-plugin && npm test && npm run build`. Paste the final counts.
- [x] 7.8 Public-repo docs: add `ThreatModel.md` T31 (onboarding surface) and tick the Step-16 checkbox in `codeEval/Fable20260710-NewFeaturePlan.md`.
- [x] 7.9 `openspec validate onboarding-flow --strict` clean; `/opsx:verify`.
