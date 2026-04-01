## Context

The Terrestrial Brain knowledge base stores atomized thoughts (1-3 sentence units with embeddings for semantic search) and delivers AI-generated content to Obsidian via `ai_output`. Neither mechanism supports storing full, verbatim long-form documents as project-scoped reference material that an AI can retrieve later.

When a smart AI produces research notes, product briefs, or specs, it currently must either:
1. Push through `ingest_note` — which paraphrases via GPT-4o-mini, losing fidelity
2. Create `ai_output` — which is a delivery mechanism to Obsidian, not a queryable store

This change adds a `documents` table and three MCP tools (`write_document`, `get_document`, `list_documents`) so AIs can store and retrieve full documents by project.

## Goals / Non-Goals

**Goals:**
- Store full markdown documents verbatim, linked to a project
- Automatically extract person and task references from content when not provided
- Provide retrieval by ID (full content) and listing by project (metadata only)
- Follow existing patterns for RLS, error handling, and tool registration

**Non-Goals:**
- Semantic/vector search on documents (search stays on thoughts)
- Document versioning or edit history
- Obsidian vault delivery (documents live in brain DB only)
- Embedding generation for documents

## Decisions

### 1. Schema: `documents` table with foreign key to `projects`

The `documents` table uses `project_id` as a required NOT NULL foreign key to `projects`. Every document must belong to a project. This matches the task description and the conceptual model: documents are project-scoped reference material.

**Alternative considered:** Optional `project_id` (nullable). Rejected because orphaned documents with no project context are hard to discover and don't fit the "project reference material" use case.

### 2. References stored as JSONB column

References (`people` UUIDs, `task` UUIDs) are stored in a `references jsonb` column, matching the pattern used in `thoughts.metadata.references`. This keeps the schema consistent and avoids junction tables for a feature where reference queries are infrequent.

**Alternative considered:** Junction tables (`document_people`, `document_tasks`). Rejected as over-normalized for this use case — documents are retrieved by project or ID, not by "find all documents mentioning person X."

### 3. Reference extraction reuses the existing extraction pipeline

When `references` is not provided by the caller, `write_document` runs the same extraction pipeline that `capture_thought` and `ingest_note` already use: `runExtractionPipeline(parsedNote, [ProjectExtractor, PeopleExtractor, TaskExtractor], supabase)`. This means:
- People extraction uses the LLM-based `PeopleExtractor` (name detection, matching against known people, auto-creation of unknown names)
- Project detection uses the 3-signal `ProjectExtractor` (path convention, LLM path analysis, content matching)
- Task detection uses `TaskExtractor` (checkbox parsing, reconciliation)

No new extraction code is written. Enhancements to the extraction pipeline automatically benefit `write_document`.

The document content is passed through `parseNote()` to produce a `ParsedNote`, then fed to the pipeline. Since documents don't have a vault path or reference_id, the parser receives `null` for those fields (same as `capture_thought` does with `"mcp"` source).

**Alternative considered:** Writing a new, simpler extraction prompt specific to documents. Rejected because it duplicates logic that already exists, and improvements to the pipeline wouldn't carry over.

**Alternative considered:** Skip auto-extraction entirely. Rejected because the task description explicitly requests automatic extraction, and it provides useful cross-linking for free.

### 4. `thoughts_required: true` hint and document ID in `write_document` response

The response includes the document's UUID and an informational `thoughts_required: true` hint. The MCP description tells the calling AI to pass the document ID to `capture_thought` via a `document_ids` parameter when atomizing — this creates a bidirectional link (document → people/tasks via `references`, thoughts → document via `metadata.references.documents`).

**Alternative considered:** Automatically generate thoughts from the document. Rejected because the task description explicitly states "Does not generate thoughts" — the calling AI handles atomization with full context of what's important.

### 4a. `capture_thought` gains `document_ids` parameter

`capture_thought` already accepts `project_ids` which gets merged into `metadata.references.projects`. We add `document_ids` with the same pattern: an optional `string[]` that gets merged into `metadata.references.documents`. This lets thoughts link back to their source document for traceability.

**Alternative considered:** Storing `document_id` as a top-level column on the `thoughts` table. Rejected because the `metadata.references` JSONB pattern is already established for this kind of cross-linking (projects, tasks, people) and adding a column for one reference type breaks consistency.

### 5. No embedding column on `documents`

Documents are retrieved by project or ID, not by semantic similarity. Embedding generation would be wasteful for large documents and the retrieval pattern doesn't need it.

### 6. `list_documents` omits content body

For performance, the listing endpoint returns metadata only (id, title, project_id, file_path, references, created_at, updated_at). Callers use `get_document` to fetch full content for a specific document.

### Test Strategy

- **Integration tests**: CRUD operations against real Supabase (insert, select, list with project filter, reference extraction). No mocks on the DB path.
- **Unit tests**: Reference extraction prompt parsing (mock the OpenRouter call, but test the extraction logic).
- **E2E**: Not applicable — no browser UI; MCP tools are tested via integration tests against the edge function.

## User Error Scenarios

| Scenario | Handling |
|---|---|
| Missing or empty `title` | Zod validation rejects — MCP returns validation error |
| Missing or empty `content` | Zod validation rejects |
| Invalid `project_id` (not a UUID) | Zod string validation; Supabase FK constraint returns error |
| Non-existent `project_id` | Supabase FK violation → tool returns descriptive error |
| `file_path` with invalid characters | Optional field — no validation needed (it's provenance metadata, not a write target) |
| Extremely large content | No artificial limit — Supabase `text` column handles it; practical limit is the MCP transport payload size |
| Duplicate document (same title + project) | Allowed — documents are not deduplicated (different from thoughts which use `reference_id`) |

## Security Analysis

| Threat | Mitigation |
|---|---|
| Unauthorized document creation | Same auth as all MCP tools: `x-brain-key` header check in Hono middleware. RLS restricts to service_role. |
| SQL injection via title/content | Supabase client uses parameterized queries — no raw SQL. |
| LLM prompt injection via content (reference extraction) | The extraction prompt is focused on name/task extraction. Even if the content tricks the LLM, the worst case is incorrect references (wrong person linked) — no data loss or escalation. |
| Content exfiltration via references | References only link to existing people/tasks by UUID — no new data is exposed that wasn't already in the DB. |

## Risks / Trade-offs

- **[Risk] Large documents may slow down reference extraction** → Mitigation: The extraction pipeline sends content to GPT-4o-mini via the people and project extractors. For very large documents (>50K chars), this could be slow or hit token limits. Accept this for now; can add content truncation for the extraction prompt later if needed.
- **[Risk] Auto-created people records may be duplicates** → Mitigation: People have a UNIQUE constraint on `name`. The extraction should check for existing people first (matching existing pattern in `people-extractor.ts`). If the LLM returns a slightly different name variant, a duplicate could be created. This is the same risk the existing people extractor already accepts.
- **[Trade-off] No full-text search on documents** → Accepted. The design relies on the calling AI atomizing documents into thoughts for searchability. If this proves insufficient, a future change could add `tsvector` indexing on `documents.content`.

## Migration Plan

1. Add migration file `20260331000002_documents.sql` with table creation, indexes, trigger, and RLS policy
2. Deploy migration to Supabase (runs automatically on `supabase db push` or via dashboard)
3. Deploy updated edge function with new tools
4. No rollback complexity — purely additive (new table, new tools, no existing behavior changed)

## Open Questions

_(none — the task description is detailed and the patterns are well-established)_
