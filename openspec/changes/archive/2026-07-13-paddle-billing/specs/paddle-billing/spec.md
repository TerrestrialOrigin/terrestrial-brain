## ADDED Requirements

> **Test tier:** every scenario below is tagged `test` (deterministic). The billing mapping has no LLM behavior, so there is no `eval` tier. Deterministic scenarios run against fakes (signature verifier, provisioning/deprovision triggers, management API, in-memory control-plane client) — no live Paddle, no live Supabase; real-system confidence comes from an opt-in, fail-loud live smoke.

### Requirement: Inbound webhooks are authenticated by Paddle signature before any action

The system SHALL verify each inbound webhook's Paddle signature before parsing the body or performing any side effect. Verification SHALL compute an HMAC-SHA256 over the timestamped raw request body using the configured webhook secret, compare it against the header digest in constant time, and reject the request when the signature header is missing or malformed, the digest does not match, or the signed timestamp is outside a bounded freshness window. A rejected webhook SHALL cause no provisioning, pause, deprovision, subscription change, or event record.

#### Scenario: A validly signed webhook is accepted
- **GIVEN** a webhook body signed with the configured secret and a current timestamp
- **WHEN** the receiver verifies it
- **THEN** verification succeeds and the event proceeds to parsing

#### Scenario: A webhook with an invalid or missing signature is rejected
- **GIVEN** a webhook whose signature header is absent, malformed, or does not match the body under the configured secret
- **WHEN** the receiver verifies it
- **THEN** the request is rejected with an unauthorized outcome and produces no side effect and no recorded event

#### Scenario: A replayed webhook outside the freshness window is rejected
- **GIVEN** a webhook whose signed timestamp is older than the allowed freshness window
- **WHEN** the receiver verifies it
- **THEN** the request is rejected even though the digest would otherwise match

### Requirement: Webhook payloads are parsed at the boundary into known-good events

The system SHALL parse a verified webhook body once, at the boundary, into a known-good typed event carrying the event id, event type, and the resolved customer id, region, and email read from Paddle `custom_data`. An event whose payload does not resolve to a customer id SHALL be refused with a bad-request outcome and no side effect. An event whose type the system does not act on SHALL be acknowledged and ignored, not errored. No unvalidated value SHALL flow into a provisioning, pause, or deprovision action.

#### Scenario: An acted-on event parses into its typed form
- **WHEN** a verified `transaction.completed`, `transaction.payment_failed`, `subscription.canceled`, or `subscription.resumed` event is parsed
- **THEN** it yields a typed event with its event id, resolved customer id, and region

#### Scenario: An event with no resolvable customer is refused
- **GIVEN** a verified webhook whose `custom_data` contains no customer id
- **WHEN** it is parsed
- **THEN** the operation reports a bad-request outcome, invents no customer, and performs no side effect

#### Scenario: An unrecognised event type is acknowledged and ignored
- **GIVEN** a verified webhook of a type the system does not act on
- **WHEN** it is handled
- **THEN** the operation reports an ignored outcome with a success acknowledgement and performs no side effect

### Requirement: Webhook handling is idempotent under at-least-once delivery

The system SHALL record each processed webhook by its Paddle event id using a single atomic insert-if-absent conditional write, so that the first delivery of an event id is claimed and processed and every redelivery of the same event id is a no-op that still acknowledges successfully. Concurrent deliveries of one event id SHALL be resolved by the database, so exactly one performs the side effects.

#### Scenario: A first delivery is processed
- **GIVEN** an event id not seen before
- **WHEN** the webhook is handled
- **THEN** the event is claimed, its mapped side effects run once, and the outcome is success

#### Scenario: A redelivered event is a no-op that still acknowledges
- **GIVEN** an event id already recorded as processed
- **WHEN** the same event is delivered again
- **THEN** no side effect runs a second time and the outcome is a successful duplicate acknowledgement

### Requirement: The payment lifecycle drives provisioning, pausing, deprovisioning, and subscription status

The system SHALL map each acted-on Paddle event onto the existing pipelines and the control plane: a completed transaction or activated subscription SHALL ensure the customer, set the subscription status to active, and request provisioning when the customer is not already provisioned; a failed payment or past-due subscription SHALL pause the customer's project and set the status to paused; a resumed subscription SHALL restore a paused project and set the status to active; a canceled subscription SHALL set the status to canceled and request deprovisioning through the export-then-delete pathway. Every mutation SHALL be idempotent and SHALL refuse an unknown customer rather than silently creating one where a record is required.

#### Scenario: Checkout provisions a new customer's brain
- **GIVEN** a verified completed-transaction event for a customer with no provisioned project
- **WHEN** it is handled
- **THEN** the customer is ensured, the subscription status is set to active, and provisioning is requested for the customer's id and region

#### Scenario: Payment failure pauses the project
- **GIVEN** a verified payment-failed event for a provisioned customer
- **WHEN** it is handled
- **THEN** the customer's project is paused and the subscription status is set to paused

#### Scenario: Resume restores a paused project
- **GIVEN** a verified subscription-resumed event for a paused, provisioned customer
- **WHEN** it is handled
- **THEN** the customer's project is restored and the subscription status is set to active

#### Scenario: Cancellation deprovisions through the export-then-delete pathway
- **GIVEN** a verified subscription-canceled event for a provisioned customer
- **WHEN** it is handled
- **THEN** the subscription status is set to canceled and deprovisioning is requested through the pathway that exports and verifies the data before deleting the project

#### Scenario: A redelivered checkout does not provision twice
- **GIVEN** a completed-transaction event whose provisioning has already run
- **WHEN** the same event id is delivered again
- **THEN** provisioning is not requested a second time and the outcome is a successful duplicate

### Requirement: The webhook receiver is a thin adapter over transport-neutral billing logic

The system SHALL implement the webhook logic in a transport-neutral billing service whose single entry point takes the raw body and signature header and returns a transport-neutral outcome, and SHALL expose it over HTTP through a thin receiver that only reads the request and maps the outcome to a status code. A handled, ignored, or duplicate event SHALL map to a success status; a signature failure SHALL map to an unauthorized status; an unparseable or no-customer event SHALL map to a bad-request status. The HTTP layer SHALL contain no billing logic, so the same logic is reusable by a future entry point without duplication.

#### Scenario: Outcomes map to the documented status codes
- **WHEN** the receiver handles a request and obtains a billing outcome
- **THEN** a handled/ignored/duplicate outcome returns a success status, a signature-failure outcome returns unauthorized, and a bad-request outcome returns bad-request

#### Scenario: The webhook secret never appears in logs
- **WHEN** the billing service and receiver run and produce log output
- **THEN** the Paddle webhook secret value appears nowhere in the logs
