## Why

The current schema lacks the tables needed by the upcoming extractor pipeline (Sprint 3-5) and the AI Output system (Sprint 6). Thoughts have no link back to the full source note, and `ai_notes` uses a cumbersome sync model with `terrestrialBrainExclude` frontmatter. These schema changes must land first because every subsequent sprint builds on them.

## What Changes

- **New `note_snapshots` table** — stores the latest full text of each ingested note, keyed by `reference_id`. Enables future extractors to reference source content and lets the AI retrieve the original note a thought came from.
- **New `ai_output` table** — replaces `ai_notes` with a cleaner delivery model: explicit `file_path`, boolean `picked_up` flag, and no `terrestrialBrainExclude` frontmatter (delivered files participate in normal ingest). **BREAKING**: `ai_notes` table will be dropped after migration in Sprint 6.
- **New `thoughts.note_snapshot_id` column** — nullable FK linking each thought to its source `note_snapshots` row (`ON DELETE SET NULL`).
- **New `thoughts.metadata.references` format** — changes from `{ project_id: "uuid" }` to `{ projects: ["uuid1"], tasks: ["uuid1"] }`. Array-based, future-proof for additional entity types. Backwards-compatible reads required.

## Non-goals

- Migrating data from `ai_notes` to `ai_output` (Sprint 6).
- Dropping the `ai_notes` table (Sprint 6).
- Building the extractor pipeline or modifying `ingest_note`/`capture_thought` logic (Sprint 3-5).
- Changing the Obsidian plugin polling behavior (Sprint 6).

## Capabilities

### New Capabilities
- `note-snapshots`: Full-text note storage with upsert-on-reference-id semantics, enabling source-note retrieval and extractor pipeline access.
- `ai-output`: Replacement for ai-notes with explicit file paths, picked-up tracking, and no exclude-tag workaround.

### Modified Capabilities
- `thoughts`: Add `note_snapshot_id` FK column and change `metadata.references` from single-value to array-based format. Affects `openspec/specs/thoughts.md`.

## Impact

- **Database (PostgreSQL/Supabase):** Two new tables, one ALTER TABLE, three new indexes.
- **MCP server:** No code changes in this sprint — schema only. Future sprints will add tools for `ai_output` and update `ingest_note`/`capture_thought` to populate `note_snapshot_id` and the new references format.
- **Obsidian plugin:** No changes in this sprint.
- **Specs affected:** `openspec/specs/thoughts.md` (data model section), `openspec/specs/ai-notes.md` (will be superseded by new `ai-output` spec).
