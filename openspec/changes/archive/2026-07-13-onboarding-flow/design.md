## Context

Steps 10–15 delivered the hosted spine but no customer-facing entry point (see proposal). The pieces onboarding must compose already exist as seams in the private `terrestrial-brain-hosting` repo:

- `ControlPlaneClient` (narrow, no generic SQL): `ensureCustomer`, `getCustomer`, `loadProvisioningRow`, `getSecret` (service-role-only `{ accessKey, dbPassword }`), plus the durable stores. Its in-memory fake runs the whole thing test-only.
- `ControlPlaneService`: transport-neutral reads that **never return secrets** — `getCustomerConnection` gives `{ region, projectRef, mcpUrl, provisioningStatus, subscriptionStatus }` but deliberately not the access key.
- `provisioning/state.ts`: `ProvisioningStatus = pending | running | done | failed | rolled_back | deprovisioned`; `mcpUrlFor(projectRef)`.
- `billing/service.ts` (Step 14): the Paddle `transaction.completed` webhook is the sole provisioning trigger, reading `custom_data.customer_id` / `region` / `email`.
- Composition root `wire()`: the ONE place adapters are built; `controlPlane` wiring is non-null only under `TB_STORE_BACKEND=control-plane`.

The gap: (1) nothing creates a customer + hands the browser the checkout `custom_data`; (2) nothing surfaces provisioning status to a customer; (3) the access key a customer needs is reachable only through `getSecret` (service-role) and is intentionally withheld by every existing customer-facing read.

This is an MVP web flow living in a Deno backend repo that has **no front-end framework** (by recorded decision — the React/Ionic console is Step 17). So Step 16 follows the repo's established shape: a transport-neutral service + a thin `Deno.serve` adapter + minimal server-rendered HTML, tested at the handler level exactly as `billing/receiver.ts` is.

## Goals / Non-Goals

**Goals:**
- Turn a paid signup into a working, self-serve-connectable brain: signup → Paddle checkout → "building…" wait → connection details (MCP URL + Claude config + Obsidian token).
- Reveal the per-customer access key **once provisioning is done**, over an **authorized** session only, never logged, never through an unauthenticated read.
- Keep exactly one provisioning trigger (the Step-14 webhook); signup never provisions directly.
- Reuse every existing seam; add only what's genuinely new (session auth, connection-package assembly, the served screens). Change no provisioning/billing/deprovision logic.
- Distinguish awaiting-payment / building / ready / failed as first-class states (empty ≠ broken).

**Non-Goals:**
- A password/account system, email verification, login, or password reset — the onboarding **session token** is the only credential this flow issues, scoped to the onboarding window. (A durable customer login belongs to the Step-17 console.)
- The React/Ionic dashboard, memory console, or any post-onboarding management UI (Step 17).
- Server-side Paddle API calls (create subscription, etc.) — checkout is client-side Paddle.js; the server acts on the resulting **webhook** (Step 14).
- Browser (Playwright) E2E for the served screens — deferred to Step 17 when the front-end tooling lands (see Test Strategy).
- Rate limiting / CAPTCHA on signup — documented as a T31 follow-up, not built in the MVP.

## Decisions

### D1 — Onboarding lives in the private hosting repo; public repo gets artifacts only
Same rationale as Steps 10–14: onboarding reads the control plane and reveals a per-customer secret — hosted-business logic that must never ship in the FSL public tree. Public repo carries `openspec/changes/onboarding-flow/**`, `ThreatModel.md` T31, and the Step-16 checkbox. **Alternative considered:** put a thin onboarding page in the public repo — rejected: the access-key reveal + control-plane reads are exactly the business logic the split exists to keep private.

### D2 — Provisioning trigger stays the Step-14 webhook; signup only creates customer + session
Signup does `ensureCustomer(customerId, email)` (status `none`), mints a session, and returns checkout `custom_data`. It does **not** call the provisioning trigger. Payment → Paddle `transaction.completed` → Step-14 `BillingService` provisions. This preserves the "runs-twice / one provisioning entry point" invariant: there is no second path that could create a project, and a customer who signs up but never pays simply never provisions. **Alternative:** provision on signup and treat payment as a gate — rejected: it would create a project (real cost) before payment and add a second provisioning trigger to keep idempotent.

### D3 — Session-token auth: opaque, hashed at rest, header-carried, bounded TTL
`startSignup` mints a 256-bit CSPRNG token, stores only its **SHA-256 hash** in `onboarding_sessions` (hash → customerId, createdAtMs, expiresAtMs), and returns the plaintext token **once**. `getStatus`/`getConnection` take the token, hash it, and resolve by hash lookup; an expired row (`expiresAtMs <= now`) resolves to null. The token is carried in the `x-tb-onboarding-token` **request header**.
- **Why hashed at rest:** a control-plane DB read (or leaked backup) must not yield live session tokens — same reasoning as password hashing. Lookup-by-hash means the compare is a normal indexed equality on the *hash*, so there is no plaintext-token timing side channel to exploit (the secret never sits in a row to be compared byte-by-byte).
- **Why a header, not a cookie:** a cookie-authenticated GET that returns a secret is a CSRF target; a header the browser must explicitly attach is not sent cross-site automatically. It also matches the product's "secrets in headers, never URLs" rule.
- **Why not reuse the MCP access key as the session credential:** the access key doesn't exist until provisioning is done — the customer needs to *watch* provisioning before it exists. The session token is the pre-provision identity.
- **Alternatives:** JWT (rejected — needs a signing-key rotation story for a short-lived token; an opaque hashed row is simpler and revocable by delete); Supabase Auth (rejected for the MVP — a full auth dependency for a one-window token, and it's the Step-17 concern).

### D4 — Transport-neutral `OnboardingService`; the HTTP layer is a thin adapter
All logic — signup, token mint, status mapping, connection-package assembly, the `done`-gate — lives in `OnboardingService`. The `Deno.serve` receiver only reads the header/body, calls the service, and maps the outcome to a status code + JSON (and serves the two HTML screens). This mirrors `billing/receiver.ts` so a future entry point (the Step-17 console) reuses the same service with zero duplication. Outcome → status map is a pure function (`statusForOutcome`), unit-tested.

### D5 — The connection package reveals the access key from the secret store, gated on `done`
`getConnection` refuses unless `loadProvisioningRow(customerId).status === "done"` → returns a distinct `not-ready` outcome (HTTP 409). When ready it reads `getSecret(customerId)` (service-role), and assembles:
- `mcpUrl = mcpUrlFor(projectRef)`, `header = "x-tb-key"`, `obsidianToken = accessKey`;
- `claudeDesktopConfig` / `claudeCodeConfig`: the exact JSON shapes from the public README (`mcpServers.terrestrial-brain` with `url` + `headers["x-tb-key"]`), filled with the real URL + key.
The **db password is never read or returned** on this path (only `accessKey` is pulled from `StoredSecret`). If a ready customer somehow has no stored access key, that's a broken state → an error outcome (HTTP 500 with a non-secret message), never a package with a blank token. **Alternative:** add `getConnectionWithSecret` to `ControlPlaneService` — rejected: keeps the "service never returns secrets" invariant intact; the secret read is confined to `OnboardingService`, the one authorized-by-session caller.

### D6 — `OnboardingTokens` is its own narrow seam
`mintCustomerId()` + `mintSessionToken()`, CSPRNG in the real adapter (`crypto.getRandomValues` → url-safe base64url), deterministic fake in tests. Kept separate from `KeyGenerator` (which mints the MCP access key) so each generator is single-purpose and the fakes stay obvious. Token hashing (`sha256Hex`) is a small pure helper, unit-tested against a known vector.

### D7 — Config is parse-at-boundary; billing wiring is unchanged
New env: `TB_PADDLE_CLIENT_TOKEN` + `TB_PADDLE_PRICE_ID` (public — shipped to the browser for Paddle.js; **not** in `secretValues`), `TB_ONBOARDING_SESSION_TTL_DAYS` (positive int, default 7), `TB_PUBLIC_BASE_URL` (the origin the served pages use for their own API calls; url-validated). `onboarding serve` requires the control-plane backend (fail fast otherwise), exactly like `billing serve`. The onboarding wiring is non-null only when `controlPlane` is wired.

### D8 — Two served screens, minimal and self-contained
`GET /onboarding` → signup + "building…" screen (loads Paddle.js, posts to `/onboarding/signup`, opens checkout with the returned `custom_data`, then polls `/onboarding/status`); on `ready` it fetches `/onboarding/connection` and renders the pitch screen (copy-buttons for the MCP URL, Claude config, Obsidian token). Accessible (semantic elements, labelled form, keyboard-reachable, `aria-live` on the status region). Server-rendered from the receiver; no build step. The screens' *behavior* is covered by handler-level tests; the HTML itself is thin glue.

### Test Strategy
Which layers apply and why (CLAUDE.md GATE 1/2/2b + mock-boundary):
- **Unit** (`test/unit/`): `OnboardingTokens` fake determinism; `sha256Hex` known-vector; config parse (new vars, TTL positivity, client-token/price-id present, base-url validity); connection-package assembly (Claude Desktop/Code JSON shape, `x-tb-key` header, `obsidianToken === accessKey`, **no** dbPassword field anywhere); status→state mapping across every `ProvisioningStatus` × `SubscriptionStatus` case; `statusForOutcome` pure map; the HTTP handler routing + status codes with a stub service.
- **Integration** (`test/integration/onboarding.test.ts`, real `OnboardingService` + real `ControlPlaneService` + `InMemoryControlPlaneClient`, **fakes only at the external boundary** — no mock between service and store): full flow — signup creates the customer + a resolvable session; status before payment = `awaiting-payment`; drive the real provisioning pipeline (Step 10, fakes) to `done` for that customer; status → `ready`; connection returns the **actually-minted** access key from the secret store + correct URL; unauthorized/absent/expired token → `unauthorized`; connection-before-`done` → `not-ready`; a no-secret-in-logs assertion (`CapturingLogger` sees no token/key).
- **Compose-with-Step-14** (integration): signup → feed a real `transaction.completed` body through the real `BillingService` (fake verifier accept) → assert the provisioning trigger fired for that customer → complete provisioning (fakes) → onboarding status `ready` → connection package. Proves the seams compose end-to-end without a browser.
- **GATE 2b mutation checks** (record + revert): (1) drop the `done`-gate → connection-before-ready test reddens; (2) skip the token→customer resolution (treat any token as valid) → unauthorized/forged-token test reddens; (3) include `dbPassword`/return it → no-secret test reddens; (4) skip TTL/expiry check → expired-token test reddens.
- **Opt-in fail-loud `onboarding:live`**: real CSPRNG token + real control-plane project round-trip; fails loudly without creds, never a silent skip; non-destructive.
- **Browser E2E deferred (recorded):** the hosting repo has no front-end/Playwright tooling; the served screens are thin server-rendered glue whose every decision (routing, gating, auth, package assembly, status codes) is covered by handler-level Request→Response tests with no mock on the tested path. A browser E2E harness arrives with the Step-17 React/Ionic console; adding one here would be greenfield tooling out of proportion to two static screens. This is the same handler-level boundary Step 14's webhook receiver uses.

### API contract
Recorded here so a future Step-17 front-end can consume it (all JSON unless noted; session token in `x-tb-onboarding-token` header):
- `POST /onboarding/signup` — body `{ email: string, region: SupportedRegion }` → `201 { customerId, sessionToken, checkout: { customerId, region, email, clientToken, priceId } }`; invalid body → `400 { error }`.
- `GET /onboarding/status` — header token → `200 { state: "awaiting-payment"|"building"|"ready"|"failed"|"paused"|"canceled", provisioningStatus, subscriptionStatus }`; missing/invalid/expired token → `401 { error }`.
- `GET /onboarding/connection` — header token → `200 { mcpUrl, header:"x-tb-key", obsidianToken, accessKey, claudeDesktopConfig, claudeCodeConfig }` when ready; not ready → `409 { error:"not ready", state }`; missing/invalid token → `401`; ready-but-no-secret → `500 { error }`.
- `GET /onboarding` → `200 text/html` (the flow screens). `Method not allowed` → `405`.

### User-error scenarios
- **Invalid email/region at signup** → parsed at the boundary (Zod), `400`, no customer created, no session minted.
- **Missing / malformed / expired / forged session token** on status or connection → `401` (never a partial read, never someone else's data — the token *is* the customer scope).
- **Connection requested before provisioning done** (impatient poll, direct call) → `409 not-ready` with the current `state`, never a blank/placeholder package.
- **Payment abandoned after signup** → customer stays `none`/no provisioning; status shows `awaiting-payment` indefinitely; no project is ever created (D2). Re-running checkout with the same `custom_data.customer_id` is idempotent at the Step-14 webhook.
- **Double signup (same email)** → each signup mints a fresh customer id + session (two customers, two checkouts). Accepted MVP behavior — payment gates provisioning, so an unpaid duplicate costs nothing; documented as a known limitation (dedup-by-email is a follow-up, not an MVP requirement).
- **Provisioning fails** (Step 10 leaves `failed`) → status maps to `failed` with retry guidance in the screen, never a stuck "building…" — the state is read from the real provisioning row, so a failed row surfaces as `failed`.
- **Polling a paused/canceled customer** → status maps to `paused`/`canceled` distinctly (a lapsed customer sees the truth, not "building").

### Security analysis (→ ThreatModel.md T31)
The onboarding surface is internet-facing and its connection read reveals a crown-jewel per-customer access key. Threats + mitigations:
- **Session-token theft/guessing** → 256-bit CSPRNG (unguessable), stored only as SHA-256 hash (a DB/backup leak yields no live tokens), bounded TTL (a stolen token expires), header-only (not auto-sent, not in URLs/logs), redacted from logs. Revocable by deleting the row.
- **Customer enumeration** → status/connection are keyed by the opaque token, never by a customer id in the URL/body; there is no endpoint that maps an email or sequential id to a customer. Signup returns the customer id only to the signer.
- **Access-key exposure** → revealed only over an authorized session, only when `done`, only the `accessKey` (never dbPassword), never logged, TLS assumed at the platform edge. The reveal is confined to `OnboardingService`; no other caller can read the secret via a customer-facing path.
- **CSRF** → GET-returns-secret is protected by requiring an explicit `x-tb-onboarding-token` header (not a cookie); a cross-site page cannot attach it.
- **Signup abuse / cost** → signup creates a customer row + session but **triggers no provisioning** (D2), so spam signups cost a row, not a project. Rate limiting/CAPTCHA is a documented follow-up.
- **Paddle client token/price id are public by design** (they ship to the browser) — explicitly NOT in `secretValues`; the *webhook secret* (Step 14) remains the money-relevant secret.

## Risks / Trade-offs

- **[No browser E2E for the served screens]** → Mitigation: every decision the screens make is in the transport-neutral service + pure handler, covered by handler-level Request→Response tests with no mock on the path; browser E2E lands with the Step-17 front-end. Recorded, not silent.
- **[Session token in `sessionStorage`/memory on the client]** → Mitigation: short TTL + hashed at rest + header-carried; XSS on the onboarding page would expose it, but the page is minimal, self-contained, and loads only Paddle.js from a trusted origin (no third-party widgets). A stolen token yields only that one customer's onboarding window, which expires.
- **[Duplicate-signup by email creates duplicate customers]** → Mitigation: payment gates provisioning so unpaid duplicates are free; dedup-by-email is a bounded follow-up, documented.
- **[Provisioning takes ~2 min; a customer may close the tab]** → Mitigation: the session token persists server-side for the TTL; re-opening `/onboarding` with the stored token resumes the poll. Status is always read fresh from the provisioning row, so it's correct on any reload.
- **[Ready-but-no-secret is an invariant violation]** → Mitigation: treated as an explicit `500` error state (broken ≠ empty), logged (no secret), never a package with a blank token — so it's visible, not silently wrong.

## Migration Plan
Additive only. `onboarding_sessions` ships in `control-plane/schema.sql` (idempotent `create table if not exists`, RLS on, no policies, grants revoked — service-role only) and is applied by the existing `control-plane apply-schema`. No data migration; no change to any existing table or pipeline. Rollback = don't run `onboarding serve` and (optionally) drop the table; nothing else references it. **[Anastasia] pending:** set `TB_PADDLE_CLIENT_TOKEN` / `TB_PADDLE_PRICE_ID` (from the Paddle dashboard) and `TB_PUBLIC_BASE_URL` in the hosted deployment to activate the flow.

## Open Questions
- Post-onboarding, where does the customer manage their brain / re-fetch the token? → Step 17 console (out of scope here); the session TTL covers the onboarding window only.
- Should the connection package be single-reveal (token invalidated after first successful connection fetch)? → Deferred; the MVP allows re-fetch within TTL so a closed tab can recover. Noted as a hardening follow-up in T31.
