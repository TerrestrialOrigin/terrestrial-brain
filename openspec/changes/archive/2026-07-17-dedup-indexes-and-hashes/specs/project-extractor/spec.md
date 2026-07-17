## ADDED Requirements

### Requirement: Project auto-create is idempotent under concurrency

Auto-creating a project from an unmatched name SHALL be safe against interleaving. A database-level partial unique index on `lower(name)` restricted to active (`archived_at IS NULL`) rows SHALL prevent two concurrent ingests from creating two rows for the same new project name. When an auto-create insert fails with a unique violation (`23505`), the extractor SHALL recover by re-querying the active project by name and returning its id (create-or-get), rather than recording a failure. If the recovery lookup itself errors, the extractor SHALL return null and record the error (not silently drop the reference).

#### Scenario: Concurrent ingests of the same new project create one row

- **WHEN** two ingests referencing the same not-yet-existing project name run concurrently
- **THEN** exactly one active project row exists for that name and both runs resolve to the same project id

#### Scenario: A unique violation recovers the existing id

- **WHEN** an auto-create insert returns `23505`
- **THEN** the extractor returns the existing active project's id and records no error
