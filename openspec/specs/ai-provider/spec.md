# ai-provider Specification

## Purpose

Defines the `AiProvider` seam — the single abstraction over external LLM
(JSON completion) and embedding calls. It exists so the transport (base URL,
model, API key, `response.ok` handling, JSON parsing) lives in exactly one
implementation and so a deterministic fake can be substituted in tests without a
live, paid API key.
## Requirements
### Requirement: AiProvider interface abstracts all LLM and embedding calls

The MCP edge function SHALL define an `AiProvider` interface as the single seam
over external embedding and JSON-completion calls. The interface SHALL expose
exactly two operations:

- `getEmbedding(text: string): Promise<number[]>` — returns the embedding vector
  for the given text.
- `completeJson<Parsed>(request, parse): Promise<Parsed>` — sends a JSON-mode
  chat completion (a system prompt + user content, optional model override),
  parses the model's JSON response, hands the parsed value to the caller's
  `parse` callback, and returns its result.

No code outside the provider implementation SHALL construct a `fetch` call to the
LLM/embedding host. The base URL, model names, and API-key read SHALL live only
inside the provider implementation.

#### Scenario: Embedding returned for text

- **WHEN** `getEmbedding("hello")` is called and the upstream returns HTTP 200 with an embedding
- **THEN** the provider SHALL return the embedding vector as `number[]`

#### Scenario: JSON completion parsed and validated

- **WHEN** `completeJson({ systemPrompt, userContent }, parse)` is called and the upstream returns HTTP 200 with a JSON body
- **THEN** the provider SHALL parse the response content as JSON and return the value produced by the `parse` callback

#### Scenario: Single OpenRouter literal

- **WHEN** the codebase is searched for the `openrouter.ai` host literal
- **THEN** it SHALL appear in exactly one location (the `OpenRouterAiProvider` implementation)

### Requirement: Provider surfaces transport failures as typed errors

`completeJson` SHALL distinguish an HTTP failure from a response-parse failure so
that each caller can apply its own fallback policy:

- On a non-OK HTTP response it SHALL throw an `AiProviderHttpError` carrying the
  status code and a truncated response body.
- On an unreadable/non-JSON response body, or when the caller's `parse` callback
  throws, it SHALL throw an `AiProviderParseError`.

`getEmbedding` SHALL throw on a non-OK HTTP response (it does not degrade).

#### Scenario: HTTP error is thrown, not swallowed

- **WHEN** `completeJson` receives a non-OK HTTP status from the upstream
- **THEN** it SHALL throw an `AiProviderHttpError` that includes the status code

#### Scenario: Unparseable body is thrown as a parse error

- **WHEN** `completeJson` receives an OK response whose body is not valid JSON
- **THEN** it SHALL throw an `AiProviderParseError`

#### Scenario: Embedding HTTP failure propagates

- **WHEN** `getEmbedding` receives a non-OK HTTP status
- **THEN** it SHALL throw an error rather than returning an empty or partial vector

### Requirement: Provider is injected, never a module-level singleton

The provider SHALL be created by a single `createAiProvider()` factory at the
`index.ts` composition root and injected into consumers: every tool module's
`register(...)` function SHALL accept the provider as a parameter, and it SHALL
be placed on `ExtractionContext` for extractors. No consumer SHALL import a
provider instance from a module-level global.

#### Scenario: Provider threaded through tool registration

- **WHEN** the MCP server is constructed for a request
- **THEN** each tool module's `register(...)` SHALL receive the injected `AiProvider` instance

#### Scenario: Fake provider substitutable in tests

- **WHEN** a unit test constructs a consumer (extractor or helper) with a hand-written fake `AiProvider`
- **THEN** the consumer SHALL use the fake and perform no network call

### Requirement: API key is read lazily and kept out of logs

The `OpenRouterAiProvider` constructor SHALL NOT read the API key; the key SHALL
be read via `requireEnv("OPENROUTER_API_KEY")` at the point of each request. The
key SHALL be sent only in the `Authorization` header (never a URL/query string)
and SHALL never be written to logs.

#### Scenario: Construction without key does not throw

- **WHEN** `new OpenRouterAiProvider()` is constructed while `OPENROUTER_API_KEY` is unset
- **THEN** construction SHALL succeed and no error SHALL be raised until the first LLM/embedding call

#### Scenario: Missing key fails fast at call time

- **WHEN** an embedding or completion call is made while `OPENROUTER_API_KEY` is unset
- **THEN** the call SHALL throw an error naming the `OPENROUTER_API_KEY` variable

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
unrelated text, so that `search_thoughts`/`search_thoughts_by_embedding` behave reproducibly
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

