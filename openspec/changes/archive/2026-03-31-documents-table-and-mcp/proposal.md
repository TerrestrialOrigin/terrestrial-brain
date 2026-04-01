## Why

The knowledge base currently has two storage paradigms: atomized **thoughts** (short, searchable, embedding-indexed) and ephemeral **ai_output** (markdown delivered to the Obsidian vault and then re-ingested). There is no way for an AI to store a full long-form document — a research brief, a spec, product notes — as a first-class, retrievable entity linked to a project. When a smart AI must persist reference material today, it either pushes it through `ingest_note` (which paraphrases via a cheap AI, losing fidelity) or creates an `ai_output` (which is a delivery mechanism, not a storage one). This gap means full-text source documents cannot be recalled verbatim later by project.

## What Changes

- **New `documents` table** in Supabase — stores full markdown documents verbatim, each linked to a project, with optional person and task references.
- **New `write_document` MCP tool** — lets an AI store a document, with automatic reference extraction (people, tasks) when not provided explicitly.
- **New `get_document` MCP tool** — retrieves a full document by ID including content body.
- **New `list_documents` MCP tool** — lists documents (metadata only, no content) with optional project filter.
- **Database migration** with RLS policies following existing patterns.

## Non-goals

- **Semantic search on documents.** Vector search stays on thoughts. Documents are retrieved by project or by ID — the calling AI is expected to atomize documents into thoughts via `capture_thought` after storing them.
- **Document versioning.** No edit history or snapshots for documents. They are immutable reference material; if a new version is needed, store a new document.
- **Obsidian sync.** Documents are not delivered to the vault. They live in the brain DB for AI retrieval only.

## Capabilities

### New Capabilities
- `documents`: Full lifecycle for long-form document storage — create, retrieve, and list documents linked to projects with automatic reference extraction.

### Modified Capabilities
_(none — this is purely additive)_

## Impact

- **Database**: New `documents` table, new migration file, RLS policies
- **Edge function**: New `tools/documents.ts` module registered in `index.ts`
- **AI helpers**: Uses existing `extractMetadata`-style LLM call for reference extraction when references aren't provided explicitly
- **No breaking changes** to existing tools or tables
