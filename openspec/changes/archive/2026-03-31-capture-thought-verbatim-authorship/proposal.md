## Why

When a smart AI (e.g. Claude Opus) calls `capture_thought`, the resulting thought row has no provenance — there's no record of which AI wrote it or that it was directly authored (as opposed to extracted by the cheap gpt-4o-mini pipeline). The `reliability` and `author` columns were added to the thoughts table in the previous change, but `capture_thought` doesn't populate them yet. Additionally, there's no way to explicitly associate a thought with projects by UUID — callers must rely on the extraction pipeline guessing correctly from content.

## What Changes

- Add `author` (optional string) and `project_ids` (optional UUID array) parameters to `capture_thought`
- Hardcode `reliability = 'reliable'` on all `capture_thought` inserts (not caller-configurable)
- Merge explicitly passed `project_ids` into the `metadata.references.projects` array alongside whatever the extractor pipeline finds
- Update the MCP tool description to position `capture_thought` as the designated function for AI callers to write thoughts directly, discouraging use of `ingest_note` (which paraphrases via a secondary AI)

## Non-goals

- Making `reliability` caller-configurable — it's always `'reliable'` for direct captures
- Changing the content handling — content remains byte-for-byte verbatim, the cheap AI only touches metadata
- Creating a new `record_thought_verbatim` function — `capture_thought` already does this

## Capabilities

### New Capabilities

_(none — this enhances an existing capability)_

### Modified Capabilities

- `thoughts` (`openspec/specs/thoughts.md`): `capture_thought` gains `author` and `project_ids` parameters, always sets `reliability = 'reliable'`, and merges explicit project UUIDs into references

## Impact

- **MCP server**: `tools/thoughts.ts` — `capture_thought` registration and handler
- **Database**: No migration needed — `reliability` and `author` columns already exist from `20260331000001_thoughts_reliability_author.sql`
- **Integration tests**: `tests/integration/thoughts.test.ts` — new test cases for author, reliability, and project_ids
- **Specs**: `openspec/specs/thoughts.md` — updated capture_thought scenarios
