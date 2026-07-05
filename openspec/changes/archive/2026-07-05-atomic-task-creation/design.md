## Context

`create_tasks_with_output` (`supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts:257-419`) creates N task rows and one `ai_output` row from a single MCP call. Today it:

1. Loops over `tasks`, inserting each with `supabase.from("tasks").insert(...)`. On the first insert error it returns immediately — leaving every prior insert committed (orphaned rows). Only the *later* `ai_output` insert failure triggers a rollback (`ai_output.ts:384-398`).
2. Resolves `parent_index → parent_id` with `dbIdByIndex.get(task.parent_index) || null` (`ai_output.ts:329-331`). Because rows are inserted in array order, a `parent_index` pointing at the current index, a later index, or an out-of-range/negative index is simply absent from the map and collapses to `null` — the subtask silently becomes top-level with no error.
3. Guards `computeTaskDepth` against runaway parent chains with a hard-coded `if (depth > 10) break;` (`ai_output.ts:37`).

The insert loop is inherently sequential because each child's `parent_id` depends on its parent's freshly-minted DB id. That ordering guarantee is what makes "parent must be an earlier index" both a correctness rule and a natural validation.

## Goals / Non-Goals

**Goals:**
- A failed `create_tasks_with_output` call leaves **zero** task rows behind (all-or-nothing on the task set).
- Invalid `parent_index` values (forward, self, out-of-range, non-integer, negative) are rejected **before any insert**, with a clear, specific error message, and create nothing.
- Valid subtask hierarchies continue to be created exactly as before.
- The `depth > 10` magic number is replaced with an explicit, documented bound now that cycles are impossible by construction.

**Non-Goals:**
- Not converting the whole operation to a Postgres RPC/transaction (see Decisions → trade-off).
- Not changing markdown generation, name resolution, the tool description, or the `ai_output` rollback that already exists.

## Decisions

### Decision 1: Up-front `parent_index` validation over silent null-coalescing

Add a validation pass before the insert loop. For each task at `index` with a defined `parent_index`, require:
`Number.isInteger(parent_index) && parent_index >= 0 && parent_index < index`.

Any violation returns an `isError` result naming the offending task index, its `parent_index`, and the reason (forward reference / self reference / out of range). Because a valid `parent_index` is *strictly less than* the task's own index, the parent chain is strictly decreasing — cycles and forward refs are impossible by construction, and every `dbIdByIndex.get(parent_index)` during the loop is guaranteed to hit.

**Alternative considered — resolve forward refs by topological sort/insert reordering:** rejected. It would let the LLM emit hierarchy in any order, but it complicates the loop, obscures which insert failed, and the tool's own `parent_index` doc already says "index of the parent task in this array" implying declaration-before-use. A clear rejection is better feedback to the calling model than silent reordering.

**Alternative considered — keep `|| null` but log a warning:** rejected. Silently dropping hierarchy is the bug; a log the caller never sees does not fix it.

### Decision 2: Application-level rollback over a Postgres transaction/RPC

On any insert error inside the loop, delete the already-inserted ids (`supabase.from("tasks").delete().in("id", taskIds)`) — reusing the exact pattern the `ai_output`-failure path already uses (`ai_output.ts:386-388`) — then return the error.

**Alternative considered — move the whole create into a single `create_tasks_with_output` Postgres function (true atomicity):** deferred. A stored procedure gives real transactional atomicity (no compensating-delete window) but moves branching logic into PL/pgSQL, needs its own migration, and is harder to unit-test than TypeScript. For this step the compensating-delete is sufficient: the failure window is tiny, both statements use the service role, and the delete targets only ids we just created. **Trade-off recorded:** if the rollback `delete` itself fails (e.g. the connection dropped), orphans can still remain; we surface that in the error text rather than pretending success. A future step may promote this to an RPC — the validation logic stays identical.

### Decision 3: Named constant for the depth bound

Replace `if (depth > 10) break;` with `const MAX_TASK_DEPTH = 50;` (defensive upper bound) and a comment stating that upfront validation already guarantees a finite, acyclic chain, so the bound is belt-and-suspenders against a caller that bypasses validation (e.g. a future direct caller of `generateTaskMarkdown`). `generateTaskMarkdown` is exported and unit-tested directly, so it must remain safe on its own.

### User error scenarios

| User/LLM mistake | Handling |
|---|---|
| `parent_index` points to a later task (forward ref) | Rejected up front: explicit error, zero rows created. |
| `parent_index` equals the task's own index (self-parent) | Rejected up front (self is not `< index`). |
| `parent_index` out of range (`>= tasks.length`) or negative | Rejected up front. |
| `parent_index` is a non-integer (e.g. `1.5`) | Rejected up front (`Number.isInteger`). |
| Empty `tasks` array | Existing "At least one task is required." error (unchanged). |
| A single task's content violates a DB constraint mid-loop | Loop aborts, all prior inserts rolled back, error names the failing task. |
| Duplicate `reference_id` collisions across re-runs | Out of scope here (dedup handled by ingest); this tool always inserts fresh rows keyed by `file_path` as before. |

### Security analysis

- **Input source:** `create_tasks_with_output` is an MCP tool callable only with a valid `MCP_ACCESS_KEY`; the caller is a trusted AI agent, not an anonymous user. The threat is *incorrect* input (hallucinated indices), not adversarial input.
- **No new attack surface:** validation reduces the set of inputs that reach the DB; it cannot be used to bypass RLS (service role is unchanged) or to inject SQL (parameterized inserts via supabase-js, unchanged).
- **DoS bound:** upfront validation short-circuits before doing N inserts on bad input, slightly *reducing* wasted DB work. The `MAX_TASK_DEPTH` constant caps markdown-indent computation. No unbounded loops introduced.
- **No data exposure:** error messages include only the caller's own indices/values, not other users' data.
- Threat model note: this feature does not warrant a standalone `ThreatModel.md` — it narrows existing behavior on a trusted, authenticated path with no new external inputs, secrets, or cross-tenant surface.

### Test Strategy

All three test layers considered; this change is exercised at the **integration** layer (real edge function + real local Supabase), matching the existing `ai_output.test.ts` suite, plus one **unit** assertion for the depth constant via the already-unit-tested `generateTaskMarkdown`:

- **Integration (primary):** forward `parent_index` → explicit error + assert zero task rows exist for that `reference_id`; mid-loop failure (forced via a DB constraint violation on task N) → assert tasks 1..N-1 absent afterward; happy-path parent/child/grandchild hierarchy → assert `parent_id` links are correct in the DB. These are the failing-first bug-replication tests required by the owner's bug-fix rule and GATE 1 (denial/failure path).
- **Unit:** `generateTaskMarkdown` remains safe with deep valid hierarchies (existing tests) — confirm the renamed depth bound doesn't regress indentation.
- **E2E:** not applicable — `create_tasks_with_output` has no dedicated Obsidian UI flow beyond the existing ingest path; the integration layer drives the real tool end-to-end through the HTTP/MCP boundary.

## Risks / Trade-offs

- **[Compensating delete can itself fail]** → the rollback `delete().in("id", taskIds)` could error, leaving orphans. Mitigation: include the rollback outcome in the returned error text so a partial failure is visible rather than reported as success; a future RPC promotion removes the window entirely.
- **[Stricter input rejects previously-"tolerated" LLM output]** → callers that relied on forward `parent_index` silently flattening will now get an error. Mitigation: this is the intended fix (silent flattening was data loss); the error message tells the model exactly how to reorder. No happy-path caller is affected.
- **[Depth constant chosen arbitrarily]** → `MAX_TASK_DEPTH = 50` is a defensive bound, not a product limit. Mitigation: documented as such; real hierarchies are shallow, and validation already prevents the infinite case.

## Migration Plan

No schema migration. Pure edge-function code change, deployed with the function. Rollback = redeploy the prior function build; no data migration to reverse.
