## Why

`requestReconciliationPlan` returned the LLM's JSON via a bare `raw as ReconciliationPlan` cast with zero runtime validation, on output that directly drives irreversible DB mutations (`thoughtRepository.update` overwriting content/embedding/hash, `thoughtRepository.archive`). A hallucinated but valid-shaped UUID in `update`/`delete` could **overwrite or archive an unrelated thought**; a missing `content`, a non-array field (`"delete": "all"`), or an object-shaped `add` entry crashed far from the cause. This violates the binding rule "validate LLM outputs against allowlists so a hallucinated value can't flow into a mutation" (TOOL-1).

## What Changes

- Parse the reconciliation plan with a Zod schema (`ReconciliationPlanSchema`) inside the `completeJson` callback; a wrong shape throws `AiProviderParseError`, which the existing catch degrades to a safe fresh ingest.
- After parsing, intersect every `keep`/`update`/`delete` id against this note's existing thought ids (allowlist); drop and log any id not in the set so a hallucinated UUID can never reach `update`/`archive`.
- Remove the `as unknown as { thought: string }` double-cast in `executeReconciliationPlan` — the schema guarantees `add` entries are non-empty strings.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `thoughts`: Note reconciliation validates the LLM plan and allowlists its ids before any mutation.

## Impact

- `tools/thoughts.ts` (`ReconciliationPlanSchema`, `filterPlanToKnownIds`, `requestReconciliationPlan`, `executeReconciliationPlan`)
- Tests: `tests/unit/ingest-note-steps.test.ts`
- No schema, API, or dependency changes (Zod already a dependency).

## Non-goals

- No change to the reconciliation prompt or the fresh-ingest fallback contract.
- Concurrency of the reconcile mutations is out of scope (separate findings).
