# Terrestrial Brain — Changes Spec

This document describes all planned changes to the Terrestrial Brain MCP edge function and the Obsidian sync plugin. Use this alongside `SETUP.md`. Make all changes against the local dev environment first. Do not touch production until the test suite passes and the changes are manually verified.

> **Claude Code context:** All work happens inside the Podman VM (`podman machine ssh` on Windows).
> Project files live on the host filesystem and are accessible inside the VM at `~/Dev/`.
> Run `supabase functions serve`, `deno test`, and all other CLI commands from inside the VM.
> VS Code on the host edits the same files directly — no special sync needed.

---

## Part 1 — MCP Edge Function Refactor & New Tools

### 1.1 Modularize the Edge Function

The current `index.ts` is a single large file. Split it into:

```
supabase/functions/terrestrial-brain-mcp/
  index.ts          ← Hono app, auth middleware, server init only
  helpers.ts        ← getEmbedding(), extractMetadata(), freshIngest()
  tools/
    thoughts.ts     ← existing 5 tools (search, list, stats, capture, ingest)
    projects.ts     ← new project tools
    tasks.ts        ← new task tools
    ai_notes.ts     ← new AI notes 2-way sync tools
```

Each `tools/*.ts` file exports a single `register(server: McpServer, supabase: SupabaseClient)` function that calls `server.registerTool(...)` for each tool in that file.

`index.ts` calls all four register functions after creating the server:

```typescript
import { register as registerThoughts } from "./tools/thoughts.ts";
import { register as registerProjects } from "./tools/projects.ts";
import { register as registerTasks } from "./tools/tasks.ts";
import { register as registerAINotes } from "./tools/ai_notes.ts";

registerThoughts(server, supabase);
registerProjects(server, supabase);
registerTasks(server, supabase);
registerAINotes(server, supabase);
```

`helpers.ts` exports `getEmbedding`, `extractMetadata`, and `freshIngest`. All tools import from `../helpers.ts` as needed.

**Important:** Do not change any existing tool behavior during the refactor. The goal is a clean structural split only. Verify with the existing test suite after refactoring before adding new tools.

---

### 1.2 Update `freshIngest` — Project Detection

Modify `freshIngest()` in `helpers.ts` to detect project references during the split step.

Before calling the split AI, fetch active projects:

```typescript
const { data: projects } = await supabase
  .from("projects")
  .select("id, name")
  .is("archived_at", null);

const projectList = (projects || [])
  .map((p: { id: string; name: string }) => `- "${p.name}" (id: ${p.id})`)
  .join("\n");
```

Update the split AI system prompt to include project detection. Add to the existing prompt:

```
KNOWN PROJECTS (tag thoughts that clearly relate to one of these):
${projectList}

When a thought clearly relates to a known project, return it as an object instead of a plain string:
{"thought": "the thought text", "project_id": "the-uuid"}
Thoughts with no clear project match should remain plain strings.
Only tag a thought if the connection is explicit, not just tangential.
```

Update the response parsing to handle both plain strings and `{thought, project_id}` objects:

```typescript
for (const item of parsed.thoughts) {
  if (typeof item === "string") {
    // existing path — no project reference
    thoughts.push({ content: item, project_id: null });
  } else if (typeof item === "object" && item.thought) {
    thoughts.push({ content: item.thought, project_id: item.project_id || null });
  }
}
```

When inserting thoughts, add `project_id` to the metadata references if present:

```typescript
metadata: {
  ...metadata,
  source: "obsidian",
  note_title: title || null,
  ...(project_id ? { references: { project_id } } : {}),
}
```

Apply the same project detection logic to the reconcile path (the update and add branches of `ingest_note`).

---

### 1.3 New Tools — `tools/projects.ts`

Implement the following tools:

**`create_project`**
- Input: `name` (string, required), `type` (string, optional), `parent_id` (uuid string, optional), `description` (string, optional)
- Inserts into `projects` table
- Returns: confirmation string with the new project's id and name

**`list_projects`**
- Input: `include_archived` (boolean, optional, default false), `parent_id` (uuid string, optional — if provided, list only children of this project), `type` (string, optional)
- Query filters: `WHERE archived_at IS NULL` unless `include_archived` is true
- Returns: formatted list of projects with id, name, type, parent name (if any), child count, created date

**`get_project`**
- Input: `id` (uuid string, required)
- Returns: full project detail — name, type, description, parent (if any), direct children, open task count, created/updated dates

**`update_project`**
- Input: `id` (uuid string, required), `name` (string, optional), `type` (string, optional), `parent_id` (uuid string or null, optional), `description` (string, optional)
- Only updates fields that are provided
- Returns: confirmation

**`archive_project`**
- Input: `id` (uuid string, required)
- Sets `archived_at = now()` on the project
- Also archives all direct child projects (recursive) and all open tasks belonging to this project or any child
- Returns: summary of what was archived (e.g. "Archived project 'CarChief Backend' and 2 child projects, 4 tasks")

---

### 1.4 New Tools — `tools/tasks.ts`

**`create_task`**
- Input: `content` (string, required), `project_id` (uuid string, optional), `parent_id` (uuid string, optional), `due_by` (ISO 8601 string, optional), `status` (string, optional, default `"open"`)
- Inserts into `tasks` table
- Returns: confirmation with new task id

**`list_tasks`**
- Input: `project_id` (uuid string, optional), `status` (string, optional), `overdue_only` (boolean, optional), `include_archived` (boolean, optional, default false), `limit` (number, optional, default 20)
- Filters: `archived_at IS NULL` by default; if `overdue_only`, add `due_by < now() AND status != 'done'`
- Returns: formatted task list with id, content, status, due date, project name

**`update_task`**
- Input: `id` (uuid string, required), `content` (string, optional), `status` (string, optional), `due_by` (string or null, optional), `project_id` (string or null, optional)
- Only updates provided fields
- If `status` is set to `"done"`, automatically set `archived_at = now()` after a configurable delay — for now, set it immediately
- Returns: confirmation

**`archive_task`**
- Input: `id` (uuid string, required)
- Sets `archived_at = now()`
- Returns: confirmation

---

### 1.5 New Tools — `tools/ai_notes.ts`

**`create_ai_note`**
- Input: `title` (string, required), `content` (string, required), `suggested_path` (string, optional)
- The `content` field should be full markdown. The tool automatically prepends frontmatter:
  ```yaml
  ---
  tb_id: <generated uuid>
  created_utc: <current UTC millis>
  created_readable: <human-readable UTC string>
  terrestrialBrainExclude: true
  ---
  ```
- Inserts into `ai_notes` with `synced_at = null`
- Returns: confirmation with the note id and suggested path

**`get_unsynced_ai_notes`**
- Input: none
- Returns: JSON array of all notes where `synced_at IS NULL`, each with `{ id, title, content, suggested_path, created_at_utc }`
- If no unsynced notes, returns empty array `[]`
- The return value must be valid JSON string so the Obsidian plugin can `JSON.parse()` it

**`mark_notes_synced`**
- Input: `ids` (array of uuid strings, required)
- Sets `synced_at = current UTC millis` for all matching ids
- Returns: confirmation of how many notes were marked

---

## Part 2 — Obsidian Plugin Changes

The plugin source is in `obsidian-plugin/src/main.ts`. The existing structure (settings, debounce timers, `processNote`, `callMCP`) should be preserved. Add new functionality alongside it.

---

### 2.1 New Settings Fields

Add to `TBPluginSettings`:

```typescript
pollIntervalMs: number;   // How often to poll for AI notes (default: 600000 = 10 minutes)
aiNotesFolderBase: string; // Base folder for AI notes (default: "AI Notes")
```

Add corresponding settings UI in `TBSettingTab.display()`.

---

### 2.2 AI Notes Polling — `pollAINotes()`

Add a new method `pollAINotes()` to the plugin class:

```typescript
async pollAINotes() {
  if (!this.settings.tbEndpointUrl) return;
  try {
    const raw = await this.callMCP("get_unsynced_ai_notes", {});
    const notes: AINote[] = JSON.parse(raw);
    if (!notes.length) return;

    const ids: string[] = [];
    for (const note of notes) {
      const path = note.suggested_path
        || `${this.settings.aiNotesFolderBase}/${note.title}.md`;

      // Ensure parent folders exist
      const folder = path.substring(0, path.lastIndexOf("/"));
      if (folder) await this.app.vault.adapter.mkdir(folder);

      // Write the file (overwrite if exists — AI notes are always authoritative)
      await this.app.vault.adapter.write(path, note.content);
      ids.push(note.id);
    }

    await this.callMCP("mark_notes_synced", { ids });
    new Notice(`🧠 ${notes.length} AI note${notes.length > 1 ? "s" : ""} synced to vault`);
  } catch (err) {
    console.error("TB Poll error:", err);
  }
}
```

Add a type definition at the top of the file:

```typescript
interface AINote {
  id: string;
  title: string;
  content: string;
  suggested_path: string | null;
  created_at_utc: number;
}
```

---

### 2.3 Start Polling in `onload()`

Add to `onload()` after existing setup:

```typescript
// Poll for AI notes on startup
await this.pollAINotes();

// Then poll on interval
this.registerInterval(
  window.setInterval(() => this.pollAINotes(), this.settings.pollIntervalMs)
);
```

`registerInterval` is Obsidian's built-in method — it automatically clears the interval when the plugin unloads, so no manual cleanup is needed.

---

### 2.4 Add Manual Poll Command

```typescript
this.addCommand({
  id: "poll-ai-notes",
  name: "Pull AI notes from Terrestrial Brain",
  callback: async () => {
    await this.pollAINotes();
  },
});
```

---

### 2.5 AI Notes Exclusion — Ensure No Loop

The `isExcluded()` method already checks for the configured exclude tag. The `create_ai_note` tool (server side) injects `terrestrialBrainExclude: true` into the frontmatter of every AI-written note. Obsidian's metadata cache reads this as a tag, so `isExcluded()` will catch it automatically.

Verify this works correctly in testing: sync an AI note to the test vault, edit it, wait for the debounce timer, and confirm it does NOT get ingested back into the thoughts table.

---

### 2.6 Default Settings Update

```typescript
const DEFAULT_SETTINGS: TBPluginSettings = {
  tbEndpointUrl: "",
  excludeTag: "terrestrialBrainExclude",
  debounceMs: 300000,
  pollIntervalMs: 600000,        // 10 minutes
  aiNotesFolderBase: "AI Notes",
};
```

---

## Part 3 — Test Suite

### 3.1 Integration Tests (`tests/integration/`)

Write Deno tests covering:

- `create_project` → `list_projects` → verify it appears
- `create_project` with `parent_id` → `get_project` on parent → verify child appears
- `archive_project` → `list_projects` → verify it no longer appears in default list
- `create_task` with `project_id` → `list_tasks` with `project_id` filter → verify
- `update_task` with `status: "done"` → verify `archived_at` is set
- `create_ai_note` → `get_unsynced_ai_notes` → verify note appears
- `mark_notes_synced` → `get_unsynced_ai_notes` → verify note no longer appears
- `ingest_note` with content mentioning "CarChief" → verify resulting thought metadata has `references.project_id` set to the CarChief seed project id
- `thought_stats` → verify counts are accurate after operations

### 3.2 DB Tests (`supabase/tests/`)

Write pgTAP tests covering:

- `projects` table: parent_id self-reference works, archived_at filtering works
- `tasks` table: status constraint rejects invalid values, due_by ordering works
- `ai_notes` table: `synced_at IS NULL` filter returns correct rows
- `match_thoughts` RPC: returns results above threshold, respects match_count

---

## Part 4 — Deployment Checklist (do not do this yet)

When local testing is complete and the test suite passes:

1. Run `supabase db push` to apply new migrations to production
2. Run `supabase functions deploy terrestrial-brain-mcp` to deploy the updated edge function
3. Build the plugin with `npm run build` and copy `dist/main.js` + `manifest.json` to the real vault's plugin folder
4. Open real Obsidian vault, update plugin settings if needed, run "Sync entire vault" to re-index with project detection
5. Verify `thought_stats` in Claude shows the updated totals
6. Create a test project and task via Claude to verify the new MCP tools work end-to-end in production
