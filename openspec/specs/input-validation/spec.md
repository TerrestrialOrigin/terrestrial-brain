# input-validation Specification

## Purpose
TBD - created by archiving change db-types-and-validation. Update Purpose after archive.
## Requirements
### Requirement: Enum-valued tool parameters are validated against an allowlist

Every MCP tool parameter that represents a closed set of values — `status`, `type`, and `reliability` — SHALL be declared as a Zod enum whose members match the database's allowed values, so an out-of-domain value is rejected at the tool boundary before any database access. The allowlists are: task `status` = {open, in_progress, done, deferred}; thought `type` = {observation, task, idea, reference, person_note}; project `type` = {client, personal, research, internal}; person `type` = {human, ai}; `reliability` = {reliable, less reliable}.

#### Scenario: Invalid enum value is rejected

- **WHEN** a caller invokes an update or list/create tool with a `status`/`type`/`reliability` value not in that parameter's allowlist
- **THEN** the tool returns a validation error naming the parameter and its allowed values, and no row is created or modified

#### Scenario: Valid enum value is accepted

- **WHEN** a caller passes an allowlisted enum value
- **THEN** the tool proceeds normally and the value is persisted

### Requirement: Identifier parameters are validated as UUIDs

Every MCP tool parameter that is an entity identifier — `id`, any `*_id`, and each element of id arrays (`ids`, `project_ids`, `document_ids`, `builds_on`, etc.) — SHALL be validated as a UUID at the tool boundary, so a malformed identifier is rejected with a clear error rather than silently returning an empty result.

#### Scenario: Malformed id is rejected

- **WHEN** a caller passes a non-UUID string for an id parameter
- **THEN** the tool returns a validation error identifying the parameter, and performs no database query for that id

#### Scenario: Well-formed id is accepted

- **WHEN** a caller passes a syntactically valid UUID
- **THEN** the tool proceeds to look it up

### Requirement: List limits are bounded

Every MCP tool `limit` (and equivalent count/window parameter such as `days`) SHALL declare an explicit maximum so a single call cannot request an unbounded number of rows. Batch-id inputs SHALL declare their maximum in the schema rather than only checking it imperatively.

#### Scenario: Over-limit request is rejected

- **WHEN** a caller passes a `limit` above the declared maximum
- **THEN** the tool returns a validation error stating the allowed range and fetches no rows

#### Scenario: Batch size is bounded in the schema

- **WHEN** a caller passes a batch-id array larger than the tool's declared maximum
- **THEN** the request is rejected by schema validation with a clear message

### Requirement: Search input is escaped before pattern matching

User-supplied search text that feeds a SQL `ilike`/`like` pattern SHALL have its pattern metacharacters (`\`, `%`, `_`) escaped so the text matches literally, preventing a bare `%` from returning the entire table.

#### Scenario: Literal percent search

- **WHEN** a caller searches documents for a value containing `%`
- **THEN** only documents whose field literally contains `%` match, not every document

#### Scenario: Ordinary search unaffected

- **WHEN** a caller searches for text with no metacharacters
- **THEN** results are the same substring matches as before this change

### Requirement: Get-by-id tools use one not-found convention

All get-by-id read tools (`get_thought_by_id`, `get_document`, `get_project`, `get_person`) SHALL return a non-error result with a plain "no such entity" message when the requested id does not exist, so a missing row is reported as data rather than a tool failure.

#### Scenario: Missing entity on read

- **WHEN** a caller requests a get-by-id tool with a valid-but-nonexistent UUID
- **THEN** the tool returns a non-error result stating no such entity was found

### Requirement: Updates verify the affected row and unify no-op handling

All update tools (`update_thought`, `update_task`, `update_project`, `update_person`, `update_document`) SHALL verify that the target row exists and report not-found as an error when it does not (instead of reporting success), and SHALL treat an update call with no updatable field as an error that indicates which fields may be provided.

#### Scenario: Update a nonexistent entity

- **WHEN** a caller updates a valid-but-nonexistent UUID
- **THEN** the tool returns an error stating no such entity was found and modifies nothing

#### Scenario: Update with no fields

- **WHEN** a caller invokes an update tool without any updatable field
- **THEN** the tool returns an error indicating at least one updatable field must be provided, and modifies nothing

### Requirement: Aggregate statistics are computed in the database

The `thought_stats` tool SHALL obtain its aggregate counts from a database function rather than loading every thought row into the edge function to count client-side. The database function SHALL be executable only by the service role.

#### Scenario: Stats without loading all rows

- **WHEN** a caller invokes `thought_stats`
- **THEN** the returned totals match a direct database aggregate over the same rows, computed via the database function

#### Scenario: Stats function is not anon-executable

- **WHEN** the stats database function's privileges are inspected
- **THEN** EXECUTE is granted to the service role and revoked from anon and authenticated roles

### Requirement: The database client is strongly typed

The Supabase client used by the MCP server SHALL be constructed with generated database types (`SupabaseClient<Database>`) so row shapes are inferred rather than hand-retyped, and the type generation SHALL be part of the developer workflow so the types stay in sync with migrations.

#### Scenario: Typed rows without hand-written shapes

- **WHEN** the code accesses a column of a queried row
- **THEN** the column type comes from the generated `Database` types, and no hand-written interface duplicates that row shape

#### Scenario: Type generation is runnable from the dev workflow

- **WHEN** a developer runs the type-generation step wired into the dev workflow against the local stack
- **THEN** the generated types file is refreshed from the current schema

### Requirement: Date, email, and index fields are format-validated at the boundary

Tool input schemas SHALL validate formats at the boundary, not deep in the stack: `due_by` SHALL be an ISO 8601 datetime with offset (`z.string().datetime({ offset: true })`) wherever a due date enters (create_task, update_task's nullable variant, create_tasks_with_output items); `email` SHALL be a valid email address (nullable where clearing is allowed); `parent_index` SHALL be a non-negative integer at the schema level (cross-field ordering checks remain in `validateParentIndices`). The `TaskInput` type SHALL be derived from the Zod schema (`z.infer`) so no cast bridges the schema and the type.

#### Scenario: Hallucinated due date is rejected at the boundary

- **WHEN** a caller passes `due_by: "next Tuesday"` to create_task or update_task
- **THEN** the tool returns a validation error naming the expected ISO 8601 format
- **AND** no database call is made

#### Scenario: Valid ISO datetime with offset is accepted

- **WHEN** a caller passes `due_by: "2026-08-01T12:00:00+02:00"`
- **THEN** the tool proceeds normally

#### Scenario: Junk email is rejected

- **WHEN** a caller passes `email: "not-an-email"` to create_person or update_person
- **THEN** the tool returns a validation error
- **AND** `email: null` on update_person still clears the field

#### Scenario: Fractional parent_index is rejected by the schema

- **WHEN** a caller passes `parent_index: 1.5` in create_tasks_with_output
- **THEN** the schema rejects it before `validateParentIndices` runs

### Requirement: Direct HTTP route bodies are validated by per-route schemas

Direct HTTP route bodies SHALL be validated by Zod schemas run in the shared dispatcher (one validation at the door); route handlers SHALL receive typed, validated bodies with no `as` casts on raw request JSON.

#### Scenario: Wrong-typed optional field is rejected

- **WHEN** a client POSTs `{ "content": "note", "title": 42 }` to `/ingest-note`
- **THEN** the response is HTTP 400 and the handler is not invoked

### Requirement: Stored metadata references are structurally validated before use

Code reading project references out of stored thought metadata (`getProjectRefs`) SHALL validate the structure at runtime — verifying `references` is a non-null object and filtering `projects` to string elements — instead of casting. Legacy or malformed shapes (a scalar `references`, non-string array elements) SHALL yield only the valid entries, never hand garbage downstream typed as `string[]`.

#### Scenario: Legacy scalar references yields no refs

- **WHEN** a thought's metadata carries `references: "old-string-value"`
- **THEN** `getProjectRefs` returns an empty list without throwing

#### Scenario: Mixed-type projects array is filtered

- **WHEN** a thought's metadata carries `references.projects: [42, "b8f5…-uuid"]`
- **THEN** `getProjectRefs` returns only the string entry
