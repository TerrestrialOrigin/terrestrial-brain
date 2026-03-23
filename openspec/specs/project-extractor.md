# ProjectExtractor

Detects project associations from parsed notes using four signals: conventional path, LLM path analysis, heading match, and LLM content matching. Auto-creates projects from folder structure or LLM-extracted names.

## Detection Signals (priority order)

1a. **Conventional path** — `referenceId` matching `projects/{name}/...` pattern (case-insensitive, any depth)
1b. **LLM path analysis** — path segments or filename containing "project" (skipped if 1a matches)
2. **Heading match** — case-insensitive comparison of note headings against known project names
3. **LLM content matching** — focused AI call with note summary + known projects list

---

## Scenarios

### Note in a known project folder

GIVEN a parsed note has `referenceId` matching the pattern `projects/{name}/` (case-insensitive) at any depth in the path
AND a project with a matching name exists in the database (case-insensitive)
THEN the extractor SHALL return that project's ID in `ids`

#### Scenario: Root-level projects folder
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

---

### Note in a nested project path

GIVEN a parsed note has `referenceId` matching `projects/{name}/...` at any depth
AND a project with that name exists
THEN the extractor SHALL match on the first segment after `projects/`

---

### Note not in a projects folder

GIVEN a parsed note has `referenceId` of `daily/2026-03-22.md`
THEN the file path detection SHALL not produce any project match from path alone

---

### New project folder triggers auto-creation

GIVEN a parsed note has `referenceId` matching `projects/{name}/...` at any depth
AND no project with that name exists (case-insensitive)
THEN the extractor SHALL create a project row and return its ID

---

### Auto-created project enriches context

GIVEN the ProjectExtractor auto-creates a project "DealerPro"
THEN `context.newlyCreatedProjects` SHALL contain `{ id: <new-uuid>, name: "DealerPro" }`
AND `context.knownProjects` SHALL also contain the new project

---

### Empty folder name is skipped

GIVEN a parsed note has `referenceId` of `projects//somefile.md` (empty folder name)
THEN the extractor SHALL NOT attempt to create a project

---

### LLM-based project name extraction from path

GIVEN a parsed note's `referenceId` does NOT match the `projects/{name}/` convention
AND any path segment or the filename (without extension) contains the word "project" (case-insensitive)
THEN the extractor SHALL call the LLM with the full path to determine:
1. Whether the path segment or filename represents an actual project name
2. What the clean project name is (with "Project" stripped)

If the LLM determines it IS a project, the extractor SHALL match or auto-create the project.
If the LLM determines it is NOT a project, no project SHALL be created from this signal.

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
- **THEN** the LLM path analysis SHALL NOT be invoked

#### Scenario: LLM path analysis skipped when conventional match succeeds
- **WHEN** a note has `referenceId` of `projects/CarChief/notes.md`
- **THEN** the conventional `projects/{name}/` pattern matches first
- **AND** the LLM path analysis SHALL NOT be invoked

#### Scenario: LLM path analysis fails
- **WHEN** the LLM API call for path analysis fails (network error, timeout, invalid response)
- **THEN** the extractor SHALL log the error and continue with other signals

---

### Heading matches known project

GIVEN a parsed note has a heading `# CarChief` or `## CarChief`
AND a project named "CarChief" exists
THEN the extractor SHALL include CarChief's ID in the result

---

### Heading does not match any project

GIVEN a parsed note has a heading `# Meeting Notes`
AND no project named "Meeting Notes" exists
THEN no project SHALL be matched from that heading

---

### Case-insensitive heading match

GIVEN a parsed note has a heading `# carchief`
AND a project named "CarChief" exists
THEN the extractor SHALL match and include CarChief's ID

---

### Content mentions a project by name

GIVEN a note's body text mentions "CarChief" but has no matching heading or file path
AND "CarChief" is a known project
THEN the LLM content matching SHALL detect and return CarChief's ID

---

### LLM returns invalid project ID

GIVEN the LLM response contains a project ID not in the known projects list
THEN that ID SHALL be discarded

---

### No known projects exist

GIVEN the database has no active projects (and no project was auto-created from path)
THEN the LLM call SHALL be skipped entirely

---

### LLM call fails

GIVEN the LLM API call fails (network error, timeout, invalid response)
THEN the extractor SHALL log the error and continue with only the deterministic results (path + heading matches), not throw

---

### Same project detected by path and heading

GIVEN a note is at `projects/CarChief/notes.md` AND has a heading `# CarChief`
THEN CarChief's ID SHALL appear exactly once in the result

---

### ProjectExtractor referenceKey

GIVEN the ProjectExtractor produces a result
THEN `result.referenceKey` SHALL equal `"projects"`
