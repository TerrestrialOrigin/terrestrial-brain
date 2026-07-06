## Context

The MCP edge function reaches OpenRouter for two things: 1536-dim embeddings (`getEmbedding`) and JSON-mode chat completions (`completeJson`), both behind the `AiProvider` interface (Step 15). Today the only implementation is `OpenRouterAiProvider`, so the Deno integration suite requires a live, paid `OPENROUTER_API_KEY` and is nondeterministic. To cope, several tests hedge (`if (!result.includes("No thoughts found")) { assert… }`) — the assertion runs only when the LLM happened to return data, so the test passes even when the behavior it names is broken. This change adds the deterministic fake the seam was designed for and removes the hedges.

There are exactly eight `completeJson` call sites, each with a distinctive system prompt and its own `parse` callback:

1. `extractMetadata` (`helpers.ts`) — "Extract metadata from the user's captured thought" → `{topics, type, people, action_items, dates_mentioned}`
2. `freshIngest` split (`helpers.ts`) — "You split notes into discrete, standalone thoughts" → `{thoughts: string[]}`
3. `requestReconciliationPlan` (`tools/thoughts.ts`) — "You reconcile an updated note" → `{keep, update, add, delete}`
4. `inferProjectsByContent` (`task-extractor.ts`) — "You match tasks to projects" → `{assignments: [...]}`
5. `enrichTasks` (`task-extractor.ts`) — "You extract metadata from task descriptions" → `{enrichments: [...]}`
6. `extractProjectNameFromPath` (`project-extractor.ts`) — "You analyze file paths" → `{is_project, project_name}`
7. `detectProjectsByContent` (`project-extractor.ts`) — "You identify which projects a note is about" → `{project_ids: [...]}`
8. `detectAllPeople` (`people-extractor.ts`) — "You identify people mentioned in a note" → `{people: [...]}`

Every `parse` callback already validates/reshapes and clamps to safe defaults (empty arrays, `false`), so the fake only has to return a JSON value the callback accepts — it never has to be "smart."

## Goals / Non-Goals

**Goals:**
- A `FakeAiProvider` selectable by `TB_AI_PROVIDER=fake` at the `createAiProvider()` factory — the ONLY place selection happens; no call site changes.
- Deterministic 1536-dim embeddings whose cosine similarity is stable and monotonic in content overlap: identical text → identical vector; heavily-overlapping text → high similarity (above the suite's `threshold`); unrelated text → low similarity. This makes `search_thoughts`/`match_thoughts` reproducible so a captured thought is reliably findable by a related query.
- Deterministic `completeJson` responses for all eight shapes, sufficient for capture/ingest/extraction/reconciliation to complete and for the de-hedged tests to assert hard outcomes.
- A `deno task test:live-llm` opt-in tier that runs against the real provider; the default suite runs green with NO `OPENROUTER_API_KEY`.

**Non-Goals:**
- No change to `OpenRouterAiProvider` or production behavior (unset var → real provider).
- No change to the `AiProvider` interface signature.
- No semantic NLP in the fake — similarity is a deterministic function of surface content overlap, not meaning.
- No CI wiring (Step 23).

## Decisions

### D1: Select the fake at the factory via `TB_AI_PROVIDER`, defaulting to real
`createAiProvider()` reads `TB_AI_PROVIDER`; `=== "fake"` returns `new FakeAiProvider()`, otherwise `new OpenRouterAiProvider()`. **Why:** the factory is the composition root the seam was built around (its own comment anticipates this). Any unset/unknown value → real provider, so production and the live tier are safe by default and only the test stack opts in. *Alternative rejected:* a separate `createTestAiProvider()` imported by tests — but tools construct the provider server-side inside the edge function, not in the test process, so selection must be an env var the running function reads.

### D2: Embeddings = seeded, token-hashed, L2-normalized 1536-vectors
Lowercase the text, split into word tokens, hash each token (FNV-1a → bucket in `[0,1536)`), accumulate token weights into the vector, then L2-normalize. **Why:** cosine similarity of two such vectors rises with shared-token overlap and is exactly 1.0 for identical text — deterministic, no RNG (`Math.random` is banned in this stack anyway), dimension-correct for the `vector(1536)` column and `match_thoughts`. Unrelated texts share few buckets → low cosine. *Alternatives rejected:* (a) constant vector — every thought would match every query (useless for search assertions); (b) per-text random vector cached in a map — not stable across the two isolates/processes that embed the stored thought vs. the query.

### D3: `completeJson` dispatches on a stable substring of the system prompt
The fake matches each request against a distinctive, unlikely-to-drift phrase from its system prompt (e.g. `"split notes into discrete"`, `"reconcile an updated note"`) and returns the matching shape. Unknown prompts return a benign empty object `{}` (every caller's `parse` degrades that to its safe default). **Why:** the system prompts are the only stable discriminator available inside the provider; the `model` field is identical across calls. A central `const DISPATCH` table keeps each matcher + responder in one short function. *Alternative rejected:* threading a `purpose` tag through `AiJsonCompletionRequest` — that changes the interface and touches all eight call sites for test-only benefit; substring dispatch keeps the seam untouched.

### D4: Fake completion payloads are content-derived, not hard-coded blanks
- **split thoughts** → return the note as a single-element array (`{thoughts: [<note text>]}`), matching the real provider's "already one coherent thought" branch — so ingest deterministically produces one findable thought.
- **extractMetadata** → `{topics: [<first content word or "general">], type: "observation", people: [], action_items: [], dates_mentioned: []}`.
- **reconciliation** → keep all existing IDs, no add/update/delete (`{keep: [...ids], update: [], add: [], delete: []}`) — the safe no-op plan; specific reconcile tests that need add/delete assert via the deterministic content rules below.
- **people / projects / tasks extractors** → echo deterministic matches derived from the input against the supplied known-entity lists (e.g. a known person whose name appears in the note is returned with its id; otherwise empty). **Why:** tests assert real extraction outcomes (a person gets linked, a task gets a project) — a blank response would make those assertions un-writable. Deriving from input keeps the fake honest (GATE 2b: deleting the extractor code still reddens the test because the tool no longer applies the fake's output).

### D5: Live-LLM tier is a separate task, never a skip
Move/keep a minimal set of live-only assertions under `tests/live/` and add `deno.json` task `test:live-llm` = `deno test --allow-net --allow-env tests/live/`. It is never part of `deno task test`. **Why:** the owner's zero-skip rule — a live tier that would `test.skip` without a key is a skip in disguise; making it a distinct, explicitly-invoked task honors "opt-in tier, NOT a skip."

### Test Strategy
- **Unit** (`tests/unit/fake-provider.test.ts`, no DB, no network): embedding determinism (same text → identical vector, 1536 dims, unit length), similarity monotonicity (overlap > unrelated, self-similarity ≈ 1.0), and each `completeJson` shape returns the documented structure. This is the layer that pins the fake itself.
- **Integration** (existing `tests/integration/*`, now run with `TB_AI_PROVIDER=fake`): the de-hedged assertions become hard — `search_thoughts` finds a just-captured related thought; ingest/extraction produce the asserted rows. Zero mocks on the path; the fake is the real injected provider inside the running edge function.
- **Live** (`tests/live/`, opt-in): a couple of smoke assertions that the real provider still returns well-formed embeddings/completions.
- **GATE 2b:** for each de-hedged test, deleting the implementation it targets must redden it — verified because the fake supplies data the tool must actually process to satisfy the assertion.

## Risks / Trade-offs

- **[Fake similarity doesn't clear the search `threshold` used in tests]** → tune the token-hash accumulation and pick/adjust the `threshold` in the affected tests so an overlapping query reliably matches; assert the concrete similarity behavior in the unit test so drift is caught there, not flakily in integration.
- **[System-prompt substring dispatch breaks if a prompt is reworded]** → choose phrases central to each prompt's purpose (unlikely to change without a behavior change), and cover every dispatch branch in the unit test so a reword fails loudly with a clear "unmatched prompt" signal rather than silently returning `{}`.
- **[Edge function reads `TB_AI_PROVIDER` but the test stack doesn't set it]** → set it in the same env surface as `OPENROUTER_API_KEY` (`supabase/functions/.env`) and/or the local start path, and add a unit assertion that the factory returns the fake when the var is `fake`; document in README.
- **[Fake diverges from real provider's error contract]** → the fake implements the same typed-error surface only where a caller depends on it; for the default happy paths it returns success. Live tier still exercises the real error handling.
- **[`{}` fallback masks a genuinely unmatched prompt in production]** → the fake is never selected in production (`TB_AI_PROVIDER` unset → real). The fallback only affects the test stack, where the unit test asserts all real prompts are matched.

## User Error Scenarios

- **`TB_AI_PROVIDER` set to a typo (`fak`, `Fake`, `real`)** → treated as "not fake" → real provider. Documented as case-sensitive exact `fake`. No crash; if the key is also unset, the real provider fails fast with the existing `requireEnv` error naming `OPENROUTER_API_KEY` — a clear signal, not a silent stub.
- **Developer runs `deno task test` expecting live behavior** → gets deterministic fake results; README states the default suite is fake and `test:live-llm` is the live tier, so the two are not confusable.
- **Developer runs `test:live-llm` with no key** → the real provider throws the `requireEnv` "OPENROUTER_API_KEY is not set" error immediately (fail-loud), never a silent skip.
- **Fake asked to embed empty string** → returns a deterministic zero-or-unit vector of correct dimension without throwing (mirrors a valid-but-empty input); unit test covers it.

## Security analysis

Threats are documented in `ThreatModel.md`. Summary: the fake is a **test-only** component with no new external surface. Key considerations:
- The fake must never be selectable by accident in production — mitigated by defaulting to the real provider for any value other than the exact string `fake`, and by never setting `TB_AI_PROVIDER` in production config.
- The fake removes the need for a real `OPENROUTER_API_KEY` in the default/CI test path, *reducing* secret exposure (a live key no longer has to exist in CI).
- The fake performs no network I/O, reads no secrets, and writes no data outside what the calling tool already writes — no new data-egress or injection surface.

## Migration Plan

1. Add `fake-provider.ts` + factory branch (no behavior change while `TB_AI_PROVIDER` unset).
2. Point the local/test stack at `TB_AI_PROVIDER=fake`.
3. De-hedge the tests and add the unit test; run the full suite with NO key set → green.
4. Add `test:live-llm` task and `tests/live/`; document both tiers in README.
- **Rollback:** unset `TB_AI_PROVIDER` (or delete the factory branch) → suite reverts to requiring the live key. No data or schema migration is involved, so rollback is a config revert.

## Open Questions

- Exact search `threshold` values the de-hedged tests should use — resolved empirically during apply against the fake's measured similarity, and pinned in the unit test.
