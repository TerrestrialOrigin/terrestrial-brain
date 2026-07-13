## ADDED Requirements

### Requirement: Signup creates the customer and returns checkout parameters
The onboarding service SHALL, on signup, validate the request at the boundary, create (or idempotently ensure) the customer with subscription status `none`, mint an onboarding session token bound to that customer, and return the Paddle checkout `custom_data` the browser needs — WITHOUT triggering provisioning. Provisioning remains driven solely by the Step-14 Paddle `transaction.completed` webhook.

#### Scenario: Valid signup creates a customer and session (test)
- **WHEN** `startSignup({ email, region })` is called with a valid email and a supported region
- **THEN** a customer with that id exists in the control plane with subscription status `none`, a resolvable session token is returned, and the result carries `checkout` = `{ customerId, region, email, clientToken, priceId }`
- **AND** no provisioning trigger is invoked and no provisioning row is created

#### Scenario: Invalid email or region is refused at the boundary (test)
- **WHEN** `startSignup` is called with a malformed email or an unsupported region
- **THEN** it fails with a validation error, no customer is created, and no session token is minted

#### Scenario: Signup returns the public Paddle client token and price id (test)
- **WHEN** a valid signup completes
- **THEN** the returned `checkout` contains the configured public `clientToken` and `priceId` so the browser can open Paddle.js checkout, and neither the webhook secret nor any control-plane service key is present in the result

### Requirement: Onboarding session tokens are opaque, hashed at rest, and expire
The service SHALL mint session tokens from a CSPRNG, persist ONLY their hash (never plaintext at rest), bind each to a single customer, and honor a bounded time-to-live. A token SHALL be resolved by hash lookup and SHALL resolve to no customer once expired.

#### Scenario: A minted token resolves to its customer within TTL (test)
- **WHEN** a session token minted for a customer is presented before its expiry
- **THEN** it resolves to exactly that customer id

#### Scenario: The plaintext token is never stored (test)
- **WHEN** a session is created
- **THEN** the stored session row contains the token's hash, and the plaintext token does not appear in any stored row

#### Scenario: An expired token resolves to no customer (test)
- **WHEN** a session token is presented after its `expiresAtMs` has passed
- **THEN** it resolves to no customer and any status/connection request bearing it is unauthorized

#### Scenario: A forged or unknown token resolves to no customer (test)
- **WHEN** a token that was never minted (or a random string) is presented
- **THEN** it resolves to no customer, with no partial data returned

### Requirement: Status polling surfaces onboarding state distinctly
The service SHALL, for an authorized session, map the customer's real provisioning-row status and subscription status onto a distinct onboarding state — `awaiting-payment`, `building`, `ready`, `failed`, `paused`, or `canceled` — never conflating a not-yet-started, in-progress, failed, or lapsed customer with each other or with an empty result.

#### Scenario: Before payment the state is awaiting-payment (test)
- **WHEN** status is requested for a signed-up customer whose subscription is `none` and who has no provisioning row
- **THEN** the state is `awaiting-payment`

#### Scenario: During provisioning the state is building (test)
- **WHEN** status is requested for a customer whose provisioning row is `pending` or `running`
- **THEN** the state is `building`

#### Scenario: When provisioning is done the state is ready (test)
- **WHEN** status is requested for a customer whose provisioning row is `done`
- **THEN** the state is `ready`

#### Scenario: A failed provision surfaces as failed, not stuck building (test)
- **WHEN** status is requested for a customer whose provisioning row is `failed`
- **THEN** the state is `failed` (not `building`)

#### Scenario: A lapsed customer surfaces paused or canceled (test)
- **WHEN** status is requested for a customer whose subscription is `paused` or `canceled`
- **THEN** the state is `paused` or `canceled` respectively

#### Scenario: Status without a valid session is unauthorized (test)
- **WHEN** status is requested with a missing, malformed, or expired token
- **THEN** the request is unauthorized and no customer state is returned

### Requirement: The connection package is gated on a completed provision and reveals only the access key
The service SHALL return a customer's connection package — MCP URL, `x-tb-key` header name, the Obsidian token, and ready-to-paste Claude Desktop and Claude Code MCP configs — ONLY over an authorized session AND ONLY when the customer's provisioning row is `done`. The package's token SHALL be the per-customer MCP access key read from the service-role-only secret store; the database password SHALL never be read or returned on this path.

#### Scenario: A ready customer gets a complete connection package (test)
- **WHEN** `getConnection` is called with a valid session for a customer whose provisioning is `done` and whose access key is stored
- **THEN** it returns `mcpUrl` = the customer's project MCP URL, `header` = `x-tb-key`, `obsidianToken` = `accessKey` = the stored access key, and Claude Desktop/Code configs embedding that URL and key

#### Scenario: The package never contains the database password (test)
- **WHEN** a connection package is assembled
- **THEN** no field of the package equals or contains the customer's stored database password

#### Scenario: Connection before provisioning is done is refused as not-ready (test)
- **WHEN** `getConnection` is called with a valid session for a customer whose provisioning row is absent, `pending`, `running`, or `failed`
- **THEN** it returns a distinct `not-ready` outcome carrying the current state, never a package with a blank or placeholder token

#### Scenario: Connection without a valid session is unauthorized (test)
- **WHEN** `getConnection` is called with a missing, malformed, or expired token
- **THEN** the request is unauthorized and no package is returned

#### Scenario: Ready-but-missing-secret is an explicit error, not a blank package (test)
- **WHEN** `getConnection` is called for a `done` customer whose stored access key is absent
- **THEN** it returns an explicit error outcome (a broken state), not a package containing an empty token

### Requirement: Secrets never leak into logs
The onboarding service and receiver SHALL never write a session token (plaintext) or a customer access key to any log line.

#### Scenario: No token or key appears in captured logs (test)
- **WHEN** a full signup → status → connection flow runs against a capturing logger
- **THEN** neither the plaintext session token nor the customer access key appears in any captured log line

### Requirement: The HTTP receiver is a thin adapter over the service
The onboarding HTTP receiver SHALL hold no onboarding logic: it SHALL read the request body / `x-tb-onboarding-token` header, call the transport-neutral `OnboardingService`, and map the outcome to a status code (signup created → 201; ok → 200; not-ready → 409; unauthorized → 401; bad request → 400; ready-but-broken → 500; wrong method → 405), and SHALL serve the onboarding screens as HTML.

#### Scenario: Endpoints map service outcomes to the contracted status codes (test)
- **WHEN** each endpoint is invoked (valid signup, authorized status, authorized-but-not-ready connection, unauthorized read, malformed signup body)
- **THEN** the receiver returns 201 / 200 / 409 / 401 / 400 respectively, with a non-secret JSON body, and returns 405 for a disallowed method

#### Scenario: The onboarding page is served as accessible HTML (test)
- **WHEN** `GET /onboarding` is requested
- **THEN** the receiver returns `200` with `text/html` containing the signup form and the status/connection screens (labelled form controls, a live status region), and the response contains no server secret

### Requirement: Onboarding composes with the billing webhook end-to-end
Signup followed by a verified Paddle `transaction.completed` webhook for the same customer SHALL result in that customer being provisioned and, once provisioning completes, the connection package becoming available over the onboarding session — with no code path other than the webhook triggering provisioning.

#### Scenario: Signup then paid webhook yields a connectable brain (test)
- **WHEN** a customer signs up, then a verified `transaction.completed` webhook carrying that customer's `custom_data` is handled by the billing service, and provisioning subsequently completes
- **THEN** the provisioning trigger fired exactly once for that customer, and the onboarding status becomes `ready` and the connection package is retrievable over the session token
