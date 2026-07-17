## ADDED Requirements

### Requirement: Completion requests carry a purpose and the fake dispatches on it

`AiJsonCompletionRequest` SHALL include a `purpose` discriminator drawn from a fixed set of completion purposes, and every real call site SHALL set it. The deterministic `FakeAiProvider` SHALL select its responder by `purpose`, NOT by a system-prompt substring. When a request carries a purpose for which no responder is wired, the fake SHALL fail loudly (reject) rather than degrade to a benign default, so a drifted or newly-added call site is caught by the test suite.

#### Scenario: The fake exercises the real metadata path

- **WHEN** the real `extractMetadata` runs through `FakeAiProvider`
- **THEN** it returns enriched metadata (at least one topic), not the empty default

#### Scenario: An unwired purpose rejects loudly

- **WHEN** `completeJson` is called with a purpose that has no wired responder
- **THEN** the returned promise rejects (it does not resolve to `{}`)

### Requirement: The fake honors the parse-error seam contract

`FakeAiProvider.completeJson` SHALL wrap an exception thrown by the caller's `parse` callback in `AiProviderParseError`, exactly as the live provider does, so a caller's `instanceof AiProviderParseError` fallback branch behaves identically under both providers.

#### Scenario: A throwing parse surfaces as AiProviderParseError

- **WHEN** the `parse` callback passed to `FakeAiProvider.completeJson` throws
- **THEN** the returned promise rejects with `AiProviderParseError`

### Requirement: Split parsing tolerates malformed elements

The note-split parse SHALL skip any malformed element (null, non-string, or missing/empty `thought`) and never throw on one bad element, so a single malformed entry cannot collapse the whole split batch.

#### Scenario: One malformed element does not nuke the batch

- **WHEN** the split response contains `[null, "a real thought", {"thought": "wrapped"}, 7]`
- **THEN** parsing returns `["a real thought", "wrapped"]`
