## ADDED Requirements

### Requirement: Default test suite runs deterministically without a live LLM key

The default test suite (`deno task test`, `test:unit`, `test:integration`) SHALL
run against the deterministic `FakeAiProvider` (selected by `TB_AI_PROVIDER=fake`
in the test stack) and SHALL pass with NO `OPENROUTER_API_KEY` set. The suite
SHALL contain no LLM-availability hedges — no assertion guarded by a conditional
such as `if (!result.includes("No thoughts found"))` or a "the LLM may or may not
be available" structure-only check. Every assertion that depends on embedding or
completion output SHALL be an unconditional (hard) assertion, so that deleting
the implementation it targets reddens it.

#### Scenario: Suite is green with no OpenRouter key

- **WHEN** the default test suite is run with `TB_AI_PROVIDER=fake` and `OPENROUTER_API_KEY` unset
- **THEN** all tests SHALL pass with zero failures and zero skips

#### Scenario: No hedged LLM conditionals remain

- **WHEN** the test sources are searched for LLM-availability hedges (`No thoughts found` guards, "may or may not be available" structure-only assertions)
- **THEN** no such conditional SHALL remain in the suite

#### Scenario: Related query finds a captured thought deterministically

- **WHEN** a thought is captured and `search_thoughts` is run with a query sharing its words, against the fake provider
- **THEN** the search SHALL return that thought (a hard assertion, not skipped when empty)

### Requirement: Opt-in live-LLM test tier

The suite SHALL provide a separate, explicitly-invoked live-LLM tier
(`deno task test:live-llm`) that exercises the real `OpenRouterAiProvider`. This
tier SHALL NOT be part of the default `deno task test`, and SHALL NOT be
implemented as a skip in the default suite. Its `OPENROUTER_API_KEY` requirement
SHALL be documented in the README.

#### Scenario: Live tier is separate from the default suite

- **WHEN** `deno task test` is run
- **THEN** it SHALL NOT execute the live-LLM tier

#### Scenario: Live tier fails loudly without a key

- **WHEN** `deno task test:live-llm` is run with `OPENROUTER_API_KEY` unset
- **THEN** the live provider SHALL throw a clear error naming `OPENROUTER_API_KEY` rather than skipping silently
