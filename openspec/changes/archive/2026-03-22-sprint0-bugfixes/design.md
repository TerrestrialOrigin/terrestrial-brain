## Context

The Obsidian plugin (`obsidian-plugin/src/main.ts`) has two pre-existing bugs in `isExcluded()` and `pollAINotes()`. Both are in the plugin's sync logic — no server-side or database changes are needed.

Current state:
- `isExcluded()` (lines 246–258) checks inline tags and the frontmatter `tags` array but misses standalone frontmatter booleans like `terrestrialBrainExclude: true`
- `pollAINotes()` (lines 166–192) writes AI note files to the vault but never stores their content hash in `syncedHashes`, causing the modify event to trigger unnecessary re-ingestion

## Goals / Non-Goals

**Goals:**
- `isExcluded()` correctly identifies notes with `terrestrialBrainExclude: true` as a standalone frontmatter boolean
- `pollAINotes()` stores content hashes after writing files, preventing re-ingestion on the next modify event
- Both fixes are covered by tests

**Non-Goals:**
- No changes to MCP server, edge functions, or database
- No changes to the AI notes data model or polling mechanism
- No new plugin settings or UI

## Decisions

### 1. Check frontmatter boolean before tag arrays in `isExcluded()`

Add `if (cache.frontmatter?.[excludeTag] === true) return true;` as the first check after obtaining the metadata cache.

**Why before, not after:** The boolean check is cheaper than building tag arrays, and it's the primary mechanism used by AI notes. Short-circuiting early is both correct and marginally more efficient.

**Why `=== true` (strict):** Obsidian stores frontmatter values with their YAML types. `terrestrialBrainExclude: true` is a boolean `true`. Using strict equality avoids matching `terrestrialBrainExclude: "true"` (string) or `terrestrialBrainExclude: 1` (number), which would be unexpected.

**Alternative considered:** Checking for truthy (`if (cache.frontmatter?.[excludeTag])`) — rejected because it would match unexpected values like `terrestrialBrainExclude: "yes"` or `terrestrialBrainExclude: 1`.

### 2. Compute and store hash after each file write in `pollAINotes()`

After `this.app.vault.adapter.write(path, note.content)`, compute `simpleHash(stripFrontmatter(note.content))` and store it in `this.syncedHashes[path]`.

**Why `stripFrontmatter` before hashing:** `processNote()` hashes `stripFrontmatter(content).trim()`. To match, `pollAINotes()` must hash the same transformation. Otherwise the hashes won't match and the modify-event handler will still re-ingest.

**Why store per-file (not batch):** Each file write triggers a modify event immediately. The hash must be in `syncedHashes` before `processNote()` runs for that file. Since `processNote` is debounced (5 min default), writing all files first and then storing hashes would work in practice, but storing immediately after each write is more correct and resilient to lower debounce settings.

### 3. Single `saveSettings()` call after the poll loop

Call `this.saveSettings()` once after all files are written and hashes stored, not after each file. This persists all new hashes to disk in one write.

**Why not per-file:** `saveSettings()` serializes the entire data object. Calling it N times for N files is wasteful. The hashes are already in memory (which is what `processNote` checks), so a single persistence call at the end is sufficient.

### Test Strategy

- **Unit tests:** Test `isExcluded()` with mocked Obsidian metadata cache objects to verify the boolean frontmatter check. Test hash storage logic in `pollAINotes()`.
- **No integration/E2E tests needed:** Both bugs are in the Obsidian plugin runtime, which depends on the Obsidian API. Tests will use mocks of Obsidian's `MetadataCache` and `Vault` APIs since these are external boundaries, not our own code.

## Risks / Trade-offs

- **[Risk] AI note content has no frontmatter** → If the MCP-generated AI note content doesn't include frontmatter, `stripFrontmatter()` is a no-op and the hash is computed on the full content. This is fine — `processNote()` will also call `stripFrontmatter()` on the same content and get the same result. → No mitigation needed.
- **[Risk] Race condition: modify event fires before hash is stored** → The debounce timer is 5 minutes by default, so the hash will be stored long before `processNote()` runs. Even with the minimum 1-minute debounce, the hash storage is synchronous after the file write. → Effectively impossible in practice.

## User Error Scenarios

Not applicable — both bugs are internal logic errors with no user-facing input surface.

## Security Analysis

No security implications — these are correctness fixes to local file I/O and in-memory hash comparison. No new attack surface introduced.
