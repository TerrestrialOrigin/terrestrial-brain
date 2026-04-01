import {
  assertEquals,
  assertExists,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createClient } from "@supabase/supabase-js";
import { getProjectRefs } from "../../supabase/functions/terrestrial-brain-mcp/helpers.ts";

// ---------------------------------------------------------------------------
// Supabase client + MCP tool caller
// ---------------------------------------------------------------------------

const SUPABASE_URL = "http://localhost:54321";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const BASE =
  "http://localhost:54321/functions/v1/terrestrial-brain-mcp?key=dev-test-key-123";

async function callTool(
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const text = await res.text();
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    if (parsed.result?.isError)
      throw new Error(parsed.result.content?.[0]?.text || "Tool error");
    return parsed.result?.content?.[0]?.text || "";
  }
  const parsed = JSON.parse(text);
  if (parsed.result?.isError)
    throw new Error(parsed.result.content?.[0]?.text || "Tool error");
  return parsed.result?.content?.[0]?.text || "";
}

const INGEST_URL =
  "http://localhost:54321/functions/v1/terrestrial-brain-mcp/ingest-note?key=dev-test-key-123";

async function callIngestNote(args: {
  content: string;
  title?: string;
  note_id?: string;
}): Promise<string> {
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const body = await res.json();
  if (!body.success) throw new Error(body.error || "Ingest failed");
  return body.message || "";
}

// Seed project IDs (from seed.sql)
const CARCHIEF_ID = "00000000-0000-0000-0000-000000000001";

// Track entities for cleanup
const testNoteIds: string[] = [];
const testTaskReferenceIds: string[] = [];

// ---------------------------------------------------------------------------
// 5.1 — ingest_note with checkboxes populates tasks table
// ---------------------------------------------------------------------------

Deno.test("ingest_note: checkboxes create task rows", async () => {
  const noteId = `test/enhanced-ingest/tasks-${Date.now()}.md`;
  testNoteIds.push(noteId);
  testTaskReferenceIds.push(noteId);

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
});

// ---------------------------------------------------------------------------
// 5.2 — ingest_note thoughts have references.tasks array
// ---------------------------------------------------------------------------

Deno.test("ingest_note: thoughts have metadata.references with tasks and projects", async () => {
  const noteId = `test/enhanced-ingest/refs-${Date.now()}.md`;
  testNoteIds.push(noteId);
  testTaskReferenceIds.push(noteId);

  const noteContent = `# CarChief
- [ ] Fix dealer lookup
Some notes about the CarChief dealer integration.
`;

  await callIngestNote({
    content: noteContent,
    title: "CarChief Tasks",
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
});

// ---------------------------------------------------------------------------
// 5.3 — ingest_note stores note content in note_snapshots
// ---------------------------------------------------------------------------

Deno.test("ingest_note: stores note snapshot", async () => {
  const noteId = `test/enhanced-ingest/snapshot-${Date.now()}.md`;
  testNoteIds.push(noteId);

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
});

// ---------------------------------------------------------------------------
// 5.4 — ingest_note re-sync updates snapshot (not duplicated)
// ---------------------------------------------------------------------------

Deno.test("ingest_note: re-sync updates snapshot, no duplicates", async () => {
  const noteId = `test/enhanced-ingest/resync-snapshot-${Date.now()}.md`;
  testNoteIds.push(noteId);

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
});

// ---------------------------------------------------------------------------
// 5.5 — ingest_note re-sync with checkbox state change updates task status
// ---------------------------------------------------------------------------

Deno.test("ingest_note: re-sync with checkbox state change updates task", async () => {
  const noteId = `test/enhanced-ingest/task-update-${Date.now()}.md`;
  testNoteIds.push(noteId);
  testTaskReferenceIds.push(noteId);

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
});

// ---------------------------------------------------------------------------
// 5.6 — capture_thought with checkboxes creates tasks
// ---------------------------------------------------------------------------

Deno.test("capture_thought: content with checkbox creates task", async () => {
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
  assertEquals(tasks.length >= 1, true, "Task should be created from capture_thought checkbox");

  // Track for cleanup — tasks from capture_thought have null reference_id
  // We'll clean up by content match
});

// ---------------------------------------------------------------------------
// 5.7 — getProjectRefs backwards compatibility
// ---------------------------------------------------------------------------

Deno.test("getProjectRefs: reads new format (projects array)", () => {
  const metadata = { references: { projects: ["uuid-1", "uuid-2"], tasks: ["uuid-3"] } };
  const result = getProjectRefs(metadata);
  assertEquals(result, ["uuid-1", "uuid-2"]);
});

Deno.test("getProjectRefs: reads old format (project_id string)", () => {
  const metadata = { references: { project_id: "old-uuid" } };
  const result = getProjectRefs(metadata);
  assertEquals(result, ["old-uuid"]);
});

Deno.test("getProjectRefs: returns empty for no references", () => {
  assertEquals(getProjectRefs({}), []);
  assertEquals(getProjectRefs({ references: {} }), []);
  assertEquals(getProjectRefs({ something: "else" }), []);
});

// ---------------------------------------------------------------------------
// 5.8 — ingest_note thoughts have note_snapshot_id set
// ---------------------------------------------------------------------------

Deno.test("ingest_note: thoughts have note_snapshot_id set", async () => {
  const noteId = `test/enhanced-ingest/snapshot-link-${Date.now()}.md`;
  testNoteIds.push(noteId);

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
});

// ---------------------------------------------------------------------------
// 7.1 — Option 4 round-trip: create_tasks_with_output → ingest → no duplicates
// ---------------------------------------------------------------------------

Deno.test("option4: create_tasks_with_output creates tasks and ai_output", async () => {
  const filePath = `test/option4/sprint-tasks-${Date.now()}.md`;
  testNoteIds.push(filePath);
  testTaskReferenceIds.push(filePath);

  const result = await callTool("create_tasks_with_output", {
    title: "CarChief Sprint Plan",
    file_path: filePath,
    tasks: [
      { content: "Implement dealer lookup caching", project_id: CARCHIEF_ID, status: "open" },
      { content: "Write integration tests for caching", project_id: CARCHIEF_ID, status: "open" },
      { content: "Deploy to staging", project_id: CARCHIEF_ID, status: "open" },
    ],
    source_context: "Option 4 integration test",
  });

  assertExists(result);
  assertEquals(result.includes("3 task(s)"), true, "Should report 3 tasks created");
  assertEquals(result.includes("CarChief Sprint Plan"), true, "Should include title");
  assertEquals(result.includes(filePath), true, "Should include file_path");

  // Verify tasks were created with correct reference_id
  const { data: tasks } = await supabase
    .from("tasks")
    .select("id, content, status, reference_id, project_id")
    .eq("reference_id", filePath)
    .order("created_at", { ascending: true });

  assertExists(tasks);
  assertEquals(tasks.length, 3, "Should have 3 tasks in DB");
  assertEquals(tasks[0].content, "Implement dealer lookup caching");
  assertEquals(tasks[0].reference_id, filePath);
  assertEquals(tasks[0].project_id, CARCHIEF_ID);
  assertEquals(tasks[0].status, "open");
});

Deno.test("option4: round-trip — ingest of delivered content creates no duplicate tasks", async () => {
  // Find the file_path from the previous test (most recent option4 test)
  const { data: existingTasks } = await supabase
    .from("tasks")
    .select("id, content, reference_id")
    .like("reference_id", "test/option4/sprint-tasks-%")
    .order("created_at", { ascending: true });

  assertExists(existingTasks);
  assertEquals(existingTasks.length >= 3, true, "Pre-created tasks should exist");

  const filePath = existingTasks[0].reference_id!;
  const taskCountBefore = existingTasks.filter(
    (task: { reference_id: string | null }) => task.reference_id === filePath,
  ).length;

  // Get the ai_output content (the markdown that would be delivered to vault)
  const pending = await callTool("get_pending_ai_output", {});
  const outputs = JSON.parse(pending);
  const matchingOutput = outputs.find(
    (output: { file_path: string }) => output.file_path === filePath,
  );
  assertExists(matchingOutput, "AI output should exist for this file_path");

  // Simulate what happens after plugin delivery: ingest_note with the same content and path
  const ingestResult = await callIngestNote({
    content: matchingOutput.content,
    title: "CarChief Sprint Plan",
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

  const taskRefs = (thoughts[0].metadata?.references as Record<string, unknown>)?.tasks;
  assertEquals(Array.isArray(taskRefs), true, "Thoughts should have references.tasks array");

  // The task IDs in references should match the pre-existing tasks
  const preExistingIds = new Set(existingTasks.map((task: { id: string }) => task.id));
  for (const refId of (taskRefs as string[])) {
    assertEquals(
      preExistingIds.has(refId),
      true,
      `Referenced task ID ${refId} should be a pre-existing task`,
    );
  }

  // Clean up ai_output
  await callTool("mark_ai_output_picked_up", { ids: [matchingOutput.id] });
});

Deno.test("option4: create_tasks_with_output with subtask hierarchy", async () => {
  const filePath = `test/option4/subtasks-${Date.now()}.md`;
  testNoteIds.push(filePath);
  testTaskReferenceIds.push(filePath);

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
  const pendingResult = await callTool("get_pending_ai_output", {});
  const pendingOutputs = JSON.parse(pendingResult);
  const subtaskOutput = pendingOutputs.find(
    (output: { file_path: string }) => output.file_path === filePath,
  );
  if (subtaskOutput) {
    await callTool("mark_ai_output_picked_up", { ids: [subtaskOutput.id] });
  }
});

Deno.test("option4: create_tasks_with_output with done tasks", async () => {
  const filePath = `test/option4/done-tasks-${Date.now()}.md`;
  testNoteIds.push(filePath);
  testTaskReferenceIds.push(filePath);

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
  const pendingResult = await callTool("get_pending_ai_output", {});
  const pendingOutputs = JSON.parse(pendingResult);
  const output = pendingOutputs.find(
    (o: { file_path: string }) => o.file_path === filePath,
  );
  assertExists(output);
  assertEquals(output.content.includes("- [ ] Open task"), true, "Should have unchecked checkbox");
  assertEquals(output.content.includes("- [x] Completed task"), true, "Should have checked checkbox");

  // Clean up
  await callTool("mark_ai_output_picked_up", { ids: [output.id] });
});

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

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

Deno.test("cleanup: remove test thoughts", async () => {
  for (const noteId of testNoteIds) {
    await supabase.from("thoughts").delete().eq("reference_id", noteId);
  }
  assertEquals(true, true);
});

Deno.test("cleanup: remove test tasks", async () => {
  for (const referenceId of testTaskReferenceIds) {
    await supabase.from("tasks").delete().eq("reference_id", referenceId);
  }
  // Also clean up capture_thought tasks
  await supabase.from("tasks").delete().eq("content", "Review the pull request");
  assertEquals(true, true);
});

Deno.test("cleanup: remove test snapshots", async () => {
  for (const noteId of testNoteIds) {
    await supabase.from("note_snapshots").delete().eq("reference_id", noteId);
  }
  assertEquals(true, true);
});
