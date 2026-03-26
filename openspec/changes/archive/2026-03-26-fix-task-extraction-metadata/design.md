## Context

TaskExtractor (`task-extractor.ts`) creates/updates task rows from parsed checkboxes in notes. Currently it only sets `content`, `status`, `reference_id`, `project_id`, and `parent_id`. The `metadata`, `due_by`, and `assigned_to` columns are left empty, losing extraction context that is available during the pipeline run.

The extraction pipeline runs extractors sequentially: ProjectExtractor → TaskExtractor → PeopleExtractor. This ordering means PeopleExtractor results are NOT available to TaskExtractor at runtime — they run after tasks are created.

## Goals / Non-Goals

**Goals:**
- Populate `metadata` with extraction context on every task insert and update
- Extract due dates from checkbox text into `due_by`
- Assign `assigned_to` when a known person is referenced in or near a checkbox

**Non-Goals:**
- Schema changes (all columns already exist)
- Backfilling existing tasks (only newly extracted/updated tasks get enriched)
- Changing reconciliation logic (similarity matching is fine)
- Auto-creating people (PeopleExtractor only matches known people, keeping that)

## Decisions

### 1. Metadata shape

Task metadata will contain:
```json
{
  "source": "obsidian",
  "section_heading": "Sprint 12" | null,
  "extraction_method": "heading_match" | "file_path" | "ai_inference" | "none"
}
```

**Rationale:** Minimal, useful for debugging and querying. `source` mirrors thoughts metadata. `section_heading` preserves note structure context. `extraction_method` records how project_id was resolved — useful for auditing AI vs deterministic assignment.

**Alternative considered:** Including `note_title` — rejected because `reference_id` already stores the full vault-relative path which includes the filename.

### 2. Due date extraction: regex-first with LLM batch fallback

**Phase 1 (regex):** Parse common date patterns from checkbox text:
- ISO dates: `2026-04-01`, `2026/04/01`
- Natural dates: `March 30`, `Mar 30`, `30 March`
- Relative dates: `by Friday`, `next Monday`, `tomorrow`
- Explicit markers: `due: ...`, `by: ...`, `deadline: ...`

Strip the matched date fragment from the task `content` so the display is clean.

**Phase 2 (LLM fallback):** For checkboxes where regex found nothing but the text looks date-like (heuristic: contains month names, day numbers, or time words), batch them into a single LLM call similar to `inferProjectsByContent`.

**Rationale:** Most dates in checkboxes use obvious formats. Regex handles 80%+ with zero latency/cost. LLM handles the ambiguous remainder. This avoids an LLM call on every ingest when no dates are present.

**Alternative considered:** LLM-only — rejected because it adds cost and latency on every note sync even when no dates exist.

### 3. People assignment: reorder pipeline to run PeopleExtractor before TaskExtractor

Currently the pipeline order is `[ProjectExtractor, TaskExtractor, PeopleExtractor]`. The problem is that TaskExtractor needs people results to set `assigned_to`, but PeopleExtractor runs after.

**Solution:** Change pipeline order to `[ProjectExtractor, PeopleExtractor, TaskExtractor]`. PeopleExtractor detects people at the note level and its results become available in `context.accumulatedReferences.people` for TaskExtractor.

TaskExtractor then assigns people to tasks using a priority chain:
1. **Direct mention in checkbox text:** If the checkbox text contains a known person's name (case-insensitive substring match), assign that person.
2. **Section-level association:** If the checkbox's `sectionHeading` contains a known person's name, assign that person.
3. **No match:** Leave `assigned_to` null. Don't use AI inference for people assignment — the risk of false positives is too high for assigning work to someone.

**Rationale:** Deterministic matching only. Incorrectly assigning a task to a person is worse than leaving it unassigned.

**Alternative considered:** LLM inference for people assignment — rejected due to false positive risk (e.g., LLM might match "build the Johnson report" to a person named "Johnson" when it's a report name).

### 4. Metadata on update path too

When reconciliation matches a checkbox to an existing task (the `matched` path), update metadata alongside content/status/project_id. This ensures metadata stays current as notes evolve.

## Risks / Trade-offs

- **Date parsing ambiguity** → Mitigated by preferring explicit formats in regex and only using LLM for genuinely ambiguous cases. Worst case: a date is missed and `due_by` stays null (same as today).
- **Pipeline reorder could affect PeopleExtractor** → PeopleExtractor is independent of TaskExtractor results (it reads note content, not task rows). Reordering is safe because PeopleExtractor only needs `knownPeople` from the context, not task references.
- **Person name substring matching false positives** → Mitigated by requiring the full name (not partial) to match. Short names (2-3 chars) could match coincidentally, but the people list is user-curated and expected to be small.

## Test Strategy

- **Unit tests:** Date extraction regex, person name matching logic, metadata shape construction
- **Integration tests:** Full pipeline run verifying metadata, due_by, and assigned_to are populated on the resulting task rows
