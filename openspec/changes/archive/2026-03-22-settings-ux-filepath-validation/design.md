## Context

The Obsidian plugin currently exposes timing settings in milliseconds, which is confusing for users. The ribbon brain icon only triggers a single action (sync current note). The MCP `create_ai_output` tool accepts any string as `file_path` without validation, meaning AI can produce paths with characters that are invalid on certain operating systems (especially Windows), causing silent write failures in the plugin.

The plugin already creates parent directories when delivering AI output (`deliverOutputs` in `main.ts:201-218`) and uses the `file_path` from the AI output record directly, so arbitrary-folder delivery already works. This change adds server-side validation to catch bad paths before they reach the plugin.

## Goals / Non-Goals

**Goals:**
- Validate file paths in `create_ai_output` and `create_tasks_with_output` server-side, rejecting paths with Windows-invalid characters
- Convert settings from milliseconds to minutes (user-facing), with internal ms conversion
- Replace the single-action ribbon icon with a two-option context menu
- Verify and test that AI output can be placed in any vault folder

**Non-Goals:**
- Changing the confirmation dialog UX
- Adding per-output accept/reject
- Modifying the ingest pipeline or thought reconciliation
- Adding OS detection (always validate against the most restrictive OS: Windows)

## Decisions

### 1. Filepath validation — extract a shared `validateFilePath` function

**Decision:** Create a `validateFilePath(filePath: string): string | null` function in a new `validators.ts` module in the MCP tools directory. Returns `null` if valid, or a descriptive error string if invalid. Called by both `create_ai_output` and `create_tasks_with_output` before database insert.

**Validation rules (Windows as baseline):**
- Reject characters: `< > : " / \ | ? *` and ASCII control characters (0x00–0x1F)
- Note: forward slash `/` is the path separator — it's allowed between segments but not within a segment name
- Reject reserved Windows filenames: `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9` (case-insensitive, with or without extension)
- Reject segments ending with `.` or space
- Reject empty segments (consecutive `/`)
- Reject empty path or path that is just whitespace
- Reject paths starting with `/` (must be vault-relative, not absolute)
- Require `.md` extension (all vault files are markdown)

**Why not validate on the plugin side?** The MCP server is the single entry point for all AI clients. Validating there catches bad paths regardless of which client calls the tool, and the AI gets an immediate retry opportunity.

**Alternative considered:** Sanitize paths instead of rejecting. Rejected because auto-sanitizing could produce unexpected filenames that confuse both the AI and the user.

### 2. Settings — rename fields from ms to minutes

**Decision:** Rename `debounceMs` → `syncDelayMinutes` and `pollIntervalMs` → `pollIntervalMinutes` in `TBPluginSettings`. Store values in minutes (number). Convert to milliseconds in code: `value * 60000`. Defaults: 5 and 10.

**Migration:** In `loadSettings()`, detect old `debounceMs`/`pollIntervalMs` fields and convert them to minutes (divide by 60000, round). This handles upgrades from the old format seamlessly.

**Minimum:** 1 minute for both settings (unchanged in ms terms: 60000).

### 3. Brain icon — context menu via Obsidian Menu API

**Decision:** Replace the ribbon icon's direct callback with one that creates and shows an Obsidian `Menu` instance with two items:
1. "Sync note to Terrestrial Brain" → calls `processNote(activeFile, { force: true })`
2. "Pull AI Output from Terrestrial Brain" → calls `pollAIOutput()`

**Why Menu over a custom modal?** `Menu` is Obsidian's native context menu API — it's lightweight, familiar to users, and follows platform conventions. A modal would be overkill for two options.

**Ctrl+P commands:** Unchanged. Both "Sync current note" and "Pull AI output" remain as separate commands.

### 4. Test strategy

| Layer | What | Where |
|-------|------|-------|
| Unit | `validateFilePath` — all edge cases (invalid chars, reserved names, etc.) | New test file in supabase or alongside ai_output.ts |
| Unit | Settings migration (old ms → new minutes), default values | `obsidian-plugin/src/main.test.ts` |
| Unit | Context menu setup (ribbon icon creates menu with correct items) | `obsidian-plugin/src/main.test.ts` |
| Unit | AI output delivery to nested paths (already partially covered) | `obsidian-plugin/src/main.test.ts` |

## Risks / Trade-offs

- **[Risk] Over-restrictive validation** → Some valid Unix paths might be rejected (e.g., filenames with `?` or `*`). **Mitigation:** This is intentional — cross-platform safety is more valuable than edge-case Unix flexibility. Error messages tell the AI exactly what's wrong so it can fix the path.

- **[Risk] Settings migration** → Users upgrading from old plugin version have ms values in persisted data. **Mitigation:** `loadSettings()` detects old field names and converts automatically.

- **[Risk] Menu event coordinates** → The Obsidian `Menu.showAtMouseEvent()` needs a mouse event. **Mitigation:** Ribbon icon clicks provide a mouse event. We'll capture it from the ribbon click handler.

## Open Questions

None — all decisions are straightforward and don't require external input.
