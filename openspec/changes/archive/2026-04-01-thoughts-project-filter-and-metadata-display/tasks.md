## 1. Database — match_thoughts RPC Update

- [x] 1.1 Create a SQL migration to update the `match_thoughts` function: add `reliability` and `author` to the return type and SELECT clause
- [x] 1.2 Verify the migration applies cleanly against the local Supabase instance

## 2. list_thoughts Enhancements

- [x] 2.1 Add `project_id` optional parameter to `list_thoughts` input schema with description
- [x] 2.2 Add `reliability` and `author` to the `select()` clause in `list_thoughts`
- [x] 2.3 Add JSONB containment filter for `project_id` on `metadata.references.projects`
- [x] 2.4 Add project name resolution: collect unique project UUIDs from results, batch-fetch names from `projects` table, build UUID-to-name map
- [x] 2.5 Update result formatter to display reliability, author, and resolved project names
- [x] 2.6 Update the MCP tool description to mention the new `project_id` filter

## 3. search_thoughts Enhancements

- [x] 3.1 Update the type annotation for `search_thoughts` results to include `reliability` and `author` fields from the updated `match_thoughts` RPC
- [x] 3.2 Add project name resolution: collect unique project UUIDs from results, batch-fetch names from `projects` table, build UUID-to-name map
- [x] 3.3 Update result formatter to display reliability, author, and resolved project names

## 4. thought_stats Enhancement

- [x] 4.1 Add `project_id` optional parameter to `thought_stats` input schema with description
- [x] 4.2 Apply JSONB containment filter on `project_id` to both the count query and the metadata fetch query
- [x] 4.3 Update the MCP tool description to mention the new `project_id` filter

## 5. Shared Utilities

- [x] 5.1 Extract a reusable `resolveProjectNames(supabase, projectUuids)` helper function that takes a SupabaseClient and array of UUIDs and returns a `Map<string, string>` (UUID → name), falling back to the raw UUID for unresolvable entries

## 6. Testing & Verification

- [x] 6.1 Write integration tests for `list_thoughts` with `project_id` filter (match, no-match, combined with other filters)
- [x] 6.2 Write integration tests verifying `list_thoughts` output includes reliability, author, and project names
- [x] 6.3 Write integration tests verifying `search_thoughts` output includes reliability, author, and project names
- [x] 6.4 Write integration tests for `thought_stats` with `project_id` filter (scoped stats, no-match returns 0)
- [x] 6.5 Write integration test for project name resolution fallback (orphaned UUID displays raw UUID)
- [x] 6.6 Run full test suite across all packages and verify 0 failures, 0 skips
- [x] 6.7 Run `npm run build` to verify clean build
- [x] 6.8 Deploy to local Supabase emulator and smoke-test all three modified tools via MCP calls
