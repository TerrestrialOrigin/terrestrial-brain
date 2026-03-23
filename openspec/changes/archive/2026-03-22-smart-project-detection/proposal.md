## Why

The project extractor only detects projects from a hardcoded root-level `projects/` folder path (case-sensitive). This means notes in `Projects/` (capitalized), nested project folders (`farming/projects/Rabbit Hutch/`), folders named with "Project" in them (`farming/Rabbit Hutch Project/`), or notes with "Project" in the filename (`Rabbit Hutch Project.md`) are all missed. Users organize vaults freely — the extractor needs to meet them where they are.

## What Changes

- **Case-insensitive "projects" folder detection**: The regex matching `projects/{name}/` becomes case-insensitive, matching `Projects/`, `PROJECTS/`, etc.
- **Any-depth "projects" folder**: The pattern matches `projects/{name}/` at any path depth, not just root. `farming/projects/Rabbit Hutch/plan.md` → project "Rabbit Hutch".
- **LLM-powered project name extraction from paths**: When a path segment or filename contains the word "project" (case-insensitive) but doesn't match the `projects/{name}/` convention, the AI determines the actual project name (or that it's not a project at all). Examples:
  - `farming/Rabbit Hutch Project/Plan.md` → AI extracts "Rabbit Hutch" as the project
  - `farming/Rabbit Hutch Project.md` → AI extracts "Rabbit Hutch" as the project
  - `farming/Project Planning notes.md` → AI determines this is NOT a project name
- **Existing signals preserved**: Heading-based and content-based LLM detection remain unchanged.

## Non-goals

- Changing the heading-based or content-based detection signals.
- Modifying the task extractor or parser.
- Changing how projects are stored in the database.
- Detecting projects that have no "project" indicator in the path at all (that's what the existing heading/content signals handle).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `project-extractor`: File path detection becomes case-insensitive, works at any depth, and adds LLM-based project name extraction from path segments/filenames containing "project".

## Impact

- **`supabase/functions/terrestrial-brain-mcp/extractors/project-extractor.ts`**: Rewrite `extractProjectFolderName` + add new LLM path analysis signal.
- **`openspec/specs/project-extractor.md`**: Update scenarios for new detection rules.
