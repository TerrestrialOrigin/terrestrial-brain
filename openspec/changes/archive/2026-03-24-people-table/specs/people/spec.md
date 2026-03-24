## ADDED Requirements

### Requirement: People table schema
The system SHALL store people in a `people` table with columns: `id` (uuid PK, auto-generated), `name` (text, NOT NULL, UNIQUE), `type` (text, CHECK 'human' or 'ai'), `email` (text, nullable), `description` (text, nullable), `metadata` (jsonb, default '{}'), `archived_at` (timestamptz, nullable), `created_at` (timestamptz, default now()), `updated_at` (timestamptz, auto-updated via trigger).

#### Scenario: Table exists with correct columns
- **WHEN** the migration has been applied
- **THEN** the `people` table SHALL exist with all specified columns and constraints

#### Scenario: Duplicate name rejected
- **WHEN** a person with name "Alice" exists and another insert with name "Alice" is attempted
- **THEN** the database SHALL reject the insert with a unique constraint violation

#### Scenario: Invalid type rejected
- **WHEN** an insert attempts to set type to "robot"
- **THEN** the database SHALL reject the insert with a check constraint violation

### Requirement: Create person via MCP
The system SHALL provide a `create_person` MCP tool that creates a person with name (required), type (optional, defaults to 'human'), email (optional), and description (optional).

#### Scenario: Create person with all fields
- **WHEN** `create_person` is called with name="Alice", type="human", email="alice@example.com", description="Project lead"
- **THEN** a person row SHALL be inserted and the response SHALL include the new person's id and name

#### Scenario: Create person with name only
- **WHEN** `create_person` is called with name="Bob"
- **THEN** a person row SHALL be inserted with type defaulting to null, and email/description as null

#### Scenario: Create person with duplicate name
- **WHEN** `create_person` is called with a name that already exists
- **THEN** the tool SHALL return an error message indicating the name is taken

### Requirement: List people via MCP
The system SHALL provide a `list_people` MCP tool that lists people with optional filters by type and archive status.

#### Scenario: List active people
- **WHEN** `list_people` is called with default parameters
- **THEN** the response SHALL include all non-archived people with their id, name, type, and email

#### Scenario: List by type
- **WHEN** `list_people` is called with type="ai"
- **THEN** the response SHALL include only people with type="ai"

#### Scenario: Include archived
- **WHEN** `list_people` is called with include_archived=true
- **THEN** the response SHALL include both active and archived people

#### Scenario: No people exist
- **WHEN** `list_people` is called and no people exist
- **THEN** the response SHALL indicate no people found

### Requirement: Get person via MCP
The system SHALL provide a `get_person` MCP tool that retrieves a single person's details by id, including assigned task count.

#### Scenario: Get existing person
- **WHEN** `get_person` is called with a valid person id
- **THEN** the response SHALL include all person fields plus a count of open tasks assigned to them

#### Scenario: Get non-existent person
- **WHEN** `get_person` is called with an invalid id
- **THEN** the tool SHALL return an error

### Requirement: Update person via MCP
The system SHALL provide an `update_person` MCP tool that updates a person's name, type, email, or description.

#### Scenario: Update description
- **WHEN** `update_person` is called with id and description="New role"
- **THEN** the person's description SHALL be updated and the response SHALL confirm the update

#### Scenario: Update with no fields
- **WHEN** `update_person` is called with only an id and no other fields
- **THEN** the tool SHALL respond that there are no fields to update

### Requirement: Archive person via MCP
The system SHALL provide an `archive_person` MCP tool that soft-deletes a person by setting `archived_at`.

#### Scenario: Archive person
- **WHEN** `archive_person` is called with a valid person id
- **THEN** the person's `archived_at` SHALL be set to the current timestamp

#### Scenario: Archive person with assigned tasks
- **WHEN** a person with assigned tasks is archived
- **THEN** the person SHALL be archived but the tasks' `assigned_to` SHALL remain pointing to the person (not cleared)
