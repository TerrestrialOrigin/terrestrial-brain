## 1. Failing tests first (RED)

- [x] 1.1 `tests/unit/fake-provider-fidelity.test.ts`: real `extractMetadata` via the fake yields topics (CORE-1); fake `completeJson` wraps a throwing parse in `AiProviderParseError` (CORE-8); `parseSplitThoughts` skips null/malformed elements (CORE-12).
- [x] 1.2 Confirm RED with the fake still on substring dispatch + unwrapped parse + old split logic.

## 2. Fix (GREEN)

- [x] 2.1 `ai-provider.ts`: add `AiCompletionPurpose` + required `purpose` field.
- [x] 2.2 Wire `purpose` at all 8 `completeJson` call sites (metadata, split, reconcile, assign-task-projects, enrich-tasks, project-from-path, projects-by-content, detect-people).
- [x] 2.3 `fake-provider.ts`: switch dispatch to `purpose` (exhaustive, throws on unknown); wrap a throwing `parse` in `AiProviderParseError`.
- [x] 2.4 `helpers.ts`: harden `parseSplitThoughts` (null-safe, honest typing).
- [x] 2.5 Update `fake-provider.test.ts` (per-purpose + unknown-purpose-rejects), `openrouter-provider.test.ts`, `live-llm.test.ts` to set `purpose`.

## 3. Testing & Verification

- [x] 3.1 GATE 2b: fidelity tests RED before the behavior fixes.
- [x] 3.2 Full `deno task test` on a reset stack green; `deno check`, lint, fmt clean.
- [x] 3.3 Validate + archive; check off Step 4 in the plan; commit.
