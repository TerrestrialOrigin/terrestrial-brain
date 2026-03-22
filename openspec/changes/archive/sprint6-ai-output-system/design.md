## Context

The current AI-to-Obsidian reverse path uses the `ai_notes` table and three MCP tools (`create_ai_note`, `get_unsynced_ai_notes`, `mark_notes_synced`). This system has three design issues:

1. **`suggested_path` is optional** — when omitted, the plugin falls back to `AI Notes/{title}.md`. The AI should always specify where output goes.
2. **`terrestrialBrainExclude: true` frontmatter is injected** — delivered files are invisible to the ingest pipeline. Tasks, projects, and thoughts inside AI-generated content are never extracted.
3. **`synced_at` nullable timestamp** — semantically overloaded (null = pending, non-null = synced). A boolean `picked_up` with separate `picked_up_at` is cleaner.

The `ai_output` table already exists (created in Sprint 1 migration `20260322000001`). This sprint wires it up with MCP tools and plugin polling.

## Goals / Non-Goals

**Goals:**
- Replace all three `ai_notes` MCP tools with `ai_output` equivalents
- Replace `pollAINotes()` in the plugin with `pollAIOutput()` using the new tools
- Delivered AI content participates in normal ingest (no exclusion tag)
- Migrate unsynced `ai_notes` rows to `ai_output`
- Drop the `ai_notes` table
- Clean up settings: remove `aiNotesFolderBase`, add `projectsFolderBase`

**Non-Goals:**
- No changes to `ingest_note`, `capture_thought`, or the extractor pipeline
- No AI-created task rows (Sprint 7)
- No composite query tools (Sprint 8)
- No changes to the Obsidian → Brain sync direction

## Decisions

### 1. No frontmatter injection in `create_ai_output`

**Decision:** `create_ai_output` stores raw content as-is. No UUID, timestamp, or `terrestrialBrainExclude` frontmatter is prepended.

**Why:** The whole point of the new system is that delivered files participate in normal ingest. Adding `terrestrialBrainExclude` defeats this. The AI can add its own frontmatter if needed, but the tool doesn't force it.

**Alternative considered:** Adding a non-exclusion frontmatter (e.g., `source: ai`). Rejected — this is metadata the AI can add itself if it wants to. The tool shouldn't impose structure on the markdown.

### 2. `file_path` is required, no fallback folder

**Decision:** `create_ai_output` requires `file_path` (full vault-relative path including filename). No default folder logic.

**Why:** The AI always knows where it wants to put the file. Making it explicit avoids the ambiguity of `suggested_path` + fallback. This also enables Sprint 7 where the AI creates tasks referencing a specific `file_path`.

### 3. Plugin writes content directly (no hash-busting frontmatter)

**Decision:** `pollAIOutput()` writes the content from the DB directly to the vault file. The hash stored in `syncedHashes` is computed on the raw content (no `stripFrontmatter` needed since there's no injected frontmatter).

**Why:** Since `create_ai_output` doesn't inject frontmatter, the content is stored exactly as the AI provided it. The plugin hashes whatever it writes. When the modify event fires and `processNote()` runs, it strips any frontmatter the AI may have included, hashes the result, and compares — but since `pollAIOutput()` stores the hash using the same `simpleHash(stripFrontmatter(content).trim())` transformation, the hashes match and re-ingestion is skipped.

**Note:** We keep the same hash transformation (`stripFrontmatter` then `trim` then `simpleHash`) in `pollAIOutput()` as `processNote()` uses, so the hash comparison works correctly even if the AI includes its own frontmatter in the content.

### 4. Migration via SQL migration file

**Decision:** A new SQL migration handles the `ai_notes` → `ai_output` data migration and drops `ai_notes`.

**Why:** Keeps the migration atomic and repeatable. The migration maps: `suggested_path` → `file_path` (with fallback to `'AI Notes/' || title || '.md'`), `synced_at IS NULL` → `picked_up = false`, `synced_at IS NOT NULL` → `picked_up = true`.

### 5. Plugin settings change

**Decision:** Remove `aiNotesFolderBase` from settings. Add `projectsFolderBase` (default: `"projects"`).

**Why:** `aiNotesFolderBase` was used as the fallback folder when `suggested_path` was null. With required `file_path`, it's unnecessary. `projectsFolderBase` is mentioned in SyncChanges 6.5 and will be used by the plugin for future path-related features.

### 6. Test Strategy

- **Integration tests (Deno):** Test the three new MCP tools end-to-end against the local Supabase instance. Replace `tests/integration/ai_notes.test.ts` with `tests/integration/ai_output.test.ts`.
- **Plugin unit tests (Vitest):** Test `pollAIOutput()` logic — parsing response, hash storage, MCP call sequence.
- **pgTAP tests:** The `ai_output` table already has pgTAP tests from Sprint 1. No new SQL tests needed.

## Risks / Trade-offs

- **[Breaking change for AI consumers]** Any AI session using `create_ai_note` will get a tool-not-found error after this change. → Mitigation: This is expected — the AI learns the new tool names from the MCP tool listing. No backwards compatibility needed since the AI discovers tools dynamically.

- **[Unsynced ai_notes lost if migration fails]** If the SQL migration errors, unsynced notes could be in limbo. → Mitigation: The migration is a single transaction. If it fails, nothing changes. Run it manually first against local Supabase to verify.

- **[Content participates in ingest]** AI-generated files will now be ingested, creating thoughts. If the AI writes a very long document, it could create many thoughts. → Mitigation: This is the desired behavior. The existing ingest pipeline handles long notes fine (it splits into thoughts). The user can always exclude specific files manually.

- **[Plugin settings migration]** Old plugin data has `aiNotesFolderBase` but no `projectsFolderBase`. → Mitigation: `Object.assign({}, DEFAULT_SETTINGS, savedData)` handles this — new defaults apply, old unused keys are ignored.

## Migration Plan

1. Apply SQL migration: migrate `ai_notes` → `ai_output`, drop `ai_notes`
2. Deploy updated edge function with new tools (old tools removed)
3. Update plugin code (new polling, new settings)
4. Plugin auto-loads new defaults via `Object.assign`

**Rollback:** If issues arise, re-create `ai_notes` from backup and redeploy old edge function. The `ai_output` table persists harmlessly.

## Open Questions

None — the design is straightforward and well-defined by SyncChanges.md Sprint 6.
