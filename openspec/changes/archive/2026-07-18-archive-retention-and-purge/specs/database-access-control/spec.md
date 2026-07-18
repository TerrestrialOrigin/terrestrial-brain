## ADDED Requirements

### Requirement: Archive-purge RPCs are service_role only

`count_archived_rows` and `purge_archived_rows` SHALL have `EXECUTE` revoked from `PUBLIC`, `anon`, and `authenticated` and granted only to `service_role`, and the pgTAP denial suite SHALL assert anon/authenticated cannot execute them.

#### Scenario: Anon and authenticated cannot execute the purge RPCs
- **WHEN** `count_archived_rows` or `purge_archived_rows` is called as `anon` or `authenticated`
- **THEN** the call is rejected with SQLSTATE `42501`
