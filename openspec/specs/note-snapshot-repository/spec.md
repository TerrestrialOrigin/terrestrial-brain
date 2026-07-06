# note-snapshot-repository Specification

## Purpose
TBD - created by archiving change repository-layer-remaining. Update Purpose after archive.
## Requirements
### Requirement: NoteSnapshotRepository abstracts the ingest note_snapshots writes

The MCP edge function SHALL define a `NoteSnapshotRepository` interface as the
seam over the `note_snapshots` write path used by `handleIngestNote` — a
find-content-by-reference read (the unchanged-content skip) and an upsert
(keyed on `reference_id`). No code in `tools/thoughts.ts` SHALL construct a
`supabase.from("note_snapshots")` query directly; the sole implementation is
`SupabaseNoteSnapshotRepository`.

#### Scenario: No inline note_snapshots query remains in thoughts.ts

- **WHEN** `tools/thoughts.ts` is searched for `from("note_snapshots")`
- **THEN** no match SHALL be found — the ingest snapshot read and upsert go through the repository

#### Scenario: Upsert is keyed on reference_id

- **WHEN** `handleIngestNote` upserts a snapshot
- **THEN** the repository SHALL upsert on conflict of `reference_id` and return the new/updated row's `id`, preserving the existing dedup behavior

#### Scenario: Repository is injected

- **WHEN** the thoughts tool module is registered
- **THEN** `SupabaseNoteSnapshotRepository` SHALL be constructed at the `index.ts` composition root and passed to `registerThoughts(...)` / `handleIngestNote(...)`, never read from a module-level global

