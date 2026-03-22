# Terrestrial Brain — Two-Way Project & Task Sync

This document describes the changes needed to add full two-way sync of projects and tasks between the Supabase database and the Obsidian vault. Build and test everything against the local dev environment before deploying.

> **Loop prevention is the critical concern.** Every design decision here is made with the goal of preventing infinite sync loops between the plugin writing notes and the modify handler syncing changes back.

---

## Overview

Currently, the plugin syncs vault notes *to* Terrestrial Brain (one-way ingest). AI notes sync *from* the server to the vault (one-way pull). This change adds full two-way sync for projects and tasks:

- **Server → Vault:** Plugin polls for projects and tasks, creates/updates markdown notes in the vault
- **Vault → Server:** When the user edits a project or task note in Obsidian, the plugin detects the change and pushes updates back to the MCP

All generated notes use `terrestrialBrainExclude: true` in frontmatter, so `ingest_note` never touches them. The existing hash-based dedup (`syncedHashes`) is extended to prevent modify-event loops.

---

## Part 1 — New MCP Tools

### 1.1 `get_all_projects` (`tools/projects.ts`)

Returns a JSON array of all active (non-archived) projects with full details.

- Input: `include_archived` (boolean, optional, default false)
- Returns: JSON string of array, each element:
  ```json
  {
    "id": "uuid",
    "name": "CarChief",
    "type": "client",
    "parent_id": "uuid or null",
    "parent_name": "Parent Name or null",
    "description": "Project description or null",
    "metadata": {},
    "created_at": "ISO string",
    "updated_at": "ISO string"
  }
  ```
- The response must be a valid JSON string (not formatted text) so the plugin can `JSON.parse()` it
- Include `parent_name` resolved from the parent record so the plugin doesn't need a second round trip

### 1.2 `get_all_tasks` (`tools/tasks.ts`)

Returns a JSON array of all non-archived tasks.

- Input: `include_archived` (boolean, optional, default false)
- Returns: JSON string of array, each element:
  ```json
  {
    "id": "uuid",
    "content": "Task description",
    "status": "open",
    "due_by": "ISO string or null",
    "project_id": "uuid or null",
    "project_name": "CarChief or null",
    "parent_id": "uuid or null",
    "metadata": {},
    "created_at": "ISO string",
    "updated_at": "ISO string"
  }
  ```
- Include `project_name` resolved from the projects table

---

## Part 2 — Note Format

### 2.1 Task Notes

```markdown
---
terrestrialBrainExclude: true
tb_type: task
tb_id: 38439648-929e-4c15-a660-cf7f0cb8c120
tb_status: open
tb_due: 2026-03-25
tb_project_id: 00000000-0000-0000-0000-000000000001
tb_project_name: CarChief
tb_synced_at: 1742558400000
---

Set up local Supabase dev environment
```

- The markdown body (everything after frontmatter) IS the task content. No special formatting required — the user just edits the text.
- `tb_status` is editable: `open`, `in_progress`, `done`, `deferred`
- `tb_due` is editable: ISO date string or remove the field to clear it
- `tb_project_id` / `tb_project_name` are editable: change or remove to reassign
- `tb_synced_at` is managed by the plugin — do not edit manually

**File path:** `{tasksFolder}/{project_name}/{sanitized_content}.md`
- Tasks without a project go in `{tasksFolder}/Unassigned/`
- Example: `Tasks/CarChief/Set up local Supabase dev environment.md`
- If task content is too long for a filename, truncate to first 60 chars

### 2.2 Project Notes

```markdown
---
terrestrialBrainExclude: true
tb_type: project
tb_id: 00000000-0000-0000-0000-000000000001
tb_project_type: client
tb_parent_id: null
tb_archived: false
tb_synced_at: 1742558400000
---

# CarChief

Main client project for dealer management platform.
```

- The first `# heading` in the body is the project name
- Everything after the heading is the project description
- `tb_project_type` is editable: `client`, `personal`, `research`, `internal`
- `tb_parent_id` is editable: set to a project UUID to reparent
- `tb_archived` is editable: set to `true` to archive the project (triggers `archive_project` on sync-back)
- If there is no `# heading`, the filename (without `.md`) is used as the project name

**File path:** `{projectsFolder}/{sanitized_name}.md`
- Child projects go in `{projectsFolder}/{parent_name}/{sanitized_name}.md`
- Example: `Projects/CarChief.md`, `Projects/CarChief/CarChief Backend.md`

---

## Part 3 — Plugin Settings

### 3.1 New Settings Fields

Add to `TBPluginSettings`:

```typescript
projectsFolderBase: string;   // default: "Projects"
tasksFolderBase: string;      // default: "Tasks"
syncProjectsAndTasks: boolean; // default: true — master toggle for this feature
```

Add corresponding UI in `TBSettingTab.display()`.

### 3.2 Default Settings Update

```typescript
const DEFAULT_SETTINGS: TBPluginSettings = {
  // ... existing fields ...
  projectsFolderBase: "Projects",
  tasksFolderBase: "Tasks",
  syncProjectsAndTasks: true,
};
```

---

## Part 4 — Plugin: Server → Vault Sync

### 4.1 `syncProjectsAndTasks()` Method

Add a new method to the plugin class. This runs alongside `pollAINotes()` on the same interval.

```
async syncProjectsAndTasks():
  if !settings.syncProjectsAndTasks or !settings.tbEndpointUrl: return

  // ── Sync Projects ──
  1. Call get_all_projects → parse JSON array
  2. Build a map of existing vault notes: scan projectsFolderBase for files
     with tb_type: "project" in frontmatter → map tb_id → file path
  3. For each project from server:
     a. Determine target path based on parent hierarchy
     b. If no existing note with this tb_id:
        - Generate markdown with frontmatter
        - Write file, store hash in syncedHashes
     c. If existing note found:
        - Compare server updated_at against note's tb_synced_at
        - If server is newer: regenerate note content, write file, update hash
        - If server is same or older: skip (vault version is current)
     d. If file exists at wrong path (project renamed/reparented):
        - Delete old file, write at new path
  4. For each vault note with tb_type: "project" whose tb_id is NOT in
     the server response (project was archived/deleted server-side):
     - Delete the vault note (or move to an archive folder)

  // ── Sync Tasks ──
  5. Call get_all_tasks → parse JSON array
  6. Same logic as projects: map tb_id → file path, create/update/remove
  7. Task file paths depend on project_name, so build paths after
     projects are synced
```

### 4.2 Generating Note Content

Helper functions to build the markdown string for each type:

```typescript
function buildTaskNote(task: ServerTask): string {
  const fm = [
    '---',
    'terrestrialBrainExclude: true',
    'tb_type: task',
    `tb_id: ${task.id}`,
    `tb_status: ${task.status}`,
  ];
  if (task.due_by) fm.push(`tb_due: ${task.due_by}`);
  if (task.project_id) {
    fm.push(`tb_project_id: ${task.project_id}`);
    fm.push(`tb_project_name: ${task.project_name}`);
  }
  fm.push(`tb_synced_at: ${Date.now()}`);
  fm.push('---');
  fm.push('');
  fm.push(task.content);
  return fm.join('\n');
}

function buildProjectNote(project: ServerProject): string {
  const fm = [
    '---',
    'terrestrialBrainExclude: true',
    'tb_type: project',
    `tb_id: ${project.id}`,
    `tb_project_type: ${project.type || ''}`,
    `tb_parent_id: ${project.parent_id || ''}`,
    'tb_archived: false',
    `tb_synced_at: ${Date.now()}`,
    '---',
    '',
    `# ${project.name}`,
  ];
  if (project.description) {
    fm.push('');
    fm.push(project.description);
  }
  return fm.join('\n');
}
```

### 4.3 Call from `onload()`

Add to `onload()` after the existing polling setup:

```typescript
// Sync projects and tasks on startup
await this.syncProjectsAndTasks();

// Then sync on the same poll interval
this.registerInterval(
  window.setInterval(() => this.syncProjectsAndTasks(), this.settings.pollIntervalMs)
);
```

---

## Part 5 — Plugin: Vault → Server Sync (Write-Back)

### 5.1 Modify Handler — New Branch for TB-Managed Notes

The existing `modify` event handler calls `scheduleSync(file)` for markdown files. Add a new check **before** `scheduleSync`:

```typescript
this.registerEvent(
  this.app.vault.on("modify", (file: TFile) => {
    if (file.extension !== "md") return;

    // Check if this is a TB-managed note (project or task)
    const cache = this.app.metadataCache.getFileCache(file);
    const tbType = cache?.frontmatter?.tb_type;
    if (tbType === "task" || tbType === "project") {
      this.scheduleWriteBack(file);
      return; // do NOT schedule ingest — these are excluded anyway
    }

    this.scheduleSync(file);
  })
);
```

### 5.2 `scheduleWriteBack()` — Debounced Write-Back

Same pattern as `scheduleSync` but with a shorter debounce (e.g. 5 seconds — these are quick metadata updates, not full note ingests):

```typescript
private writeBackTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

scheduleWriteBack(file: TFile) {
  const existing = this.writeBackTimers.get(file.path);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(async () => {
    this.writeBackTimers.delete(file.path);
    await this.processWriteBack(file);
  }, 5000); // 5 second debounce
  this.writeBackTimers.set(file.path, timer);
}
```

Clear these timers in `onunload()` alongside the existing debounce timers.

### 5.3 `processWriteBack()` — Detect Changes and Push

```
async processWriteBack(file: TFile):
  1. Read file content
  2. Compute hash of full content
  3. If hash matches syncedHashes[file.path]: return (no change, or we just wrote this)
     ← THIS IS THE LOOP BREAKER
  4. Parse frontmatter to get tb_type, tb_id, and editable fields
  5. Based on tb_type:

     If "task":
       - Parse body (strip frontmatter) → this is the task content
       - Read tb_status, tb_due, tb_project_id from frontmatter
       - Call update_task with: id, content, status, due_by, project_id
       - Update tb_synced_at in frontmatter, rewrite file, update hash

     If "project":
       - Parse body: first # heading = name, rest = description
       - Read tb_project_type, tb_parent_id, tb_archived from frontmatter
       - If tb_archived changed to true: call archive_project instead of update
       - Otherwise: call update_project with: id, name, type, parent_id, description
       - Update tb_synced_at in frontmatter, rewrite file, update hash
```

### 5.4 Loop Prevention — Detailed Walkthrough

This is the critical path. Here's exactly how loops are prevented:

```
Scenario A: Server changes a task → plugin updates vault note
  1. syncProjectsAndTasks() detects server updated_at > tb_synced_at
  2. Plugin rewrites the note file with new content
  3. Plugin stores hash of written content in syncedHashes[path]
  4. Obsidian fires "modify" event
  5. scheduleWriteBack fires after 5s debounce
  6. processWriteBack reads file, computes hash
  7. Hash MATCHES syncedHashes → return immediately. NO write-back.
  ✅ No loop.

Scenario B: User edits a task note in Obsidian
  1. User changes task content or frontmatter status
  2. Obsidian fires "modify" event
  3. scheduleWriteBack fires after 5s debounce
  4. processWriteBack reads file, computes hash
  5. Hash DOES NOT match syncedHashes (user changed something)
  6. Plugin calls update_task on MCP
  7. Plugin updates tb_synced_at in frontmatter, rewrites file
  8. Plugin stores NEW hash in syncedHashes
  9. Obsidian fires "modify" event again (from step 7 rewrite)
  10. processWriteBack reads file, computes hash
  11. Hash MATCHES syncedHashes → return immediately. NO second write-back.
  ✅ No loop.

Scenario C: Next poll after user edit
  1. syncProjectsAndTasks() fetches tasks from server
  2. Server's updated_at reflects the update from Scenario B
  3. Compare server updated_at against note's tb_synced_at
  4. tb_synced_at was updated in step 7 of Scenario B → server is NOT newer
  5. Skip this note.
  ✅ No loop.
```

---

## Part 6 — Parsing Helpers

### 6.1 `parseTaskNote(content: string)`

```typescript
interface ParsedTaskNote {
  tb_id: string;
  content: string;         // body text after frontmatter
  status: string;
  due_by: string | null;
  project_id: string | null;
  synced_at: number;
}

function parseTaskNote(raw: string): ParsedTaskNote | null {
  // Extract frontmatter and body
  // Return null if tb_type !== "task" or tb_id missing
}
```

### 6.2 `parseProjectNote(content: string)`

```typescript
interface ParsedProjectNote {
  tb_id: string;
  name: string;            // from first # heading or filename
  description: string;     // body after heading
  type: string | null;
  parent_id: string | null;
  archived: boolean;
  synced_at: number;
}

function parseProjectNote(raw: string, filename: string): ParsedProjectNote | null {
  // Extract frontmatter and body
  // Parse first # heading as name, rest as description
  // Return null if tb_type !== "project" or tb_id missing
}
```

### 6.3 `sanitizeFilename(name: string): string`

Strip characters that are invalid in filenames (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`). Truncate to 60 characters. Trim whitespace.

---

## Part 7 — File Path Management

### 7.1 Path Resolution

```typescript
function getProjectPath(project: ServerProject, allProjects: ServerProject[]): string {
  // If project has parent_id, nest under parent folder
  // e.g. "Projects/CarChief/CarChief Backend.md"
  // If no parent, e.g. "Projects/CarChief.md"
  const parts = [settings.projectsFolderBase];
  if (project.parent_id) {
    const parent = allProjects.find(p => p.id === project.parent_id);
    if (parent) parts.push(sanitizeFilename(parent.name));
  }
  parts.push(sanitizeFilename(project.name) + ".md");
  return parts.join("/");
}

function getTaskPath(task: ServerTask): string {
  // e.g. "Tasks/CarChief/Set up local Supabase dev.md"
  // e.g. "Tasks/Unassigned/Some task.md"
  const parts = [settings.tasksFolderBase];
  parts.push(task.project_name ? sanitizeFilename(task.project_name) : "Unassigned");
  parts.push(sanitizeFilename(task.content) + ".md");
  return parts.join("/");
}
```

### 7.2 Handling Renames and Moves

When a task's content changes or a project is renamed, the target file path changes. The sync logic must:

1. Detect that `tb_id` maps to a file at the OLD path
2. Delete (or rename) the old file
3. Write the new file at the new path
4. Update `syncedHashes` — remove old path entry, add new path entry

The `tb_id → file path` map is rebuilt on each poll by scanning the folder for files with `tb_type` frontmatter.

---

## Part 8 — Tests

### 8.1 Integration Tests (`tests/integration/sync.test.ts`)

**New MCP tool tests:**
- `get_all_projects` returns JSON array with all seed projects
- `get_all_projects` includes parent_name for child projects
- `get_all_tasks` returns JSON array with all seed tasks
- `get_all_tasks` includes project_name
- `get_all_tasks` with `include_archived: false` excludes archived tasks

**Round-trip tests:**
- Create a project via `create_project` → `get_all_projects` → verify it appears with correct fields
- Create a task via `create_task` → `get_all_tasks` → verify it appears
- Update a task via `update_task` → `get_all_tasks` → verify `updated_at` changed
- Archive a project → `get_all_projects` (default) → verify it's gone
- Archive a project → `get_all_projects` with `include_archived: true` → verify it's there

### 8.2 Loop Prevention Tests (`tests/integration/loop.test.ts`)

These tests verify that the hash-based loop prevention works correctly. Since we can't run the Obsidian plugin in a test, we simulate the logic:

```typescript
// Test the core loop-prevention invariant:
// "If content hasn't changed since last write, no sync fires"

Deno.test("hash match prevents write-back", () => {
  const content = buildTaskNote(sampleTask);
  const hash = simpleHash(stripFrontmatter(content));
  const syncedHashes: Record<string, string> = { "Tasks/Test.md": hash };

  // Simulate modify event — hash matches, should skip
  const currentHash = simpleHash(stripFrontmatter(content));
  assertEquals(currentHash, syncedHashes["Tasks/Test.md"]);
  // processWriteBack would return here — no MCP call
});

Deno.test("content change triggers write-back", () => {
  const content = buildTaskNote(sampleTask);
  const hash = simpleHash(stripFrontmatter(content));
  const syncedHashes: Record<string, string> = { "Tasks/Test.md": hash };

  // User edits the note
  const edited = content.replace("original content", "user edited this");
  const newHash = simpleHash(stripFrontmatter(edited));
  assertNotEquals(newHash, syncedHashes["Tasks/Test.md"]);
  // processWriteBack would call update_task here
});

Deno.test("write-back rewrite doesn't trigger second write-back", () => {
  // Simulate: processWriteBack updates tb_synced_at and rewrites
  const rewritten = buildTaskNote({ ...sampleTask, content: "user edited this" });
  const rewriteHash = simpleHash(stripFrontmatter(rewritten));
  const syncedHashes: Record<string, string> = { "Tasks/Test.md": rewriteHash };

  // Next modify event from the rewrite
  const currentHash = simpleHash(stripFrontmatter(rewritten));
  assertEquals(currentHash, syncedHashes["Tasks/Test.md"]);
  // processWriteBack would return here — loop broken
});

Deno.test("server poll after user edit doesn't overwrite", () => {
  // Simulate: user edited at time T1, server got the update
  // Next poll: server updated_at = T1, note tb_synced_at = T1
  // Server is NOT newer → skip
  const serverUpdatedAt = 1742558400000;
  const noteSyncedAt = 1742558400000;
  assertEquals(serverUpdatedAt <= noteSyncedAt, true);
  // syncProjectsAndTasks would skip this note
});
```

### 8.3 Parse/Generate Round-Trip Tests (`tests/integration/note_format.test.ts`)

```typescript
Deno.test("buildTaskNote → parseTaskNote round-trips correctly", () => {
  const task = { id: "abc-123", content: "Test task", status: "open",
                 due_by: "2026-03-25", project_id: "def-456",
                 project_name: "TestProject" };
  const note = buildTaskNote(task);
  const parsed = parseTaskNote(note);
  assertEquals(parsed.tb_id, task.id);
  assertEquals(parsed.content.trim(), task.content);
  assertEquals(parsed.status, task.status);
  assertEquals(parsed.due_by, task.due_by);
  assertEquals(parsed.project_id, task.project_id);
});

Deno.test("buildProjectNote → parseProjectNote round-trips correctly", () => {
  const project = { id: "abc-123", name: "TestProject", type: "client",
                    parent_id: null, description: "A test project" };
  const note = buildProjectNote(project);
  const parsed = parseProjectNote(note, "TestProject.md");
  assertEquals(parsed.tb_id, project.id);
  assertEquals(parsed.name, project.name);
  assertEquals(parsed.type, project.type);
  assertEquals(parsed.description.trim(), project.description);
});

Deno.test("sanitizeFilename handles edge cases", () => {
  assertEquals(sanitizeFilename("foo/bar:baz"), "foobarbaz");
  assertEquals(sanitizeFilename("a".repeat(100)), "a".repeat(60));
  assertEquals(sanitizeFilename("  spaces  "), "spaces");
});
```

### 8.4 End-to-End Simulation Test (`tests/integration/e2e_sync.test.ts`)

This test simulates the full cycle without Obsidian:

```typescript
Deno.test("full sync cycle: create → poll → edit → write-back → poll", async () => {
  // 1. Create a task via MCP
  const createResult = await callTool("create_task", {
    content: "E2E test task",
    project_id: SEED_PROJECT_ID,
  });
  const taskId = extractId(createResult);

  // 2. Simulate plugin poll: get_all_tasks
  const tasksJson = await callTool("get_all_tasks", {});
  const tasks = JSON.parse(tasksJson);
  const task = tasks.find(t => t.id === taskId);
  assertExists(task);

  // 3. Simulate plugin writing note
  const noteContent = buildTaskNote(task);
  const hash1 = simpleHash(stripFrontmatter(noteContent));

  // 4. Simulate user edit: change status
  const edited = noteContent.replace("tb_status: open", "tb_status: done");
  const hash2 = simpleHash(stripFrontmatter(edited));
  assertNotEquals(hash1, hash2); // Change detected

  // 5. Simulate write-back: update_task
  await callTool("update_task", { id: taskId, status: "done" });

  // 6. Simulate next poll: task should show done
  const tasksJson2 = await callTool("get_all_tasks", { include_archived: true });
  const tasks2 = JSON.parse(tasksJson2);
  const updated = tasks2.find(t => t.id === taskId);
  assertEquals(updated.status, "done");
});
```

---

## Part 9 — Implementation Order

1. **MCP tools first:** Add `get_all_projects` and `get_all_tasks` to the edge function. Test with curl / integration tests.
2. **Note generation helpers:** Write `buildTaskNote`, `buildProjectNote`, `sanitizeFilename` as pure functions. Test with round-trip unit tests.
3. **Server → Vault sync:** Implement `syncProjectsAndTasks()` in the plugin. Test by running the plugin in the test vault — verify notes appear in `Projects/` and `Tasks/` folders.
4. **Vault → Server write-back:** Implement `scheduleWriteBack` and `processWriteBack`. Test by editing notes in Obsidian and checking the DB via Studio.
5. **Loop prevention tests:** Run the full test suite, especially the loop simulation tests.
6. **Manual verification:** Edit a task in Obsidian, wait 5 seconds, check Studio. Edit the same task in Studio, wait for poll, check Obsidian. Repeat several times to confirm no loops.

---

## Part 10 — Edge Cases to Handle

- **Concurrent edits:** If the user edits in Obsidian while a poll is writing, the poll should not clobber user changes. The hash check handles this — if the file hash doesn't match what the poll would write, the user has unsaved changes. In this case, skip the server → vault update for this file and let the next write-back push the user's version.
- **Deleted notes:** If the user deletes a task/project note from the vault, the plugin should NOT delete it from the server. The note will be recreated on next poll. To actually delete/archive, the user should set `tb_archived: true` in frontmatter.
- **New tasks created in Obsidian:** Out of scope for this change. Tasks are created via Claude/MCP. The vault is a view + edit surface, not a creation surface. (Could be added later by watching for new files in the Tasks folder without `tb_id`.)
- **Filename collisions:** If two tasks have the same content under the same project, append a short hash suffix to the filename: `Task name (a1b2).md`.
