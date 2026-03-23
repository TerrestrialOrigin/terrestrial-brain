## Why

The plugin settings expose milliseconds directly to users (confusing UX), the brain icon only does one thing (sync current note), and the MCP `create_ai_output` tool accepts any string as `file_path` — including paths with characters that are invalid on Windows, which causes silent failures when the plugin tries to write the file. These are small but compounding friction points that hurt daily usability.

## What Changes

- **Filepath validation in `create_ai_output`**: Reject file paths containing characters invalid on Windows (`<>:"/\|?*`, control characters, reserved names like `CON`/`PRN`/`NUL`, trailing dots/spaces). Return a descriptive error so the AI can retry with a corrected path.
- **Settings stored in minutes**: Change `debounceMs` and `pollIntervalMs` to `syncDelayMinutes` and `pollIntervalMinutes` in the settings UI and persisted data. Convert to milliseconds internally. Defaults stay at 5 and 10 minutes respectively.
- **Brain icon context menu**: Replace the single-action ribbon icon with a context menu offering "Sync note to Terrestrial Brain" and "Pull AI Output from Terrestrial Brain". Keep existing Ctrl+P commands unchanged.
- **Verify AI output can target any folder**: Confirm and test that `pollAIOutput` correctly creates arbitrary nested parent directories and writes files at any vault-relative path.

## Non-goals

- Changing the AI output confirmation dialog UX (already implemented in a previous sprint).
- Adding per-output accept/reject (current batch accept/reject is sufficient).
- Changing the MCP authentication or transport layer.
- Modifying the ingest pipeline or thought reconciliation logic.

## Capabilities

### New Capabilities

- `filepath-validation`: Server-side validation of file paths in `create_ai_output`, rejecting OS-invalid paths with descriptive errors.

### Modified Capabilities

- `obsidian-plugin`: Settings renamed from milliseconds to minutes (`syncDelayMinutes`, `pollIntervalMinutes`), ribbon icon changed from single-action to context menu with two options, verify arbitrary folder output delivery.
- `ai-output`: `create_ai_output` tool gains filepath validation — invalid paths are rejected before insert.

## Impact

- **`supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts`**: Add validation logic to `create_ai_output` handler.
- **`obsidian-plugin/src/main.ts`**: Rename settings fields, add ms conversion, replace ribbon click handler with context menu, update settings tab labels.
- **`obsidian-plugin/src/main.test.ts`**: Update tests for new setting names, add tests for context menu, add tests for arbitrary-path AI output delivery.
- **`openspec/specs/obsidian-plugin/spec.md`**: Update settings table and ribbon icon scenarios.
- **`openspec/specs/ai-output/spec.md`**: Add filepath validation scenarios to `create_ai_output`.
