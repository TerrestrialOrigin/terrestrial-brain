## MODIFIED Requirements

### Requirement: Checkbox parsing extracts task lines

The parser SHALL match lines matching the pattern `^\s*[-*+] \[([ xX])\] (.+)$` — accepting `-`, `*`, or `+` as the list bullet — and produce a `ParsedCheckbox` for each match, containing the text, checked state, indentation depth, line number, parent index, and section heading.

#### Scenario: Unchecked checkbox

- **WHEN** the note contains `- [ ] Buy groceries`
- **THEN** a `ParsedCheckbox` SHALL be produced with `text` = "Buy groceries", `checked` = false, `depth` = 0

#### Scenario: Checked checkbox (lowercase x)

- **WHEN** the note contains `- [x] Done task`
- **THEN** a `ParsedCheckbox` SHALL be produced with `text` = "Done task", `checked` = true

#### Scenario: Checked checkbox (uppercase X)

- **WHEN** the note contains `- [X] Done task`
- **THEN** a `ParsedCheckbox` SHALL be produced with `checked` = true

#### Scenario: Asterisk bullet checkbox

- **WHEN** the note contains `* [ ] Star task`
- **THEN** a `ParsedCheckbox` SHALL be produced with `text` = "Star task", `checked` = false

#### Scenario: Plus bullet checkbox

- **WHEN** the note contains `+ [x] Plus task`
- **THEN** a `ParsedCheckbox` SHALL be produced with `text` = "Plus task", `checked` = true

#### Scenario: Checkbox line number

- **WHEN** the note contains a checkbox on line 5 (1-indexed)
- **THEN** the `ParsedCheckbox` SHALL have `lineNumber` = 5

#### Scenario: Malformed checkbox is ignored

- **WHEN** the note contains `- [] no space` or `- [x]` (no text after bracket)
- **THEN** no `ParsedCheckbox` SHALL be produced for those lines

#### Scenario: Non-checkbox bullet line is ignored

- **WHEN** the note contains `* just a bullet, not a checkbox`
- **THEN** no `ParsedCheckbox` SHALL be produced for that line

### Requirement: Checkbox parent detection

The parser SHALL set `parentIndex` to the index (within the `checkboxes` array) of the nearest preceding checkbox whose `depth` is strictly less than the current checkbox's depth, provided that preceding checkbox shares the current checkbox's `sectionHeading`. The backward scan SHALL stop at (and SHALL NOT cross into) a checkbox belonging to a different section heading. If no such in-section shallower checkbox exists, `parentIndex` SHALL be null.

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

#### Scenario: Depth jump nests to nearest shallower checkbox

- **WHEN** the note contains a depth-0 checkbox immediately followed by a checkbox indented to depth 2 (no intervening depth-1 checkbox):
  ```
  - [ ] Parent task
      - [ ] Deeply indented child
  ```
- **THEN** the depth-2 checkbox SHALL have `parentIndex` = 0 (the nearest preceding checkbox with smaller depth), NOT null

#### Scenario: Parent search does not cross a section heading

- **WHEN** the note contains a depth-0 checkbox under one heading, then a new heading, then a depth-1 checkbox under the new heading:
  ```
  ## Section A
  - [ ] A task
  ## Section B
    - [ ] B subtask
  ```
- **THEN** the depth-1 checkbox under "Section B" SHALL have `parentIndex` = null (its only shallower predecessor is in a different section)
