# Terrestrial Brain — Phase 2: Enhanced Ingest Pipeline + AI Output

This document describes the changes needed to enhance the ingest pipeline with structured data extraction (projects, tasks, and future entity types) and add the AI Output delivery system. Build and test everything against the local dev environment before deploying.

> **Core principle:** Obsidian is the human's workspace. The brain DB is the AI's workspace. Data flows mostly one-way (Obsidian → Brain) with a narrow, explicit path back (AI Output → Obsidian). No two-way sync. No magic file manipulation.

---

## Sprint Tracker

- [x] **Sprint 0** — Bug fixes (isExcluded, pollAINotes hash storage)
- [x] **Sprint 1** — Database migrations (note_snapshots, ai_output, thoughts.note_snapshot_id)
- [x] **Sprint 2** — Structural parser (checkbox + heading extraction, pure functions)
- [x] **Sprint 3** — Extractor pipeline framework + ProjectExtractor
- [x] **Sprint 4** — TaskExtractor (checkbox → tasks table, project association, reconciliation)
- [x] **Sprint 5** — Enhanced ingest_note + capture_thought (integrate pipeline, snapshots, references)
- [ ] **Sprint 6** — AI Output system (ai_output tools, plugin polling, ai_notes migration)
- [ ] **Sprint 7** — Option 4 integration (AI creates tasks + ai_output, dedup on ingest)
- [ ] **Sprint 8** — Composite query tools (get_project_summary, get_recent_activity)

---

## Sprint 0 — Bug Fixes

**Goal:** Fix two pre-existing bugs before building on top of the current code.

### 0.1 Fix `isExcluded()` (main.ts:246-258)

**Bug:** `isExcluded()` checks `cache.frontmatter?.tags` and inline tags, but `terrestrialBrainExclude: true` is a standalone frontmatter boolean — Obsidian stores it as `cache.frontmatter.terrestrialBrainExclude === true`, NOT in the `tags` array. So `isExcluded()` returns `false` for AI notes and any notes with that frontmatter field.

**Fix:** Add `if (cache.frontmatter?.[excludeTag]) return true;` before the tag-array check in `isExcluded()`.

**File:** `obsidian-plugin/src/main.ts`

### 0.2 Fix `pollAINotes()` hash storage

**Bug:** `pollAINotes()` writes files to the vault but doesn't store their hash in `syncedHashes`. On the next modify event, `processNote()` may try to re-ingest the file unnecessarily.

**Fix:** After writing each AI note file, compute `simpleHash(stripFrontmatter(content))` and store it in `syncedHashes[path]`.

**File:** `obsidian-plugin/src/main.ts`

### 0.3 Tests

- Verify `isExcluded()` returns `true` for a file with `terrestrialBrainExclude: true` in frontmatter
- Verify `pollAINotes()` file write doesn't trigger re-ingest

---

## Sprint 1 — Database Migrations

**Goal:** Create new tables and add the note_snapshot_id column to thoughts.

### 1.1 `note_snapshots` Table

```sql
create table public.note_snapshots (
  id uuid not null default gen_random_uuid(),
  reference_id text not null unique,
  title text null,
  content text not null,
  source text not null default 'obsidian',
  captured_at timestamptz not null default now(),
  constraint note_snapshots_pkey primary key (id)
);

create index note_snapshots_reference_id_idx on public.note_snapshots using btree (reference_id);
create index note_snapshots_source_idx on public.note_snapshots using btree (source);
```

- One row per note, upserted on `reference_id` (always stores the latest version)
- `reference_id` is the stable identifier — vault-relative path for Obsidian notes, a chat/session ID for chat-originated content, etc.

### 1.2 `ai_output` Table (replaces `ai_notes`)

```sql
create table public.ai_output (
  id uuid not null default gen_random_uuid(),
  title text not null,
  content text not null,
  file_path text not null,
  source_context text null,
  created_at timestamptz not null default now(),
  picked_up boolean not null default false,
  picked_up_at timestamptz null,
  constraint ai_output_pkey primary key (id)
);

create index ai_output_picked_up_idx on public.ai_output using btree (picked_up) where picked_up = false;
```

- AI writes output here with a specific `file_path` (full vault-relative path including filename)
- Plugin polls for `picked_up = false`, writes to vault, flips `picked_up = true` and sets `picked_up_at`
- No `terrestrialBrainExclude` tag — the delivered file participates in normal ingest, so task checkboxes, project references, etc. all get picked up naturally

### 1.3 `thoughts` Table — Add `note_snapshot_id`

```sql
alter table public.thoughts
  add column note_snapshot_id uuid null references public.note_snapshots(id) on delete set null;

create index thoughts_note_snapshot_id_idx on public.thoughts using btree (note_snapshot_id);
```

- Nullable FK — null for thoughts from direct capture, chat, or if snapshot was purged
- `ON DELETE SET NULL` — purging old snapshots doesn't cascade-delete thoughts

### 1.4 `thoughts.metadata.references` — Enhanced Structure

The `references` field in thought metadata changes from:
```json
{ "project_id": "uuid" }
```
to:
```json
{
  "projects": ["uuid1", "uuid2"],
  "tasks": ["uuid1", "uuid2"]
}
```

- Arrays, not single values — a thought can reference multiple projects or tasks
- Future-proof: adding `"people": [...]` later requires no schema change
- Old thoughts with `{ "project_id": "uuid" }` should still be readable (backwards-compatible reads)

### 1.5 Tests

**pgTAP tests (`supabase/tests/`):**
- `note_snapshots`: upsert on `reference_id` works (insert then update, only one row)
- `note_snapshots`: `ON DELETE SET NULL` on `thoughts.note_snapshot_id`
- `ai_output`: `picked_up` partial index filters correctly
- `thoughts.note_snapshot_id`: nullable FK works correctly

---

## Sprint 2 — Structural Parser

**Goal:** Build a deterministic (no AI) parser that extracts checkboxes and headings from markdown text. Pure functions with zero dependencies — testable from Deno.

### 2.1 Checkbox Parsing

- Regex: lines matching `^\s*- \[([ xX])\] (.+)$`
- Indentation depth: count leading tabs or groups of spaces (each tab or 2/4 spaces = one level)
- Parent detection: a checkbox at depth N is a subtask of the nearest preceding checkbox at depth N-1
- Section heading: the nearest `#` heading above the checkbox
- **Skip** checkboxes inside fenced code blocks (``` or ~~~)

### 2.2 Heading Parsing

- Regex: lines matching `^(#{1,6})\s+(.+)$`
- Track line ranges: each heading's content extends until the next heading of same or higher level, or EOF

### 2.3 Types

```typescript
interface ParsedNote {
  content: string;
  title: string | null;
  referenceId: string | null;
  source: string;
  checkboxes: ParsedCheckbox[];
  headings: ParsedHeading[];
}

interface ParsedCheckbox {
  text: string;
  checked: boolean;
  depth: number;
  lineNumber: number;
  parentIndex: number | null;
  sectionHeading: string | null;
}

interface ParsedHeading {
  text: string;
  level: number;
  lineStart: number;
  lineEnd: number;
}
```

### 2.4 File Location

`supabase/functions/terrestrial-brain-mcp/parser.ts` — pure functions, no Supabase or AI dependencies. Exported: `parseNote(content, title, referenceId, source): ParsedNote`

### 2.5 Tests (`tests/integration/parse.test.ts`)

- Parse `- [ ] task text` → `{ text: "task text", checked: false, depth: 0 }`
- Parse `- [x] done task` → `{ text: "done task", checked: true, depth: 0 }`
- Parse indented checkboxes → correct depth and parent detection
- Parse headings → correct line ranges
- Mixed content (headings + checkboxes + prose) → correct structure
- Edge cases: empty checkboxes, deeply nested (3+ levels), checkboxes inside code blocks (should be ignored)
- Heading line ranges: heading at line 5 extends until next heading or EOF

---

## Sprint 3 — Extractor Pipeline Framework + ProjectExtractor

**Goal:** Build the extractor interface, pipeline runner, and the first extractor (projects).

### 3.1 Extractor Interface

```typescript
interface ExtractionContext {
  supabase: SupabaseClient;
  knownProjects: { id: string; name: string }[];
  knownTasks: { id: string; content: string; reference_id: string | null }[];
  // Enriched by earlier extractors:
  newlyCreatedProjects: { id: string; name: string }[];
  newlyCreatedTasks: { id: string; content: string }[];
}

interface ExtractionResult {
  referenceKey: string;     // "projects", "tasks", "people", etc.
  ids: string[];            // PKs of upserted/matched rows
}

interface Extractor {
  readonly referenceKey: string;
  extract(note: ParsedNote, context: ExtractionContext): Promise<ExtractionResult>;
}
```

### 3.2 Pipeline Runner

```typescript
async function runExtractionPipeline(
  note: ParsedNote,
  extractors: Extractor[],
  baseContext: ExtractionContext
): Promise<Record<string, string[]>>
```

1. Initialize context from `baseContext` (fetch known projects, known tasks for this `reference_id`)
2. For each extractor in order:
   a. Call `extractor.extract(note, context)`
   b. Collect returned PKs under `result.referenceKey`
   c. Enrich context for subsequent extractors (e.g., ProjectExtractor adds to `context.newlyCreatedProjects` so TaskExtractor can see them)
3. Return the composed references: `{ projects: [...], tasks: [...] }`

Extractors run **in sequence**, not parallel, because later extractors depend on context enrichment from earlier ones.

### 3.3 ProjectExtractor

**What it detects:**
- File path: if the note is under `/projects/{name}/`, that project is referenced
- Section headings: a `# ProjectName` or `## ProjectName` heading where `ProjectName` matches a known project
- Content mentions: the note text mentions a known project by name

**How it works:**
1. Check file path against `/projects/*/` pattern → if match, look up or create the project
2. For remaining project associations (headings, content mentions), use a focused AI call:
   - Input: note title, heading structure, first ~200 chars of each section, known projects list
   - Output: `{ "project_ids": ["uuid1", "uuid2"] }`
   - This call is cheap — it's just matching, not generation
3. If a folder under `/projects/` exists but no matching project row: create the project (the human started a new project by creating a folder)
4. Return all matched/created project IDs

**Context enrichment:** Adds any newly created projects to `context.newlyCreatedProjects` and `context.knownProjects`.

### 3.4 File Location

`supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts`
`supabase/functions/terrestrial-brain-mcp/extractors/pipeline.ts`

### 3.5 Tests (`tests/integration/extractors.test.ts`)

- ProjectExtractor: note in `/projects/CarChief/` → detects CarChief project
- ProjectExtractor: note with `# TerrestrialCore` heading → detects project by heading
- ProjectExtractor: new folder under `/projects/` → creates project row
- ProjectExtractor: enriches context (newlyCreatedProjects populated)
- Pipeline runner: single extractor → returns correct references structure

---

## Sprint 4 — TaskExtractor

**Goal:** Extract tasks from checkboxes, associate with projects, reconcile with existing DB tasks.

### 4.1 What It Detects

- `- [ ]` lines = open tasks
- `- [x]` lines = completed tasks
- Indentation = subtask hierarchy
- Section context = which project a task group belongs to

### 4.2 How It Works

1. Use the structurally parsed checkboxes from `ParsedNote.checkboxes`
2. For project association, apply priority chain:
   a. **File path** — if note is in `/projects/CarChief/`, all tasks default to CarChief
   b. **Section heading** — if a task is under a `# TerrestrialCore` heading that matches a known project, it belongs to that project
   c. **Content inference** — for remaining unassigned tasks, use an AI call:
      - Input: task texts + known projects list (including `context.newlyCreatedProjects`)
      - Output: `[{ "task_text": "...", "project_id": "uuid or null" }]`
3. For each task, reconcile against existing tasks in DB:
   - Match by `reference_id` (file path) + content similarity
   - If match found: update content, status (checked/unchecked), project association
   - If no match: insert new task row
   - If existing DB task not found in note anymore: keep it (don't delete — it may have been moved to another note, or the user removed the checkbox but the task is still relevant in the DB)
4. Handle subtask hierarchy: tasks with `parentIndex` get their `parent_id` set to the DB ID of the parent task
5. Return all task IDs (matched + created)

**Context enrichment:** Adds newly created tasks to `context.newlyCreatedTasks`.

**Reconciliation detail:** Tasks are matched by `reference_id` (the note's vault path) so we only compare against tasks that came from the same note. Content matching uses simple string similarity (not embeddings — overkill for short checkbox text). The structural parse gives us line position, which helps disambiguate tasks with similar content.

### 4.3 File Location

`supabase/functions/terrestrial-brain-mcp/extractors/task-extractor.ts`

### 4.4 Tests (add to `tests/integration/extractors.test.ts`)

- TaskExtractor: note with `- [ ]` lines → creates task rows
- TaskExtractor: checked `- [x]` → task status = 'done'
- TaskExtractor: indented checkboxes → subtask hierarchy (parent_id set)
- TaskExtractor: tasks under project heading → associated with that project
- TaskExtractor: content-based project detection ("CarChief tickets" → CarChief project)
- TaskExtractor: re-ingest with checked box → task status updated to 'done'
- TaskExtractor: re-ingest with new checkbox added → new task created, existing tasks kept
- Pipeline: full run with both extractors → references composed correctly with both project and task IDs

---

## Sprint 5 — Enhanced Ingest

**Goal:** Integrate the extractor pipeline into `ingest_note` and `capture_thought`. Add note snapshot storage and new references format.

### 5.1 Updated `ingest_note` Flow

```
1. Receive: content, title, note_id (reference_id)

2. Upsert note_snapshots:
   INSERT INTO note_snapshots (reference_id, title, content, source)
   VALUES (note_id, title, content, 'obsidian')
   ON CONFLICT (reference_id) DO UPDATE SET content, title, captured_at = now()
   → get note_snapshot_id

3. Structural parse:
   - Extract checkboxes (with depth, checked state, section headings)
   - Extract heading structure
   → produces ParsedNote

4. Run extractor pipeline:
   - ProjectExtractor → project IDs
   - TaskExtractor → task IDs
   → produces references = { projects: [...], tasks: [...] }

5. Split into thoughts (existing AI call, mostly unchanged):
   - Same GPT-4o-mini prompt for splitting
   - Project detection prompt REMOVED from here (extractors handle it now)
   - Each thought gets:
     - reference_id = note_id
     - note_snapshot_id = from step 2
     - metadata.references = from step 4

6. Reconcile thoughts (existing logic, unchanged):
   - Same keep/update/add/delete reconciliation
   - Updated/added thoughts get the new references and note_snapshot_id

7. Return summary: "Synced 'note': 3 thoughts, 2 tasks detected, 1 project linked"
```

### 5.2 Updated `capture_thought` Flow

```
1. Receive: content (the thought text)

2. Structural parse (lightweight — mostly checking for checkboxes in the text)

3. Run extractor pipeline:
   - ProjectExtractor → project IDs (from content mentions)
   - TaskExtractor → task IDs (if the thought contains "- [ ]" lines)
   → produces references

4. Get embedding + extract metadata (existing)

5. Insert thought with:
   - reference_id = null (no source note)
   - note_snapshot_id = null (no source note)
   - metadata.references = from step 3

6. Return confirmation
```

### 5.3 Backwards Compatibility for `references`

Old thoughts have `metadata.references.project_id` (single string). New thoughts have `metadata.references.projects` (array). All code that reads references must handle both formats:

```typescript
function getProjectRefs(metadata: Record<string, unknown>): string[] {
  const refs = metadata?.references as Record<string, unknown> | undefined;
  if (!refs) return [];
  if (Array.isArray(refs.projects)) return refs.projects;
  if (typeof refs.project_id === "string") return [refs.project_id];
  return [];
}
```

### 5.4 Tests (`tests/integration/enhanced_ingest.test.ts`)

- `ingest_note` with checkboxes → tasks table populated
- `ingest_note` with checkboxes → thoughts have `references.tasks` array
- `ingest_note` → `note_snapshots` table has the full note content
- `ingest_note` re-sync → note snapshot updated (not duplicated)
- `ingest_note` re-sync with checkbox state change → task status updated
- `capture_thought` with task-like content → task extracted and linked
- Backwards compat: existing tools that read `references.project_id` still work

---

## Sprint 6 — AI Output System

**Goal:** Replace `ai_notes` with `ai_output`. New MCP tools, updated plugin polling, migration.

### 6.1 MCP Tool: `create_ai_output`

Replaces `create_ai_note`. The AI uses this when the user explicitly requests output to be delivered to Obsidian.

- Input:
  - `title` (string, required) — human-readable title
  - `content` (string, required) — full markdown body
  - `file_path` (string, required) — target vault path, e.g. `"projects/TerrestrialCore/PhaseTwoPlan.md"`
  - `source_context` (string, optional) — what prompted this output
- Inserts into `ai_output` with `picked_up = false`
- Returns: confirmation with ID, title, and file path
- The AI should tell the user: "I've put the plan at `projects/TerrestrialCore/PhaseTwoPlan.md` — it'll appear in your vault shortly."

### 6.2 MCP Tools: `get_pending_ai_output` and `mark_ai_output_picked_up`

**`get_pending_ai_output`:**
- Input: none
- Returns: JSON array of all rows where `picked_up = false`
- Each element: `{ id, title, content, file_path, created_at }`

**`mark_ai_output_picked_up`:**
- Input: `ids` (array of uuid strings)
- Sets `picked_up = true` and `picked_up_at = now()` for all matching IDs
- Returns: confirmation of count

### 6.3 Plugin: Replace `pollAINotes()` with `pollAIOutput()`

```
async pollAIOutput():
  1. Call get_pending_ai_output → parse JSON array
  2. For each output:
     a. Ensure parent folders exist (create if needed)
     b. Write file to vault at output.file_path
     c. Store hash in syncedHashes
     d. Collect the ID
  3. Call mark_ai_output_picked_up with collected IDs
  4. Show notice: "N AI output(s) delivered to vault"
```

The delivered file has no special tags. It's a normal markdown file that participates in normal ingest. When the plugin's debounce fires and `ingest_note` processes it, the extractor pipeline extracts tasks, projects, etc.

### 6.4 Migration from `ai_notes`

- Migrate any unsynced rows from `ai_notes` to `ai_output` (map `suggested_path` → `file_path`, `synced_at IS NULL` → `picked_up = false`)
- Update MCP tools: remove `create_ai_note`, `get_unsynced_ai_notes`, `mark_notes_synced`; add new equivalents
- Update plugin: replace `pollAINotes()` with `pollAIOutput()`
- Drop `ai_notes` table after migration is verified

### 6.5 Plugin Settings

Add to `TBPluginSettings`:
```typescript
projectsFolderBase: string;     // default: "projects"
```

### 6.6 Tests (`tests/integration/ai_output.test.ts`)

- `create_ai_output` → `get_pending_ai_output` → verify it appears
- `mark_ai_output_picked_up` → `get_pending_ai_output` → verify it's gone
- `create_ai_output` with nested path → verify `file_path` preserved correctly

---

## Sprint 7 — Option 4 Integration

**Goal:** When the AI creates tasks for the user, it writes structured data to the tasks table AND markdown to ai_output. On ingest, the TaskExtractor deduplicates against pre-existing tasks.

### 7.1 AI Creating Tasks via AI Output

When the AI creates tasks for the user (e.g., "create a task list for the CarChief sprint"):

1. **Write structured data to tasks table directly** — correct project associations, proper status, hierarchy
2. **Write the markdown version to `ai_output`** — with `- [ ]` checkboxes, organized under headings, placed at a specific file path
3. **Tag each task row with `reference_id`** = the target file path from step 2

When the plugin delivers the file and it later gets ingested:
- The TaskExtractor finds checkboxes in the note
- It matches them against existing tasks by `reference_id` (same file path) + content similarity
- Matches found → links them (no duplicates created)
- The thoughts get references to the already-existing task IDs

### 7.2 Tests (`tests/integration/enhanced_ingest.test.ts` — add to existing)

- Option 4 round-trip: AI creates tasks + ai_output → simulate plugin delivery → ingest detects → no duplicate tasks created
- Thoughts from ingested note reference the pre-existing task IDs

---

## Sprint 8 — Composite Query Tools

**Goal:** Add MCP tools that join across tables for complete-picture queries.

### 8.1 `get_project_summary`

- Input: `id` (uuid string, required)
- Returns: formatted text with:
  - Project details (name, type, description, parent, children)
  - Open tasks for this project (content, status, due date)
  - Recent thoughts referencing this project (last 10)
  - Source notes that mentioned this project (from note_snapshots via thoughts)

### 8.2 `get_recent_activity`

- Input: `days` (number, optional, default 7)
- Returns: formatted text with:
  - New/updated thoughts in the last N days
  - Tasks created or completed in the last N days
  - Projects created or updated in the last N days
  - AI outputs delivered in the last N days

### 8.3 Tests

- `get_project_summary` returns tasks, thoughts, and source notes for a project
- `get_recent_activity` returns cross-table activity within date range

---

## Edge Cases (All Sprints)

- **Checkboxes inside code blocks:** The structural parser must skip fenced code blocks (``` or ~~~). A `- [ ]` inside a code block is not a task.
- **Duplicate task text:** Two checkboxes with identical text in the same note. Disambiguate by line position during reconciliation.
- **Task moved between notes:** User cuts a `- [ ]` from one note and pastes it in another. The old note's ingest won't find the task → it stays in the DB (we don't delete tasks from re-ingest). The new note's ingest creates a new task. Mitigation: semantic dedup during TaskExtractor — before creating a new task, check if an identical-content task already exists for the same project.
- **Project folder renamed:** User renames `/projects/CarChief/` to `/projects/DealerPro/`. Next ingest creates a new project "DealerPro." Old "CarChief" project stays in DB. User would need to manually archive CarChief or the AI can detect the rename heuristically.
- **Very long notes:** Notes with 100+ checkboxes. The AI call for project association should batch if needed. The structural parse is O(lines) and always fast.
- **`capture_thought` with no tasks or projects:** The extractors run but return empty arrays. No harm — the thought is stored normally with empty references.
- **AI Output file already exists in vault:** The plugin overwrites it. The AI should be aware of this and avoid clobbering user files — use paths under `/projects/` or a dedicated output folder.
