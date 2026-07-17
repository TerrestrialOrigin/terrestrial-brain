## Context

`requestReconciliationPlan` cast the LLM JSON with `raw as ReconciliationPlan`. The plan drives `thoughtRepository.update` (overwrites content, embedding, content_hash — no history) and `thoughtRepository.archive`. A valid-UUID-but-foreign id therefore silently mutated an unrelated thought; a shape violation crashed downstream. Zod is already a dependency and used elsewhere in this file (`uuidField`).

## Goals / Non-Goals

**Goals:**
- No hallucinated id can reach a mutation.
- Shape violations degrade to the existing safe fresh-ingest fallback, not a crash.
- Preserve existing behavior for well-formed plans whose ids belong to the note.

**Non-Goals:** reconcile-op concurrency; prompt changes.

## Decisions

- **Schema shape, not strict UUID, for ids.** `ReconciliationPlanSchema` validates ids as `z.string()` (structural) rather than `uuidField()`, because the belonging **allowlist** (`filterPlanToKnownIds`, intersecting against this note's thought ids) is the real protection against the mutation attack, and it also catches non-UUID garbage (a garbage id is never in `existingThoughts`). Using strict UUID in the schema would reject an entire otherwise-valid plan over one malformed id, needlessly losing valid `keep`/`update`/`delete` work; the allowlist drops just the bad id. `content`/`add` entries ARE validated as non-empty strings, so a missing-content update or object-shaped add still degrades the whole plan to fresh ingest (safe).
- **Throw `AiProviderParseError` from the parse callback** on `safeParse` failure, so the existing `catch (reconcileError instanceof AiProviderParseError) → null` path degrades to fresh ingest with no new control flow.
- **`.default([])` per field** so a plan omitting a field is an empty (no-op) plan, matching the prior `plan.x || []` guards.
- **Drop the `add` double-cast.** Schema guarantees `add` entries are strings, so `executeReconciliationPlan` iterates them directly with no `as` casts.

### User error scenarios

- Model hallucinates an id from a different note → dropped + logged, no cross-note mutation.
- Model truncates/malforms the plan → fresh ingest (documented safe fallback), no partial corruption.

### Security analysis

Directly addresses the "hallucinated value flows into a mutation" threat. No new external surface. Logged dropped ids are opaque UUIDs (no PII). No ThreatModel change beyond closing this validation gap.

### Test Strategy

Unit-only, via a stub `AiProvider` feeding raw plans through the real parser: allowlist drop of foreign ids; missing-content → null; non-array → null; object-add → null; well-formed pass-through. RED-first confirmed (allowlist absent, invalid shapes accepted). GATE 2b: removing the allowlist re-reddens the foreign-id test.

## Risks / Trade-offs

- **Trade-off:** A single malformed `update`/`add` entry degrades the WHOLE plan to fresh ingest rather than salvaging the rest. Accepted — fresh ingest is the documented safe fallback and never corrupts data; per-entry salvage would add complexity for little gain.
