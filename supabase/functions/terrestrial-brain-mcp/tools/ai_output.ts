import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { validateFilePath } from "../validators.ts";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";

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
    if (depth > 10) break; // safety: prevent infinite loops from circular refs
  }
  return depth;
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

export async function handleGetPendingAIOutputMetadata(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .rpc("get_pending_ai_output_metadata");

  if (error) return { error: error.message };
  return { data: data || [] };
}

export async function handleFetchAIOutputContent(supabase: SupabaseClient, ids: string[]) {
  const { data, error } = await supabase
    .from("ai_output")
    .select("id, content")
    .in("id", ids)
    .eq("picked_up", false)
    .eq("rejected", false);

  if (error) return { error: error.message };
  return { data: data || [] };
}

export async function handleMarkAIOutputPickedUp(supabase: SupabaseClient, ids: string[]) {
  const { error } = await supabase
    .from("ai_output")
    .update({ picked_up: true, picked_up_at: new Date().toISOString() })
    .in("id", ids);

  if (error) return { error: error.message };
  return { message: `Marked ${ids.length} output${ids.length > 1 ? "s" : ""} as picked up.` };
}

export async function handleRejectAIOutput(supabase: SupabaseClient, ids: string[]) {
  const { error } = await supabase
    .from("ai_output")
    .update({ rejected: true, rejected_at: new Date().toISOString() })
    .in("id", ids);

  if (error) return { error: error.message };
  return { message: `Rejected ${ids.length} output${ids.length > 1 ? "s" : ""}.` };
}

// ---------------------------------------------------------------------------
// MCP tool registration — only AI-facing tools remain
// ---------------------------------------------------------------------------

export function register(server: McpServer, supabase: SupabaseClient, logger: FunctionCallLogger) {
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
        content: z.string().describe("Full markdown body — stored exactly as provided"),
        file_path: z.string().describe("Target vault-relative path including filename, e.g. 'projects/TerrestrialCore/PhaseTwoPlan.md'"),
        source_context: z.string().optional().describe("What prompted this output (for provenance tracking)"),
      },
    },
    withMcpLogging("create_ai_output", async ({ title, content, file_path, source_context }) => {
      try {
        const pathError = validateFilePath(file_path);
        if (pathError) {
          return {
            content: [{ type: "text" as const, text: pathError }],
            isError: true,
          };
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
          return {
            content: [{ type: "text" as const, text: `Failed to create AI output: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Created AI output "${title}" (id: ${data.id})\nWill appear at: ${file_path}` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }, logger)
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
        title: z.string().describe("Human-readable title for the output document"),
        file_path: z.string().describe(
          "Target vault-relative path including filename, e.g. 'projects/CarChief/sprint-tasks.md'",
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
    withMcpLogging("create_tasks_with_output", async ({ title, file_path, tasks, source_context }) => {
      try {
        const pathError = validateFilePath(file_path);
        if (pathError) {
          return {
            content: [{ type: "text" as const, text: pathError }],
            isError: true,
          };
        }

        if (!tasks || tasks.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "At least one task is required.",
              },
            ],
            isError: true,
          };
        }

        // Fetch project names for markdown headings
        const projectIds = [
          ...new Set(
            tasks.filter((task) => task.project_id).map((task) => task.project_id!),
          ),
        ];
        let projectNameMap: Record<string, string> = {};
        if (projectIds.length > 0) {
          const { data: projects } = await supabase
            .from("projects")
            .select("id, name")
            .in("id", projectIds);
          projectNameMap = Object.fromEntries(
            (projects || []).map((project: { id: string; name: string }) => [
              project.id,
              project.name,
            ]),
          );
        }

        // Fetch person names for markdown assignee labels
        const personIds = [
          ...new Set(
            tasks.filter((task) => task.assigned_to).map((task) => task.assigned_to!),
          ),
        ];
        let personNameMap: Record<string, string> = {};
        if (personIds.length > 0) {
          const { data: people } = await supabase
            .from("people")
            .select("id, name")
            .in("id", personIds);
          personNameMap = Object.fromEntries(
            (people || []).map((person: { id: string; name: string }) => [
              person.id,
              person.name,
            ]),
          );
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
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to create task "${task.content}": ${error.message}`,
                },
              ],
              isError: true,
            };
          }

          dbIdByIndex.set(index, data.id);
          taskIds.push(data.id);
        }

        // Generate markdown from structured task data
        const markdown = generateTaskMarkdown(title, tasks, projectNameMap, personNameMap);

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
          return {
            content: [
              {
                type: "text" as const,
                text: `Failed to create AI output (tasks rolled back): ${outputError.message}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Created ${taskIds.length} task(s) and AI output "${title}" (output id: ${outputData.id})\n` +
                `Task IDs: ${taskIds.join(", ")}\n` +
                `Will appear at: ${file_path}`,
            },
          ],
        };
      } catch (err: unknown) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${(err as Error).message}` },
          ],
          isError: true,
        };
      }
    }, logger),
  );
}
