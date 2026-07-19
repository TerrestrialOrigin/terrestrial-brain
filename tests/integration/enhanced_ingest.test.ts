import { assertEquals, assertExists } from "@std/assert";
import {
  callHTTP,
  callIngestNote,
  callTool,
  createServiceClient,
} from "../helpers/mcp-client.ts";

const supabase = createServiceClient();

// Seed project IDs (from seed.sql)
const TEST_PROJ_ID = "00000000-0000-0000-0000-000000000001";

// Delete all rows a note-based test created, keyed by its reference_id.
async function cleanupByReference(referenceId: string): Promise<void> {
  await supabase.from("thoughts").delete().eq("reference_id", referenceId);
  await supabase.from("tasks").delete().eq("reference_id", referenceId);
  await supabase.from("note_snapshots").delete().eq(
    "reference_id",
    referenceId,
  );
}

// Wrapper that gives each note/ingest test its own uniquely-named fixture and
// tears it down in `finally`, so tests are self-contained and never leak rows.
function withNoteFixture(
  name: string,
  referenceIdPrefix: string,
  run: (referenceId: string) => Promise<void>,
): void {
  Deno.test(name, async () => {
    const referenceId = `${referenceIdPrefix}-${Date.now()}.md`;
    try {
      await run(referenceId);
    } finally {
      await cleanupByReference(referenceId);
    }
  });
}

// ---------------------------------------------------------------------------
// 5.1 — ingest_note with checkboxes populates tasks table
// ---------------------------------------------------------------------------

withNoteFixture(
  "ingest_note: checkboxes create task rows",
  "test/enhanced-ingest/tasks",
  async (noteId) => {
    const noteContent = `# Sprint Tasks

- [ ] Fix the login page
- [ ] Update the API docs
- [x] Deploy to staging
`;

    const result = await callIngestNote({
      content: noteContent,
      title: "Sprint Tasks",
      note_id: noteId,
    });
    assertExists(result);

    // Verify tasks were created
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, content, status, reference_id")
      .eq("reference_id", noteId);

    assertExists(tasks);
    assertEquals(tasks.length, 3, `Expected 3 tasks, got ${tasks.length}`);

    const openTasks = tasks.filter(
      (task: { status: string }) => task.status === "open",
    );
    const doneTasks = tasks.filter(
      (task: { status: string }) => task.status === "done",
    );
    assertEquals(openTasks.length, 2, "Should have 2 open tasks");
    assertEquals(doneTasks.length, 1, "Should have 1 done task");
  },
);

// ---------------------------------------------------------------------------
// 5.2 — ingest_note thoughts have references.tasks array
// ---------------------------------------------------------------------------

withNoteFixture(
  "ingest_note: thoughts have metadata.references with tasks and projects",
  "test/enhanced-ingest/refs",
  async (noteId) => {
    const noteContent = `# Test Proj
- [ ] Fix record lookup
Some notes about the Test Proj record integration.
`;

    await callIngestNote({
      content: noteContent,
      title: "Test Proj Tasks",
      note_id: noteId,
    });

    // Verify thoughts have references
    const { data: thoughts } = await supabase
      .from("thoughts")
      .select("content, metadata")
      .eq("reference_id", noteId);

    assertExists(thoughts);
    assertEquals(thoughts.length > 0, true, "Should have at least one thought");

    for (const thought of thoughts) {
      const refs = thought.metadata?.references as
        | Record<string, unknown>
        | undefined;
      assertExists(refs, "Thought should have metadata.references");
      assertEquals(
        Array.isArray(refs.tasks),
        true,
        "references.tasks should be an array",
      );
      assertEquals(
        Array.isArray(refs.projects),
        true,
        "references.projects should be an array",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// 5.3 — ingest_note stores note content in note_snapshots
// ---------------------------------------------------------------------------

withNoteFixture(
  "ingest_note: stores note snapshot",
  "test/enhanced-ingest/snapshot",
  async (noteId) => {
    const noteContent = "A simple note for snapshot testing.";

    await callIngestNote({
      content: noteContent,
      title: "Snapshot Test",
      note_id: noteId,
    });

    // Verify snapshot exists
    const { data: snapshot } = await supabase
      .from("note_snapshots")
      .select("id, reference_id, title, content, source")
      .eq("reference_id", noteId)
      .single();

    assertExists(snapshot);
    assertEquals(snapshot.reference_id, noteId);
    assertEquals(snapshot.title, "Snapshot Test");
    assertEquals(snapshot.content, noteContent);
    assertEquals(snapshot.source, "obsidian");
  },
);

// ---------------------------------------------------------------------------
// 5.4 — ingest_note re-sync updates snapshot (not duplicated)
// ---------------------------------------------------------------------------

withNoteFixture(
  "ingest_note: re-sync updates snapshot, no duplicates",
  "test/enhanced-ingest/resync-snapshot",
  async (noteId) => {
    // First ingest
    await callIngestNote({
      content: "Version 1 of the note.",
      title: "Resync Test",
      note_id: noteId,
    });

    // Second ingest with updated content
    await callIngestNote({
      content: "Version 2 of the note with more detail.",
      title: "Resync Test Updated",
      note_id: noteId,
    });

    // Verify only one snapshot exists
    const { data: snapshots } = await supabase
      .from("note_snapshots")
      .select("id, content, title")
      .eq("reference_id", noteId);

    assertExists(snapshots);
    assertEquals(snapshots.length, 1, "Should have exactly 1 snapshot row");
    assertEquals(
      snapshots[0].content,
      "Version 2 of the note with more detail.",
    );
    assertEquals(snapshots[0].title, "Resync Test Updated");
  },
);

// ---------------------------------------------------------------------------
// 5.4b — ingest_note skips processing when content is unchanged
// ---------------------------------------------------------------------------

withNoteFixture(
  "ingest_note: unchanged content is skipped (no duplicate thoughts)",
  "test/enhanced-ingest/unchanged",
  async (noteId) => {
    const noteContent =
      "Obsidian Sync should not cause duplicate ingestion of unchanged notes.";

    // First ingest — should process normally
    const firstResult = await callIngestNote({
      content: noteContent,
      title: "Unchanged Test",
      note_id: noteId,
    });
    assertExists(firstResult);

    // Count thoughts after first ingest
    const { data: thoughtsBefore } = await supabase
      .from("thoughts")
      .select("id")
      .eq("reference_id", noteId)
      .is("archived_at", null);
    assertExists(thoughtsBefore);
    const countBefore = thoughtsBefore.length;
    assertEquals(
      countBefore > 0,
      true,
      "First ingest should create at least one thought",
    );

    // Second ingest with identical content — should be skipped
    const secondResult = await callIngestNote({
      content: noteContent,
      title: "Unchanged Test",
      note_id: noteId,
    });
    assertExists(secondResult);
    assertEquals(
      secondResult.includes("unchanged") || secondResult.includes("skipped"),
      true,
      `Expected skip message, got: ${secondResult}`,
    );

    // Count thoughts after second ingest — should be the same
    const { data: thoughtsAfter } = await supabase
      .from("thoughts")
      .select("id")
      .eq("reference_id", noteId)
      .is("archived_at", null);
    assertExists(thoughtsAfter);
    assertEquals(
      thoughtsAfter.length,
      countBefore,
      `Thought count should remain ${countBefore} after unchanged re-ingest, got ${thoughtsAfter.length}`,
    );
  },
);

withNoteFixture(
  "ingest_note: changed content is NOT skipped",
  "test/enhanced-ingest/changed",
  async (noteId) => {
    // First ingest
    await callIngestNote({
      content: "Version 1 of a note about content change detection.",
      title: "Changed Test",
      note_id: noteId,
    });

    // Second ingest with different content — should NOT be skipped
    const secondResult = await callIngestNote({
      content:
        "Version 2 of the note — completely rewritten with new information.",
      title: "Changed Test",
      note_id: noteId,
    });
    assertExists(secondResult);
    assertEquals(
      secondResult.includes("skipped"),
      false,
      `Changed content should NOT be skipped, got: ${secondResult}`,
    );
  },
);

// ---------------------------------------------------------------------------
// 5.5 — ingest_note re-sync with checkbox state change updates task status
// ---------------------------------------------------------------------------

withNoteFixture(
  "ingest_note: re-sync with checkbox state change updates task",
  "test/enhanced-ingest/task-update",
  async (noteId) => {
    // First ingest: unchecked
    await callIngestNote({
      content: "- [ ] Ship the feature\n",
      title: "Task Update",
      note_id: noteId,
    });

    // Verify task is open
    const { data: tasksBefore } = await supabase
      .from("tasks")
      .select("id, status")
      .eq("reference_id", noteId);
    assertExists(tasksBefore);
    assertEquals(tasksBefore.length, 1);
    assertEquals(tasksBefore[0].status, "open");

    // Second ingest: now checked
    await callIngestNote({
      content: "- [x] Ship the feature\n",
      title: "Task Update",
      note_id: noteId,
    });

    // Verify task is done
    const { data: tasksAfter } = await supabase
      .from("tasks")
      .select("id, status")
      .eq("reference_id", noteId);
    assertExists(tasksAfter);
    assertEquals(tasksAfter.length, 1);
    assertEquals(tasksAfter[0].status, "done");
  },
);

// ---------------------------------------------------------------------------
// 5.6 — capture_thought with checkboxes creates tasks
// ---------------------------------------------------------------------------

Deno.test("capture_thought: content with checkbox creates task", async () => {
  try {
    const result = await callTool("capture_thought", {
      content: "Reminder for later:\n- [ ] Review the pull request\n",
    });
    assertExists(result);

    // The task should exist — find by content
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, content, status, reference_id")
      .eq("content", "Review the pull request");

    assertExists(tasks);
    assertEquals(
      tasks.length >= 1,
      true,
      "Task should be created from capture_thought checkbox",
    );
  } finally {
    // Tasks from capture_thought have null reference_id — clean up by content.
    await supabase.from("tasks").delete().eq(
      "content",
      "Review the pull request",
    );
  }
});

// Note: getProjectRefs backward-compatibility unit tests moved to
// tests/unit/get-project-refs.test.ts (pure unit, no DB) as part of the
// dual-format simplification (fix-plan Step 28).

// ---------------------------------------------------------------------------
// 5.8 — ingest_note thoughts have note_snapshot_id set
// ---------------------------------------------------------------------------

withNoteFixture(
  "ingest_note: thoughts have note_snapshot_id set",
  "test/enhanced-ingest/snapshot-link",
  async (noteId) => {
    await callIngestNote({
      content: "A thought about linking snapshots.",
      title: "Snapshot Link",
      note_id: noteId,
    });

    // Get the snapshot ID
    const { data: snapshot } = await supabase
      .from("note_snapshots")
      .select("id")
      .eq("reference_id", noteId)
      .single();
    assertExists(snapshot);

    // Verify thoughts reference the snapshot
    const { data: thoughts } = await supabase
      .from("thoughts")
      .select("id, note_snapshot_id")
      .eq("reference_id", noteId);

    assertExists(thoughts);
    assertEquals(thoughts.length > 0, true, "Should have at least one thought");
    for (const thought of thoughts) {
      assertEquals(
        thought.note_snapshot_id,
        snapshot.id,
        "Thought should reference the note snapshot",
      );
    }
  },
);

// ---------------------------------------------------------------------------
// 7.1 — Option 4 round-trip: create_tasks_with_output → ingest → no duplicates
// ---------------------------------------------------------------------------

withNoteFixture(
  "option4: create_tasks_with_output creates tasks and ai_output",
  "test/option4/sprint-tasks",
  async (filePath) => {
    const result = await callTool("create_tasks_with_output", {
      title: "Test Proj Sprint Plan",
      file_path: filePath,
      tasks: [
        {
          content: "Implement record lookup caching",
          project_id: TEST_PROJ_ID,
          status: "open",
        },
        {
          content: "Write integration tests for caching",
          project_id: TEST_PROJ_ID,
          status: "open",
        },
        {
          content: "Deploy to staging",
          project_id: TEST_PROJ_ID,
          status: "open",
        },
      ],
      source_context: "Option 4 integration test",
    });

    assertExists(result);
    assertEquals(
      result.includes("3 task(s)"),
      true,
      "Should report 3 tasks created",
    );
    assertEquals(
      result.includes("Test Proj Sprint Plan"),
      true,
      "Should include title",
    );
    assertEquals(result.includes(filePath), true, "Should include file_path");

    // Verify tasks were created with correct reference_id
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, content, status, reference_id, project_id")
      .eq("reference_id", filePath)
      .order("created_at", { ascending: true });

    assertExists(tasks);
    assertEquals(tasks.length, 3, "Should have 3 tasks in DB");
    assertEquals(tasks[0].content, "Implement record lookup caching");
    assertEquals(tasks[0].reference_id, filePath);
    assertEquals(tasks[0].project_id, TEST_PROJ_ID);
    assertEquals(tasks[0].status, "open");
  },
);

withNoteFixture(
  "option4: round-trip — ingest of delivered content creates no duplicate tasks",
  "test/option4/round-trip",
  async (filePath) => {
    // Self-contained: create this test's own tasks + ai_output, then round-trip.
    await callTool("create_tasks_with_output", {
      title: "Test Proj Sprint Plan",
      file_path: filePath,
      tasks: [
        {
          content: "Implement record lookup caching",
          project_id: TEST_PROJ_ID,
          status: "open",
        },
        {
          content: "Write integration tests for caching",
          project_id: TEST_PROJ_ID,
          status: "open",
        },
        {
          content: "Deploy to staging",
          project_id: TEST_PROJ_ID,
          status: "open",
        },
      ],
      source_context: "Option 4 round-trip integration test",
    });

    const { data: existingTasks } = await supabase
      .from("tasks")
      .select("id, content, reference_id")
      .eq("reference_id", filePath)
      .order("created_at", { ascending: true });

    assertExists(existingTasks);
    assertEquals(
      existingTasks.length >= 3,
      true,
      "Pre-created tasks should exist",
    );

    const taskCountBefore = existingTasks.length;

    // Get the ai_output content (the markdown that would be delivered to vault)
    const pendingResult = await callHTTP("get-pending-ai-output");
    const outputs = pendingResult.data as {
      file_path: string;
      content: string;
      id: string;
    }[];
    const matchingOutput = outputs.find(
      (output) => output.file_path === filePath,
    );
    assertExists(matchingOutput, "AI output should exist for this file_path");

    // Simulate what happens after plugin delivery: ingest_note with the same content and path
    const ingestResult = await callIngestNote({
      content: matchingOutput.content,
      title: "Test Proj Sprint Plan",
      note_id: filePath,
    });
    assertExists(ingestResult);

    // Verify NO duplicate tasks were created
    const { data: tasksAfter } = await supabase
      .from("tasks")
      .select("id, content, reference_id")
      .eq("reference_id", filePath);

    assertExists(tasksAfter);
    assertEquals(
      tasksAfter.length,
      taskCountBefore,
      `Task count should remain ${taskCountBefore} (no duplicates), got ${tasksAfter.length}`,
    );

    // Verify thoughts reference the pre-existing task IDs
    const { data: thoughts } = await supabase
      .from("thoughts")
      .select("metadata")
      .eq("reference_id", filePath);

    assertExists(thoughts);
    assertEquals(thoughts.length > 0, true, "Ingest should create thoughts");

    const taskRefs =
      (thoughts[0].metadata?.references as Record<string, unknown>)?.tasks;
    assertEquals(
      Array.isArray(taskRefs),
      true,
      "Thoughts should have references.tasks array",
    );

    // The task IDs in references should match the pre-existing tasks
    const preExistingIds = new Set(
      existingTasks.map((task: { id: string }) => task.id),
    );
    for (const refId of (taskRefs as string[])) {
      assertEquals(
        preExistingIds.has(refId),
        true,
        `Referenced task ID ${refId} should be a pre-existing task`,
      );
    }

    // Clean up ai_output
    await callHTTP("mark-ai-output-picked-up", { ids: [matchingOutput.id] });
  },
);

withNoteFixture(
  "option4: create_tasks_with_output with subtask hierarchy",
  "test/option4/subtasks",
  async (filePath) => {
    const result = await callTool("create_tasks_with_output", {
      title: "Subtask Test",
      file_path: filePath,
      tasks: [
        { content: "Parent task", status: "open" },
        { content: "Child task A", parent_index: 0, status: "open" },
        { content: "Child task B", parent_index: 0, status: "open" },
        { content: "Grandchild task", parent_index: 1, status: "open" },
      ],
    });

    assertExists(result);
    assertEquals(result.includes("4 task(s)"), true);

    // Verify hierarchy
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, content, parent_id, reference_id")
      .eq("reference_id", filePath)
      .order("created_at", { ascending: true });

    assertExists(tasks);
    assertEquals(tasks.length, 4);

    // Parent task has no parent_id
    assertEquals(tasks[0].parent_id, null);
    // Children reference parent
    assertEquals(tasks[1].parent_id, tasks[0].id);
    assertEquals(tasks[2].parent_id, tasks[0].id);
    // Grandchild references child A
    assertEquals(tasks[3].parent_id, tasks[1].id);

    // Clean up ai_output
    const pendingCleanup = await callHTTP("get-pending-ai-output");
    const pendingOutputs = pendingCleanup.data as {
      id: string;
      file_path: string;
    }[];
    const subtaskOutput = pendingOutputs.find(
      (output) => output.file_path === filePath,
    );
    if (subtaskOutput) {
      await callHTTP("mark-ai-output-picked-up", { ids: [subtaskOutput.id] });
    }
  },
);

withNoteFixture(
  "option4: create_tasks_with_output with done tasks",
  "test/option4/done-tasks",
  async (filePath) => {
    const result = await callTool("create_tasks_with_output", {
      title: "Mixed Status Tasks",
      file_path: filePath,
      tasks: [
        { content: "Open task", status: "open" },
        { content: "Completed task", status: "done" },
      ],
    });

    assertExists(result);
    assertEquals(result.includes("2 task(s)"), true);

    // Verify statuses
    const { data: tasks } = await supabase
      .from("tasks")
      .select("id, content, status, archived_at")
      .eq("reference_id", filePath)
      .order("created_at", { ascending: true });

    assertExists(tasks);
    assertEquals(tasks[0].status, "open");
    assertEquals(tasks[0].archived_at, null);
    assertEquals(tasks[1].status, "done");
    assertExists(tasks[1].archived_at, "Done task should have archived_at set");

    // Verify markdown contains correct checkboxes
    const pendingResult = await callHTTP("get-pending-ai-output");
    const pendingOutputs = pendingResult.data as {
      id: string;
      file_path: string;
      content: string;
    }[];
    const output = pendingOutputs.find(
      (pendingOutput) => pendingOutput.file_path === filePath,
    );
    assertExists(output);
    assertEquals(
      output.content.includes("- [ ] Open task"),
      true,
      "Should have unchecked checkbox",
    );
    assertEquals(
      output.content.includes("- [x] Completed task"),
      true,
      "Should have checked checkbox",
    );

    // Clean up
    await callHTTP("mark-ai-output-picked-up", { ids: [output.id] });
  },
);

Deno.test("option4: create_tasks_with_output with empty tasks returns error", async () => {
  try {
    await callTool("create_tasks_with_output", {
      title: "Empty Test",
      file_path: "test/option4/empty.md",
      tasks: [],
    });
    // Should have thrown
    assertEquals(true, false, "Should have thrown an error for empty tasks");
  } catch (error) {
    assertEquals(
      (error as Error).message.includes("At least one task is required"),
      true,
      "Error should mention empty tasks",
    );
  }
});
