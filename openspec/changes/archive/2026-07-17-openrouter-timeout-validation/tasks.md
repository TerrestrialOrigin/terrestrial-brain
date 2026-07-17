## 1. Failing tests first (RED)

- [x] 1.1 `tests/unit/openrouter-provider.test.ts`: wrong-length embedding → `AiProviderParseError`; shape-mismatched body → `AiProviderParseError`; outbound timeout (fetch rejects TimeoutError) → `AiProviderHttpError` status 0 (embeddings + completion); injectable-fetch smoke test. Update the HTTP-200 embedding test to a length-1536 vector.
- [x] 1.2 Confirm RED with injectable fetch + `postJson` wired but no abort-mapping and no Zod validation.

## 2. Fix (GREEN)

- [x] 2.1 Add `EMBEDDING_TIMEOUT_MS`/`COMPLETION_TIMEOUT_MS`, `EMBEDDING_DIMENSIONS`, and Zod response schemas.
- [x] 2.2 `postJson`: pass `AbortSignal.timeout`; map a `TimeoutError`/`AbortError` to `AiProviderHttpError(op, 0, …)`.
- [x] 2.3 `getEmbedding` / `completeJson`: validate the response via the Zod schemas, wrapping failures in `AiProviderParseError`.
- [x] 2.4 Constructor accepts an injectable `fetch` (default defers to global fetch at call time).

## 3. Testing & Verification

- [x] 3.1 GATE 2b: validation + timeout tests RED before the catch/schemas.
- [x] 3.2 Full `deno task test` on a reset stack green; `deno check`, lint, fmt clean.
- [x] 3.3 Validate + archive; check off Step 7 in the plan; commit.
