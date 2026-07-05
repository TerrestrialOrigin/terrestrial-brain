import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { validateFilePath } from "../validators.ts";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";

// ---------------------------------------------------------------------------
// Task input type for create_tasks_with_output
// ---------------------------------------------------------------------------

interface TaskInput {
  content: string;
  project_id?: string;
  parent_index?: number;
  status?: string;
  due_by?: string;
  assigned_to?: string;
}

// ---------------------------------------------------------------------------
// Markdown generation helpers
// ---------------------------------------------------------------------------

/**
 * Defensive upper bound on how deep the parent chain is followed when computing
 * a task's nesting depth. `validateParentIndices` already guarantees a strictly
 * decreasing, acyclic parent chain for the `create_tasks_with_output` path, so
 * this bound is belt-and-suspenders — it protects `generateTaskMarkdown`, which
 * is exported and unit-tested directly and can therefore be called with data
 * that never went through validation.
 */
const MAX_TASK_DEPTH = 50;

/**
 * Computes nesting depth for a task by following the parent_index chain.
 * Returns 0 for top-level tasks.
 */
function computeTaskDepth(index: number, tasks: TaskInput[]): number {
  let depth = 0;
  let current = index;
  while (
    tasks[current].parent_index !== undefined &&
    tasks[current].parent_index !== null
  ) {
    depth++;
    current = tasks[current].parent_index!;
    if (depth > MAX_TASK_DEPTH) break; // safety: bound runaway/unvalidated chains
  }
  return depth;
}

/**
 * Validates that every task's `parent_index`, when present, references an
 * EARLIER task in the array (an integer in the range [0, index)). Because a
 * valid parent index is strictly less than the task's own index, the parent
 * chain is strictly decreasing — forward references, self references, and
 * cycles are all impossible by construction, so subtask hierarchy is never
 * silently dropped during insertion.
 *
 * Returns a human-readable error string for the first violation, or null when
 * every `parent_index` is valid.
 */
export function validateParentIndices(tasks: TaskInput[]): string | null {
  for (let index = 0; index < tasks.length; index++) {
    const parentIndex = tasks[index].parent_index;
    if (parentIndex === undefined || parentIndex === null) continue;

    if (!Number.isInteger(parentIndex)) {
      return `Task at index ${index} has a non-integer parent_index (${parentIndex}). ` +
        `parent_index must be the integer array index of an earlier task.`;
    }
    if (parentIndex < 0) {
      return `Task at index ${index} has a negative parent_index (${parentIndex}). ` +
        `parent_index must reference an earlier task (0-based index).`;
    }
    if (parentIndex === index) {
      return `Task at index ${index} references itself as its own parent. ` +
        `parent_index must reference an EARLIER task.`;
    }
    if (parentIndex > index) {
      return `Task at index ${index} has a forward parent_index (${parentIndex}); ` +
        `a parent must appear BEFORE its child in the tasks array. ` +
        `Reorder the tasks so each parent precedes its children.`;
    }
    if (parentIndex >= tasks.length) {
      return `Task at index ${index} has an out-of-range parent_index (${parentIndex}); ` +
        `only ${tasks.length} task(s) were provided.`;
    }
  }
  return null;
}

/**
 * Generates a markdown document with checkboxes from structured task data.
 * Groups top-level tasks under project headings when project names are known.
 */
export function generateTaskMarkdown(
  title: string,
  tasks: TaskInput[],
  projectNameMap: Record<string, string>,
  personNameMap?: Record<string, string>,
): string {
  const lines: string[] = [`# ${title}`, ""];

  let currentProjectId: string | null | undefined = undefined; // sentinel: undefined = not yet set

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const depth = computeTaskDepth(index, tasks);

    // Add project heading when the project changes (only for top-level tasks)
    if (depth === 0) {
      const projectId = task.project_id || null;
      if (projectId !== currentProjectId) {
        currentProjectId = projectId;
        if (projectId && projectNameMap[projectId]) {
          if (index > 0) lines.push(""); // blank line before new section
          lines.push(`## ${projectNameMap[projectId]}`, "");
        }
      }
    }

    const indent = "  ".repeat(depth);
    const checkbox = task.status === "done" ? "[x]" : "[ ]";
    const assigneeSuffix = task.assigned_to && personNameMap?.[task.assigned_to]
      ? ` @${personNameMap[task.assigned_to]}`
      : "";
    lines.push(`${indent}- ${checkbox} ${task.content}${assigneeSuffix}`);
  }

  lines.push("");
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Standalone handler functions — used by HTTP route handlers in index.ts
// ---------------------------------------------------------------------------

export async function handleGetPendingAIOutput(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("ai_output")
    .select("id, title, content, file_path, created_at")
    .eq("picked_up", false)
    .eq("rejected", false)
    .order("created_at", { ascending: true });

  if (error) return { error: error.message };
  return { data: data || [] };
}

export async function handleGetPendingAIOutputMetadata(
  supabase: SupabaseClient,
) {
  const { data, error } = await supabase
    .rpc("get_pending_ai_output_metadata");

  if (error) return { error: error.message };
  return { data: data || [] };
}

export async function handleFetchAIOutputContent(
  supabase: SupabaseClient,
  ids: string[],
) {
  const { data, error } = await supabase
    .from("ai_output")
    .select("id, content")
    .in("id", ids)
    .eq("picked_up", false)
    .eq("rejected", false);

  if (error) return { error: error.message };
  return { data: data || [] };
}

export async function handleMarkAIOutputPickedUp(
  supabase: SupabaseClient,
  ids: string[],
) {
  const { error } = await supabase
    .from("ai_output")
    .update({ picked_up: true, picked_up_at: new Date().toISOString() })
    .in("id", ids);

  if (error) return { error: error.message };
  return {
    message: `Marked ${ids.length} output${
      ids.length > 1 ? "s" : ""
    } as picked up.`,
  };
}

export async function handleRejectAIOutput(
  supabase: SupabaseClient,
  ids: string[],
) {
  const { error } = await supabase
    .from("ai_output")
    .update({ rejected: true, rejected_at: new Date().toISOString() })
    .in("id", ids);

  if (error) return { error: error.message };
  return {
    message: `Rejected ${ids.length} output${ids.length > 1 ? "s" : ""}.`,
  };
}

// ---------------------------------------------------------------------------
// MCP tool registration — only AI-facing tools remain
// ---------------------------------------------------------------------------

export function register(
  server: McpServer,
  supabase: SupabaseClient,
  logger: FunctionCallLogger,
) {
  server.registerTool(
    "create_ai_output",
    {
      title: "Create AI Output",
      description:
        "Create a markdown document delivered to the user's Obsidian vault. " +
        "IMPORTANT: Only call this when the user has explicitly asked you to create, write up, or save a document — do NOT call proactively or as a side effect of answering a question. " +
        "Every document delivered here gets ingested into the knowledge base via ingest_note, so unnecessary calls create duplicate thoughts. " +
        "If the document should not be ingested as thoughts, include a #tbExclude tag in the content. " +
        "For task lists specifically, prefer create_tasks_with_output — it creates both structured task rows and a checklist document.",
      inputSchema: {
        title: z.string().describe("Human-readable title for this output"),
        content: z.string().describe(
          "Full markdown body — stored exactly as provided",
        ),
        file_path: z.string().describe(
          "Target vault-relative path including filename, e.g. 'projects/TerrestrialCore/PhaseTwoPlan.md'",
        ),
        source_context: z.string().optional().describe(
          "What prompted this output (for provenance tracking)",
        ),
      },
    },
    withMcpLogging(
      "create_ai_output",
      async ({ title, content, file_path, source_context }) => {
        const pathError = validateFilePath(file_path);
        if (pathError) {
          return errorResult(pathError);
        }

        const { data, error } = await supabase
          .from("ai_output")
          .insert({
            title,
            content,
            file_path,
            source_context: source_context || null,
          })
          .select("id")
          .single();

        if (error) {
          return errorResult(`Failed to create AI output: ${error.message}`);
        }

        return textResult(
          `Created AI output "${title}" (id: ${data.id})\nWill appear at: ${file_path}`,
        );
      },
      logger,
    ),
  );

  server.registerTool(
    "create_tasks_with_output",
    {
      title: "Create Tasks with AI Output",
      description:
        "Create multiple tasks at once AND generate a markdown checklist document delivered to the user's Obsidian vault. " +
        "IMPORTANT: Only call this when the user has explicitly asked you to create tasks or a task document — do NOT call proactively. " +
        "The delivered markdown gets ingested into the knowledge base via ingest_note; while task checkboxes use reference_id deduplication, " +
        "prose content surrounding the task list can generate unwanted thoughts. " +
        "This is the preferred way to create task lists — it writes structured task rows (queryable, filterable, trackable) " +
        "AND a human-readable markdown document with checkboxes (visible in Obsidian). " +
        "Tasks are tagged with reference_id = file_path so re-ingesting the delivered document won't create duplicates. " +
        "Supports subtask hierarchy via parent_index, person assignment via assigned_to, and project linking via project_id. " +
        "Assigned person names appear as @Name suffixes in the generated markdown.",
      inputSchema: {
        title: z.string().describe(
          "Human-readable title for the output document",
        ),
        file_path: z.string().describe(
          "Target vault-relative path including filename, e.g. 'projects/Test Proj/sprint-tasks.md'",
        ),
        tasks: z
          .array(
            z.object({
              content: z.string().describe("Task description"),
              project_id: z
                .string()
                .optional()
                .describe("UUID of the project this task belongs to"),
              parent_index: z
                .number()
                .optional()
                .describe(
                  "Index (0-based) of the parent task in this array for subtask hierarchy",
                ),
              status: z
                .string()
                .optional()
                .default("open")
                .describe("Status: open, in_progress, done, deferred"),
              due_by: z
                .string()
                .optional()
                .describe("Due date as ISO 8601 string"),
              assigned_to: z
                .string()
                .optional()
                .describe("UUID of the person this task is assigned to"),
            }),
          )
          .describe("Array of tasks to create (at least one required)"),
        source_context: z
          .string()
          .optional()
          .describe("What prompted this output (for provenance tracking)"),
      },
    },
    withMcpLogging(
      "create_tasks_with_output",
      async ({ title, file_path, tasks, source_context }) => {
        const pathError = validateFilePath(file_path);
        if (pathError) {
          return errorResult(pathError);
        }

        if (!tasks || tasks.length === 0) {
          return errorResult("At least one task is required.");
        }

        // Fetch project names for markdown headings
        const typedTasks = tasks as TaskInput[];

        // Validate parent_index references up front — reject forward/self/
        // out-of-range/non-integer parents BEFORE inserting anything, so bad
        // hierarchy fails loudly instead of silently flattening (finding C4).
        const parentError = validateParentIndices(typedTasks);
        if (parentError) {
          return errorResult(parentError);
        }
        const projectIds = [
          ...new Set(
            typedTasks.filter((task) => task.project_id).map((task) =>
              task.project_id!
            ),
          ),
        ];
        let projectNameMap: Record<string, string> = {};
        if (projectIds.length > 0) {
          const { data: projects, error: projectsError } = await supabase
            .from("projects")
            .select("id, name")
            .in("id", projectIds);
          // Log + raw-id fallback on error, never a silently-empty map (finding C9).
          if (projectsError) {
            console.error(
              `create_tasks_with_output project-name lookup failed: ${projectsError.message}`,
            );
            projectNameMap = Object.fromEntries(
              projectIds.map((pid) => [pid, pid]),
            );
          } else {
            projectNameMap = Object.fromEntries(
              (projects || []).map((project: { id: string; name: string }) => [
                project.id,
                project.name,
              ]),
            );
          }
        }

        // Fetch person names for markdown assignee labels
        const personIds = [
          ...new Set(
            typedTasks.filter((task) => task.assigned_to).map((task) =>
              task.assigned_to!
            ),
          ),
        ];
        let personNameMap: Record<string, string> = {};
        if (personIds.length > 0) {
          const { data: people, error: peopleError } = await supabase
            .from("people")
            .select("id, name")
            .in("id", personIds);
          if (peopleError) {
            console.error(
              `create_tasks_with_output assignee lookup failed: ${peopleError.message}`,
            );
            personNameMap = Object.fromEntries(
              personIds.map((pid) => [pid, pid]),
            );
          } else {
            personNameMap = Object.fromEntries(
              (people || []).map((person: { id: string; name: string }) => [
                person.id,
                person.name,
              ]),
            );
          }
        }

        // Insert task rows sequentially (parent_index → parent_id resolution)
        const taskIds: string[] = [];
        const dbIdByIndex = new Map<number, string>();

        for (let index = 0; index < tasks.length; index++) {
          const task = tasks[index];
          const status = task.status || "open";

          let parentId: string | null = null;
          if (task.parent_index !== undefined && task.parent_index !== null) {
            parentId = dbIdByIndex.get(task.parent_index) || null;
          }

          const insertData: Record<string, unknown> = {
            content: task.content,
            status,
            reference_id: file_path,
            project_id: task.project_id || null,
            parent_id: parentId,
            due_by: task.due_by || null,
            assigned_to: task.assigned_to || null,
          };

          if (status === "done") {
            insertData.archived_at = new Date().toISOString();
          }

          const { data, error } = await supabase
            .from("tasks")
            .insert(insertData)
            .select("id")
            .single();

          if (error) {
            // Roll back the tasks already inserted in this call so a mid-loop
            // failure never leaves orphaned rows (all-or-nothing, finding C4).
            let rollbackNote = "";
            if (taskIds.length > 0) {
              const { error: rollbackError } = await supabase
                .from("tasks")
                .delete()
                .in("id", taskIds);
              rollbackNote = rollbackError
                ? ` WARNING: rollback of ${taskIds.length} already-inserted task(s) failed (${rollbackError.message}); these rows may be orphaned: ${
                  taskIds.join(", ")
                }.`
                : ` Rolled back ${taskIds.length} already-inserted task(s).`;
            }
            return errorResult(
              `Failed to create task "${task.content}": ${error.message}.${rollbackNote}`,
            );
          }

          dbIdByIndex.set(index, data.id);
          taskIds.push(data.id);
        }

        // Generate markdown from structured task data
        const markdown = generateTaskMarkdown(
          title,
          tasks,
          projectNameMap,
          personNameMap,
        );

        // Create ai_output row
        const { data: outputData, error: outputError } = await supabase
          .from("ai_output")
          .insert({
            title,
            content: markdown,
            file_path,
            source_context: source_context || null,
          })
          .select("id")
          .single();

        if (outputError) {
          // Roll back orphaned task rows
          if (taskIds.length > 0) {
            await supabase.from("tasks").delete().in("id", taskIds);
          }
          return errorResult(
            `Failed to create AI output (tasks rolled back): ${outputError.message}`,
          );
        }

        return textResult(
          `Created ${taskIds.length} task(s) and AI output "${title}" (output id: ${outputData.id})\n` +
            `Task IDs: ${taskIds.join(", ")}\n` +
            `Will appear at: ${file_path}`,
        );
      },
      logger,
    ),
  );
}
