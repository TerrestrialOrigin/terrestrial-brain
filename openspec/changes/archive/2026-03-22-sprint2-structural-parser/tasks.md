## 1. Types & Module Scaffold

- [x] 1.1 Create `supabase/functions/terrestrial-brain-mcp/parser.ts` with TypeScript interfaces: `ParsedNote`, `ParsedCheckbox`, `ParsedHeading` as defined in SyncChanges.md Sprint 2.3
- [x] 1.2 Export a stub `parseNote(content, title, referenceId, source): ParsedNote` function that returns an empty ParsedNote

## 2. Heading Parser

- [x] 2.1 Implement `parseHeadings(lines: string[]): ParsedHeading[]` — regex matching `^(#{1,6})\s+(.+)$`, collecting text, level, and lineStart for each heading
- [x] 2.2 Implement heading line range computation — each heading's `lineEnd` is the line before the next heading of same or higher level (lower or equal `level` number), or the last line of the file

## 3. Checkbox Parser

- [x] 3.1 Implement fenced code block detection — track toggle state for lines starting with ``` or ~~~, return a `Set<number>` of line numbers inside code blocks
- [x] 3.2 Implement `parseCheckboxes(lines: string[], codeBlockLines: Set<number>, headings: ParsedHeading[]): ParsedCheckbox[]` — regex matching `^\s*- \[([ xX])\] (.+)$`, skipping code block lines, extracting text, checked state, lineNumber, and depth from indentation
- [x] 3.3 Implement indentation depth calculation — tabs count as 1 level each, groups of 2+ consecutive spaces count as 1 level each
- [x] 3.4 Implement parent detection — for each checkbox at depth N, find the nearest preceding checkbox at depth N-1 and set `parentIndex`
- [x] 3.5 Implement section heading association — for each checkbox, set `sectionHeading` to the text of the nearest preceding heading

## 4. Compose parseNote

- [x] 4.1 Wire up `parseNote()` to call heading parser, code block detector, and checkbox parser in sequence, returning the complete `ParsedNote`

## 5. Testing & Verification

- [x] 5.1 Create `tests/integration/parse.test.ts` with Deno test infrastructure
- [x] 5.2 Test basic checkbox parsing: unchecked `- [ ]`, checked `- [x]` and `- [X]`, correct text extraction
- [x] 5.3 Test indentation depth: tab-indented, space-indented (2 and 4 spaces), multi-level nesting
- [x] 5.4 Test parent detection: parent-child relationships, siblings sharing a parent, 3+ level deep nesting
- [x] 5.5 Test heading parsing: H1-H6 levels, correct line ranges, heading extends to next same-or-higher-level heading or EOF
- [x] 5.6 Test code block awareness: checkboxes and headings inside ``` and ~~~ fenced blocks are ignored, elements after code blocks parse normally
- [x] 5.7 Test section heading association: checkbox under heading gets correct `sectionHeading`, checkbox with no preceding heading gets null
- [x] 5.8 Test mixed content: note with headings, checkboxes, prose, and code blocks produces correct combined ParsedNote
- [x] 5.9 Test edge cases: empty content, malformed checkboxes (no text, no space in brackets), deeply nested checkboxes (5+ levels), heading with no text
- [x] 5.10 Run full test suite across all packages (obsidian-plugin, integration tests) to verify no regressions
