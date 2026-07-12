## ADDED Requirements

### Requirement: List open tasks grouped by project

The system SHALL provide a read-only MCP tool `list_open_tasks_by_project` that returns every incomplete, unarchived task across the whole brain, grouped by project, in a single call. A task is "incomplete" when its status is not `done`. Archived tasks (`archived_at` set) SHALL always be excluded.

#### Scenario: Incomplete tasks are grouped under their projects
- **WHEN** the tool is invoked and multiple projects each have one or more incomplete, unarchived tasks
- **THEN** the response renders one group section per project, each containing that project's incomplete tasks, and every incomplete unarchived task appears in exactly one group

#### Scenario: Done and archived tasks are excluded
- **WHEN** the tool is invoked and some tasks have status `done` or have `archived_at` set
- **THEN** those tasks do NOT appear in any group in the response

### Requirement: Tasks with no project are grouped separately

Tasks whose `project_id` is null SHALL be collected into a single dedicated "(No project)" group that is rendered last, so unassigned tasks are never omitted.

#### Scenario: Unassigned tasks land in the no-project group
- **WHEN** the tool is invoked and one or more incomplete tasks have no `project_id`
- **THEN** those tasks appear together in a "(No project)" group rendered after all real project groups

#### Scenario: All tasks unassigned
- **WHEN** every incomplete task has no `project_id`
- **THEN** the response contains a single "(No project)" group and does not error

#### Scenario: Task references a missing project
- **WHEN** an incomplete task's `project_id` does not resolve to an existing project row
- **THEN** that task is grouped under a clearly-labelled "(Unknown project <id>)" group rather than being dropped, and the tool does not crash

### Requirement: Deterministic group and task ordering

Project groups SHALL be ordered alphabetically (case-insensitive) by resolved project name, with the "(No project)" group always last. Within each group, tasks SHALL be ordered overdue-first, then by due date ascending (undated tasks last), then by creation date ascending.

#### Scenario: Projects ordered by name, no-project last
- **WHEN** the tool renders groups for projects "Zephyr" and "Apollo" plus unassigned tasks
- **THEN** "Apollo" is rendered before "Zephyr", and the "(No project)" group is rendered after both

#### Scenario: Tasks within a group ordered by urgency
- **WHEN** a group contains an overdue task, a task due next week, and an undated task
- **THEN** they render in the order: overdue task, task due next week, undated task

### Requirement: Incomplete set is configurable for deferred tasks

The tool SHALL accept an optional `include_deferred` boolean, defaulting to `true`. When `true`, tasks with status `deferred` are included in the incomplete set; when `false`, `deferred` tasks are excluded. Status `done` is always excluded regardless of this flag.

#### Scenario: Deferred included by default
- **WHEN** the tool is invoked without `include_deferred` and a project has a `deferred` task
- **THEN** the `deferred` task appears in that project's group

#### Scenario: Deferred excluded on request
- **WHEN** the tool is invoked with `include_deferred: false`
- **THEN** no `deferred` task appears in any group, while `open` and `in_progress` tasks still appear

### Requirement: Bounded query with explicit truncation reporting

The tool SHALL cap the total number of tasks fetched via a `limit` parameter (Zod-validated integer, default 500, minimum 1, maximum 1000) and SHALL NOT perform an unbounded fetch-all. When more incomplete tasks exist than the cap, the response body SHALL state that results were truncated, and the truncation SHALL be logged.

#### Scenario: Truncation is surfaced and logged
- **WHEN** more incomplete unarchived tasks exist than the effective `limit`
- **THEN** the response includes an explicit notice that results were truncated and how to narrow them, and the truncation is recorded in the logs

#### Scenario: Invalid limit is rejected at the boundary
- **WHEN** the tool is invoked with `limit` of 0, above 1000, or a non-integer value
- **THEN** the request is rejected with a validation error before any query runs

### Requirement: Empty state is distinct from error

When no incomplete, unarchived tasks exist anywhere, the tool SHALL return a successful response with an explicit empty-state message, never an error and never a bare empty body.

#### Scenario: No open tasks anywhere
- **WHEN** the brain has zero incomplete unarchived tasks
- **THEN** the tool returns a success response whose body clearly states there are no open tasks

### Requirement: Accurate retrieval telemetry

The tool SHALL report accurate retrieval telemetry to the logging layer: `recordsReturned` equal to the total number of tasks emitted across all groups, and `returnedIds` populated with the ids of those tasks. Telemetry SHALL record ids and counts only, never task content.

#### Scenario: Telemetry reflects emitted tasks
- **WHEN** the tool emits N incomplete tasks across several groups
- **THEN** the corresponding function-call log records `recordsReturned` = N and `returned_ids` containing those N task ids

**Tag:** test
