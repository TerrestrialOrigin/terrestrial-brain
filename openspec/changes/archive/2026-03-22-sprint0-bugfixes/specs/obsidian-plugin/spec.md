## MODIFIED Requirements

### Requirement: Exclusion check

GIVEN a file is being considered for sync
WHEN `isExcluded(file)` is called
THEN the plugin SHALL check, in order:
  1. Standalone frontmatter boolean: if `cache.frontmatter?.[excludeTag] === true`, return true
  2. Inline tags from Obsidian's metadata cache (e.g. `#terrestrialBrainExclude`)
  3. Frontmatter `tags` array (supports both array and single-value format)
  4. Comparison is case-insensitive, leading `#` is stripped
  5. Returns true if the excludeTag is found in any of the above checks

#### Scenario: Frontmatter boolean exclusion
- **WHEN** a file has `terrestrialBrainExclude: true` as a standalone frontmatter boolean (not in the `tags` array)
- **THEN** `isExcluded()` SHALL return `true`

#### Scenario: Frontmatter boolean with non-true value
- **WHEN** a file has `terrestrialBrainExclude: false` as a standalone frontmatter boolean
- **THEN** `isExcluded()` SHALL return `false` (unless the tag appears in inline or frontmatter tags)

#### Scenario: Tag-based exclusion still works
- **WHEN** a file has `terrestrialBrainExclude` in the frontmatter `tags` array or as an inline tag
- **THEN** `isExcluded()` SHALL return `true` (existing behavior preserved)

#### Scenario: No exclusion markers present
- **WHEN** a file has neither the frontmatter boolean nor the tag
- **THEN** `isExcluded()` SHALL return `false`

### Requirement: AI notes polling stores content hashes

GIVEN the plugin polls for AI notes and receives unsynced notes
WHEN the plugin writes each AI note file to the vault
THEN the plugin SHALL:
  1. Write the file content to the vault
  2. Compute the content hash using `simpleHash(stripFrontmatter(content))` — the same transformation used by `processNote()`
  3. Store the hash in `syncedHashes[filePath]`
  4. After all files are written and hashes stored, persist `syncedHashes` to disk via `saveSettings()`

#### Scenario: AI note write does not trigger re-ingestion
- **WHEN** an AI note is written to the vault by `pollAINotes()`
- **AND** the subsequent modify event fires and `processNote()` runs for that file
- **THEN** `processNote()` SHALL find a matching hash in `syncedHashes` and skip re-ingestion

#### Scenario: AI note hash uses same transformation as processNote
- **WHEN** `pollAINotes()` computes the hash for a written file
- **THEN** it SHALL use `simpleHash(stripFrontmatter(content).trim())` — identical to the hash computation in `processNote()`

#### Scenario: Hashes persisted after poll completes
- **WHEN** `pollAINotes()` finishes writing all files
- **THEN** it SHALL call `saveSettings()` once to persist all new hashes to disk
