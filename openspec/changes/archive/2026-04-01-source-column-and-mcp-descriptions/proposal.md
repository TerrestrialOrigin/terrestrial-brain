## Why

The `note_snapshots.source` column defaults to `'obsidian'`, which masks missing data — snapshots created by MCP `capture_thought` or other non-Obsidian callers silently get tagged as Obsidian-originated. Callers should always pass source explicitly so provenance is accurate.

Separately, the `create_ai_output` and `create_tasks_with_output` MCP tool descriptions don't warn AI callers that every document delivered to the vault gets ingested into the knowledge base via `ingest_note`. This leads to proactive or incidental calls that pollute the thoughts table with unwanted data.

## What Changes

- **BREAKING**: Remove the default value from `note_snapshots.source` — callers must now provide it explicitly or the insert will fail.
- Update the Obsidian plugin's `ingest_note` call path to ensure `source: 'obsidian'` is passed explicitly (the MCP handler already hardcodes this, so confirm it still works without the DB default).
- Update the `create_ai_output` MCP tool description to state it should only be called when the user explicitly requests output, and that all delivered content is ingested into the knowledge base.
- Update the `create_tasks_with_output` MCP tool description with the same "only call when explicitly asked" language.

## Non-goals

- Changing the `capture_thought` source handling — it already sets `source: 'mcp'` explicitly.
- Adding a new `source` enum or validation — the column remains free-text.
- Changing the behavior of `create_ai_output` or `create_tasks_with_output` beyond their descriptions.

## Capabilities

### New Capabilities

_None — this change modifies existing capabilities only._

### Modified Capabilities

- `note-snapshots`: Remove default value from `source` column; callers must provide it explicitly. Spec path: `openspec/specs/note-snapshots.md`
- `ai-output`: Update MCP tool descriptions for `create_ai_output` and `create_tasks_with_output` to discourage proactive use and document ingest side effects. Spec path: `openspec/specs/ai-output/spec.md`

## Impact

- **Database**: Migration to `ALTER COLUMN source DROP DEFAULT` on `note_snapshots`. Any caller that doesn't pass `source` will get a NOT NULL violation after this migration.
- **MCP edge function** (`tools/thoughts.ts`): Already passes `source: "obsidian"` explicitly in the `handleIngestNote` upsert — no code change needed there, but verify.
- **MCP edge function** (`tools/ai_output.ts`): Description-only changes to `create_ai_output` and `create_tasks_with_output` tool registrations.
- **Obsidian plugin** (`obsidian-plugin/src/main.ts`): Currently does not pass `source` in its HTTP call to `/ingest-note`. The MCP handler hardcodes it, so the plugin itself doesn't need to change — but we should confirm the chain is solid.
