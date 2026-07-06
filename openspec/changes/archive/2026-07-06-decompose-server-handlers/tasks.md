## 1. Usefulness-reminder builder consolidation

- [x] 1.1 Create `tools/usefulness-reminder.ts` exporting `buildUsefulnessReminder(thoughtIds, tone)` (tone: hard | soft | terse) and `buildUsefulnessHeader(thoughtIds, tone)`, preserving the three variants' exact text.
- [x] 1.2 Add `tests/unit/usefulness-reminder.test.ts` pinning the exact output string for each tone (hard/soft/terse) and the header wrapper.
- [x] 1.3 Replace the hard/soft builders in `tools/thoughts.ts` and the two terse inline reminders in `tools/queries.ts` with calls to the shared builder; delete the now-dead local builders/constants.

## 2. Composite-query fetch/format split (queries.ts)

- [x] 2.1 Define `ProjectSummaryData` and `RecentActivityData` types carrying every field the current inline formatters read (including per-section `{data,error}` results).
- [x] 2.2 Extract `fetchProjectSummary(queryRepository, id): Promise<ProjectSummaryData | {error}>` and pure `formatProjectSummary(data): string`; rewire the `get_project_summary` handler to orchestrate them.
- [x] 2.3 Extract `dedupeByName` helper and use it for both the projects and people created/updated merge in recent activity.
- [x] 2.4 Extract `fetchRecentActivity(queryRepository, days): Promise<RecentActivityData>` and pure `formatRecentActivity(data): string`; rewire the `get_recent_activity` handler.
- [x] 2.5 Add `tests/unit/queries-format.test.ts`: synthetic-data tests for `formatProjectSummary`, `formatRecentActivity`, `dedupeByName`, and the failed-sub-query "(section unavailable: …)" rendering.

## 3. handleIngestNote decomposition (thoughts.ts)

- [x] 3.1 Extract `checkUnchanged`, `upsertSnapshot`, `fetchExistingThoughts` step functions; rewire the orchestrator to call them.
- [x] 3.2 Extract `requestReconciliationPlan` (moves the system+user prompt verbatim; returns `null` on parse failure, rethrows transport errors) and `ReconciliationPlan` type.
- [x] 3.3 Extract `executeReconciliationPlan` (update/add/soft-archive ops + counting) and pure `formatIngestSummary`.
- [x] 3.4 Reduce `handleIngestNote` to a thin orchestrator preserving both `freshIngest` fallback call sites and the exact `{success,message,error?}` mapping.
- [x] 3.5 Add `tests/unit/ingest-note-steps.test.ts`: `requestReconciliationPlan` prompt-building + parse-failure→null with a fake `AiProvider`; `executeReconciliationPlan` soft-archive + counting with fake repositories; `formatIngestSummary` string cases.

## 4. update_thought branch unification (thoughts.ts)

- [x] 4.1 Collapse the content and non-content branches into one field-application path; the content case additionally regenerates embedding+metadata and prepends the label. Preserve: ≥1-field validation, reference replace-semantics, `metadata.source` preservation, no `metadata` key when references unchanged, and identical confirmation text.

## 5. create_tasks_with_output split (ai_output.ts)

- [x] 5.1 Extract `resolveTaskNames` and `insertTasksAtomically` (moving the atomic-insert + rollback logic verbatim); reduce the handler to orchestration.

## 6. Testing & Verification

- [x] 6.1 Confirm no function in `tools/*.ts` exceeds ~50 lines (grep/inspection).
- [x] 6.2 `deno lint` + `deno fmt --check` clean on changed files; `deno task test:unit` green (new unit tests included).
- [x] 6.3 Run full integration suite (`deno task test:integration`) — must be green with ZERO edits to any integration test file. If a test needs changing, stop and investigate the behavior drift.
- [x] 6.4 GATE 2b spot-check: deleting an extracted formatter/step line reddens a new unit test.
- [x] 6.5 `/opsx:verify`, then `/opsx:archive`; check off Step 18 in `codeEval/Fable20260704-fix-plan.md`.
