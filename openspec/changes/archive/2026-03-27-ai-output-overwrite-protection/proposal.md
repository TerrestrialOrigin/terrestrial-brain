## Why

When the Obsidian plugin pulls AI output, it unconditionally overwrites existing files at the same path. Users can lose local edits or curated content with no warning. The confirmation dialog shows *what* will be delivered but not *whether* it conflicts with existing vault files — users need per-file control when a conflict is detected.

## What Changes

- Detect file conflicts: before writing, check if each AI output's `file_path` already exists in the vault
- Show conflict status in the confirmation dialog (new file vs. overwrite)
- For conflicting files, let the user choose per-file: **Overwrite** or **Save as copy** (e.g., `Filename(2).md`)
- Auto-increment the suffix if `Filename(2).md` already exists (→ `Filename(3).md`, etc.)
- Non-conflicting files are written as before (no extra interaction needed)

## Non-goals

- Merge or diff between existing and incoming content — this is overwrite-or-rename, not a merge tool
- Changing the backend/MCP tools — conflict detection is purely a client-side (Obsidian plugin) concern
- Per-file accept/reject — rejection is still all-or-nothing via the existing "Reject All" button
- Version history or backup of overwritten files

## Capabilities

### New Capabilities

_(none — this enhances an existing capability)_

### Modified Capabilities

- `ai-output-confirmation` (`openspec/specs/ai-output-confirmation/spec.md`): The confirmation dialog gains per-file conflict detection and overwrite-vs-rename controls when a pending output targets an existing vault file
- `obsidian-plugin` (`openspec/specs/obsidian-plugin/spec.md`): The AI output polling flow gains conflict-aware file writing with optional rename using numeric suffix

## Impact

- **Obsidian plugin** (`obsidian-plugin/src/main.ts`): `pollAIOutput()` and `AIOutputConfirmModal` modified
- **Tests** (`obsidian-plugin/src/main.test.ts`): New test cases for conflict detection, rename logic, suffix incrementing
- **No backend changes** — MCP tools, database schema, and Supabase functions are unaffected
