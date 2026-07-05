## Context

The MCP edge function (`supabase/functions/terrestrial-brain-mcp/`) reads required secrets at module load with `Deno.env.get(NAME)!`. The `!` silences the compiler's `string | undefined`, so a missing variable yields `undefined` at runtime with no error — it only surfaces later as a corrupt outbound request (`Authorization: Bearer undefined`) or a broken auth compare. Separately, most read handlers destructure only `{ data }` from Supabase calls and drop `{ error }`; `helpers.extractMetadata` catches every failure into a hard-coded `{ topics: ["uncategorized"] }` fallback with no `response.ok` check and no log. The net effect: infrastructure failures are indistinguishable from genuinely-empty results.

This is fix-plan Step 10 (findings X5 fail-fast env, C9 silent-error surfacing). It is a bug-fix step, so each defect is pinned by a failing test written first.

## Goals / Non-Goals

**Goals:**
- A missing required env var makes the function fail fast at cold start with a message naming the variable.
- Every Supabase sub-query and external-API call in the touched handlers checks its error channel; a failure is logged and rendered as an explicit `(section unavailable: <reason>)` marker, never as empty-state prose or a silent fallback.
- The new logic is unit-testable without a live DB or a paid LLM key (the `requireEnv` throw and the "unavailable" marker are covered by deterministic tests).

**Non-Goals:**
- No repository/`AiProvider` seam introduction — that is Steps 15–17. Here we only add a narrow `requireEnv` helper and surface errors in-place; the broader dependency-injection refactor is deliberately deferred.
- No change to the auth mechanism, HTTP contract, or database schema.
- No new retry/backoff logic — surfacing the failure is the scope; recovery strategy is out.
- `date-parser.ts` is untouched: it already reads `TB_USER_TIMEZONE` with a `?? "UTC"` default (not a `!`), so it is not a fail-fast defect.

## Decisions

### D1: A tiny `requireEnv(name): string` helper in a new `env.ts` module
Single home for the fail-fast read: `const value = Deno.env.get(name); if (value === undefined || value === "") throw new Error(...)`. Every module-level secret read imports it. Alternative considered: a central config object built once and imported. Rejected for this step — it would force threading config through every module and overlaps with the Step 15 injection work; a per-read `requireEnv` is the minimal change that fixes X5 and is trivially unit-testable. The helper treats empty-string as missing (an empty secret is never valid) and names the variable in the thrown message so ops can diagnose instantly.

**Placement — module-load vs lazy call-time (refined during implementation):** The three composition-root infra secrets in `index.ts` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `MCP_ACCESS_KEY`) are validated at **module load** — `index.ts` is the boot entrypoint (imported only by the running function and integration tests, both of which have the secrets set), so a throw there is exactly the cold-start fail-fast X5 asks for, and the platform reports the boot error. The `OPENROUTER_API_KEY` reads in `helpers.ts`, `tools/thoughts.ts`, and the three extractor files are instead validated **lazily at call time** (inside each function immediately before building the OpenRouter request). Rationale: those modules are imported by pure unit tests that stub `fetch` and never set a real key; a module-load throw would break the import of unrelated pure-function tests in the same file. A call-time `requireEnv` still fails fast the moment an LLM call is attempted without a key (no more `Bearer undefined`), keeps module import side-effect-free (better testability, and the seam Step 15 will build on), and only requires the two stubbed LLM-path unit tests to set a throwaway key value. Net: same fail-fast guarantee, import-safe modules.

### D2: `(section unavailable: <reason>)` marker convention for surfaced errors
When a sub-query returns `{ error }`, the handler logs `console.error` with context and substitutes the section body with `(section unavailable: <error.message>)` instead of the "No open tasks." / "No recent thoughts." empty-state text. The section header/count line still renders so the overall response shape is stable. Rationale: the caller (an AI agent) must be able to tell "there are zero tasks" from "we couldn't load tasks" — the two demand different downstream behavior. A single shared string builder keeps the marker text consistent across handlers.

**Distinction preserved:** empty-state prose ("No open tasks.") is emitted ONLY when the query succeeded (`error` is null) and returned zero rows. A non-null `error` always yields the unavailable marker. This is the "empty vs broken" rule from the code-quality directives.

### D3: `extractMetadata` mirrors `getEmbedding`'s error handling, but degrades rather than throws
`getEmbedding` throws on `!response.ok`. `extractMetadata` is called on a best-effort enrichment path where a total ingest failure would be worse than degraded metadata, so it keeps its `{ topics: ["uncategorized"] }` fallback — but now (a) checks `response.ok` and (b) `console.warn`s with the status/body before falling back, so the degradation is observable in logs. Alternative considered: make it throw like `getEmbedding`. Rejected because metadata is non-critical enrichment; the thought should still be captured. The fix is *observability* of the fallback, not changing the fallback policy. This trade-off is recorded so a future step can revisit if metadata quality matters more.

### D4: Name-resolution failures surface but do not abort the parent operation
In `tasks.ts`/`ai_output.ts`/`documents.ts`, project/person name lookups that error today silently yield an empty name map (rows then show a raw UUID or blank). After this change the error is logged and the affected names fall back to the raw id with the failure noted, rather than being indistinguishable from "no such name." These are secondary enrichment queries, so like D3 they log-and-degrade rather than fail the whole tool call — consistent with D2's "render the failure, don't crash the response."

## User Error Scenarios

- **Operator deploys with a missing/empty secret** → function throws at cold start naming the variable (D1); operator sees the exact missing var in the platform boot log instead of a runtime `Bearer undefined`.
- **Caller requests a project summary during a transient DB outage** → each failed sub-query renders `(section unavailable: <reason>)`; the caller is not misled into believing the project has no tasks/thoughts.
- **Caller ingests a note while OpenRouter is degraded** → `extractMetadata` logs a warning and falls back to `uncategorized`; the thought is still captured (no data loss), and the log records that metadata was degraded.
- **Caller passes a valid UUID whose name row was concurrently deleted** → name resolution surfaces the raw id rather than a blank, so the response is still interpretable.

## Security Analysis

- **Threat: secret disclosure in error messages.** `requireEnv` throws with the variable *name* only, never its value; the "unavailable" marker echoes `error.message` from Supabase (schema/constraint text, not secrets). No secret material is added to any surfaced string. Recorded in `ThreatModel.md`.
- **Threat: fail-fast as a denial-of-service lever.** A missing env var stops the whole function. This is intentional and correct for a required secret (running without `MCP_ACCESS_KEY` would be a worse security hole — open auth). Only genuinely-required vars use `requireEnv`; optional ones keep defaults.
- **Threat: information leakage via surfaced DB errors.** Supabase error messages could in principle name internal columns. This is an existing, low-severity exposure to an already-authenticated caller (the shared-secret gate is upstream); the marker does not widen it beyond what `console.error` and the existing top-level `catch` already expose. No new external surface.
- No change to authn/authz, input validation, or the HTTP contract.

## Test Strategy

- **Unit (new, no external deps):** `tests/unit/env.test.ts` — `requireEnv` returns a set value, throws naming the var when unset/empty. `tests/unit/query-error-surfacing.test.ts` — a pure section-builder given a simulated `{ error }` produces the `(section unavailable: …)` marker and given `{ data: [] }` produces the empty-state prose (proves the empty-vs-broken split). To make the marker logic unit-testable without a live DB, the per-section formatting that chooses marker-vs-empty is extracted into a small pure helper the test calls directly.
- **Integration (Deno, live local Supabase):** existing `queries`/`thoughts` integration tests must stay green — the successful path is unchanged. Add one integration assertion that a normal `get_project_summary` still emits empty-state prose (not the marker) when a section is genuinely empty, guarding against over-surfacing.
- **Bug-fix replication:** the env test and the marker-vs-empty test are written to FAIL against current code first (current code has no `requireEnv` and renders empty-state on error), then pass after the fix (GATE 2b mutation check: deleting the error-check reddens the marker test).
- Layers per fix-plan: Deno `tests/unit` + `tests/integration`. No plugin changes, so no vitest layer for this step.

## Risks / Trade-offs

- **[Import-time throw could mask which var is missing if several are absent]** → `requireEnv` throws on the first missing var; operator fixes and redeploys iteratively. Acceptable — the message names each var as it's hit. Mitigation noted; a future enhancement could aggregate.
- **[Over-surfacing: turning a benign empty result into a scary "unavailable" marker]** → guarded by the D2 rule (marker only on non-null `error`) and an integration test asserting genuine-empty still shows empty-state prose.
- **[`extractMetadata` still degrades silently to callers]** → by design (D3); the degradation is now logged, and the trade-off is documented for a later revisit. Not a regression — it is strictly more observable than today.

## Migration Plan

Pure code change, no DB migration. Deploy is a standard function redeploy. Rollback is reverting the branch. The only behavioral risk at deploy time is the new fail-fast: verify all four required env vars are set in the target environment before deploying (they already must be, or the function was silently broken).
