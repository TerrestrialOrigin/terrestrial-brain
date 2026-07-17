## MODIFIED Requirements

### Requirement: Every content edit stores a content hash in the one update path

The system SHALL store a `content_hash` on `thoughts`, `projects`, `tasks`, and
`documents`, computed wherever content is written, in the single server-side
update path. This SHALL include the task extractor's re-ingest path: whenever
`TaskExtractor` writes a task's `content` (updating a matched task or creating a
new one), it SHALL re-compute and store `content_hash` from that content, so the
dedup gate never compares against a stale hash. A thought content edit SHALL also
re-embed. Emptying content SHALL be a valid, re-hashed edit, never swallowed.

#### Scenario: A content edit updates the stored hash

- **WHEN** an entity's content is edited
- **THEN** its stored `content_hash` equals the hash of the new content

#### Scenario: The hash column exists on all four entities

- **WHEN** the schema is inspected
- **THEN** `content_hash` exists on `thoughts`, `projects`, `tasks`, and `documents`

#### Scenario: Re-ingest re-stamps a matched task's content hash

- **WHEN** a note is re-ingested with edited checkbox text and the extractor updates the matched task's content
- **THEN** the task's stored `content_hash` equals the SHA-256 of the new content (not the prior text's hash)
