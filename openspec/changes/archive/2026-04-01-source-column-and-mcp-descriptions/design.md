## Context

The `note_snapshots` table has `source text not null default 'obsidian'` (migration `20260322000001`). The MCP handler `handleIngestNote` in `tools/thoughts.ts:466-472` already hardcodes `source: "obsidian"` in its upsert, so the DB default is redundant for the Obsidian path — but it masks bugs for any other caller that forgets to pass `source`.

The Obsidian plugin (`obsidian-plugin/src/main.ts:466-485`) calls the `/ingest-note` HTTP endpoint with `{ content, title, note_id }` and does not pass `source`. The MCP handler supplies it server-side, so the plugin doesn't need to change.

The `create_ai_output` and `create_tasks_with_output` tool descriptions (`tools/ai_output.ts:88-92` and `329-335`) currently encourage use "whenever the user asks" but don't warn that delivered documents get re-ingested via the Obsidian plugin's `ingest_note` pipeline, creating thoughts in the knowledge base. AI callers have been using these proactively.

## Goals / Non-Goals

**Goals:**
- Ensure `note_snapshots.source` is always explicitly provided, never silently defaulted
- Make AI callers aware that `create_ai_output` / `create_tasks_with_output` have ingest side effects and should only be called on explicit user request

**Non-Goals:**
- Changing the Obsidian plugin's HTTP call (the server-side handler already supplies `source`)
- Adding enum validation or restricting `source` values
- Changing any runtime behavior of `create_ai_output` or `create_tasks_with_output`

## Decisions

### 1. Drop the DB default rather than making it dynamic

**Choice:** `ALTER COLUMN source DROP DEFAULT` — keep `NOT NULL`, remove the default.

**Why:** The server-side handler already passes `source: "obsidian"` explicitly. Removing the default makes any future caller that forgets to pass `source` fail loudly at insert time, which is the desired behavior. Making the default dynamic (e.g., a function that inspects context) would add complexity for no gain.

**Alternative considered:** Change the default to `'unknown'`. Rejected because a silent fallback defeats the purpose of enforcing provenance.

### 2. Description-only changes for AI output tools

**Choice:** Update the `.describe()` strings on `create_ai_output` and `create_tasks_with_output`. No code logic changes.

**Why:** The problem is AI callers using these tools proactively, not a code bug. The fix is to communicate the side effects and usage policy in the tool description, which is what AI callers read to decide when to use a tool.

**Alternative considered:** Adding a `confirmed: true` required parameter to force explicit intent. Rejected as over-engineered — the description change aligns with how MCP tool usage decisions work.

### Test Strategy

- **Unit tests:** Not applicable — no logic changes, only a migration and description strings.
- **Integration tests:** Verify that inserting into `note_snapshots` without `source` raises a NOT NULL error after the migration. Verify that the existing `handleIngestNote` path still works (it passes `source` explicitly).
- **E2E tests:** Existing E2E tests that go through `ingest_note` should continue to pass since the handler supplies `source`. Verify no test relies on the DB default.

## Risks / Trade-offs

- **[Risk] Existing callers relying on the default** → Mitigated: Only `handleIngestNote` inserts into `note_snapshots`, and it already passes `source: "obsidian"` explicitly. `capture_thought` does not use `note_snapshots` at all. Grep for `.from("note_snapshots")` to confirm no other insert paths exist.
- **[Risk] Migration on production data** → No data migration needed. Existing rows already have `source` populated. The `ALTER COLUMN DROP DEFAULT` only affects future inserts.
- **[Risk] AI callers ignore updated descriptions** → Low risk, but the description is the primary mechanism MCP provides for guiding tool usage. Reinforced by the memory file `feedback_no_unsolicited_ai_output.md` already in the user's Claude config.

## Migration Plan

1. Apply the `ALTER COLUMN source DROP DEFAULT` migration via Supabase CLI
2. Deploy the updated edge function with new tool descriptions
3. No rollback needed for descriptions. DB rollback: `ALTER COLUMN source SET DEFAULT 'obsidian'` if needed
