## Context

The current `ingest_note` flow sends raw markdown directly to GPT-4o-mini for thought splitting. It has no awareness of structural markdown elements like checkboxes (`- [ ]`/`- [x]`) or heading hierarchy. Sprints 3-5 will add an extractor pipeline (ProjectExtractor, TaskExtractor) that needs this structural data as input — specifically parsed checkboxes with depth, parent relationships, and section context, and headings with line ranges.

This module sits between raw note content and the extractor pipeline:

```
raw markdown → parseNote() → ParsedNote → extractors (Sprint 3+) → references
```

The parser runs in the Deno edge function environment alongside the MCP server. It has zero external dependencies and zero AI calls — purely deterministic string processing.

## Goals / Non-Goals

**Goals:**
- Provide a `parseNote()` function that produces a `ParsedNote` with checkboxes and headings
- Handle real-world Obsidian markdown: nested checkboxes, mixed content, code blocks
- Be fully testable with no mocks — pure functions, deterministic output
- Define clean TypeScript interfaces that Sprint 3+ extractors consume directly

**Non-Goals:**
- No Dataview query parsing, YAML frontmatter interpretation, or wiki-link resolution
- No database interaction or AI calls
- No integration with `ingest_note` (that's Sprint 5)
- No extraction of semantic meaning — this is structural parsing only

## Decisions

### 1. Single-file module at `parser.ts`

Place all parsing logic in `supabase/functions/terrestrial-brain-mcp/parser.ts`.

**Why:** The parser is a cohesive set of pure functions (checkbox parsing, heading parsing, composition). A single file keeps it simple and avoids premature abstraction. If it grows beyond ~300 lines in future sprints, it can be split then.

**Alternative considered:** Separate files per concern (`checkbox-parser.ts`, `heading-parser.ts`). Rejected because the functions are tightly coupled (checkboxes need heading context) and the total code is small.

### 2. Regex-based line-by-line parsing

Process the markdown line by line, using regex patterns:
- Checkbox: `^\s*- \[([ xX])\] (.+)$`
- Heading: `^(#{1,6})\s+(.+)$`
- Fenced code block toggle: `^(\s*)(```|~~~)`

**Why:** Line-by-line processing is simple, O(n) in line count, and handles all real-world Obsidian markdown. No need for a full AST parser — we only need checkboxes and headings.

**Alternative considered:** Using a markdown AST library (e.g., remark/unified). Rejected because it adds a dependency, is overkill for two element types, and Deno compatibility with the unified ecosystem is uneven.

### 3. Indentation-based parent detection

Compute checkbox depth from leading whitespace: each tab or group of 2+ spaces = one level. A checkbox at depth N is a child of the nearest preceding checkbox at depth N-1.

**Why:** Obsidian uses indentation for nesting. This matches how users write and how Obsidian renders hierarchy. The algorithm is a single pass with a stack.

**Alternative considered:** Relying on Obsidian's cache for hierarchy info. Rejected because the parser runs server-side in Deno, not in the Obsidian plugin.

### 4. Code block awareness via toggle state

Track whether we're inside a fenced code block (``` or ~~~). When inside, skip all checkbox and heading regex matching. Toggle state on/off when encountering a fence line.

**Why:** Users may include example checkboxes in code blocks (e.g., documenting a markdown format). These must not be parsed as real tasks.

### 5. Section heading association for checkboxes

Each checkbox stores the `sectionHeading` — the text of the nearest `#` heading above it. This is computed during the line-by-line pass by tracking the most recent heading seen.

**Why:** The TaskExtractor (Sprint 4) uses section headings to associate tasks with projects (e.g., a task under a `## CarChief` heading belongs to that project).

### 6. Heading line ranges

Each heading stores `lineStart` and `lineEnd`. The range extends from the heading's line to just before the next heading of same or higher level, or to the last line of the file.

**Why:** Extractors need to know which content belongs to which section. Line ranges enable slicing note content by section without re-parsing.

### Test Strategy

**Unit tests only** — this is a pure function module with no external dependencies.

- **Framework:** Deno standard library assertions (`tests/integration/parse.test.ts`)
- **Coverage:** Every `ParsedCheckbox` and `ParsedHeading` field, edge cases (empty input, code blocks, deep nesting, mixed content)
- **No mocks needed** — functions are pure input/output

## User Error Scenarios

| Scenario | System behavior |
|----------|----------------|
| Empty note content | Returns `ParsedNote` with empty `checkboxes` and `headings` arrays |
| Malformed checkbox (e.g., `- [] text`, `- [x]` with no text after) | Line is not matched by regex — silently skipped, no error |
| Checkbox inside fenced code block | Skipped — code block state tracking prevents false matches |
| Deeply nested checkboxes (10+ levels) | Parsed correctly — depth is computed from whitespace with no limit |
| Heading with no text (bare `##`) | Not matched by regex (requires `\s+(.+)$`) — silently skipped |
| Mixed tab/space indentation | Each tab = 1 level, each group of 2+ consecutive spaces = 1 level. Consistent within a note is the user's responsibility; mixed indent may produce unexpected depth values, but never errors |

## Security Analysis

This module processes untrusted user input (note markdown content). Threats:

| Threat | Mitigation |
|--------|------------|
| ReDoS (regex denial of service) | All regexes are linear — no nested quantifiers or backtracking traps. The checkbox regex is `^\s*- \[([ xX])\] (.+)$` — anchored, no alternation inside repetition |
| Excessively large input | The parser is O(lines) with no recursion. Notes with 10k+ lines parse in milliseconds. No mitigation needed beyond Supabase's request size limits |
| Injection via heading/checkbox text | The parser stores raw text — it does not evaluate, template, or execute any extracted content. Downstream consumers must sanitize if rendering to HTML |

No `ThreatModel.md` created — threats are trivial for a pure parsing function with no I/O, no state, and no execution of parsed content.

## Risks / Trade-offs

- **[Risk] Mixed indentation produces unexpected depth** → Mitigation: Document that consistent indentation is expected. The parser uses a simple heuristic (tabs or space groups) that matches Obsidian's default behavior. If this becomes a problem, we can add a normalization pass later.
- **[Risk] Regex doesn't match all possible checkbox formats** → Mitigation: The regex `^\s*- \[([ xX])\] (.+)$` covers standard Obsidian checkboxes. Non-standard formats (e.g., `* [ ]`, `+ [ ]`, custom checkbox plugins) are intentionally out of scope. Can be extended via additional patterns if needed.
- **[Trade-off] Heading line ranges are inclusive** → `lineEnd` points to the last content line before the next heading, not the heading line itself. This is a design choice to make section slicing intuitive: `lines.slice(heading.lineStart, heading.lineEnd + 1)` gives the full section.

## Open Questions

_(none — the scope and approach are well-defined by SyncChanges.md Sprint 2)_
