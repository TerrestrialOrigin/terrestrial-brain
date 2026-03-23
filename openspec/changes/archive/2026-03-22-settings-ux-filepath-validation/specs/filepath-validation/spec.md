## ADDED Requirements

### Requirement: File path validation for AI output

The MCP server SHALL validate the `file_path` parameter in `create_ai_output` and `create_tasks_with_output` before inserting into the database. Validation SHALL use Windows as the most restrictive baseline to ensure cross-platform compatibility. Invalid paths SHALL be rejected with a descriptive error message that tells the AI client exactly what is wrong, enabling retry with a corrected path.

#### Scenario: Valid simple path accepted
- **WHEN** a client calls `create_ai_output` with `file_path: "projects/MyProject/notes.md"`
- **THEN** the system SHALL accept the path and proceed with insertion

#### Scenario: Valid deeply nested path accepted
- **WHEN** a client calls `create_ai_output` with `file_path: "projects/TeamA/2026/Q1/sprint-review.md"`
- **THEN** the system SHALL accept the path and proceed with insertion

#### Scenario: Reject path with invalid Windows characters
- **WHEN** a client calls `create_ai_output` with a `file_path` containing any of `< > : " \ | ? *` in a segment name
- **THEN** the system SHALL return an error: `"Invalid file path: character '{char}' is not allowed in file or folder names. Please use only letters, numbers, spaces, hyphens, underscores, and periods."`
- **AND** the response SHALL have `isError: true`

#### Scenario: Reject path with control characters
- **WHEN** a client calls `create_ai_output` with a `file_path` containing ASCII control characters (0x00–0x1F)
- **THEN** the system SHALL return an error describing the invalid character
- **AND** the response SHALL have `isError: true`

#### Scenario: Reject reserved Windows filenames
- **WHEN** a client calls `create_ai_output` with a `file_path` where any segment (with or without extension) matches a reserved Windows name (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`), case-insensitive
- **THEN** the system SHALL return an error: `"Invalid file path: '{name}' is a reserved filename on Windows. Please choose a different name."`
- **AND** the response SHALL have `isError: true`

#### Scenario: Reject segment ending with dot or space
- **WHEN** a client calls `create_ai_output` with a `file_path` where any segment ends with `.` or a space character
- **THEN** the system SHALL return an error: `"Invalid file path: file and folder names must not end with a period or space."`
- **AND** the response SHALL have `isError: true`

#### Scenario: Reject empty or whitespace-only path
- **WHEN** a client calls `create_ai_output` with `file_path` that is empty or contains only whitespace
- **THEN** the system SHALL return an error: `"Invalid file path: path must not be empty."`
- **AND** the response SHALL have `isError: true`

#### Scenario: Reject absolute paths
- **WHEN** a client calls `create_ai_output` with a `file_path` starting with `/`
- **THEN** the system SHALL return an error: `"Invalid file path: path must be vault-relative (no leading slash)."`
- **AND** the response SHALL have `isError: true`

#### Scenario: Reject empty segments (consecutive slashes)
- **WHEN** a client calls `create_ai_output` with a `file_path` containing `//`
- **THEN** the system SHALL return an error: `"Invalid file path: path contains empty segments (consecutive slashes)."`
- **AND** the response SHALL have `isError: true`

#### Scenario: Require .md extension
- **WHEN** a client calls `create_ai_output` with a `file_path` that does not end with `.md`
- **THEN** the system SHALL return an error: `"Invalid file path: file must have a .md extension."`
- **AND** the response SHALL have `isError: true`

#### Scenario: Forward slash allowed as path separator
- **WHEN** a client calls `create_ai_output` with `file_path: "folder/subfolder/file.md"`
- **THEN** the system SHALL treat `/` as the path separator and validate each segment between slashes individually

#### Scenario: Validation applies to create_tasks_with_output
- **WHEN** a client calls `create_tasks_with_output` with an invalid `file_path`
- **THEN** the system SHALL reject the path with the same validation rules and error messages as `create_ai_output`
- **AND** no tasks SHALL be inserted into the database
