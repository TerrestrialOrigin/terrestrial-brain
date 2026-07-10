## MODIFIED Requirements

### Requirement: ThoughtRepository interface abstracts all thoughts-table access

The MCP edge function SHALL define a `ThoughtRepository` interface as the single
seam over the `thoughts` table and its associated RPCs (`search_thoughts_by_embedding`,
`increment_usefulness`). The interface SHALL expose only the operations current
callers use — vector match, list-with-filters, active-count, stats read,
find-by-id, find-for-update, find-active-by-id, find-by-reference, insert,
update, archive, and increment-usefulness. No tool handler or helper in
`tools/thoughts.ts` or `helpers.ts` SHALL construct a `supabase.from("thoughts")`
query or a `thoughts`-related `supabase.rpc(...)` call directly.

#### Scenario: No inline thoughts query remains in scope

- **WHEN** `tools/thoughts.ts` and `helpers.ts` are searched for `from("thoughts")`
- **THEN** no match SHALL be found — every `thoughts`-table access goes through the repository

#### Scenario: Vector match delegated to the repository

- **WHEN** `search_thoughts` runs a semantic search
- **THEN** it SHALL call the repository's vector-match method (which wraps `rpc("search_thoughts_by_embedding", …)`) rather than calling `supabase.rpc` inline

#### Scenario: Usefulness increment delegated to the repository

- **WHEN** `record_useful_thoughts`, `get_thought_by_id`, or `capture_thought` credit thoughts
- **THEN** they SHALL call the repository's increment-usefulness method rather than `supabase.rpc("increment_usefulness", …)` inline
