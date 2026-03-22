# ProjectExtractor

Detects project associations from parsed notes using three signals: file path, heading match, and LLM content matching. Auto-creates projects from folder structure.

## Detection Signals (priority order)

1. **File path** — `referenceId` matching `projects/{name}/...` pattern
2. **Heading match** — case-insensitive comparison of note headings against known project names
3. **LLM content matching** — focused AI call with note summary + known projects list

---

## Scenarios

### Note in a known project folder

GIVEN a parsed note has `referenceId` of `projects/CarChief/sprint-notes.md`
AND a project named "CarChief" exists in the database
THEN the extractor SHALL return the CarChief project's ID in `ids`

---

### Note in a nested project path

GIVEN a parsed note has `referenceId` of `projects/CarChief/sprints/week1.md`
AND a project named "CarChief" exists
THEN the extractor SHALL return CarChief's ID (matching on the first segment after `projects/`)

---

### Note not in a projects folder

GIVEN a parsed note has `referenceId` of `daily/2026-03-22.md`
THEN the file path detection SHALL not produce any project match from path alone

---

### New project folder triggers auto-creation

GIVEN a parsed note has `referenceId` of `projects/DealerPro/kickoff.md`
AND no project named "DealerPro" exists
THEN the extractor SHALL create a project row with `name: "DealerPro"` and return its ID

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
