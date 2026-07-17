## ADDED Requirements

### Requirement: get_recent_activity bounds every section and its window

Every per-table query behind `get_recent_activity` (recent thoughts, tasks created/completed, projects created/updated, people created/updated, delivered AI outputs) SHALL be bounded by an explicit section limit (probing `section limit + 1`), and the `days` window SHALL have a schema maximum. When a section has more rows than its limit, the rendered section heading SHALL carry an explicit truncation marker (e.g. `## Tasks Created (50+)`); truncation SHALL never be silent.

#### Scenario: An over-full section is marked truncated
- **WHEN** a section has more rows than its section limit within the window
- **THEN** the section renders exactly the limit and its heading shows the `(<limit>+)` truncation marker

#### Scenario: days is schema-bounded
- **WHEN** `get_recent_activity` is called with a `days` value above the schema maximum
- **THEN** the value is rejected or bounded so the section caps cannot be defeated by widening the window
