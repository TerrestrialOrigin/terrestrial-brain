## ADDED Requirements

### Requirement: Phase E naming sweep covers the remaining flagged sites

The descriptive-naming rule SHALL additionally hold at the sites flagged by the 2026-07-17 scan: comparator lambdas in `tools/tasks.ts` use descriptive parameter names (`groupA`/`groupB`, not `a`/`b`); `tools/thoughts.ts` uses `extractedMetadata`/`metadataRecord` and `context` instead of `meta` and `ctx`; and the test-suite lambdas and helpers flagged in TEST-19 (`(o)`, `(k)`, `(s)`, `(t)`, `del`) are renamed to descriptive forms (`(output)`, `(specKey)`, `(scenario)`, `(row)`, `deleteRows`).

#### Scenario: Flagged production sites are renamed

- **WHEN** `tools/tasks.ts` and `tools/thoughts.ts` are grepped for the flagged single-letter comparator parameters and the `meta`/`ctx` identifiers
- **THEN** none remain, and the suite still compiles and passes

#### Scenario: Flagged test sites are renamed

- **WHEN** the test files listed in TEST-19 are grepped for the flagged single-letter lambda parameters and the `del` helper
- **THEN** none remain
