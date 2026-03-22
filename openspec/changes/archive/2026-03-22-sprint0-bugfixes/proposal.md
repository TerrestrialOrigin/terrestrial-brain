## Why

The Obsidian plugin has two bugs that cause incorrect behavior during sync:

1. **`isExcluded()` ignores frontmatter booleans.** The exclude check only looks at the `tags` array and inline tags, but `terrestrialBrainExclude: true` is stored as a standalone frontmatter boolean — not in the `tags` array. This means notes with that frontmatter field are never excluded, including AI-generated notes that set it.

2. **`pollAINotes()` doesn't store hashes.** After writing AI note files to the vault, the content hash is not stored in `syncedHashes`. The file write triggers a modify event, which fires the debounce timer, which calls `processNote()`, which re-ingests the file unnecessarily since there's no hash to short-circuit against.

Both bugs must be fixed before building the enhanced ingest pipeline (Phase 2), as that pipeline depends on correct exclusion logic and hash-based dedup.

## What Changes

- Fix `isExcluded()` to check `cache.frontmatter?.[excludeTag] === true` as a standalone boolean, before checking the tags arrays
- Fix `pollAINotes()` to compute `simpleHash(stripFrontmatter(content))` for each written file and store it in `syncedHashes[path]`
- Persist `syncedHashes` after the poll loop completes (single `saveSettings()` call)

## Non-goals

- No changes to the MCP server, database, or edge functions
- No changes to the AI notes data model or polling mechanism (that's Sprint 6)
- No new settings or UI changes

## Capabilities

### New Capabilities

_None — these are bug fixes to existing capabilities._

### Modified Capabilities

- `obsidian-plugin` (`openspec/specs/obsidian-plugin.md`): The "Exclusion check" scenario needs to also check standalone frontmatter booleans. The "AI notes polling" scenario needs to store content hashes after writing files to prevent re-ingestion.

## Impact

- **Code:** `obsidian-plugin/src/main.ts` — two functions modified: `isExcluded()` and `pollAINotes()`
- **Behavior:** AI notes and notes with `terrestrialBrainExclude: true` frontmatter boolean will now be correctly excluded. AI notes written to the vault will no longer trigger unnecessary re-ingest on the next modify event.
- **Risk:** Low — both are small, isolated changes with clear before/after behavior.
