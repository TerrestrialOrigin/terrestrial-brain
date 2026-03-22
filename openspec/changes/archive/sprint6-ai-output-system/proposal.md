## Why

The current `ai_notes` system has design limitations: it uses `suggested_path` (optional, with a fallback folder), prepends `terrestrialBrainExclude: true` frontmatter (preventing delivered content from participating in normal ingest), and tracks sync state via a nullable `synced_at` timestamp. The new `ai_output` system fixes all three: explicit `file_path` (required), no exclusion tag (so delivered files get ingested normally — tasks, projects, and thoughts are extracted), and a cleaner `picked_up` boolean with separate `picked_up_at` timestamp. This also aligns with Sprint 7 (Option 4 integration) where AI-created task markdown must be ingested on delivery.

## What Changes

- **New MCP tools:** `create_ai_output`, `get_pending_ai_output`, `mark_ai_output_picked_up` — replace the three `ai_notes` tools
- **BREAKING: Remove old MCP tools:** `create_ai_note`, `get_unsynced_ai_notes`, `mark_notes_synced` — deleted along with `tools/ai_notes.ts`
- **Plugin update:** `pollAINotes()` replaced by `pollAIOutput()` — uses new tools, writes to `file_path` (no fallback folder logic), no frontmatter injection, content participates in normal ingest
- **Plugin settings:** Add `projectsFolderBase` setting (default `"projects"`); remove `aiNotesFolderBase` (no longer needed — `file_path` is explicit)
- **Data migration:** Unsynced rows from `ai_notes` migrated to `ai_output` (map `suggested_path` → `file_path`, `synced_at IS NULL` → `picked_up = false`)
- **Drop `ai_notes` table** after migration
- **Plugin commands/UI:** "Pull AI notes" command renamed to "Pull AI output"; polling notice text updated

## Non-goals

- No changes to `ingest_note` or the extractor pipeline (Sprint 5 work is stable)
- No AI-created task rows in this sprint (that's Sprint 7 — Option 4 integration)
- No changes to thought storage, embeddings, or search
- No changes to the Obsidian plugin's sync-to-brain direction (modify → debounce → ingest)

## Capabilities

### New Capabilities
- `ai-output-tools`: MCP tools for creating, polling, and marking AI output as picked up (replaces ai-notes tools)

### Modified Capabilities
- `obsidian-plugin`: Plugin polling switches from `pollAINotes`/ai_notes tools to `pollAIOutput`/ai_output tools; settings change (`projectsFolderBase` added, `aiNotesFolderBase` removed); commands renamed
- `mcp-server`: Tool module table updated — `tools/ai_notes.ts` replaced by `tools/ai_output.ts`

## Impact

- **MCP edge function:** `tools/ai_notes.ts` deleted, `tools/ai_output.ts` created, `index.ts` import updated
- **Obsidian plugin:** `main.ts` — `pollAINotes()` rewritten as `pollAIOutput()`, settings interface updated, command text updated
- **Database:** `ai_notes` table dropped after migration (migration already created in Sprint 1: `20260322000001_create_note_snapshots_ai_output.sql` created the `ai_output` table)
- **Integration tests:** `tests/integration/ai_notes.test.ts` replaced by `tests/integration/ai_output.test.ts`
- **pgTAP tests:** `supabase/tests/ai_notes.test.sql` can be removed after migration verified
- **Specs:** `openspec/specs/ai-notes.md` archived/superseded by `openspec/specs/ai-output.md` (already exists from Sprint 1)
