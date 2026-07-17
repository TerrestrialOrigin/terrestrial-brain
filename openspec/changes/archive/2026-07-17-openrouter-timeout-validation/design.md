## Context

`OpenRouterAiProvider` issued bare `fetch` calls with no `AbortSignal` and read `data.data[0].embedding` / `data.choices[0].message.content` with no validation. A hung upstream stalled the whole ingest; a malformed body threw a raw `TypeError` or pushed a wrong-length vector into a `vector(1536)` column. The transport was also only testable via global-`fetch` stubbing.

## Goals / Non-Goals

**Goals:**
- Bound outbound calls; surface timeouts as the contract's typed error.
- Validate responses once at the boundary (parse, don't cast).
- Make the transport unit-testable offline via injectable fetch.

**Non-Goals:** retry/backoff; model/dimension changes.

## Decisions

- **Timeout via `AbortSignal.timeout`, mapped to `AiProviderHttpError(op, 0, …)`.** Chosen over a new error class so callers' existing "not a parse error ⇒ HTTP failure" branch is unchanged: extractors degrade, `freshIngest` rethrows (aborts ingest) — the same behavior a real HTTP failure already gets. 30s for embeddings, 60s for completions.
- **A shared `postJson` helper** carries the timeout + abort→typed-error mapping for both endpoints (Rule of Three; the two call sites were near-identical).
- **Zod boundary schemas.** `EmbeddingResponseSchema` requires `data[0].embedding` to be `number[]` of length 1536 — this is the specific guard the finding wants (a wrong length is caught here, not as a Postgres error). `CompletionResponseSchema` requires `choices[0].message.content` to be a string before `JSON.parse`. Both wrap failures in `AiProviderParseError`.
- **Injectable fetch, defaulting to a call-time deferral to global `fetch`.** The default `(input, init) => fetch(input, init)` calls the current global fetch at call time, so the existing global-stub tests keep working while new tests can inject directly.

### User error scenarios

- Upstream incident / network black-hole → bounded wait, typed error, ingest fails cleanly (or degrades per site) instead of hanging.
- Upstream returns a truncated/garbage body → typed parse error at the door, no downstream Postgres crash.

### Security analysis

No new external surface. Bounding outbound calls removes a resource-exhaustion / hung-invocation vector. Error bodies remain length-capped (`MAX_ERROR_BODY`). No ThreatModel change.

### Test Strategy

Unit-only, via injected/stubbed fetch. RED-first: added the injectable constructor + `postJson` (with the signal) but WITHOUT the abort→typed mapping and WITHOUT the Zod validation — the timeout and wrong-length/shape tests failed (raw DOMException; unvalidated array/TypeError) — then added the catch + schemas to green them. The existing HTTP-200 embedding test was updated from a length-3 to a length-1536 vector.

## Risks / Trade-offs

- **Trade-off:** fixed timeouts could cut off a genuinely slow-but-valid call. 30s/60s are generous for these endpoints; a timeout maps to the same fallback a transient HTTP error already triggers, so the failure mode is already handled.
