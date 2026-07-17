# projects Specification

## Purpose
TBD - created by archiving change archive-project-cascade. Update Purpose after archive.
## Requirements
### Requirement: Archiving a project cascades safely

`archive_project` SHALL archive the project and its whole active subtree — descendant projects and their open tasks — as one cascade. Every read in the cascade (child-project discovery, open-task lookup) SHALL check its error channel and abort with an error result BEFORE any write when a read fails, so a partial failure is never reported as a completed archive. The subtree traversal SHALL use a visited set so a parent cycle in the data terminates instead of spinning. Writes SHALL be ordered tasks-first, projects-last, so that a crash between the two steps leaves the projects still active and a re-run can rediscover and finish the cascade.

#### Scenario: A failed traversal aborts without archiving

- **WHEN** the child-project or open-task lookup returns an error
- **THEN** `archive_project` returns an error result and archives nothing

#### Scenario: Tasks are archived before projects

- **WHEN** a project with descendants and open tasks is archived
- **THEN** the open tasks are archived before the projects, so an interruption leaves a recoverable (still-active project) state

#### Scenario: A cyclic project graph terminates

- **WHEN** the project hierarchy contains a parent cycle
- **THEN** the archive traversal terminates rather than looping

### Requirement: Updating a project's parent cannot create a cycle

`update_project` SHALL reject a `parent_id` that would create a cycle in the project hierarchy (the proposed parent being the project itself or one of its descendants), returning an error and leaving the project's parent unchanged. A null `parent_id` (removing the parent) SHALL always be allowed.

#### Scenario: A cycle-creating parent is rejected

- **WHEN** `update_project` is asked to set a project's parent to one of that project's own descendants
- **THEN** it returns an error mentioning a cycle and the project's `parent_id` is left unchanged

