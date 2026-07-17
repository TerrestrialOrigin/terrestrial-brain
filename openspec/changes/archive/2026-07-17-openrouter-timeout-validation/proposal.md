## Why

The OpenRouter transport had no timeout on its outbound `fetch` calls, so a hung upstream pinned the edge invocation until the platform wall-clock kill — and `ingest-note` fires several of these per note, so one hang stalled an entire ingest with an opaque error (CORE-3). It also read responses unvalidated: `getEmbedding` did `data.data[0].embedding` with no shape or length check, so a malformed body threw a raw `TypeError` (not the contract's `AiProviderParseError`) or flowed a wrong-length vector into `thoughts.embedding` and failed far away as a Postgres `vector(1536)` error (CORE-4).

## What Changes

- Both `fetch` calls get an `AbortSignal.timeout` (30s embeddings, 60s completions); a timeout/abort surfaces as a typed `AiProviderHttpError` (status 0), so callers' HTTP-failure fallback policies apply unchanged.
- Responses are validated at the boundary with Zod: the embedding must be a `number[]` of length 1536; the completion `choices[0].message.content` must be a string. A mismatch surfaces as `AiProviderParseError`.
- `fetch` becomes an injectable constructor parameter so the transport is unit-testable offline.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `ai-provider`: The OpenRouter transport bounds outbound calls with a timeout, validates responses at the boundary, and accepts an injectable fetch.

## Impact

- `ai/openrouter-provider.ts` (timeouts, `postJson`, Zod response schemas, injectable fetch)
- Tests: `tests/unit/openrouter-provider.test.ts`
- No schema or dependency changes (Zod already a dependency).

## Non-goals

- Retry/backoff on timeout (callers already have per-site fallback policies).
- Changing the embedding model or dimension.
