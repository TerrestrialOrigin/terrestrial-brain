## ADDED Requirements

### Requirement: File path project detection
The ProjectExtractor SHALL detect project associations from the note's `referenceId`. If the `referenceId` matches the pattern `projects/{name}/...` (case-sensitive path segment), the extractor SHALL look up the project by name and include its ID in the result.

#### Scenario: Note in a known project folder
- **WHEN** a parsed note has `referenceId` of `projects/CarChief/sprint-notes.md`
- **AND** a project named "CarChief" exists in the database
- **THEN** the extractor SHALL return the CarChief project's ID in `ids`

#### Scenario: Note in a nested project path
- **WHEN** a parsed note has `referenceId` of `projects/CarChief/sprints/week1.md`
- **AND** a project named "CarChief" exists
- **THEN** the extractor SHALL return CarChief's ID (matching on the first segment after `projects/`)

#### Scenario: Note not in a projects folder
- **WHEN** a parsed note has `referenceId` of `daily/2026-03-22.md`
- **THEN** the file path detection SHALL not produce any project match from path alone

### Requirement: Auto-creation of projects from folder structure
If a note's `referenceId` indicates a `projects/{name}/` path and no matching project exists in the database, the ProjectExtractor SHALL insert a new project row with the folder name as the project `name`, `type` as null, and no description. The new project SHALL be added to `context.newlyCreatedProjects` and `context.knownProjects`.

#### Scenario: New project folder triggers auto-creation
- **WHEN** a parsed note has `referenceId` of `projects/DealerPro/kickoff.md`
- **AND** no project named "DealerPro" exists
- **THEN** the extractor SHALL create a project row with `name: "DealerPro"` and return its ID

#### Scenario: Auto-created project enriches context
- **WHEN** the ProjectExtractor auto-creates a project "DealerPro"
- **THEN** `context.newlyCreatedProjects` SHALL contain `{ id: <new-uuid>, name: "DealerPro" }`
- **AND** `context.knownProjects` SHALL also contain the new project

#### Scenario: Empty folder name is skipped
- **WHEN** a parsed note has `referenceId` of `projects//somefile.md` (empty folder name)
- **THEN** the extractor SHALL NOT attempt to create a project

### Requirement: Heading-based project detection
The ProjectExtractor SHALL compare heading text from `ParsedNote.headings` against known project names (case-insensitive). If a heading matches a known project name, that project's ID SHALL be included in the result.

#### Scenario: Heading matches known project
- **WHEN** a parsed note has a heading `# CarChief` or `## CarChief`
- **AND** a project named "CarChief" exists
- **THEN** the extractor SHALL include CarChief's ID in the result

#### Scenario: Heading does not match any project
- **WHEN** a parsed note has a heading `# Meeting Notes`
- **AND** no project named "Meeting Notes" exists
- **THEN** no project SHALL be matched from that heading

#### Scenario: Case-insensitive heading match
- **WHEN** a parsed note has a heading `# carchief`
- **AND** a project named "CarChief" exists
- **THEN** the extractor SHALL match and include CarChief's ID

### Requirement: LLM content-based project detection
When deterministic signals (path, heading) do not account for all potential project references, the ProjectExtractor SHALL use a focused LLM call to detect additional project mentions in the note content. The LLM call SHALL receive the note title, heading structure, a summary of each section (first ~200 characters), and the list of known projects. The LLM response SHALL be parsed as JSON and only project IDs present in the known projects list SHALL be accepted.

#### Scenario: Content mentions a project by name
- **WHEN** a note's body text mentions "CarChief" but has no matching heading or file path
- **AND** "CarChief" is a known project
- **THEN** the LLM content matching SHALL detect and return CarChief's ID

#### Scenario: LLM returns invalid project ID
- **WHEN** the LLM response contains a project ID not in the known projects list
- **THEN** that ID SHALL be discarded

#### Scenario: No known projects exist
- **WHEN** the database has no active projects (and no project was auto-created from path)
- **THEN** the LLM call SHALL be skipped entirely

#### Scenario: LLM call fails
- **WHEN** the LLM API call fails (network error, timeout, invalid response)
- **THEN** the extractor SHALL log the error and continue with only the deterministic results (path + heading matches), not throw

### Requirement: Deduplicated project IDs
The ProjectExtractor SHALL return a deduplicated list of project IDs. If the same project is detected by multiple signals (e.g., both file path and heading), its ID SHALL appear only once in the result.

#### Scenario: Same project detected by path and heading
- **WHEN** a note is at `projects/CarChief/notes.md` AND has a heading `# CarChief`
- **THEN** CarChief's ID SHALL appear exactly once in the result

### Requirement: ProjectExtractor referenceKey
The ProjectExtractor SHALL use `"projects"` as its `referenceKey`.

#### Scenario: Reference key value
- **WHEN** the ProjectExtractor produces a result
- **THEN** `result.referenceKey` SHALL equal `"projects"`
