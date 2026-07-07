## ADDED Requirements

### Requirement: Descriptive identifier names in server and plugin source

The codebase SHALL use descriptive, self-documenting identifier names. Single-letter variable and parameter names are prohibited except numeric loop counters (`i`, `j`, `k`-as-index). Abbreviations are prohibited unless the full name would exceed 30 characters. This sweep brings the older server files (`tools/thoughts.ts`, `tools/tasks.ts`, `tools/projects.ts`, `helpers.ts`) and the plugin stragglers up to the standard already met by the newer files.

#### Scenario: No cryptic locals remain in swept files

- **WHEN** a reviewer greps the swept files for single-letter local/parameter declarations (excluding numeric loop counters) or the previously-flagged names (`qEmb`, `kids`, `m`, `chr`, `opts`)
- **THEN** none are found, and each former occurrence has a descriptive replacement (e.g. `qEmb`→`queryEmbedding`, `kids`→`childProjects`, `chr`→`charCode`, `opts`→`options`)

#### Scenario: Behavior is unchanged after renames

- **WHEN** the full Deno test suite and the plugin vitest suite run after the renames
- **THEN** both pass with no modifications to test files, confirming the renames are behavior-preserving

### Requirement: Named constants for non-obvious numeric literals

Non-obvious numeric literals SHALL be replaced with named constants whose name states the literal's meaning. This covers server-side result caps/thresholds and plugin-side millisecond timeouts.

#### Scenario: Server magic numbers are named

- **WHEN** a reviewer inspects the project-thoughts cap, the archive-preview length, and list/search limit literals in the server tools
- **THEN** each is a named constant (e.g. `MAX_PROJECT_THOUGHTS`, `ARCHIVE_PREVIEW_LENGTH`, `DEFAULT_SEARCH_LIMIT`, `DEFAULT_LIST_LIMIT`, `MAX_LIST_LIMIT`) rather than a bare literal

#### Scenario: Plugin time literals are named

- **WHEN** a reviewer inspects the plugin's minute↔millisecond conversions and fixed Notice/poll delays
- **THEN** the repeated `60000` is expressed via a shared `MS_PER_MINUTE` constant and the fixed 2-second delays are named constants (e.g. `SYNCING_NOTICE_MS`, `INITIAL_POLL_DELAY_MS`)

### Requirement: Accurate internal identifiers and acknowledged trade-offs

Internal identifiers and comments SHALL be accurate. The MCP server-info name SHALL match the product, and accepted implementation trade-offs SHALL carry an acknowledging comment.

#### Scenario: Server-info name matches the product

- **WHEN** the MCP server reports its `serverInfo.name`
- **THEN** it is the product name (`terrestrial-brain`), not the stale `open-brain`

#### Scenario: simpleHash collision trade-off is documented

- **WHEN** a reviewer reads the plugin's `simpleHash` helper
- **THEN** a comment documents its 32-bit collision trade-off as an accepted choice
