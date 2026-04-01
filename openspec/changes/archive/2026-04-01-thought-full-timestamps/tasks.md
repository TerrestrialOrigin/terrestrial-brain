## 1. Database Migration

- [x] 1.1 Create migration to add `updated_at` to `match_thoughts` RPC return table and select list

## 2. Response Formatting

- [x] 2.1 Update `search_thoughts` in `tools/thoughts.ts`: change `toLocaleDateString()` to `toISOString()`, add `updated_at` to type annotation and response display
- [x] 2.2 Update `list_thoughts` in `tools/thoughts.ts`: add `updated_at` to select query, change `toLocaleDateString()` to `toISOString()`, add `updated_at` to type annotation and response display
- [x] 2.3 Update `get_thought_by_id` in `tools/thoughts.ts`: change both `toLocaleDateString()` calls to `toISOString()`

## 3. Testing & Verification

- [x] 3.1 Integration test: verify `list_thoughts` response contains ISO 8601 timestamps with time component
- [x] 3.2 Integration test: verify `search_thoughts` response contains ISO 8601 timestamps with time component
- [x] 3.3 Integration test: verify `get_thought_by_id` response contains ISO 8601 timestamps with time component
- [x] 3.4 Run full test suite and validate build
