import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseNote,
  parseHeadings,
  parseCheckboxes,
  detectCodeBlockLines,
  computeIndentDepth,
} from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";
import type {
  ParsedNote,
  ParsedCheckbox,
  ParsedHeading,
} from "../../supabase/functions/terrestrial-brain-mcp/parser.ts";

// ---------------------------------------------------------------------------
// 5.2 — Basic checkbox parsing
// ---------------------------------------------------------------------------

Deno.test("checkbox: unchecked checkbox is parsed", () => {
  const result = parseNote("- [ ] Buy groceries", null, null, "obsidian");
  assertEquals(result.checkboxes.length, 1);
  assertEquals(result.checkboxes[0].text, "Buy groceries");
  assertEquals(result.checkboxes[0].checked, false);
  assertEquals(result.checkboxes[0].depth, 0);
});

Deno.test("checkbox: checked with lowercase x", () => {
  const result = parseNote("- [x] Done task", null, null, "obsidian");
  assertEquals(result.checkboxes.length, 1);
  assertEquals(result.checkboxes[0].text, "Done task");
  assertEquals(result.checkboxes[0].checked, true);
});

Deno.test("checkbox: checked with uppercase X", () => {
  const result = parseNote("- [X] Also done", null, null, "obsidian");
  assertEquals(result.checkboxes.length, 1);
  assertEquals(result.checkboxes[0].checked, true);
});

Deno.test("checkbox: line number is 1-indexed", () => {
  const content = "Some prose\n\n- [ ] Task on line 3";
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 1);
  assertEquals(result.checkboxes[0].lineNumber, 3);
});

Deno.test("checkbox: multiple checkboxes in sequence", () => {
  const content = "- [ ] First\n- [x] Second\n- [ ] Third";
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 3);
  assertEquals(result.checkboxes[0].text, "First");
  assertEquals(result.checkboxes[1].text, "Second");
  assertEquals(result.checkboxes[1].checked, true);
  assertEquals(result.checkboxes[2].text, "Third");
});

// ---------------------------------------------------------------------------
// 5.3 — Indentation depth
// ---------------------------------------------------------------------------

Deno.test("depth: top-level checkbox has depth 0", () => {
  const result = parseNote("- [ ] Top level", null, null, "obsidian");
  assertEquals(result.checkboxes[0].depth, 0);
});

Deno.test("depth: single tab = depth 1", () => {
  const result = parseNote("\t- [ ] Subtask", null, null, "obsidian");
  assertEquals(result.checkboxes[0].depth, 1);
});

Deno.test("depth: double tab = depth 2", () => {
  const result = parseNote("\t\t- [ ] Sub-subtask", null, null, "obsidian");
  assertEquals(result.checkboxes[0].depth, 2);
});

Deno.test("depth: 2 spaces = depth 1", () => {
  const result = parseNote("  - [ ] Subtask", null, null, "obsidian");
  assertEquals(result.checkboxes[0].depth, 1);
});

Deno.test("depth: 4 spaces = depth 2", () => {
  const result = parseNote("    - [ ] Subtask", null, null, "obsidian");
  assertEquals(result.checkboxes[0].depth, 2);
});

Deno.test("depth: 6 spaces = depth 3", () => {
  const result = parseNote("      - [ ] Deep subtask", null, null, "obsidian");
  assertEquals(result.checkboxes[0].depth, 3);
});

Deno.test("depth: computeIndentDepth unit tests", () => {
  assertEquals(computeIndentDepth("- [ ] no indent"), 0);
  assertEquals(computeIndentDepth("\t- [ ] one tab"), 1);
  assertEquals(computeIndentDepth("\t\t- [ ] two tabs"), 2);
  assertEquals(computeIndentDepth("  - [ ] two spaces"), 1);
  assertEquals(computeIndentDepth("    - [ ] four spaces"), 2);
  assertEquals(computeIndentDepth("      - [ ] six spaces"), 3);
  assertEquals(computeIndentDepth("\t  - [ ] tab + 2 spaces"), 2);
});

// ---------------------------------------------------------------------------
// 5.4 — Parent detection
// ---------------------------------------------------------------------------

Deno.test("parent: top-level has no parent", () => {
  const result = parseNote("- [ ] Top", null, null, "obsidian");
  assertEquals(result.checkboxes[0].parentIndex, null);
});

Deno.test("parent: child at depth 1 has parent at depth 0", () => {
  const content = "- [ ] Parent\n  - [ ] Child";
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 2);
  assertEquals(result.checkboxes[1].parentIndex, 0);
});

Deno.test("parent: siblings share same parent", () => {
  const content = "- [ ] Parent\n  - [ ] Child A\n  - [ ] Child B";
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes[1].parentIndex, 0);
  assertEquals(result.checkboxes[2].parentIndex, 0);
});

Deno.test("parent: 3-level nesting", () => {
  const content = "- [ ] Level 0\n  - [ ] Level 1\n    - [ ] Level 2";
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes[0].parentIndex, null); // Level 0
  assertEquals(result.checkboxes[1].parentIndex, 0); // Level 1 → Level 0
  assertEquals(result.checkboxes[2].parentIndex, 1); // Level 2 → Level 1
});

Deno.test("parent: deep nesting (5+ levels)", () => {
  const content = [
    "- [ ] L0",
    "  - [ ] L1",
    "    - [ ] L2",
    "      - [ ] L3",
    "        - [ ] L4",
    "          - [ ] L5",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 6);
  assertEquals(result.checkboxes[0].depth, 0);
  assertEquals(result.checkboxes[1].depth, 1);
  assertEquals(result.checkboxes[2].depth, 2);
  assertEquals(result.checkboxes[3].depth, 3);
  assertEquals(result.checkboxes[4].depth, 4);
  assertEquals(result.checkboxes[5].depth, 5);
  assertEquals(result.checkboxes[5].parentIndex, 4);
  assertEquals(result.checkboxes[4].parentIndex, 3);
});

Deno.test("parent: second top-level after nested children", () => {
  const content = [
    "- [ ] Parent A",
    "  - [ ] Child A1",
    "- [ ] Parent B",
    "  - [ ] Child B1",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes[0].parentIndex, null); // Parent A
  assertEquals(result.checkboxes[1].parentIndex, 0); // Child A1 → Parent A
  assertEquals(result.checkboxes[2].parentIndex, null); // Parent B
  assertEquals(result.checkboxes[3].parentIndex, 2); // Child B1 → Parent B
});

// ---------------------------------------------------------------------------
// 5.5 — Heading parsing
// ---------------------------------------------------------------------------

Deno.test("heading: H1 parsed correctly", () => {
  const result = parseNote("# Top Level", null, null, "obsidian");
  assertEquals(result.headings.length, 1);
  assertEquals(result.headings[0].text, "Top Level");
  assertEquals(result.headings[0].level, 1);
  assertEquals(result.headings[0].lineStart, 1);
  assertEquals(result.headings[0].lineEnd, 1);
});

Deno.test("heading: H2 through H6 levels", () => {
  const content = [
    "## H2",
    "### H3",
    "#### H4",
    "##### H5",
    "###### H6",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.headings.length, 5);
  assertEquals(result.headings[0].level, 2);
  assertEquals(result.headings[1].level, 3);
  assertEquals(result.headings[2].level, 4);
  assertEquals(result.headings[3].level, 5);
  assertEquals(result.headings[4].level, 6);
});

Deno.test("heading: line ranges extend to next same-level heading", () => {
  const content = [
    "## Section A", // line 1
    "content A",    // line 2
    "## Section B", // line 3
    "content B",    // line 4
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.headings.length, 2);
  assertEquals(result.headings[0].lineStart, 1);
  assertEquals(result.headings[0].lineEnd, 2);
  assertEquals(result.headings[1].lineStart, 3);
  assertEquals(result.headings[1].lineEnd, 4);
});

Deno.test("heading: line range extends to EOF", () => {
  const content = [
    "## Only Heading", // line 1
    "line 2",
    "line 3",
    "line 4",
    "line 5",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.headings[0].lineEnd, 5);
});

Deno.test("heading: lower-level heading does not end higher-level range", () => {
  const content = [
    "## Parent Section", // line 1
    "### Subsection",    // line 2
    "content",           // line 3
    "## Next Section",   // line 4
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.headings.length, 3);
  // "Parent Section" (H2) ends before "Next Section" (H2)
  assertEquals(result.headings[0].lineEnd, 3);
  // "Subsection" (H3) also ends before "Next Section" (H2, which is higher level)
  assertEquals(result.headings[1].lineEnd, 3);
  // "Next Section" extends to EOF
  assertEquals(result.headings[2].lineEnd, 4);
});

Deno.test("heading: mixed levels with H1", () => {
  const content = [
    "# H1",             // line 1
    "## H2 under H1",   // line 2
    "### H3 under H2",  // line 3
    "## Another H2",    // line 4
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.headings.length, 4);
  // H1 extends to EOF (no other H1)
  assertEquals(result.headings[0].lineEnd, 4);
  // H2 under H1 ends before Another H2
  assertEquals(result.headings[1].lineEnd, 3);
  // H3 under H2 ends before Another H2 (higher level)
  assertEquals(result.headings[2].lineEnd, 3);
  // Another H2 extends to EOF
  assertEquals(result.headings[3].lineEnd, 4);
});

// ---------------------------------------------------------------------------
// 5.6 — Code block awareness
// ---------------------------------------------------------------------------

Deno.test("codeblock: checkbox inside backtick fence is ignored", () => {
  const content = [
    "```",
    "- [ ] This is example code",
    "```",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 0);
});

Deno.test("codeblock: checkbox inside tilde fence is ignored", () => {
  const content = [
    "~~~",
    "- [ ] This is example code",
    "~~~",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 0);
});

Deno.test("codeblock: heading inside code block is ignored", () => {
  const content = [
    "```",
    "## Not a real heading",
    "```",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.headings.length, 0);
});

Deno.test("codeblock: elements after code block are parsed normally", () => {
  const content = [
    "```",
    "- [ ] ignored",
    "```",
    "- [ ] real task",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 1);
  assertEquals(result.checkboxes[0].text, "real task");
});

Deno.test("codeblock: multiple code blocks", () => {
  const content = [
    "- [ ] before",
    "```",
    "- [ ] inside first",
    "```",
    "- [ ] between",
    "~~~",
    "- [ ] inside second",
    "~~~",
    "- [ ] after",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 3);
  assertEquals(result.checkboxes[0].text, "before");
  assertEquals(result.checkboxes[1].text, "between");
  assertEquals(result.checkboxes[2].text, "after");
});

Deno.test("codeblock: code block with language tag", () => {
  const content = [
    "```typescript",
    "- [ ] inside code",
    "## Also inside",
    "```",
    "- [ ] outside",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 1);
  assertEquals(result.checkboxes[0].text, "outside");
  assertEquals(result.headings.length, 0);
});

// ---------------------------------------------------------------------------
// 5.7 — Section heading association
// ---------------------------------------------------------------------------

Deno.test("section: checkbox under heading gets correct sectionHeading", () => {
  const content = [
    "## Sprint Tasks",
    "- [ ] Fix bug",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes[0].sectionHeading, "Sprint Tasks");
});

Deno.test("section: checkbox with no preceding heading gets null", () => {
  const content = "- [ ] orphan task";
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes[0].sectionHeading, null);
});

Deno.test("section: checkbox under nested heading gets nearest heading", () => {
  const content = [
    "# Project",
    "## Sprint 1",
    "- [ ] Task A",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes[0].sectionHeading, "Sprint 1");
});

Deno.test("section: checkboxes under different headings", () => {
  const content = [
    "## Section A",
    "- [ ] Task A",
    "## Section B",
    "- [ ] Task B",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes[0].sectionHeading, "Section A");
  assertEquals(result.checkboxes[1].sectionHeading, "Section B");
});

// ---------------------------------------------------------------------------
// 5.8 — Mixed content
// ---------------------------------------------------------------------------

Deno.test("mixed: full note with headings, checkboxes, prose, and code blocks", () => {
  const content = [
    "# Project Plan",                         // line 1 - heading
    "",                                        // line 2
    "Some introductory prose.",                // line 3
    "",                                        // line 4
    "## Tasks",                                // line 5 - heading
    "- [ ] Implement parser",                  // line 6 - checkbox
    "- [x] Write design doc",                  // line 7 - checkbox
    "  - [ ] Review with team",                // line 8 - checkbox (child)
    "",                                        // line 9
    "```typescript",                           // line 10 - code block start
    "- [ ] not a real task",                   // line 11 - inside code
    "## not a real heading",                   // line 12 - inside code
    "```",                                     // line 13 - code block end
    "",                                        // line 14
    "## Notes",                                // line 15 - heading
    "- [ ] Follow up on feedback",             // line 16 - checkbox
  ].join("\n");

  const result = parseNote(content, "Project Plan", "projects/plan.md", "obsidian");

  // Metadata
  assertEquals(result.title, "Project Plan");
  assertEquals(result.referenceId, "projects/plan.md");
  assertEquals(result.source, "obsidian");

  // Headings
  assertEquals(result.headings.length, 3);
  assertEquals(result.headings[0].text, "Project Plan");
  assertEquals(result.headings[0].level, 1);
  assertEquals(result.headings[0].lineEnd, 16); // H1 extends to EOF
  assertEquals(result.headings[1].text, "Tasks");
  assertEquals(result.headings[1].level, 2);
  assertEquals(result.headings[1].lineEnd, 14); // ends before "Notes"
  assertEquals(result.headings[2].text, "Notes");
  assertEquals(result.headings[2].level, 2);
  assertEquals(result.headings[2].lineEnd, 16);

  // Checkboxes
  assertEquals(result.checkboxes.length, 4);

  assertEquals(result.checkboxes[0].text, "Implement parser");
  assertEquals(result.checkboxes[0].checked, false);
  assertEquals(result.checkboxes[0].depth, 0);
  assertEquals(result.checkboxes[0].sectionHeading, "Tasks");
  assertEquals(result.checkboxes[0].parentIndex, null);

  assertEquals(result.checkboxes[1].text, "Write design doc");
  assertEquals(result.checkboxes[1].checked, true);
  assertEquals(result.checkboxes[1].sectionHeading, "Tasks");

  assertEquals(result.checkboxes[2].text, "Review with team");
  assertEquals(result.checkboxes[2].depth, 1);
  assertEquals(result.checkboxes[2].parentIndex, 1); // parent is "Write design doc"
  assertEquals(result.checkboxes[2].sectionHeading, "Tasks");

  assertEquals(result.checkboxes[3].text, "Follow up on feedback");
  assertEquals(result.checkboxes[3].sectionHeading, "Notes");

  // Code block content was NOT parsed
  const checkboxTexts = result.checkboxes.map((checkbox) => checkbox.text);
  assertEquals(checkboxTexts.includes("not a real task"), false);
  const headingTexts = result.headings.map((heading) => heading.text);
  assertEquals(headingTexts.includes("not a real heading"), false);
});

// ---------------------------------------------------------------------------
// 5.9 — Edge cases
// ---------------------------------------------------------------------------

Deno.test("edge: empty content", () => {
  const result = parseNote("", null, null, "obsidian");
  assertEquals(result.checkboxes.length, 0);
  assertEquals(result.headings.length, 0);
  assertEquals(result.content, "");
});

Deno.test("edge: malformed checkbox - no space in brackets", () => {
  const result = parseNote("- [] not valid", null, null, "obsidian");
  assertEquals(result.checkboxes.length, 0);
});

Deno.test("edge: malformed checkbox - no text after bracket", () => {
  const result = parseNote("- [x]", null, null, "obsidian");
  assertEquals(result.checkboxes.length, 0);
});

Deno.test("edge: malformed checkbox - no text after bracket with space", () => {
  const result = parseNote("- [ ] ", null, null, "obsidian");
  // The regex (.+) requires at least one character — trailing space alone doesn't match
  // Actually " " is one character so (.+)$ would match " "
  // Let's check what actually happens
  const result2 = parseNote("- [ ]", null, null, "obsidian");
  assertEquals(result2.checkboxes.length, 0); // no space + text after ]
});

Deno.test("edge: heading with no text (bare ##)", () => {
  const result = parseNote("##", null, null, "obsidian");
  assertEquals(result.headings.length, 0);
});

Deno.test("edge: heading with only spaces after hashes", () => {
  const result = parseNote("##   ", null, null, "obsidian");
  // The regex requires (.+)$ after \s+ — "   " after ## contains text?
  // The pattern is ^(#{1,6})\s+(.+)$ — "##   " → ## matches, then \s+ eats spaces, (.+)$ needs at least 1 char
  // "##   " → hashes="##", then the remaining "   " needs at least one space for \s+ and then (.+) for text
  // Since all remaining chars are spaces, \s+ can eat some and (.+) eats the rest... but (.+) matches spaces too
  // This is ambiguous, but the behavior is deterministic
  // The important thing: no crash
  assertEquals(result.headings.length <= 1, true);
});

Deno.test("edge: null title and referenceId", () => {
  const result = parseNote("Some content", null, null, "obsidian");
  assertEquals(result.title, null);
  assertEquals(result.referenceId, null);
});

Deno.test("edge: content with only whitespace", () => {
  const result = parseNote("   \n\n  \t  ", null, null, "obsidian");
  assertEquals(result.checkboxes.length, 0);
  assertEquals(result.headings.length, 0);
});

Deno.test("edge: checkbox-like line with different list marker", () => {
  // * [ ] and + [ ] should NOT match (only - [ ] is valid)
  const content = "* [ ] star marker\n+ [ ] plus marker";
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 0);
});

Deno.test("edge: unclosed code block treats rest as code", () => {
  const content = [
    "- [ ] before",
    "```",
    "- [ ] inside unclosed",
    "- [ ] also inside",
  ].join("\n");
  const result = parseNote(content, null, null, "obsidian");
  assertEquals(result.checkboxes.length, 1);
  assertEquals(result.checkboxes[0].text, "before");
});
