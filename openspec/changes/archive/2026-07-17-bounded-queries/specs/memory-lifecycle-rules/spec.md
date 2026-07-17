## ADDED Requirements

### Requirement: reconcile_tasks bounds its task set and reports truncation

`reconcile_tasks` SHALL fetch its open-task set with an explicit `limit + 1` probe and, when more tasks exist than the cap, SHALL append a note that more exist and the query should be narrowed by project — rather than silently reconciling only the first N.

#### Scenario: Over-cap reconcile reports truncation
- **WHEN** more open tasks exist than the reconcile cap
- **THEN** the response includes a "more exist — narrow by project" note
