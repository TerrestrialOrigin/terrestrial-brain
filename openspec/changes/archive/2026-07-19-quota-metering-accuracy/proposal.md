# Quota Metering Accuracy

## Why

`countMeteredCallsSince` counts **every** metered `function_call_logs` row — including calls that were themselves refused over-quota and calls that crashed — because rows are written before the gate runs (remediation plan Step 19, CORE-9). Consequences: a refused call's row keeps counting for the rest of the month (a customer who retries after a refusal burns quota they never consumed), and the user-visible message can claim "you've used 150 of 100". Separately, `withAiQuota` and the ingest-note route hard-code `Date.now()`, so month-boundary behavior can't be unit-tested at a chosen instant (CORE-13). (CORE-10 — the gate injected through the route deps — already landed in Step 18.)

## What Changes

- **CORE-9** — the meter query excludes non-consuming rows: `.is("error_details", null)`. Refused and failed calls (both of which end with `error_details` set — verified for the MCP decorator's `isError` path and the HTTP dispatcher's `!result.ok`/throw paths) no longer count against the quota. The gate keeps the documented pre-count convention (`used <= limit`, the in-flight call's own row is included), and the residual ±concurrency admission window is documented on `AiQuotaGate.check` as an accepted tolerance of best-effort cost control.
- **CORE-13** — `withAiQuota` gains an optional `now: () => number = Date.now` parameter; `HttpRouteDeps` gains a `now: () => number` seam used by the ingest-note route (composition root passes `Date.now`). Month-rollover becomes unit-testable at the decorator/route level.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `managed-ai-metering` (`openspec/specs/managed-ai-metering/spec.md`): MODIFIED "Usage is counted from existing telemetry…" — errored/refused rows are excluded from the count; ADDED — a previously-refused call does not reduce the remaining allowance; the enforcement clock is injectable.

## Non-goals

- No SQL-function counting, no transactional admission — the ±concurrency window is documented, not eliminated (the gate is documented best-effort cost control, not a billing ledger).
- No change to fail-open policy, the metered-function set, or the refusal message format.

## Impact

- `supabase/functions/terrestrial-brain-mcp/usage-meter.ts` (query filter)
- `supabase/functions/terrestrial-brain-mcp/ai-quota.ts` (doc + `now` param)
- `supabase/functions/terrestrial-brain-mcp/http-routes.ts` + `index.ts` (clock seam through deps)
- Tests: unit (fake meter / fake client chain; decorator rollover with frozen clock); integration (a refused call does not decrement remaining allowance — RED first).

---

## Scope extension: Step 20 — Extractor enrichment & merge (combined per user instruction)

This change also lands remediation Step 20 (`bug/ExtractorEnrichmentMerge` — EXTR-3, EXTR-4, EXTR-8, EXTR-10), completing Phase C in one OpenSpec change:

- **EXTR-3** — `extractAssignment` no longer picks the first-in-list person by substring containment; it delegates to the shared tiered matcher (`findPersonByName`: exact full name, then unambiguous name-part). Ambiguous candidates fall through to the AI path.
- **EXTR-4** — an enrichment response entry that is **absent** for a task (e.g. truncated completion) preserves the task's stored `due_by`/`assigned_to`; only an entry present with explicit nulls clears them. `applyAiEnrichment` reports the responded index set.
- **EXTR-8** — all five LLM parse callbacks guard each response element (`isRecord`) so one malformed element (e.g. `null`) is skipped instead of throwing and discarding the whole batch; the raw response object is guarded the same way.
- **EXTR-10** — `findPersonInText` tier-1 tie-break prefers the longer (more specific) name at equal position: "Ann Smith" beats "Ann" regardless of list order.

Modified capabilities (delta specs): `task-extractor`, `people-extractor`.
