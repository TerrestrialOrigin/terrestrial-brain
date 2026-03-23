## MODIFIED Requirements

### Requirement: Note in a known project folder

GIVEN a parsed note has `referenceId` matching the pattern `projects/{name}/` (case-insensitive) at any depth in the path
AND a project with a matching name exists in the database (case-insensitive)
THEN the extractor SHALL return that project's ID in `ids`

#### Scenario: Root-level projects folder (existing behavior)
- **WHEN** a note has `referenceId` of `projects/CarChief/sprint-notes.md`
- **AND** a project named "CarChief" exists
- **THEN** the extractor SHALL return CarChief's ID

#### Scenario: Capitalized Projects folder
- **WHEN** a note has `referenceId` of `Projects/CarChief/sprint-notes.md`
- **AND** a project named "CarChief" exists
- **THEN** the extractor SHALL return CarChief's ID

#### Scenario: Nested projects folder
- **WHEN** a note has `referenceId` of `farming/projects/Rabbit Hutch/plan.md`
- **AND** a project named "Rabbit Hutch" exists
- **THEN** the extractor SHALL return Rabbit Hutch's ID

#### Scenario: Deeply nested with capitalization
- **WHEN** a note has `referenceId` of `work/clients/Projects/DealerPro/kickoff.md`
- **AND** a project named "DealerPro" exists
- **THEN** the extractor SHALL return DealerPro's ID

### Requirement: Note in a nested project path

GIVEN a parsed note has `referenceId` matching `projects/{name}/...` at any depth
AND a project with that name exists
THEN the extractor SHALL match on the first segment after `projects/`

#### Scenario: Deeply nested note in projects subfolder
- **WHEN** a note has `referenceId` of `Projects/CarChief/sprints/week1.md`
- **THEN** the extractor SHALL match project "CarChief" (first segment after `projects/`)

### Requirement: New project folder triggers auto-creation

GIVEN a parsed note has `referenceId` matching `projects/{name}/...` at any depth
AND no project with that name exists (case-insensitive)
THEN the extractor SHALL create a project row and return its ID

#### Scenario: Auto-create from nested projects folder
- **WHEN** a note has `referenceId` of `farming/projects/Rabbit Hutch/notes.md`
- **AND** no project named "Rabbit Hutch" exists
- **THEN** the extractor SHALL create a project "Rabbit Hutch" and return its ID

## ADDED Requirements

### Requirement: LLM-based project name extraction from path

GIVEN a parsed note's `referenceId` does NOT match the `projects/{name}/` convention
AND any path segment or the filename (without extension) contains the word "project" (case-insensitive)
THEN the extractor SHALL call the LLM with the full path to determine:
1. Whether the path segment or filename represents an actual project name
2. What the clean project name is (with "Project" stripped)

If the LLM determines it IS a project, the extractor SHALL match or auto-create the project.
If the LLM determines it is NOT a project (e.g., "Project Planning notes"), no project SHALL be created from this signal.

#### Scenario: Folder name contains "Project" — is a project
- **WHEN** a note has `referenceId` of `farming/Rabbit Hutch Project/Plan.md`
- **THEN** the LLM SHALL determine the project name is "Rabbit Hutch"
- **AND** the extractor SHALL match or auto-create a project named "Rabbit Hutch"

#### Scenario: Filename contains "Project" — is a project
- **WHEN** a note has `referenceId` of `farming/Rabbit Hutch Project.md`
- **THEN** the LLM SHALL determine the project name is "Rabbit Hutch"
- **AND** the extractor SHALL match or auto-create a project named "Rabbit Hutch"

#### Scenario: Descriptive use of "Project" — not a project
- **WHEN** a note has `referenceId` of `farming/Project Planning notes.md`
- **THEN** the LLM SHALL determine this is NOT a project name
- **AND** no project SHALL be created from this signal alone

#### Scenario: LLM path analysis skipped when no "project" in path
- **WHEN** a note has `referenceId` of `daily/2026-03-22.md`
- **THEN** the LLM path analysis SHALL NOT be invoked (no path segment contains "project")

#### Scenario: LLM path analysis skipped when conventional match succeeds
- **WHEN** a note has `referenceId` of `projects/CarChief/notes.md`
- **THEN** the conventional `projects/{name}/` pattern matches first
- **AND** the LLM path analysis SHALL NOT be invoked

#### Scenario: LLM-extracted project already exists
- **WHEN** the LLM extracts project name "Rabbit Hutch" from a path
- **AND** a project named "Rabbit Hutch" already exists (case-insensitive match)
- **THEN** the extractor SHALL return the existing project's ID (not create a duplicate)

#### Scenario: LLM path analysis fails
- **WHEN** the LLM API call for path analysis fails (network error, timeout, invalid response)
- **THEN** the extractor SHALL log the error and continue with other signals (heading + content match)
