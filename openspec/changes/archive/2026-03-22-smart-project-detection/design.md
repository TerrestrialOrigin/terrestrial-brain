## Context

The `ProjectExtractor` in `project-extractor.ts` has three detection signals run in priority order:
1. **File path** — regex `^projects\/([^/]+)\/` (root-only, case-sensitive)
2. **Heading match** — case-insensitive match against known project names in DB
3. **LLM content matching** — GPT-4o-mini identifies which known projects a note relates to

Signal 1 is too rigid. Users capitalize "Projects", nest project folders at any depth, and use folder/file names like "Rabbit Hutch Project" instead of the strict `projects/{name}/` convention.

## Goals / Non-Goals

**Goals:**
- Make the `projects/{name}/` detection case-insensitive and depth-independent
- Add a new signal (between Signal 1 and Signal 2) that uses LLM to extract project names from path segments or filenames containing "project"
- Auto-create new projects from LLM-extracted names, same as the current folder-based auto-creation

**Non-Goals:**
- Changing Signal 2 (heading match) or Signal 3 (content match)
- Modifying the database schema
- Detecting projects from paths that contain no "project" keyword at all

## Decisions

### 1. Rewrite `extractProjectFolderName` to be case-insensitive and depth-independent

**Decision:** Change the regex from `^projects\/([^/]+)\/` to a case-insensitive match that finds `projects/{name}/` at any path depth.

New regex: `/(?:^|\/)projects\/([^/]+)\//i`

This matches:
- `projects/CarChief/plan.md` (root-level, current behavior)
- `Projects/CarChief/plan.md` (capitalized)
- `farming/projects/Rabbit Hutch/plan.md` (nested)
- `farming/Projects/Rabbit Hutch/plan.md` (nested + capitalized)

It still extracts the first segment after `projects/` as the project name.

**Alternative considered:** Making the `projectsFolderBase` setting a regex. Rejected — over-engineering for the problem.

### 2. Add LLM-based project name extraction from path (Signal 1b)

**Decision:** After the deterministic path match (Signal 1), if no project was found from a `projects/` folder, check if any path segment or the filename (sans .md) contains the word "project" (case-insensitive). If so, call the LLM with the full path to determine:
- Whether a path segment/filename actually represents a project name
- What the clean project name is (stripping "Project" from it)

The LLM prompt distinguishes between:
- `Rabbit Hutch Project/Plan.md` → project name: "Rabbit Hutch" (the folder IS a project)
- `Rabbit Hutch Project.md` → project name: "Rabbit Hutch" (the filename IS a project)
- `Project Planning notes.md` → NOT a project (descriptive use of "project")

**Why LLM instead of regex?** Simple pattern matching can't distinguish "Rabbit Hutch Project" (a project called Rabbit Hutch) from "Project Planning notes" (notes about planning, not a project). The user explicitly asked for AI disambiguation.

**Auto-creation:** If the LLM returns a project name and it doesn't match any known project, auto-create it (same behavior as current folder detection).

### 3. Function structure

Extract into two functions:
- `extractProjectFromConventionalPath(referenceId)` — the improved regex (Signal 1)
- `extractProjectNameFromPath(referenceId)` — LLM-based path analysis (Signal 1b)

Both return `string | null` (project name). The extractor tries Signal 1 first, then Signal 1b if Signal 1 didn't match.

### 4. Test strategy

| Layer | What | Where |
|-------|------|-------|
| Unit | `extractProjectFromConventionalPath` — case variations, any depth, edge cases | `project-extractor.test.ts` |
| Unit | LLM path extraction — mock the LLM call, test prompt construction and response parsing | `project-extractor.test.ts` |

## Risks / Trade-offs

- **[Risk] LLM cost per ingestion** → An additional LLM call for notes with "project" in their path. **Mitigation:** Only triggered when the path actually contains "project" — most notes won't. The call is small (just a path string).
- **[Risk] LLM misidentifies a project name** → "Project Planning notes" could be misread as a project. **Mitigation:** The prompt is explicit about this case. The LLM also has the option to return `null` if it's not a project.
- **[Risk] Duplicate project creation** → LLM extracts "Rabbit Hutch" but DB already has "Rabbit hutch" (different case). **Mitigation:** Case-insensitive comparison against known projects before auto-creating.

## Open Questions

None.
