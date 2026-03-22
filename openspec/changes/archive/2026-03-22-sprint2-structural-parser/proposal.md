## Why

The current `ingest_note` and `capture_thought` flows rely entirely on LLM calls for all content understanding, including detecting tasks (checkboxes) and note structure (headings). Sprint 3-5 will introduce an extractor pipeline that needs structured input — parsed checkboxes with depth, checked state, parent relationships, and section headings with line ranges. A deterministic, zero-dependency structural parser is needed as the foundation for that pipeline, providing fast, reliable, and testable extraction of markdown structure without AI costs.

## What Changes

- Add a new `parser.ts` module in the MCP function directory with pure functions for:
  - Checkbox extraction: regex-based parsing of `- [ ]` / `- [x]` lines with indentation depth, parent detection, section heading association, and code block skipping
  - Heading extraction: regex-based parsing of `#` headings with computed line ranges
  - A top-level `parseNote()` function composing both into a `ParsedNote` structure
- Define TypeScript interfaces: `ParsedNote`, `ParsedCheckbox`, `ParsedHeading`
- Add integration tests covering all parsing scenarios

## Non-goals

- No AI or LLM calls — this is purely deterministic string processing
- No Supabase or database interaction — pure functions only
- No changes to the existing `ingest_note` or `capture_thought` flows (that's Sprint 5)
- No extraction of projects or tasks to the database (that's Sprints 3-4)
- No handling of non-markdown formats (e.g., Dataview queries, YAML frontmatter parsing)

## Capabilities

### New Capabilities
- `structural-parser`: Deterministic markdown parsing that extracts checkboxes (with depth, checked state, parent hierarchy, section context) and headings (with level and line ranges) from note content. Produces a `ParsedNote` structure consumed by downstream extractors.

### Modified Capabilities
_(none — this is a new standalone module with no changes to existing spec-level behavior)_

## Impact

- **New file:** `supabase/functions/terrestrial-brain-mcp/parser.ts`
- **New test file:** `tests/integration/parse.test.ts`
- **No existing code modified** — the parser is additive and will be consumed by Sprint 3+ extractors
- **No new dependencies** — pure TypeScript/Deno, no external packages
- **No API changes** — no new MCP tools or endpoint modifications
