import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------
// Task input type for create_tasks_with_output
// ---------------------------------------------------------------------------

interface TaskInput {
  content: string;
  project_id?: string;
  parent_index?: number;
  status?: string;
  due_by?: string;
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
    lines.push(`${indent}- ${checkbox} ${task.content}`);
  }

  lines.push("");
  return lines.join("\n");
}

export function register(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "create_ai_output",
    {
      title: "Create AI Output",
      description:
        "Create a markdown document that will be automatically delivered to the user's Obsidian vault at the specified file path. " +
        "Use this whenever the user asks you to write something up, create a document, draft a proposal, or produce any structured output they'll want to reference later. " +
        "The content is stored exactly as provided and will be ingested as thoughts when delivered, so it becomes searchable in the knowledge base. " +
        "For task lists specifically, prefer create_tasks_with_output — it creates both structured task rows and a checklist document.",
      inputSchema: {
        title: z.string().describe("Human-readable title for this output"),
        content: z.string().describe("Full markdown body — stored exactly as provided"),
        file_path: z.string().describe("Target vault-relative path including filename, e.g. 'projects/TerrestrialCore/PhaseTwoPlan.md'"),
        source_context: z.string().optional().describe("What prompted this output (for provenance tracking)"),
      },
    },
    async ({ title, content, file_path, source_context }) => {
      try {
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
    }
  );

  server.registerTool(
    "get_pending_ai_output",
    {
      title: "Get Pending AI Output",
      description:
        "Returns all AI output that hasn't been delivered to the Obsidian vault yet, as a JSON array. " +
        "This is primarily used by the Obsidian plugin's polling loop. " +
        "AI clients generally do not need to call this — use create_ai_output or create_tasks_with_output to produce content, and the plugin handles delivery.",
      inputSchema: {},
    },
    async () => {
      try {
        const { data, error } = await supabase
          .from("ai_output")
          .select("id, title, content, file_path, created_at")
          .eq("picked_up", false)
          .eq("rejected", false)
          .order("created_at", { ascending: true });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(data || []) }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "mark_ai_output_picked_up",
    {
      title: "Mark AI Output Picked Up",
      description:
        "Mark AI output entries as delivered after the Obsidian plugin has written them to the vault. " +
        "This is an internal tool used by the Obsidian plugin — AI clients should not call this directly.",
      inputSchema: {
        ids: z.array(z.string()).describe("Array of AI output UUIDs to mark as picked up"),
      },
    },
    async ({ ids }) => {
      try {
        const { error } = await supabase
          .from("ai_output")
          .update({ picked_up: true, picked_up_at: new Date().toISOString() })
          .in("id", ids);

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to mark picked up: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Marked ${ids.length} output${ids.length > 1 ? "s" : ""} as picked up.` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "reject_ai_output",
    {
      title: "Reject AI Output",
      description:
        "Mark AI output entries as rejected by the user. Rejected outputs are excluded from future pending polls but preserved for audit. " +
        "This is an internal tool used by the Obsidian plugin when the user clicks 'Reject All' in the confirmation dialog — AI clients should not call this directly.",
      inputSchema: {
        ids: z.array(z.string()).describe("Array of AI output UUIDs to reject"),
      },
    },
    async ({ ids }) => {
      try {
        const { error } = await supabase
          .from("ai_output")
          .update({ rejected: true, rejected_at: new Date().toISOString() })
          .in("id", ids);

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to reject: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Rejected ${ids.length} output${ids.length > 1 ? "s" : ""}.` }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "create_tasks_with_output",
    {
      title: "Create Tasks with AI Output",
      description:
        "Create multiple tasks at once AND generate a markdown checklist document delivered to the user's Obsidian vault. " +
        "This is the preferred way to create task lists — it writes structured task rows (queryable, filterable, trackable) " +
        "AND a human-readable markdown document with checkboxes (visible in Obsidian). " +
        "Tasks are tagged with reference_id = file_path so re-ingesting the delivered document won't create duplicates. " +
        "Supports subtask hierarchy via parent_index. Always link tasks to a project_id when one exists.",
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
            }),
          )
          .describe("Array of tasks to create (at least one required)"),
        source_context: z
          .string()
          .optional()
          .describe("What prompted this output (for provenance tracking)"),
      },
    },
    async ({ title, file_path, tasks, source_context }) => {
      try {
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
        const markdown = generateTaskMarkdown(title, tasks, projectNameMap);

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
          return {
            content: [
              {
                type: "text" as const,
                text: `Tasks created but failed to create AI output: ${outputError.message}`,
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
    },
  );
}
