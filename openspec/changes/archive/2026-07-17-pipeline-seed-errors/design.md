## Context

`runExtractionPipeline` destructured only `data` from three seed reads and coalesced to `[]`, so a read failure was indistinguishable from a clean empty result. During re-ingest that means `knownTasks = []` → reconciliation matches nothing → `createNewTasks` inserts a duplicate for every checkbox (EXTR-2). Extractor write failures were logged by the runner but not returned; `PeopleExtractor`/`ProjectExtractor` did not populate `errors` at all (EXTR-6).

## Goals / Non-Goals

**Goals:**
- Never turn a seed read failure into duplicate writes — abort before any extractor runs.
- Return extractor write failures so callers can report partial failure.
- Keep the happy path behavior byte-for-byte (existing extractor tests stay green).

**Non-Goals:**
- DB-level dedup constraints / 23505 recovery (Step 11).
- Runner options-object refactor (Phase E, EXTR-9).

## Decisions

- **Discriminated `PipelineOutcome`.** `runExtractionPipeline` returns `{ ok: true; references; errors } | { ok: false; error }`. Chosen over throwing a typed error because the callers already use `{ data, error }`-style control flow and a return keeps the seam explicit and test-friendly. Seed errors are checked in read order and short-circuit to `{ ok: false, error }`.
- **Error collection in the runner.** Each extractor already returns `ExtractionResult.errors?`. The runner both logs (unchanged) AND pushes them into `collectedErrors`, returned as `errors`.
- **Extractors populate `errors`.** `PeopleExtractor.createPerson` / `ProjectExtractor.matchOrCreateProject` take an `errors: string[]` accumulator and push the same message they already log; `extract` returns `errors.length ? errors : undefined`.
- **Shared `partialExtractionWarning(errors)`.** One exported helper formats the caller-facing suffix (Rule of Three across the four call sites).
- **Caller policy.** On `ok: false` each caller returns an error result and writes nothing (capture/ingest: no thought; write/update_document: abort before the DB write). On `ok: true` with non-empty `errors`, the warning suffix is appended to the success message.

### User error scenarios

- Transient DB blip during re-ingest → abort with a retryable error instead of silently duplicating tasks.
- Partial auto-create failure (e.g. RLS denies people inserts) → ingest still succeeds for what worked but the response says N reference writes failed.

### Security analysis

No new external input surface; repository seam already authenticated. Error messages surfaced to the caller are repository error messages (no secrets). No ThreatModel change.

### Test Strategy

- Unit: pipeline seed-abort (three seed sources) with fakes returning `{ data: null, error }`, asserting no extractor ran and no insert attempted; error-collection on the outcome; per-extractor `errors` population. RED-first (return-type change captured at runtime by leaving the abort unwired first, confirming the abort tests fail, then wiring it).
- Integration: existing `extractors.test.ts` migrated to a `runPipelineRefs` unwrapper; full `deno task test` green.

## Risks / Trade-offs

- **Risk:** Aborting a re-ingest on a transient read failure returns an error to the user instead of silently proceeding. Accepted — a retryable error is strictly better than duplicated tasks that require manual cleanup.
- **Trade-off:** Return-type change touches four call sites and one integration test. Mechanical; covered by the full suite.
