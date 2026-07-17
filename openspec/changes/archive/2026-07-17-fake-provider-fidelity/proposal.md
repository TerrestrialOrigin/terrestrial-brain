## Why

The deterministic `FakeAiProvider` dispatched on system-prompt substrings, and the metadata matcher (`"Extract metadata from the user's captured"`) had drifted from the real prompt (`"You are given a single captured thought…"`). Under `TB_AI_PROVIDER=fake`, every `extractMetadata` call fell through to the `{}` default, so the deterministic suite silently stopped exercising metadata enrichment (CORE-1). Separately, `FakeAiProvider.completeJson` did not wrap a throwing `parse` in `AiProviderParseError`, so the fake and live providers diverged on the caller's fallback branch (CORE-8), and the thought-split parse callback dereferenced `.thought` on `null`, letting one malformed element crash the whole split batch (CORE-12).

## What Changes

- Add an `AiCompletionPurpose` discriminator to `AiJsonCompletionRequest`; every real call site sets it. `FakeAiProvider` dispatches on `purpose` (exhaustive `switch`) and **throws** on an unwired purpose instead of returning `{}`, so drift/omission fails loudly in tests.
- `FakeAiProvider.completeJson` wraps a throwing `parse` in `AiProviderParseError`, matching the live provider's seam contract.
- Extract and harden the split parse into `parseSplitThoughts(raw)`: null-safe, honestly typed, skipping malformed elements instead of crashing the batch.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `ai-provider`: The completion request carries a purpose discriminator; the deterministic fake dispatches on it and throws on an unwired purpose, and wraps parse errors per the seam contract.

## Impact

- `ai/ai-provider.ts` (`AiCompletionPurpose`, `purpose` field), `ai/fake-provider.ts` (dispatch + wrap)
- `helpers.ts` (`parseSplitThoughts`), 8 `completeJson` call sites set `purpose`
- Tests: `tests/unit/fake-provider-fidelity.test.ts` (new), `tests/unit/fake-provider.test.ts`, `tests/unit/openrouter-provider.test.ts`, `tests/live/live-llm.test.ts`
- No schema or dependency changes.

## Non-goals

- Injectable fetch on the live provider + response validation is Step 7 (CORE-3/4).
- Extractor LLM-callback parse tolerance (EXTR-8) is Phase C/E.
