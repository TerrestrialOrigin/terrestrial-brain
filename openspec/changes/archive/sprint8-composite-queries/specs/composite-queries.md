# Composite Queries

## get_project_summary

### GIVEN a project exists with tasks, thoughts, and child projects
WHEN `get_project_summary` is called with the project's UUID
THEN the response contains:
- Project name, type, description
- Parent project name (if applicable)
- Child project names (if any)
- Open tasks for this project (content, status, due date)
- Recent thoughts referencing this project (content, type, date)
- Source notes that generated those thoughts (title/path from note_snapshots)

### GIVEN a project exists with no tasks or thoughts
WHEN `get_project_summary` is called with the project's UUID
THEN the response contains:
- Project details
- "No open tasks" indication
- "No recent thoughts" indication

### GIVEN an invalid project UUID
WHEN `get_project_summary` is called
THEN the response is an error with "Project not found"

### GIVEN a project has thoughts with old-format references (project_id string)
WHEN `get_project_summary` is called
THEN those thoughts are included in the summary (backwards-compatible)

### GIVEN a project has thoughts with new-format references (projects array)
WHEN `get_project_summary` is called
THEN those thoughts are included in the summary

## get_recent_activity

### GIVEN activity exists across tables within the time window
WHEN `get_recent_activity` is called with `days: 7`
THEN the response contains sections for:
- New thoughts (content, type, date)
- Tasks created (content, project, status)
- Tasks completed (content, project, completion date)
- Projects created or updated
- AI outputs delivered (title, file path, delivery date)

### GIVEN no activity exists within the time window
WHEN `get_recent_activity` is called
THEN the response indicates no recent activity

### GIVEN `days` is not provided
WHEN `get_recent_activity` is called
THEN it defaults to 7 days

### GIVEN `days` is 0 or negative
WHEN `get_recent_activity` is called
THEN it clamps to minimum 1 day
