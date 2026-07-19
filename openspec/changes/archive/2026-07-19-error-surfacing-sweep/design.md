# Design — Error Surfacing Sweep

## Context

The 2026-07-04 remediation consolidated error surfacing for composite queries (`section-format.ts`, the `(section unavailable: …)` convention) and repository envelopes (`RepoResult<{ data, error }>`). Five residual sites still read only `data` and render failure as emptiness, or discard failure detail entirely. All fixes reuse existing conventions — no new patterns are introduced.

Current state per finding:

- **TOOL-4**: `tools/projects.ts` `get_project` drops errors from `findName` (~317), `listChildrenBasic` (~324), `countOpenByProject` (~327); `list_projects` drops `listChildParentIds` error (~229); `tools/people.ts` `get_person` drops `countOpenByAssignee` error (~157). A failed count prints `Open tasks: 0`.
- **TOOL-5**: three bare `await thoughtRepository.touchRetrieved(…)` calls (`tools/thoughts.ts` ~312, ~467, ~568) discard the returned `{ error }` — inconsistent with the logged `incrementUsefulness` failure ten lines below one of them.
- **TOOL-12**: `capture_thought` (thoughts.ts ~698) and `write_document` (documents.ts ~100) catch a *thrown* extraction pipeline with `console.error` only, while `update_document` (documents.ts ~378) sets a user-visible `contentWarning`. The `extractionWarning` variable is already declared and appended in both offending handlers — the catch blocks just never set it.
- **TOOL-13**: `executeReconciliationPlan` (thoughts.ts ~1422) and `freshIngest` (helpers.ts ~249) count `allSettled` rejections but never log `result.reason`, though each op constructs a descriptive `Error` message.
- **REPO-7**: `supabase-task-repository.ts` count methods return `{ data: count ?? 0, error: toRepoError(error) }` — the only envelope in the codebase where `data` is non-null alongside an error.

## Goals / Non-Goals

**Goals:**
- A failed sub-lookup is visibly distinct from a zero/empty result in tool output.
- Every best-effort failure leaves a `console.error` trace with a context label.
- Count envelopes carry `data: null` when `error` is set.
- Fix REPO-7 first so TOOL-4's marker rendering can key off `error !== null` alone.

**Non-Goals:**
- No behavior change on success paths (output byte-identical when nothing fails).
- No new retry/failover logic; `touchRetrieved` stays best-effort.
- No repository interface signature changes.

## Decisions

### D1 — Unavailable marker format: `? (lookup failed)` inline, not errorResult

`get_project`/`get_person` still return the entity when only an auxiliary lookup fails — the primary read succeeded and the entity data is valid. Failing the whole tool for a broken count would convert partial availability into total unavailability (worse for the caller). The count line renders `Open tasks: ? (lookup failed)`; parent/children lines render `Parent: ? (lookup failed)` / `Children: ? (lookup failed)`; `list_projects` child counts are omitted with a trailing `⚠️ Child counts unavailable (lookup failed).` note. This mirrors the `"?"` convention already specified for `get_project_summary` (`## Open Tasks (?)`). Alternative considered: `errorResult` on any sub-failure — rejected as strictly less useful and inconsistent with the composite-query spec.

### D2 — Shared `touchRetrievedLogged` helper (Rule of Three)

Three identical call sites → extract `touchRetrievedLogged(thoughtRepository, thoughtIds, contextLabel)` in `tools/thoughts.ts` (module-level, not exported beyond the module except for tests). It awaits the touch, logs `console.error(\`${contextLabel} touchRetrieved error: …\`)` on failure, never throws. Alternative — logging inline three times — rejected: that is the 3rd copy the duplication rule bans.

### D3 — TOOL-12 mirrors update_document exactly

In the catch blocks, set the existing warning variable to `" (warning: reference extraction failed — references not recorded)"` (capture_thought stores no references on throw; write_document resets to empty, keeping its current reset-to-empty semantics and message wording `references reset to empty`). No structural change — the append plumbing already exists.

### D4 — TOOL-13: log reasons, keep counts

Iterate rejected results and `console.error` each `result.reason` with a site label (`freshIngest insert failure: …` / `reconciliation op failure: …`). Messages embed ids only, never note content — consistent with the logging-minimization stance (X7). The returned counts/summaries are unchanged.

### D5 — REPO-7 envelope: branch on error

`return error ? { data: null, error: toRepoError(error) } : { data: count ?? 0, error: null };` — matches every other method. Callers currently doing `taskCount || 0` are updated in the same change (TOOL-4), so no window where `null` renders as `0`... it would render as `0` via `|| 0` anyway, which is the pre-existing behavior — no compatibility risk.

### Test Strategy

- **Unit** (Deno, fake repositories — the seam exists precisely for this): one test per surfaced path, RED-first per the bug-fix protocol:
  - fake `countOpenByProject`/`countOpenByAssignee`/`findName`/`listChildrenBasic`/`listChildParentIds` returning `{ data: null, error }` → output contains the unavailable marker, not `0`/omission-without-note (TOOL-4);
  - fake `touchRetrieved` erroring → read succeeds AND `console.error` spy called (TOOL-5);
  - throwing pipeline stub → confirmation contains the warning (TOOL-12; mutation check: deleting the assignment reddens it);
  - one failing op → reason logged, summary still "1 failed" (TOOL-13);
  - REPO-7: unit test on the envelope with a failing query builder fake… the Supabase client itself is not seamed inside the repository, so this is covered by an integration test against the local stack instead (grant-revoke is impractical; use an invalid UUID filter to force an error? No — invalid input throws earlier). Practical layer: unit-test TOOL-4 through a fake repository honoring the *new* envelope contract, and pin REPO-7 with a focused integration test asserting the two methods return `data: null` on a forced error (e.g. malformed UUID string produces a Postgres cast error through PostgREST).
- **Integration/E2E**: existing suites (`deno task test` against reset stack) guard regressions on success paths; no new E2E needed — no user-facing workflow changed on the happy path.
- **Mock audit**: unit tests fake only the repository seam (the dependency), never the handler code under test — compliant with the mock-boundary rule.

## Risks / Trade-offs

- [Output format changes on failure paths could surprise snapshot tests] → grep existing tests for `Open tasks:` / `Children:` assertions and update only failure-path expectations; success paths stay byte-identical.
- [`list_projects` truncation note + child-count note could stack] → both are appended notes; acceptable, each is independently meaningful.
- [REPO-7 callers outside TOOL-4 relying on `data: 0` + error] → grep shows only `get_project`/`get_person` consume these methods; both are updated here.

## User Error Scenarios

- Caller passes a valid-but-nonexistent UUID: unchanged behavior (`No project found…` / not-found text) — this change only affects infrastructure failures.
- Model misreads `?` marker as a count: marker text includes the words `lookup failed`, unambiguous to an LLM caller.
- Double-invocation: all touched paths are reads or already-idempotent logging; no new mutation paths (runs-twice: no new writes; crashes-halfway: no multi-step mutation added; interleaves: logging only).

## Security Analysis

No new inputs, no new privileges, no new data flows. Logged messages carry repository error messages and entity ids only — no note content, no personal data beyond what the existing `incrementUsefulness` log line already established as acceptable. No change to `ThreatModel.md` needed (no new threat surface).

## Migration Plan

Pure code change; no migrations, no config. Deploy with the edge function. Rollback = revert commit.

## Open Questions

None.
