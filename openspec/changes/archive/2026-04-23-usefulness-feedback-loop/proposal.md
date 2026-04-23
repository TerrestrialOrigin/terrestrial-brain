## Why

The `record_useful_thoughts` feedback loop is under-utilized: only 8 thoughts have a `usefulness_score > 1` after weeks of usage. The root cause is positional — the reminder currently lives as a footer line at the end of `search_thoughts` results, where models reliably miss it because they have already mentally committed to composing their response by the time they finish reading the payload. Prompting tweaks alone have proven insufficient; the fix needs to move the reminder into moments of high attention (tool description, top of the response, and the `capture_thought` call itself).

## What Changes

- Update the `search_thoughts` tool description with a CRITICAL directive instructing the model to call `record_useful_thoughts` before its next user-facing response (with an empty array if none contributed), and to scan results for contradictions/outdated data and surface them to the user without archiving silently.
- Move the usefulness reminder from the footer of the `search_thoughts` response to a HEADER block at the top of the payload, so it is read while the results are still streaming.
- **BREAKING (schema-level, additive at runtime):** Relax the `record_useful_thoughts` `thought_ids` parameter from `minItems: 1` to `minItems: 0` so the model can close the loop with an empty array after a search that produced nothing useful. Without this, models will skip the call entirely when nothing helped — the behaviour we are trying to prevent.
- Add an optional `builds_on?: string[]` parameter to `capture_thought`. When provided, each UUID has its `usefulness_score` incremented as a side effect, closing the loop inside a synthesis call the model was already making. This is additive to `record_useful_thoughts`, not a replacement.
- Contradiction detection: surface-don't-act. This is a pure behavioural instruction inside the new reminder text — no new tool, no new parameter, no auto-archive.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `thoughts`: adds the `builds_on` parameter to `capture_thought`; relaxes the `record_useful_thoughts` schema to accept empty arrays; changes the layout of the `search_thoughts` response (reminder moved to header) and the `search_thoughts` tool description (CRITICAL directive added). Affected spec file: `openspec/specs/thoughts.md`.

## Non-goals

- Server-side pending-action state tracking across calls. Rejected: multiple models/conversations query thoughts independently, so cross-call state would misattribute pending actions from Model A to Model B.
- A `supersedes` parameter on `capture_thought`. Rejected: redundant with manual archive plus the planned auto-archive of low-usefulness thoughts.
- A `contradicts` parameter or auto-archive on contradiction. Deferred: destructive action on model judgment is risky for v1; surface-don't-act first, collect data on false-positive rate, promote later if warranted.
- A two-phase `search_thoughts` → `hydrate_thoughts` flow that makes recording mandatory on the critical path. Deferred: highest-friction option, reserved for if softer layers underperform.
- Changing the reminder placement in `list_thoughts`, `get_project_summary`, or `get_recent_activity`. Scoped out for v1; we are measuring whether the header change on `search_thoughts` alone moves the needle before rolling the pattern out further.

## Impact

- **Affected code:**
  - `supabase/functions/terrestrial-brain-mcp/tools/thoughts.ts` — update `search_thoughts` description, move reminder to header, relax `record_useful_thoughts` schema, add `builds_on` to `capture_thought`.
- **Affected tests:**
  - `tests/integration/thoughts.test.ts` — new cases for empty-array `record_useful_thoughts`, header-position reminder in `search_thoughts` output, `builds_on` side-effect.
- **Database:** No migrations required. The existing `increment_usefulness` RPC already accepts any `uuid[]`, including empty arrays, so the schema relaxation is purely an MCP-layer input-validation change. `capture_thought` reuses the same RPC for the `builds_on` side effect.
- **API compatibility:** Changing `minItems: 1` → `minItems: 0` on `record_useful_thoughts` only removes a validation constraint, so any existing caller that passed a non-empty array continues to work.
- **Documentation:** Update `README.md` MCP tools section and `docs/api-frontend-guide.md` if either currently documents the `record_useful_thoughts` minimum-array constraint.
