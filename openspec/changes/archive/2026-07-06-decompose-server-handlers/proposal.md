## Why

Five MCP edge-function handlers have grown into god-functions (256–310 lines each) that bundle fetching, business logic, and text formatting into a single body, violating the owner's short-single-purpose-function rule and making the behavior impossible to unit-test without a live DB and paid LLM. Because the fetch and format concerns are fused, the only safety net is the integration suite; the formatting logic — the part most likely to regress on a wording change — has no fast, deterministic coverage. This is the "server half" of finding X3.

## What Changes

- **Decompose `handleIngestNote`** (`tools/thoughts.ts`, ~310 lines) into named single-purpose steps: `checkUnchanged`, `upsertSnapshot`, `fetchExistingThoughts`, `requestReconciliationPlan`, `executeReconciliationPlan`, `formatIngestSummary`. The orchestrator becomes a thin sequence of these.
- **Split `get_project_summary` and `get_recent_activity`** (`tools/queries.ts`, ~240/260 lines) into a `fetchX(deps): DomainData` data-gathering function and a pure `formatX(data): string` renderer. Extract the two duplicated created/updated dedup blocks in `get_recent_activity` into one `dedupeByName` helper.
- **Unify `update_thought`'s two branches** (`tools/thoughts.ts`): the content and non-content paths differ only in whether a regenerated embedding + metadata join the update payload — collapse them so the field-application logic exists once.
- **Split `create_tasks_with_output`** (`tools/ai_output.ts`) into validation / insertion / formatting helpers, preserving the existing atomic-creation (up-front `parent_index` validation + rollback) behavior exactly.
- **Consolidate the usefulness-reminder variants** (hard + soft builders in `tools/thoughts.ts`, and the two terse inline reminders in `tools/queries.ts`) into one builder parameterized by a `tone`. Decide and document whether the header+footer double emission in `search_thoughts` is intentional prompt-engineering (comment it) or should emit once.
- **Add deterministic unit tests** for the extracted formatters and reconciliation-plan steps using the existing `tests/unit/fake-supabase-client.ts` + fake `AiProvider`/repository patterns.

This is a **pure refactor**: zero behavior change is intended. Every string the tools emit and every DB effect they cause stays byte-for-byte identical.

## Non-goals

- No change to any tool's external contract (inputs, outputs, emitted text, DB writes).
- No change to the extractor pipeline, repositories, or AI provider seam (Steps 15–17, already landed).
- No plugin changes, no migrations, no new dependencies.
- Not touching the task-extractor decomposition (`TaskExtractor.extract`, `reconcileCheckboxes`) — that is Step 19.
- Not modifying any existing test (a needed test change would signal an accidental behavior change and must be investigated, not accommodated).

## Capabilities

### New Capabilities
- `server-handler-decomposition`: Structural/maintainability requirements the refactored handlers must satisfy — single-purpose function decomposition of the five named handlers, a pure fetch/format split for the composite-query tools, one shared usefulness-reminder builder, and deterministic unit coverage of the extracted formatters and reconciliation steps — all while preserving observable behavior.

### Modified Capabilities
<!-- None. This is a pure refactor: no spec-level requirement (input, output text, or DB effect) of any existing capability changes. The behavior contracts in specs/thoughts, specs/composite-queries.md, specs/enhanced-ingest.md, and specs/ai-output remain the authority and are unchanged. -->

## Impact

- **Code:** `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts`, `tools/queries.ts`, `tools/ai_output.ts`; possibly a small new shared module (e.g. `tools/usefulness-reminder.ts`) for the reminder builder.
- **Tests:** new files under `tests/unit/` (formatters + reconciliation steps). Existing `tests/integration/` suite is the untouched safety net — it must stay green with no edits.
- **APIs / dependencies / systems:** none. No external contract, schema, or dependency changes.
