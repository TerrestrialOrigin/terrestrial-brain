## ADDED Requirements

### Requirement: Outbound provider calls are bounded and typed on timeout

The OpenRouter transport SHALL bound every outbound embedding and completion request with a timeout, and a timeout/abort SHALL surface as a typed `AiProviderHttpError` (status 0), so a hung upstream cannot stall an entire ingest and callers' existing HTTP-failure fallback policies apply unchanged.

#### Scenario: A timed-out request surfaces as a typed transport error

- **WHEN** an outbound OpenRouter request aborts on its timeout
- **THEN** the call rejects with `AiProviderHttpError` (status 0), not a raw abort/timeout error

### Requirement: OpenRouter responses are validated at the boundary

The transport SHALL validate the OpenRouter response shape before use: the embedding response's vector SHALL be a `number[]` of the embedding column's length (1536), and the completion response's `choices[0].message.content` SHALL be a string. A shape or length mismatch SHALL surface as `AiProviderParseError`, not a raw `TypeError` and not an invalid value flowing downstream.

#### Scenario: A wrong-length embedding is rejected at the door

- **WHEN** the embedding response returns a vector whose length is not 1536
- **THEN** `getEmbedding` rejects with `AiProviderParseError`

#### Scenario: A shape-mismatched body is a typed parse error

- **WHEN** the response body is missing the expected `data`/`choices` shape
- **THEN** the call rejects with `AiProviderParseError`, not a raw `TypeError`

### Requirement: The transport's fetch is injectable

The OpenRouter provider SHALL accept an injectable `fetch` implementation so the transport itself can be unit-tested with a fake — no network and no key.

#### Scenario: The provider uses an injected fetch

- **WHEN** a provider is constructed with a fake `fetch`
- **THEN** its calls go through that fake, requiring no global stub or network
