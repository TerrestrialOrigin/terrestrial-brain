## Context

`FakeAiProvider.dispatch` keyed off system-prompt substrings; the metadata matcher had drifted from the reworded real prompt, so `TB_AI_PROVIDER=fake` silently stopped exercising metadata enrichment (a GATE 2b gap — deleting `fakeMetadata` changed nothing). `completeJson` also failed to wrap `parse` throws, diverging from the live provider, and the split callback did `typeof item === "object" && item.thought` which throws on `null`.

## Goals / Non-Goals

**Goals:**
- Make the fake dispatch on a stable discriminator that cannot silently drift.
- A new/renamed call site that forgets a responder fails loudly in tests.
- Fake and live providers agree on the parse-error contract.
- One malformed split element is skipped, not fatal.

**Non-Goals:** live-provider fetch injection + response validation (Step 7); extractor callback tolerance (EXTR-8).

## Decisions

- **`purpose` is a required, typed field** on `AiJsonCompletionRequest`. Required (not optional) so a forgotten call site is a compile error; typed as a closed union so the fake's `switch` is exhaustive (`never` default = compile-time guard) and an unwired purpose also throws at runtime.
- **The fake dispatches on `purpose`, throwing on unknown.** Chosen over the finding's alternate (shared prompt constants) because it removes the duplicated literal entirely and makes omission loud, which the substring approach could never guarantee.
- **`completeJson` returns rejected promises consistently.** A `parse` throw → `AiProviderParseError`; an unwired-purpose `dispatch` throw → a plain `Error` rejection (programmer error, not a parse error). Both are rejections, never a synchronous throw, matching the async contract.
- **`parseSplitThoughts` extracted and hardened.** Pulling the inline callback into an exported pure function makes it unit-testable and lets it be null-safe and honestly typed (no implicit-`any` element access).

### User error scenarios

- LLM returns a split array with a null/garbage element → that element is skipped, the rest survive.
- A future purpose is added to the union but not wired into the fake → the exhaustive switch fails to compile (and throws at runtime if forced), caught by tests.

### Security analysis

No external surface change. The fake is never selected in production. No ThreatModel change.

### Test Strategy

Unit-only. RED-first was demonstrated by wiring `purpose` + extracting `parseSplitThoughts` with the OLD logic while leaving the fake on substring dispatch and unwrapped parse — the fidelity tests failed (no topics; raw error not `AiProviderParseError`; null crash) — then flipping dispatch to purpose, wrapping parse, and hardening the split turned them green. A dedicated `fake-provider-fidelity.test.ts` drives the REAL `extractMetadata` through the fake (the drift guard), plus the wrap and split-tolerance cases; `fake-provider.test.ts` asserts one shape per purpose and that an unwired purpose rejects.

## Risks / Trade-offs

- **Trade-off:** `purpose` touches all 8 call sites and 3 test files. Mechanical; the closed union makes any omission a compile error, which is the point.
