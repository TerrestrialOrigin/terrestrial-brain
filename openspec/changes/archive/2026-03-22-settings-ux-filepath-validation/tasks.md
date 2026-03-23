## 1. Filepath Validation (MCP Server)

- [x] 1.1 Create `supabase/functions/terrestrial-brain-mcp/validators.ts` with `validateFilePath(filePath: string): string | null` function implementing all validation rules (invalid chars, reserved names, trailing dot/space, empty segments, absolute paths, .md extension)
- [x] 1.2 Integrate `validateFilePath` into `create_ai_output` handler in `tools/ai_output.ts` — call before DB insert, return error with `isError: true` if invalid
- [x] 1.3 Integrate `validateFilePath` into `create_tasks_with_output` handler in `tools/ai_output.ts` — call before any task insertion, return error with `isError: true` if invalid

## 2. Plugin Settings (Minutes Conversion)

- [x] 2.1 Rename `debounceMs` → `syncDelayMinutes` and `pollIntervalMs` → `pollIntervalMinutes` in `TBPluginSettings` interface and `DEFAULT_SETTINGS` (defaults: 5 and 10)
- [x] 2.2 Update `loadSettings()` to migrate old `debounceMs`/`pollIntervalMs` values to minutes (divide by 60000, round)
- [x] 2.3 Update all code that reads `debounceMs`/`pollIntervalMs` to use `syncDelayMinutes * 60000` and `pollIntervalMinutes * 60000`
- [x] 2.4 Update settings tab: labels to "Sync delay (minutes)" and "AI output poll interval (minutes)", placeholders and validation to work with minute values (min: 1)

## 3. Brain Icon Context Menu

- [x] 3.1 Replace the ribbon icon click handler with a context menu using Obsidian's `Menu` API, showing "Sync note to Terrestrial Brain" and "Pull AI Output from Terrestrial Brain"
- [x] 3.2 Wire "Sync note" menu item to cancel timer + `processNote(file, { force: true })` with no-active-file notice
- [x] 3.3 Wire "Pull AI Output" menu item to `pollAIOutput()`

## 4. Testing & Verification

- [x] 4.1 Write unit tests for `validateFilePath` — valid paths, each invalid character, reserved names, trailing dot/space, empty segments, absolute path, missing .md extension, control characters
- [x] 4.2 Update existing plugin tests: rename setting fields from `debounceMs`/`pollIntervalMs` to `syncDelayMinutes`/`pollIntervalMinutes`, verify ms conversion
- [x] 4.3 Add plugin test for settings migration (old ms values → new minutes values)
- [x] 4.4 Add plugin tests for context menu setup (ribbon icon creates Menu with correct items)
- [x] 4.5 Add plugin tests for AI output delivery to deeply nested paths (verify mkdir called with correct parent folder)
- [x] 4.6 Run all tests across all packages — zero failures, zero skips
