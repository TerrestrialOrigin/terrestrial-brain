## ADDED Requirements

### Requirement: Provider selectable between live and deterministic fake

The `createAiProvider()` factory SHALL select the `AiProvider` implementation
from the `TB_AI_PROVIDER` environment variable. When `TB_AI_PROVIDER` equals
exactly the string `fake`, the factory SHALL return a `FakeAiProvider`. For any
other value, including unset, empty, or a differently-cased string, the factory
SHALL return the live `OpenRouterAiProvider`. No call site outside the factory
SHALL reference `TB_AI_PROVIDER` or choose a provider.

#### Scenario: Fake selected by exact env value

- **WHEN** `TB_AI_PROVIDER` is set to `fake` and `createAiProvider()` is called
- **THEN** the returned provider SHALL be a `FakeAiProvider` and SHALL NOT read `OPENROUTER_API_KEY`

#### Scenario: Live provider is the default

- **WHEN** `TB_AI_PROVIDER` is unset, empty, or any value other than `fake`
- **THEN** `createAiProvider()` SHALL return the live `OpenRouterAiProvider`

### Requirement: Fake provider produces deterministic, similarity-stable embeddings

`FakeAiProvider.getEmbedding` SHALL return a 1536-element numeric vector that is
a pure, deterministic function of the input text — the same text SHALL always
yield the identical vector, with no randomness and no dependency on call order or
process. Cosine similarity between two such vectors SHALL be exactly 1.0 for
identical text, high for text with substantial word overlap, and low for
unrelated text, so that `search_thoughts`/`match_thoughts` behave reproducibly
against the fake. The vector dimension SHALL match the `thoughts.embedding`
column (`vector(1536)`).

#### Scenario: Identical text yields identical vector

- **WHEN** `getEmbedding(text)` is called twice with the same `text`
- **THEN** both calls SHALL return element-wise identical 1536-length vectors

#### Scenario: Overlapping text is more similar than unrelated text

- **WHEN** embeddings are computed for a stored thought, a query sharing most of its words, and an unrelated text
- **THEN** the cosine similarity of (stored, overlapping query) SHALL exceed the cosine similarity of (stored, unrelated text)

#### Scenario: Empty text does not throw

- **WHEN** `getEmbedding("")` is called
- **THEN** it SHALL return a 1536-length vector without throwing

### Requirement: Fake provider returns deterministic completions for every prompt shape

`FakeAiProvider.completeJson` SHALL return a deterministic JSON value, derived
from the request, that the caller's `parse` callback accepts, for each of the
edge function's completion purposes: thought-metadata extraction, note splitting,
ingest reconciliation, task-to-project inference, task enrichment, project name
extraction from a path, project-by-content detection, and people detection. For
extraction purposes the fake SHALL derive its matches from the request content
against the supplied known-entity lists (returning only allowlisted ids), so the
calling tool must genuinely process the fake's output. For an unrecognized prompt
the fake SHALL return a benign value that each caller degrades to its safe
default.

#### Scenario: Note splitting returns processable thoughts

- **WHEN** `completeJson` is called with the note-splitting system prompt
- **THEN** it SHALL return `{ "thoughts": [...] }` with at least one non-empty thought derived from the note content

#### Scenario: People detection echoes a known person present in the note

- **WHEN** `completeJson` is called with the people-detection prompt, a known-people list, and note content naming one of them
- **THEN** the returned people SHALL include that person with their allowlisted id

#### Scenario: Unknown prompt degrades safely

- **WHEN** `completeJson` is called with a system prompt matching no known purpose
- **THEN** it SHALL return a value that the caller's `parse` callback maps to its documented safe default without throwing
