## 1. Fix isExcluded()

- [x] 1.1 Add frontmatter boolean check (`cache.frontmatter?.[excludeTag] === true`) as the first check in `isExcluded()`, before the tag-array logic (`obsidian-plugin/src/main.ts`)

## 2. Fix pollAINotes() hash storage

- [x] 2.1 After each `vault.adapter.write()` call in `pollAINotes()`, compute `simpleHash(stripFrontmatter(note.content).trim())` and store in `this.syncedHashes[path]`
- [x] 2.2 Add `await this.saveSettings()` after the poll loop (after `mark_notes_synced`) to persist all new hashes to disk

## 3. Testing & Verification

- [x] 3.1 Write unit test: `isExcluded()` returns `true` for a file with `terrestrialBrainExclude: true` as a standalone frontmatter boolean
- [x] 3.2 Write unit test: `isExcluded()` returns `false` for a file with `terrestrialBrainExclude: false`
- [x] 3.3 Write unit test: `isExcluded()` still returns `true` for tag-array exclusion (existing behavior)
- [x] 3.4 Write unit test: `pollAINotes()` stores content hash in `syncedHashes` after writing file
- [x] 3.5 Write unit test: `pollAINotes()` hash matches what `processNote()` would compute, so re-ingestion is skipped
- [x] 3.6 Write unit test: `pollAINotes()` calls `saveSettings()` once after the loop
- [x] 3.7 Verify plugin builds without errors (`npm run build` in obsidian-plugin/)
