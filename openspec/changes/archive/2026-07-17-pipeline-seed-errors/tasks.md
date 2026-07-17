## 1. Failing tests first (RED)

- [x] 1.1 `tests/unit/pipeline.test.ts`: seed-read abort for each of the three seed sources (no extractor runs, no insert attempted, `ok === false`); outcome carries collected extractor errors; success outcome has empty `errors`.
- [x] 1.2 `tests/unit/people-extractor.test.ts` + `tests/unit/project-extractor.test.ts`: auto-create insert failure populates `result.errors`.
- [x] 1.3 Confirm RED: the abort tests fail (outcome `ok: true`, insert attempted) and the extractor tests fail (`result.errors` undefined).

## 2. Fix (GREEN)

- [x] 2.1 `pipeline.ts`: add `PipelineOutcome` types + `partialExtractionWarning`; check the three seed errors and abort; collect and return extractor `errors`.
- [x] 2.2 `people-extractor.ts` / `project-extractor.ts`: thread an `errors` accumulator through the auto-create paths and return it.
- [x] 2.3 Update the four callers (`write_document`, `update_document`, `capture_thought`, `handleIngestNote`) to handle `PipelineOutcome` — abort on `!ok`, append the warning on non-empty `errors`.
- [x] 2.4 Migrate `tests/integration/extractors.test.ts` to a `runPipelineRefs` unwrapper.

## 3. Testing & Verification

- [x] 3.1 GATE 2b: abort tests were RED before the abort was wired; extractor error tests RED before `errors` population.
- [x] 3.2 Full `deno task test` against a reset stack green; `deno lint` + `deno fmt` clean; edge function `deno check` clean.
- [x] 3.3 `/opsx:verify` (validate) + `/opsx:archive`; check off Step 2 in the plan; commit.
