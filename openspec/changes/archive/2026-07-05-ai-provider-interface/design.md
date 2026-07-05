## Context

The MCP edge function talks to OpenRouter for two things: **embeddings**
(`text-embedding-3-small`) and **chat completions constrained to JSON**
(`gpt-4o-mini`, `response_format: { type: "json_object" }`). Today that transport
is hand-inlined in 8 places:

| # | Location | Kind | Failure behavior today |
|---|----------|------|------------------------|
| 1 | `helpers.getEmbedding` | embedding | **throws** on `!ok` |
| 2 | `helpers.extractMetadata` | chat/JSON | `!ok` OR parse-fail → warn + return `{topics:["uncategorized"],type:"observation"}` |
| 3 | `helpers.freshIngest` (split) | chat/JSON | `!ok` → **throws**; parse-fail → fall back to `[content.trim()]` |
| 4 | `people-extractor.detectAllPeople` | chat/JSON | `!ok` OR throw → `console.error` + return `[]` |
| 5 | `project-extractor.extractProjectNameFromPath` | chat/JSON | `!ok` OR throw → return `{isProject:false, projectName:null}` |
| 6 | `project-extractor.detectProjectsByContent` | chat/JSON | `!ok` OR throw → return `[]` |
| 7 | `task-extractor.inferProjectsByContent` | chat/JSON | `!ok`/throw → `{ok:false}`; parse-not-array → `{ok:true, []}` |
| 8 | `task-extractor.inferTaskEnrichments` | chat/JSON | same shape as #7 |
| — | `thoughts.ts` reconcile | chat/JSON | `!ok` → **throws**; parse-fail → fall back to fresh ingest |

The critical observation: **the fallback policy differs per call site** (throw
vs. degrade-to-default vs. degrade-to-alternate). A naïve "one function that
swallows everything" would silently change behavior — e.g. turning
`getEmbedding`'s throw into a `[]`, corrupting a thought's vector. So the seam
must centralize the *transport* (URL, model, key, `ok`, JSON parse) while leaving
each call site's *fallback* exactly where it is.

Composition root: `index.ts` constructs `supabase` + `logger` at module scope and
calls `createMcpServer(supabase, logger)` **per request** (Step 11), which calls
each tool module's `register(server, supabase, logger)`. Extractors receive an
`ExtractionContext`. Those are the two injection points.

## Goals / Non-Goals

**Goals:**
- One `AiProvider` interface + one `OpenRouterAiProvider` implementation; exactly
  one `openrouter.ai` literal in the codebase (grep-verifiable).
- Provider injected as a real dependency (tool `register(...)` params +
  `ExtractionContext`), threaded from `index.ts`. No module-level env reads for
  the LLM; no hidden singletons.
- Byte-for-byte identical runtime behavior, including each call site's distinct
  fallback — proven by the untouched integration suite.
- The seam is usable with a fake in unit tests (demonstrate on one extractor
  test).

**Non-Goals:**
- The `FakeAiProvider` / `TB_AI_PROVIDER` env selection and deletion of hedged
  test assertions — that is Step 22, which depends on this seam.
- Repository layer over supabase-js (Steps 16–17); this change touches only the
  LLM seam. `supabase.from(...)` calls stay as-is.
- Changing prompts, models, retry, or timeout behavior. No new capabilities on
  the provider beyond what the 8 call sites need (no speculative surface).

## Decisions

### D1 — Interface shape: `getEmbedding` + generic `completeJson`

```ts
export interface AiProvider {
  getEmbedding(text: string): Promise<number[]>;
  completeJson<Parsed>(
    request: AiJsonCompletionRequest,
    parse: (raw: unknown) => Parsed,
  ): Promise<Parsed>;
}

export interface AiJsonCompletionRequest {
  systemPrompt: string;
  userContent: string;
  /** Overrides the default chat model; omit for gpt-4o-mini. */
  model?: string;
}
```

`completeJson` performs: fetch → `response.ok` check → read
`data.choices[0].message.content` → `JSON.parse` → hand the parsed value to the
caller's `parse` callback → return its result. It is the single home for the
transport; the `parse` callback is where each call site validates/reshapes the
model output (allowlist filtering, field extraction) exactly as it does today.

**Failure signaling (the crux):** `completeJson` throws typed errors so callers
choose their own fallback:
- `AiProviderHttpError` (carries status + truncated body) when `!response.ok`.
- `AiProviderParseError` when the body/JSON is unreadable or the `parse`
  callback throws.

Each call site wraps `completeJson` in the try/catch it already has, mapping
those throws to its existing fallback. `getEmbedding` does **not** catch — it
lets `AiProviderHttpError` propagate, preserving its current throw.

*Alternative considered — `completeJson` returns `T | null` and never throws:*
rejected because it erases the HTTP-vs-parse distinction three call sites rely on
(freshIngest split falls back differently on `!ok` (throw) vs. parse-fail
(single-thought), and reconcile throws on `!ok` but falls back to fresh ingest on
parse-fail). Typed throws preserve those branches without a boolean-tuple return.

*Alternative considered — one method per prompt (`splitNote`, `detectPeople`,
…):* rejected as a fatter interface (8+ methods) that bakes prompt-engineering
into the seam and makes the fake harder to write; the generic `completeJson`
keeps the seam narrow (the owner's "3–5 methods" guidance) while prompts stay
next to their call sites.

### D2 — `OpenRouterAiProvider` owns URL, models, key

`new OpenRouterAiProvider()` takes no args and reads nothing at construction.
The base URL is one private constant; model names are named constants
(`CHAT_MODEL = "openai/gpt-4o-mini"`, `EMBEDDING_MODEL =
"openai/text-embedding-3-small"`). The API key is read **lazily** via
`requireEnv("OPENROUTER_API_KEY")` inside each request (matching today's
per-call read), so constructing the provider never throws and a missing key
still fails fast at the point of the first real LLM call with the variable named
(finding X5 alignment).

### D3 — Injection: `createAiProvider()` factory at the composition root

`index.ts` calls `const aiProvider = createAiProvider()` once at module scope
(alongside `supabase`/`logger`) and passes it into
`createMcpServer(supabase, logger, aiProvider)` → each
`register(server, supabase, logger, aiProvider)`. For this step the factory
returns `new OpenRouterAiProvider()`; it exists now purely so Step 22 can add
`if (Deno.env.get("TB_AI_PROVIDER") === "fake") return new FakeAiProvider()`
without touching a single call site.

The provider is stateless, so sharing one module-scope instance across requests
is safe (unlike the per-request `McpServer`). This is *injection*, not a hidden
singleton: nothing imports the provider off a module global — it arrives through
`register(...)` params and `ExtractionContext`, so a test constructs its own.

### D4 — Extractor injection via `ExtractionContext`

`ExtractionContext` gains `aiProvider: AiProvider`.
`runExtractionPipeline(note, extractors, supabase, aiProvider)` accepts it and
stores it on the context. The three extractors' private LLM helpers change from
module-level functions that call `fetch` to methods/functions that take
`context.aiProvider`. Their public `extract(note, context)` signature is
unchanged.

### D5 — helpers.ts functions take the provider as a parameter

`getEmbedding`, `extractMetadata`, and `freshIngest` gain an `aiProvider`
parameter (threaded from the `thoughts.ts` handlers, which receive it via
`register`). This keeps them pure/testable and removes their module-level
`OPENROUTER_BASE`. `freshIngest` forwards the provider into its internal
`getEmbedding`/`extractMetadata` calls.

### Test Strategy

Layers that apply and why:
- **Unit (new):** `ai/openrouter-provider.test.ts` with a stubbed `fetch`
  (injected or via a `globalThis.fetch` swap restored in `finally`) proving:
  `completeJson` returns the parsed value on 200; throws `AiProviderHttpError` on
  500 (with status); throws `AiProviderParseError` on non-JSON body; `getEmbedding`
  returns the vector and throws on `!ok`. Exactly one place mocks the network.
- **Unit (new, seam demonstration):** convert one extractor test
  (`project-extractor` content matching) to pass a hand-written `FakeAiProvider`
  and assert deterministic behavior with **no network** — proving the seam is
  real (GATE 2b: deleting the provider call reddens it).
- **Integration (existing, untouched):** the Deno `tests/integration/` suite
  exercises the real call sites end-to-end against local Supabase + live
  OpenRouter. Because this is a pure refactor, it must stay green **with no test
  edits** — any needed edit is a red flag that behavior drifted.
- **Not E2E:** no user-facing plugin/browser surface changes in this step.

### User Error Scenarios

This is an internal refactor with no new user-facing input, so "user" here is the
calling code / the LLM's response:
- **Missing `OPENROUTER_API_KEY`:** first LLM call throws a message naming the
  variable (unchanged behavior; now centralized in the provider's lazy read).
- **LLM returns malformed / non-JSON body:** `completeJson` raises
  `AiProviderParseError`; each call site's existing catch maps it to its
  documented fallback (uncategorized metadata / single-thought split / empty
  detection / fresh-ingest reconcile). No change from today.
- **LLM returns JSON of the wrong shape (hallucinated ids):** the caller's
  `parse` callback still applies its allowlist/`validIds` filter, so a
  hallucinated project/person id is dropped exactly as now.
- **OpenRouter 4xx/5xx / network drop:** `AiProviderHttpError` propagates or is
  caught per call site (throw for embedding/split/reconcile, degrade for the
  extractors) — identical to current behavior.

### Security Analysis

- **Secret handling:** the API key stays in the `Authorization: Bearer` header
  (never a URL/query string) and is read from env via `requireEnv`; the provider
  never logs the key. Error bodies embedded in `AiProviderHttpError` are
  truncated before logging (matching the existing `.text().catch(() => "")`
  pattern) so an upstream error page can't dump unbounded content into logs.
- **No new attack surface:** the seam adds no new inbound route, no new env var,
  no new external host — it consolidates existing outbound calls to the same
  OpenRouter host. Threat model unchanged from the current design; no
  `ThreatModel.md` delta required.
- **Prompt-injection posture unchanged:** untrusted note content still reaches
  the LLM exactly as before; the mitigation remains the per-call-site allowlist
  validation in the `parse` callbacks (LLM output validated against known ids),
  which this change preserves and makes the single obvious place to harden later.

## Risks / Trade-offs

- **Risk: a subtle fallback-behavior drift during the mechanical swap** (e.g.
  accidentally catching `getEmbedding`'s throw). → Mitigation: the fallback table
  above is the checklist; the untouched integration suite is the net; the new
  provider unit test pins throw-vs-return semantics.
- **Risk: `completeJson`'s generic `parse` callback tempts call sites to move
  logic into/out of it, changing behavior.** → Mitigation: keep each `parse`
  callback a literal copy of today's inline parse/validate; no logic added or
  removed in this step.
- **Trade-off: one shared provider instance across requests.** Acceptable because
  the provider is stateless (no per-request data); documented in D3. If a future
  provider needs per-request state, construct it inside `createMcpServer`.
- **Risk: `freshIngest`/handlers gaining a parameter ripples through several
  call sites.** → Mitigation: threading is mechanical and compiler-checked;
  `deno check` + the suite catch any missed wiring.
