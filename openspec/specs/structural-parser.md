# Structural Parser

Deterministic (no AI) markdown parser that extracts checkboxes and headings from note content. Pure functions with zero external dependencies, running in the Deno edge function environment. Produces a `ParsedNote` structure consumed by downstream extractors.

## Data Types

- **`ParsedNote`**: `{ content, title, referenceId, source, checkboxes: ParsedCheckbox[], headings: ParsedHeading[] }`
- **`ParsedCheckbox`**: `{ text, checked, depth, lineNumber, parentIndex, sectionHeading }`
- **`ParsedHeading`**: `{ text, level, lineStart, lineEnd }`

## File Location

`supabase/functions/terrestrial-brain-mcp/parser.ts`

---

## Requirements

### Requirement: parseNote produces a ParsedNote from markdown content

The `parseNote(content, title, referenceId, source)` function SHALL accept raw markdown text and return a `ParsedNote` object containing the original content, metadata fields (title, referenceId, source), and extracted structural elements (checkboxes and headings).

#### Scenario: Basic note with no structural elements

- **WHEN** `parseNote("Just some prose.", "My Note", "notes/my-note.md", "obsidian")` is called
- **THEN** the result SHALL have `content` = "Just some prose.", `title` = "My Note", `referenceId` = "notes/my-note.md", `source` = "obsidian", `checkboxes` = [], `headings` = []

#### Scenario: Null optional fields

- **WHEN** `parseNote("content", null, null, "obsidian")` is called
- **THEN** the result SHALL have `title` = null, `referenceId` = null

#### Scenario: Empty content

- **WHEN** `parseNote("", null, null, "obsidian")` is called
- **THEN** the result SHALL have `checkboxes` = [], `headings` = []

---

### Requirement: Checkbox parsing extracts task lines

The parser SHALL match lines matching the pattern `^\s*- \[([ xX])\] (.+)$` and produce a `ParsedCheckbox` for each match, containing the text, checked state, indentation depth, line number, parent index, and section heading.

#### Scenario: Unchecked checkbox

- **WHEN** the note contains `- [ ] Buy groceries`
- **THEN** a `ParsedCheckbox` SHALL be produced with `text` = "Buy groceries", `checked` = false, `depth` = 0

#### Scenario: Checked checkbox (lowercase x)

- **WHEN** the note contains `- [x] Done task`
- **THEN** a `ParsedCheckbox` SHALL be produced with `text` = "Done task", `checked` = true

#### Scenario: Checked checkbox (uppercase X)

- **WHEN** the note contains `- [X] Done task`
- **THEN** a `ParsedCheckbox` SHALL be produced with `checked` = true

#### Scenario: Checkbox line number

- **WHEN** the note contains a checkbox on line 5 (1-indexed)
- **THEN** the `ParsedCheckbox` SHALL have `lineNumber` = 5

#### Scenario: Malformed checkbox is ignored

- **WHEN** the note contains `- [] no space` or `- [x]` (no text after bracket)
- **THEN** no `ParsedCheckbox` SHALL be produced for those lines

---

### Requirement: Checkbox indentation depth

The parser SHALL compute `depth` from leading whitespace. Each tab character counts as one level. Each group of 2 or more consecutive spaces counts as one level. Top-level (no indentation) has depth 0.

#### Scenario: Tab-indented checkbox

- **WHEN** the note contains `\t- [ ] subtask`
- **THEN** the `ParsedCheckbox` SHALL have `depth` = 1

#### Scenario: Double-tab indented checkbox

- **WHEN** the note contains `\t\t- [ ] sub-subtask`
- **THEN** the `ParsedCheckbox` SHALL have `depth` = 2

#### Scenario: Space-indented checkbox (2 spaces)

- **WHEN** the note contains `  - [ ] subtask`
- **THEN** the `ParsedCheckbox` SHALL have `depth` = 1

#### Scenario: Space-indented checkbox (4 spaces)

- **WHEN** the note contains `    - [ ] subtask`
- **THEN** the `ParsedCheckbox` SHALL have `depth` = 2

#### Scenario: Top-level checkbox

- **WHEN** the note contains `- [ ] top level`
- **THEN** the `ParsedCheckbox` SHALL have `depth` = 0

---

### Requirement: Checkbox parent detection

The parser SHALL set `parentIndex` to the index (within the `checkboxes` array) of the nearest preceding checkbox at depth N-1, where N is the current checkbox's depth. If no such parent exists, `parentIndex` SHALL be null.

#### Scenario: Top-level checkbox has no parent

- **WHEN** a checkbox at depth 0 is parsed
- **THEN** its `parentIndex` SHALL be null

#### Scenario: Indented checkbox has parent

- **WHEN** the note contains:
  ```
  - [ ] Parent task
    - [ ] Child task
  ```
- **THEN** the child checkbox SHALL have `parentIndex` = 0 (index of "Parent task" in the checkboxes array)

#### Scenario: Multiple nesting levels

- **WHEN** the note contains:
  ```
  - [ ] Level 0
    - [ ] Level 1
      - [ ] Level 2
  ```
- **THEN** Level 2's `parentIndex` SHALL point to Level 1, and Level 1's `parentIndex` SHALL point to Level 0

#### Scenario: Sibling checkboxes share parent

- **WHEN** the note contains:
  ```
  - [ ] Parent
    - [ ] Child A
    - [ ] Child B
  ```
- **THEN** both Child A and Child B SHALL have `parentIndex` pointing to Parent

---

### Requirement: Checkbox section heading association

Each `ParsedCheckbox` SHALL have a `sectionHeading` field set to the text of the nearest markdown heading (`#` through `######`) that appears above it in the document. If no heading precedes the checkbox, `sectionHeading` SHALL be null.

#### Scenario: Checkbox under a heading

- **WHEN** the note contains:
  ```
  ## Sprint Tasks
  - [ ] Fix bug
  ```
- **THEN** the checkbox SHALL have `sectionHeading` = "Sprint Tasks"

#### Scenario: Checkbox with no preceding heading

- **WHEN** the note contains `- [ ] orphan task` with no heading above it
- **THEN** the checkbox SHALL have `sectionHeading` = null

#### Scenario: Checkbox under nested heading

- **WHEN** the note contains:
  ```
  # Project
  ## Sprint 1
  - [ ] Task A
  ```
- **THEN** the checkbox SHALL have `sectionHeading` = "Sprint 1" (nearest heading, not highest-level)

---

### Requirement: Code block awareness

The parser SHALL track fenced code block state (lines starting with ``` or ~~~). Lines inside fenced code blocks SHALL NOT be matched as checkboxes or headings.

#### Scenario: Checkbox inside code block is ignored

- **WHEN** the note contains:
  ````
  ```
  - [ ] This is example code
  ```
  ````
- **THEN** no `ParsedCheckbox` SHALL be produced for the line inside the code block

#### Scenario: Heading inside code block is ignored

- **WHEN** the note contains:
  ````
  ```
  ## Not a real heading
  ```
  ````
- **THEN** no `ParsedHeading` SHALL be produced for the line inside the code block

#### Scenario: Elements after code block are parsed normally

- **WHEN** the note contains:
  ````
  ```
  - [ ] ignored
  ```
  - [ ] real task
  ````
- **THEN** only "real task" SHALL produce a `ParsedCheckbox`

---

### Requirement: Heading parsing extracts section structure

The parser SHALL match lines matching `^(#{1,6})\s+(.+)$` and produce a `ParsedHeading` for each match, containing the text, level, start line, and end line.

#### Scenario: Single heading

- **WHEN** the note contains `## Section Title` on line 1 and has 10 total lines
- **THEN** a `ParsedHeading` SHALL be produced with `text` = "Section Title", `level` = 2, `lineStart` = 1, `lineEnd` = 10

#### Scenario: H1 heading

- **WHEN** the note contains `# Top Level`
- **THEN** the `ParsedHeading` SHALL have `level` = 1

#### Scenario: H6 heading

- **WHEN** the note contains `###### Deep Level`
- **THEN** the `ParsedHeading` SHALL have `level` = 6

#### Scenario: Bare heading marker ignored

- **WHEN** the note contains `##` with no text after
- **THEN** no `ParsedHeading` SHALL be produced

---

### Requirement: Heading line ranges

Each `ParsedHeading` SHALL have `lineStart` (the heading's own line, 1-indexed) and `lineEnd` (the last content line before the next heading of same or higher level, or the last line of the file if no such heading follows).

#### Scenario: Heading extends to next same-level heading

- **WHEN** the note contains:
  ```
  ## Section A
  content A
  ## Section B
  content B
  ```
- **THEN** Section A SHALL have `lineEnd` = 2, and Section B SHALL have `lineEnd` = 4

#### Scenario: Heading extends to end of file

- **WHEN** a heading is the last heading in the document and the document has 20 lines
- **THEN** the heading SHALL have `lineEnd` = 20

#### Scenario: Lower-level heading does not end higher-level range

- **WHEN** the note contains:
  ```
  ## Parent Section
  ### Subsection
  content
  ## Next Section
  ```
- **THEN** "Parent Section" SHALL have `lineEnd` = 3 (ends at the line before "Next Section"), and "Subsection" SHALL have `lineEnd` = 3

#### Scenario: Mixed heading levels

- **WHEN** the note contains:
  ```
  # H1
  ## H2 under H1
  ### H3 under H2
  ## Another H2
  ```
- **THEN** "H1" range ends before another level-1 heading or EOF, so `lineEnd` = 4. "H2 under H1" ends before "Another H2" (same level), so `lineEnd` = 3. "H3 under H2" ends before "Another H2" (higher level), so `lineEnd` = 3. "Another H2" extends to EOF, so `lineEnd` = 4.
