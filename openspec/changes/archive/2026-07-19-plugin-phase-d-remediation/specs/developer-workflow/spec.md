## ADDED Requirements

### Requirement: Plugin lint and strict typecheck gate

The Obsidian plugin package SHALL enforce its safety tooling in the build: an ESLint configuration with `@typescript-eslint/no-floating-promises` and `@typescript-eslint/no-explicit-any` as errors covering both source and test files, `noUncheckedIndexedAccess` enabled in the TypeScript configuration, and typechecking that covers the test files. `npm run build` in `obsidian-plugin/` SHALL fail if any lint error is present or any file (including tests) fails typechecking. Any retained `skipLibCheck` usage SHALL carry an inline justification.

#### Scenario: Lint gate fails the build
- **WHEN** a plugin source or test file contains a floating promise or an explicit `any`
- **THEN** `npm run build` in `obsidian-plugin/` SHALL exit non-zero

#### Scenario: Test files are typechecked
- **WHEN** a plugin test file contains a type error
- **THEN** the plugin build (or its typecheck step) SHALL exit non-zero

#### Scenario: Unchecked index access is rejected
- **WHEN** plugin code indexes into an array or record without handling `undefined`
- **THEN** typechecking SHALL fail (`noUncheckedIndexedAccess` is enabled)
