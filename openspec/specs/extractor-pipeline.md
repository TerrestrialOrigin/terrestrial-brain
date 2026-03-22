# Extractor Pipeline

Framework for sequential entity extraction from parsed notes. Extractors enrich a shared context and return structured references.

## Data Model

- **Interface:** `Extractor` — `referenceKey` (string) + `extract(note: ParsedNote, context: ExtractionContext): Promise<ExtractionResult>`
- **Interface:** `ExtractionResult` — `referenceKey` (string) + `ids` (string array of entity PKs)
- **Interface:** `ExtractionContext` — Supabase client, `knownProjects` array (`{ id, name }`), `knownTasks` array (`{ id, content, reference_id }`), `newlyCreatedProjects` array (`{ id, name }`), `newlyCreatedTasks` array (`{ id, content }`)
- **Function:** `runExtractionPipeline(note, extractors, baseContext)` — returns `Record<string, string[]>`

---

## Scenarios

### Extractor returns structured result

GIVEN an extractor processes a parsed note
WHEN extraction completes
THEN it SHALL return an `ExtractionResult` with its `referenceKey` and an array of matched/created entity IDs

---

### Extractor returns empty result

GIVEN an extractor finds no matching entities in a parsed note
WHEN extraction completes
THEN it SHALL return an `ExtractionResult` with an empty `ids` array (not null, not undefined)

---

### Context enrichment visible to downstream extractors

GIVEN ExtractorA adds a project to `context.newlyCreatedProjects`
WHEN ExtractorB runs after ExtractorA in the pipeline
THEN ExtractorB SHALL see the project added by ExtractorA in `context.newlyCreatedProjects`

---

### Single extractor pipeline

GIVEN the pipeline runs with one extractor that returns `{ referenceKey: "projects", ids: ["uuid1"] }`
WHEN the pipeline completes
THEN the pipeline SHALL return `{ "projects": ["uuid1"] }`

---

### Multiple extractor pipeline

GIVEN the pipeline runs with two extractors returning `{ referenceKey: "projects", ids: ["p1"] }` and `{ referenceKey: "tasks", ids: ["t1", "t2"] }`
WHEN the pipeline completes
THEN the pipeline SHALL return `{ "projects": ["p1"], "tasks": ["t1", "t2"] }`

---

### Extractors run in order

GIVEN the pipeline receives extractors `[A, B, C]`
WHEN the pipeline runs
THEN it SHALL call `A.extract()` first, then `B.extract()`, then `C.extract()` — never in parallel

---

### Pipeline with extractor returning no results

GIVEN the pipeline runs with an extractor that returns `{ referenceKey: "projects", ids: [] }`
WHEN the pipeline completes
THEN the pipeline SHALL include `"projects": []` in the returned record

---

### Context populated with existing projects

GIVEN the pipeline runs and the database contains active projects
WHEN context initialization completes
THEN `ExtractionContext.knownProjects` SHALL contain all active projects with their `id` and `name`

---

### Context with no existing projects

GIVEN the pipeline runs and the database has no active projects
WHEN context initialization completes
THEN `ExtractionContext.knownProjects` SHALL be an empty array

---

### Context populated with existing tasks for this note

GIVEN the pipeline runs for a note with a `referenceId`
AND the `tasks` table contains tasks with matching `reference_id`
WHEN context initialization completes
THEN `ExtractionContext.knownTasks` SHALL contain those tasks with their `id`, `content`, and `reference_id`

---

### Context with no existing tasks for this note

GIVEN the pipeline runs for a note that has never been ingested before
WHEN context initialization completes
THEN `ExtractionContext.knownTasks` SHALL be an empty array

---

### Note with no referenceId has empty knownTasks

GIVEN the pipeline runs for a note with `referenceId: null`
WHEN context initialization completes
THEN `ExtractionContext.knownTasks` SHALL be an empty array
