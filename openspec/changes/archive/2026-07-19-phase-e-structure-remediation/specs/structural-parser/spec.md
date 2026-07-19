## MODIFIED Requirements

### Requirement: Code block awareness

The parser SHALL track fenced code block state (lines starting with ``` or ~~~), remembering which fence type opened the current block. A block opened with ``` SHALL be closed only by a ``` fence line, and a block opened with ~~~ SHALL be closed only by a ~~~ fence line; a fence line of the other type inside an open block SHALL be treated as in-block content. Lines inside fenced code blocks SHALL NOT be matched as checkboxes or headings.

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

#### Scenario: A tilde fence inside a backtick block does not close it

- **WHEN** the note contains a ``` block whose body includes a `~~~` line followed by `- [ ] fake task`, closed by a final ``` line
- **THEN** no `ParsedCheckbox` SHALL be produced for the `- [ ]` line — the `~~~` line is content, not a closing fence

#### Scenario: A backtick fence inside a tilde block does not close it

- **WHEN** the note contains a ~~~ block whose body includes a ``` line followed by `## fake heading`, closed by a final ~~~ line
- **THEN** no `ParsedHeading` SHALL be produced for the heading line inside the block
