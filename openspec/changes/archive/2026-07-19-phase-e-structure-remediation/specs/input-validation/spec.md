## ADDED Requirements

### Requirement: Stored metadata references are structurally validated before use

Code reading project references out of stored thought metadata (`getProjectRefs`) SHALL validate the structure at runtime — verifying `references` is a non-null object and filtering `projects` to string elements — instead of casting. Legacy or malformed shapes (a scalar `references`, non-string array elements) SHALL yield only the valid entries, never hand garbage downstream typed as `string[]`.

#### Scenario: Legacy scalar references yields no refs

- **WHEN** a thought's metadata carries `references: "old-string-value"`
- **THEN** `getProjectRefs` returns an empty list without throwing

#### Scenario: Mixed-type projects array is filtered

- **WHEN** a thought's metadata carries `references.projects: [42, "b8f5…-uuid"]`
- **THEN** `getProjectRefs` returns only the string entry
