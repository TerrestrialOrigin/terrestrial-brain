# input-validation — Delta (http-route-validation)

## ADDED Requirements

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
