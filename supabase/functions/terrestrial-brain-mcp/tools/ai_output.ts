import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { uuidField } from "../zod-schemas.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import { validateFilePath } from "../validators.ts";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import { resolveNames } from "../repositories/name-resolution.ts";
import { TASK_STATUSES } from "../enums.ts";
import type { AiOutputRepository } from "../repositories/ai-output-repository.ts";
import type { TaskRepository } from "../repositories/task-repository.ts";

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
// create_tasks_with_output helpers
// ---------------------------------------------------------------------------

/**
 * Resolve project and person UUIDs referenced by the tasks to display names via
 * the shared batched resolver (raw-id fallback on error, never a silently-empty
 * map — finding C9). Used for the generated markdown headings/assignee suffixes.
 */
async function resolveTaskNames(
  supabase: SupabaseClient,
  tasks: TaskInput[],
): Promise<{
  projectNameMap: Record<string, string>;
  personNameMap: Record<string, string>;
}> {
  const projectIds = [
    ...new Set(
      tasks.filter((task) => task.project_id).map((task) => task.project_id!),
    ),
  ];
  const projectNameMap: Record<string, string> = projectIds.length > 0
    ? Object.fromEntries(await resolveNames(supabase, "projects", projectIds))
    : {};

  const personIds = [
    ...new Set(
      tasks.filter((task) => task.assigned_to).map((task) => task.assigned_to!),
    ),
  ];
  const personNameMap: Record<string, string> = personIds.length > 0
    ? Object.fromEntries(await resolveNames(supabase, "people", personIds))
    : {};

  return { projectNameMap, personNameMap };
}

/**
 * Delete the task rows already inserted in a failed `create_tasks_with_output`
 * call and report the outcome truthfully. Returns a note to append to the error
 * message: a clean "Rolled back N …" when the compensating delete succeeds, or
 * a WARNING naming the possibly-orphaned ids when the delete itself fails — it
 * NEVER claims a rollback on a failed delete. Empty ids → empty note. Shared by
 * both rollback sites (mid-loop insert failure and post-task ai_output failure)
 * so their wording cannot drift (finding TOOL-3, Rule of Three).
 */
export async function rollbackInsertedTasks(
  taskRepository: TaskRepository,
  taskIds: string[],
): Promise<string> {
  if (taskIds.length === 0) return "";
  const { error: rollbackError } = await taskRepository.deleteByIds(taskIds);
  return rollbackError
    ? ` WARNING: rollback of ${taskIds.length} already-inserted task(s) failed (${rollbackError.message}); these rows may be orphaned: ${
      taskIds.join(", ")
    }.`
    : ` Rolled back ${taskIds.length} already-inserted task(s).`;
}

/**
 * Insert task rows sequentially (so a subtask's parent_index resolves to the
 * already-inserted parent's DB id). On any insert failure, roll back the rows
 * already inserted in THIS call so a mid-loop failure never leaves orphans
 * (all-or-nothing, finding C4). Returns the inserted ids or a ready-to-return
 * error string. Assumes `validateParentIndices` has already passed.
 */
export async function insertTasksAtomically(
  taskRepository: TaskRepository,
  tasks: TaskInput[],
  filePath: string,
): Promise<{ taskIds: string[] } | { error: string }> {
  const taskIds: string[] = [];
  const dbIdByIndex = new Map<number, string>();

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const status = task.status || "open";

    let parentId: string | null = null;
    if (task.parent_index !== undefined && task.parent_index !== null) {
      parentId = dbIdByIndex.get(task.parent_index) || null;
    }

    const insertValues = {
      content: task.content,
      status,
      reference_id: filePath,
      project_id: task.project_id || null,
      parent_id: parentId,
      due_by: task.due_by || null,
      assigned_to: task.assigned_to || null,
      ...(status === "done" ? { archived_at: new Date().toISOString() } : {}),
    };

    const { data, error } = await taskRepository.insert(insertValues);

    if (error || !data) {
      const rollbackNote = await rollbackInsertedTasks(taskRepository, taskIds);
      return {
        error: `Failed to create task "${task.content}": ${
          error?.message || "unknown"
        }.${rollbackNote}`,
      };
    }

    dbIdByIndex.set(index, data.id);
    taskIds.push(data.id);
  }

  return { taskIds };
}

// ---------------------------------------------------------------------------
// Standalone handler functions — used by HTTP route handlers in index.ts
// ---------------------------------------------------------------------------

export async function handleGetPendingAIOutput(
  aiOutputRepository: AiOutputRepository,
) {
  const { data, error } = await aiOutputRepository.listPending();
  if (error) return { error: error.message };
  return { data: data || [] };
}

export async function handleGetPendingAIOutputMetadata(
  aiOutputRepository: AiOutputRepository,
) {
  const { data, error } = await aiOutputRepository.listPendingMetadata();
  if (error) return { error: error.message };
  return { data: data || [] };
}

export async function handleFetchAIOutputContent(
  aiOutputRepository: AiOutputRepository,
  ids: string[],
) {
  const { data, error } = await aiOutputRepository.findContentByIds(ids);
  if (error) return { error: error.message };
  return { data: data || [] };
}

export async function handleMarkAIOutputPickedUp(
  aiOutputRepository: AiOutputRepository,
  ids: string[],
): Promise<{ error: string } | { message: string }> {
  const { error } = await aiOutputRepository.markPickedUp(ids);
  if (error) return { error: error.message };
  return {
    message: `Marked ${ids.length} output${
      ids.length > 1 ? "s" : ""
    } as picked up.`,
  };
}

export async function handleRejectAIOutput(
  aiOutputRepository: AiOutputRepository,
  ids: string[],
): Promise<{ error: string } | { message: string }> {
  const { error } = await aiOutputRepository.reject(ids);
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
  aiOutputRepository: AiOutputRepository,
  taskRepository: TaskRepository,
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

        const { data, error } = await aiOutputRepository.insert({
          title,
          content,
          file_path,
          source_context: source_context || null,
        });

        if (error || !data) {
          return errorResult(
            `Failed to create AI output: ${error?.message || "unknown"}`,
          );
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
              project_id: uuidField()
                .optional()
                .describe("UUID of the project this task belongs to"),
              parent_index: z
                .number()
                .optional()
                .describe(
                  "Index (0-based) of the parent task in this array for subtask hierarchy",
                ),
              status: z
                .enum(TASK_STATUSES)
                .optional()
                .default("open")
                .describe("Status: open, in_progress, done, deferred"),
              due_by: z
                .string()
                .optional()
                .describe("Due date as ISO 8601 string"),
              assigned_to: uuidField()
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

        const typedTasks = tasks as TaskInput[];

        // Validate parent_index references up front — reject forward/self/
        // out-of-range/non-integer parents BEFORE inserting anything, so bad
        // hierarchy fails loudly instead of silently flattening (finding C4).
        const parentError = validateParentIndices(typedTasks);
        if (parentError) {
          return errorResult(parentError);
        }

        // Idempotency (runs-twice / crashes-halfway / interleaves), finding
        // TOOL-3:
        //  - Runs twice? An at-least-once client retry re-issues this call
        //    after the tasks were inserted but before the response arrived. We
        //    refuse when tasks already exist for this file_path, so the retry
        //    cannot double-insert a second set of rows.
        //  - Crashes halfway? insertTasksAtomically rolls back a partial task
        //    insert; a crash after the tasks but before the ai_output insert
        //    leaves the tasks discoverable here by reference_id, so the retry
        //    refuses rather than doubling.
        //  - Interleaves? Two truly-simultaneous first calls for the same
        //    file_path remain a narrow window (there is no DB unique constraint
        //    on tasks.reference_id); accepted, because this human-triggered,
        //    non-proactive tool is not invoked concurrently for one path.
        const { data: existingForPath, error: existingError } =
          await taskRepository.findByReference(file_path);
        if (existingError) {
          return errorResult(
            `Failed to check for existing tasks at "${file_path}": ${existingError.message}`,
          );
        }
        if (existingForPath && existingForPath.length > 0) {
          return errorResult(
            `Tasks for this file_path already exist (${existingForPath.length} task(s) with reference_id "${file_path}"). ` +
              `This looks like a retry — delete the existing tasks first or use a different file_path.`,
          );
        }

        // Resolve display names, then insert the task rows atomically.
        const { projectNameMap, personNameMap } = await resolveTaskNames(
          supabase,
          typedTasks,
        );

        const insertResult = await insertTasksAtomically(
          taskRepository,
          typedTasks,
          file_path,
        );
        if ("error" in insertResult) {
          return errorResult(insertResult.error);
        }
        const { taskIds } = insertResult;

        // Generate markdown from structured task data
        const markdown = generateTaskMarkdown(
          title,
          tasks,
          projectNameMap,
          personNameMap,
        );

        // Create ai_output row
        const { data: outputData, error: outputError } =
          await aiOutputRepository
            .insert({
              title,
              content: markdown,
              file_path,
              source_context: source_context || null,
            });

        if (outputError || !outputData) {
          // Roll back the inserted task rows and report the outcome truthfully
          // — a failed rollback is a WARNING with the orphaned ids, never a
          // false "rolled back" claim (finding TOOL-3).
          const rollbackNote = await rollbackInsertedTasks(
            taskRepository,
            taskIds,
          );
          return errorResult(
            `Failed to create AI output: ${
              outputError?.message || "unknown"
            }.${rollbackNote}`,
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
