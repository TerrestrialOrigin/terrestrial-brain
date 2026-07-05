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
