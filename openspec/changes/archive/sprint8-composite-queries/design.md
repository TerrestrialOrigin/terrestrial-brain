## Context

Sprint 8 adds two read-only composite query tools that join across the brain DB's tables to produce formatted summaries. These are pure database queries with no LLM calls, no schema changes, and no side effects.

## Goals / Non-Goals

**Goals:**
- Provide `get_project_summary` that returns a complete picture of a project in one call
- Provide `get_recent_activity` that returns cross-table activity over a configurable time window
- Return human-readable formatted text (not JSON) since these are consumed by an AI reading on behalf of a user

**Non-Goals:**
- No schema changes or migrations
- No AI/LLM calls (pure DB queries)
- No pagination (bounded by thought limit and day window)
- No changes to existing tools

## Decisions

### 1. Separate module for composite queries

**Decision:** Create `tools/queries.ts` rather than adding to existing tool files.

**Why:** These tools don't belong to any single domain (projects, tasks, thoughts). They join across all of them. A dedicated module prevents any one file from becoming a grab-bag.

### 2. Formatted text output, not JSON

**Decision:** Return human-readable formatted text with clear sections, not raw JSON.

**Why:** These tools are consumed by an AI assistant that reads the output and summarizes for the user. Formatted text is immediately usable, whereas JSON would require the AI to parse and reformat. Consistent with existing tools like `get_project` and `list_tasks`.

### 3. get_project_summary — join strategy

**Decision:** Multiple sequential queries rather than a single complex join.

**Why:** Supabase JS client doesn't support complex cross-table joins cleanly. Sequential queries (project → children → tasks → thoughts → snapshots) are clear, debuggable, and fast enough for single-project scope. Each query is indexed.

**Query plan:**
1. Fetch project row by ID
2. Fetch parent project name (if parent_id exists)
3. Fetch child projects (where parent_id = id, not archived)
4. Fetch open tasks (where project_id = id, not archived, status in open/in_progress)
5. Fetch recent thoughts (where metadata contains project ID in references.projects or references.project_id, limit 10, ordered by created_at desc)
6. For thoughts with note_snapshot_id, fetch snapshot titles/reference_ids for source note display

### 4. get_recent_activity — time window approach

**Decision:** Single `days` parameter, default 7, used as a `>= now() - interval` filter across all tables.

**Why:** Simple, intuitive. "What happened this week?" → `days: 7`. "What about today?" → `days: 1`. The default covers the most common use case.

**Query plan:**
1. Compute `sinceDate = now() - days`
2. Thoughts: `created_at >= sinceDate`, ordered desc, limit 20
3. Tasks created: `created_at >= sinceDate`, ordered desc
4. Tasks completed: `status = 'done'` AND `updated_at >= sinceDate`, ordered desc
5. Projects: `created_at >= sinceDate` OR `updated_at >= sinceDate`, ordered desc
6. AI outputs delivered: `picked_up = true` AND `picked_up_at >= sinceDate`, ordered desc

### 5. Backwards-compatible references reading

**Decision:** When filtering thoughts by project, check both `metadata.references.projects` (array, new format) and `metadata.references.project_id` (string, old format).

**Why:** Old thoughts use `{ project_id: "uuid" }`, new thoughts use `{ projects: ["uuid"] }`. Both must be found. Use `or(contains.metadata->>references...projects, contains.metadata->>references...project_id)` or fetch all recent thoughts and filter in-app.

**Implementation:** Since Supabase's `.contains()` on nested JSONB is tricky for OR conditions, we'll query thoughts and filter in application code. The dataset is bounded (limit 10 for project summary, limit 20 for recent activity).

### User Error Scenarios

- **Invalid project UUID:** `get_project_summary` returns "Project not found" error
- **Non-existent project ID:** Same as above — single() returns error
- **Negative or zero days:** Clamp to minimum 1 day
- **Very large days value:** No issue — just returns more results, bounded by per-table limits

### Security Analysis

- **Read-only:** Both tools only SELECT, never INSERT/UPDATE/DELETE
- **Input validation:** Zod validates UUID string and numeric days
- **No path traversal:** No file system access
- **Access control:** Same `x-brain-key` auth as all other tools
- No new threat vectors

### Test Strategy

- **Integration tests:** Test both tools against real Supabase emulator with seed data
- `get_project_summary`: verify returns project details, tasks, thoughts, and source notes for seed project
- `get_recent_activity`: verify returns cross-table activity within date range
- Edge cases: project with no tasks/thoughts, activity with empty window

## Risks / Trade-offs

- **[In-app filtering for references]** Filtering thoughts by project in application code rather than DB query. → Acceptable: dataset is bounded (limit 10/20), and avoids complex JSONB OR queries.
- **[No pagination]** Large projects with many tasks/thoughts. → Mitigated: tasks limited to open only, thoughts limited to 10. Acceptable for MVP.

## Open Questions

None.
