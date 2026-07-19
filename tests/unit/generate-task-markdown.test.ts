// Pure-function coverage for generateTaskMarkdown. Moved from
// tests/integration/ai_output.test.ts (TEST-14): these never touch the running
// stack, so they belong in the unit tier.

import { assertEquals } from "@std/assert";
import { generateTaskMarkdown } from "../../supabase/functions/terrestrial-brain-mcp/tools/ai_output.ts";

Deno.test("generateTaskMarkdown: basic tasks produce correct checkbox markdown", () => {
  const markdown = generateTaskMarkdown(
    "Sprint Tasks",
    [
      { content: "Fix login page", status: "open" },
      { content: "Update docs", status: "open" },
      { content: "Deploy staging", status: "done" },
    ],
    {},
  );

  assertEquals(markdown.includes("# Sprint Tasks"), true);
  assertEquals(markdown.includes("- [ ] Fix login page"), true);
  assertEquals(markdown.includes("- [ ] Update docs"), true);
  assertEquals(markdown.includes("- [x] Deploy staging"), true);
});

Deno.test("generateTaskMarkdown: project headings when project names available", () => {
  const projectNameMap = {
    "proj-1": "Test Proj",
    "proj-2": "Terrestrial Brain",
  };
  const markdown = generateTaskMarkdown(
    "Multi-Project Tasks",
    [
      { content: "Task for Test Proj", project_id: "proj-1", status: "open" },
      { content: "Task for TB", project_id: "proj-2", status: "open" },
    ],
    projectNameMap,
  );

  assertEquals(
    markdown.includes("## Test Proj"),
    true,
    "Should have Test Proj heading",
  );
  assertEquals(
    markdown.includes("## Terrestrial Brain"),
    true,
    "Should have TB heading",
  );
  assertEquals(markdown.includes("- [ ] Task for Test Proj"), true);
  assertEquals(markdown.includes("- [ ] Task for TB"), true);
});

Deno.test("generateTaskMarkdown: subtask indentation", () => {
  const markdown = generateTaskMarkdown(
    "Hierarchy Test",
    [
      { content: "Parent", status: "open" },
      { content: "Child", parent_index: 0, status: "open" },
      { content: "Grandchild", parent_index: 1, status: "open" },
    ],
    {},
  );

  assertEquals(markdown.includes("- [ ] Parent"), true);
  assertEquals(markdown.includes("  - [ ] Child"), true);
  assertEquals(markdown.includes("    - [ ] Grandchild"), true);
});

Deno.test("generateTaskMarkdown: single task produces valid markdown", () => {
  const markdown = generateTaskMarkdown(
    "Single Task",
    [{ content: "The only task", status: "open" }],
    {},
  );

  assertEquals(markdown.includes("# Single Task"), true);
  assertEquals(markdown.includes("- [ ] The only task"), true);
});

Deno.test("generateTaskMarkdown: tasks without project_id have no project heading", () => {
  const markdown = generateTaskMarkdown(
    "No Project",
    [
      { content: "Orphan task 1", status: "open" },
      { content: "Orphan task 2", status: "done" },
    ],
    {},
  );

  assertEquals(markdown.includes("##"), false, "Should have no H2 headings");
  assertEquals(markdown.includes("- [ ] Orphan task 1"), true);
  assertEquals(markdown.includes("- [x] Orphan task 2"), true);
});
