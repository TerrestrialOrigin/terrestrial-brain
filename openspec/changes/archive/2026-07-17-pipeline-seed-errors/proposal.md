## Why

`runExtractionPipeline` discards the `error` channel of all three seed reads (`projectRepository.listActive`, `personRepository.listActive`, `taskRepository.findByReference`) and coalesces to empty arrays. A transient DB error on `findByReference` during re-ingest yields `knownTasks = []`, so reconciliation matches nothing and a **duplicate task is inserted for every checkbox in the note** — the highest-severity bug class the directives call out (EXTR-2). Separately, extractor write failures are logged then dropped: `PeopleExtractor`/`ProjectExtractor` never populate `ExtractionResult.errors` at all, so ingest reports full success while auto-create silently failed (EXTR-6).

## What Changes

- `runExtractionPipeline` returns a discriminated `PipelineOutcome` (`{ ok: true; references; errors } | { ok: false; error }`). A failed seed read aborts BEFORE any extractor runs — no extractor executes and no write is attempted.
- The runner collects every extractor's reported write failures into `errors` (still logged) so callers can report partial failure.
- `PeopleExtractor` and `ProjectExtractor` populate `ExtractionResult.errors` on auto-create failure (mirroring `TaskExtractor`).
- The four call sites (`write_document`, `update_document`, `capture_thought`, `handleIngestNote`) surface an error result on `ok: false` (ingesting nothing) and append a partial-failure warning when `errors` is non-empty.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `extractor-pipeline`: The pipeline runner aborts on a failed seed read and returns collected extractor write failures instead of swallowing them.

## Impact

- `extractors/pipeline.ts` (return type, seed-error abort, error collection, `partialExtractionWarning`)
- `extractors/people-extractor.ts`, `extractors/project-extractor.ts` (populate `errors`)
- `tools/documents.ts`, `tools/thoughts.ts` (handle `PipelineOutcome`)
- Tests: `tests/unit/pipeline.test.ts`, `tests/unit/people-extractor.test.ts`, `tests/unit/project-extractor.test.ts`, `tests/integration/extractors.test.ts`
- No schema or dependency changes.

## Non-goals

- The DB-side dedup index / 23505-recovering create-or-get for the interleave half of EXTR-7 is Step 11 (Phase B).
- Options-object refactor of the runner signature (EXTR-9) is Phase E.
