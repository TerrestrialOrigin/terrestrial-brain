import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { uuidField } from "../zod-schemas.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import { hashContent } from "../helpers.ts";
import { resolveNames } from "../repositories/name-resolution.ts";
import { PROJECT_TYPES } from "../enums.ts";
import type { ProjectRepository } from "../repositories/project-repository.ts";
import type { TaskRepository } from "../repositories/task-repository.ts";

export function register(
  server: McpServer,
  supabase: SupabaseClient,
  logger: FunctionCallLogger,
  projectRepository: ProjectRepository,
  taskRepository: TaskRepository,
) {
  server.registerTool(
    "create_project",
    {
      title: "Create Project",
      description:
        "Create a new project. Projects group related thoughts and tasks, and store context about the work " +
        "(client name, purpose, location, key contacts) in the description and type fields. " +
        "When creating a project, populate the description with any known context — this helps other AIs understand the project without searching through thoughts. " +
        "Use type to categorize: 'client' for client work, 'personal' for personal projects, 'research' for research/learning, 'internal' for internal tooling.",
      inputSchema: {
        name: z.string().describe("Project name"),
        type: z.enum(PROJECT_TYPES).optional().describe(
          "Project type: client, personal, research, internal",
        ),
        parent_id: uuidField().optional().describe(
          "UUID of parent project for nesting",
        ),
        description: z.string().optional().describe(
          "Project description — include client name, purpose, location, key contacts, or any context that helps understand this project at a glance",
        ),
      },
    },
    withMcpLogging(
      "create_project",
      async ({ name, type, parent_id, description }) => {
        const { data, error } = await projectRepository.insert({
          name,
          type: type || null,
          parent_id: parent_id || null,
          description: description || null,
        });

        if (error || !data) {
          return errorResult(
            `Failed to create project: ${error?.message || "unknown"}`,
          );
        }

        return textResult(`Created project "${data.name}" (id: ${data.id})`);
      },
      logger,
    ),
  );

  server.registerTool(
    "list_projects",
    {
      title: "List Projects",
      description:
        "List all projects with optional filters by type, parent, or archive status. " +
        "Use this to find a project by name before creating tasks or updating project details. " +
        "Also useful for answering 'what projects are active?' or 'what client projects do I have?'",
      inputSchema: {
        include_archived: z.boolean().optional().default(false).describe(
          "Include archived projects",
        ),
        parent_id: uuidField().optional().describe(
          "List only children of this project",
        ),
        type: z.enum(PROJECT_TYPES).optional().describe(
          "Filter by project type",
        ),
      },
    },
    withMcpLogging(
      "list_projects",
      async ({ include_archived, parent_id, type }) => {
        const { data, error } = await projectRepository.list({
          includeArchived: include_archived,
          parentId: parent_id,
          type,
        });

        if (error) {
          return errorResult(`Error: ${error.message}`);
        }

        if (!data || data.length === 0) {
          return textResult("No projects found.", { recordsReturned: 0 });
        }

        // Get parent names for display (shared batched resolver).
        const parentIds = data
          .filter((project) => project.parent_id)
          .map((project) => project.parent_id as string);
        const parentMap = parentIds.length > 0
          ? await resolveNames(supabase, "projects", parentIds)
          : new Map<string, string>();

        // Get child counts
        const projectIds = data.map((project) => project.id);
        const { data: children } = await projectRepository.listChildParentIds(
          projectIds,
        );
        const childCounts: Record<string, number> = {};
        for (const child of children || []) {
          // The query filters on `parent_id IN (…)`, so it is never null here;
          // the guard satisfies the schema-nullable type.
          if (child.parent_id) {
            childCounts[child.parent_id] = (childCounts[child.parent_id] || 0) +
              1;
          }
        }

        const lines = data.map((project, i) => {
          const parts = [
            `${i + 1}. ${project.name}`,
            `   ID: ${project.id}`,
            `   Type: ${project.type || "—"}`,
          ];
          if (project.parent_id && parentMap.get(project.parent_id)) {
            parts.push(`   Parent: ${parentMap.get(project.parent_id)}`);
          }
          if (childCounts[project.id]) {
            parts.push(`   Children: ${childCounts[project.id]}`);
          }
          parts.push(
            `   Created: ${
              project.created_at
                ? new Date(project.created_at).toLocaleDateString()
                : "—"
            }`,
          );
          if (project.archived_at) {
            parts.push(
              `   Archived: ${
                new Date(project.archived_at).toLocaleDateString()
              }`,
            );
          }
          return parts.join("\n");
        });

        return textResult(
          `${data.length} project(s):\n\n${lines.join("\n\n")}`,
          { recordsReturned: data.length },
        );
      },
      logger,
    ),
  );

  server.registerTool(
    "get_project",
    {
      title: "Get Project",
      description:
        "Get a project's details: name, type, description, parent, children, and open task count. " +
        "Use this for quick lookups when you need project metadata. " +
        "For a richer view that also includes recent thoughts and source notes, use get_project_summary instead.",
      inputSchema: {
        id: uuidField().describe("Project UUID"),
      },
    },
    withMcpLogging("get_project", async ({ id }) => {
      const { data: project, error } = await projectRepository.findById(id);

      // Unified not-found convention: a missing row on a read is data, not a
      // tool failure. `findById` uses `.single()`, so a miss surfaces as the
      // PGRST116 "no rows" code (mirrors get_thought_by_id / get_document).
      if (error && error.code !== "PGRST116") {
        return errorResult(`Error: ${error.message}`);
      }
      if (!project) {
        return textResult(`No project found with ID "${id}".`, {
          recordsReturned: 0,
        });
      }

      // Get parent name
      let parentName = null;
      if (project.parent_id) {
        const { data: parent } = await projectRepository.findName(
          project.parent_id,
        );
        parentName = parent?.name;
      }

      // Get children
      const { data: children } = await projectRepository.listChildrenBasic(id);

      // Get open task count
      const { data: taskCount } = await taskRepository.countOpenByProject(id);

      const lines = [
        `Name: ${project.name}`,
        `ID: ${project.id}`,
        `Type: ${project.type || "—"}`,
        `Description: ${project.description || "—"}`,
      ];
      if (parentName) {
        lines.push(`Parent: ${parentName} (${project.parent_id})`);
      }
      if (children && children.length > 0) {
        lines.push(
          `Children: ${
            children.map((child) => `${child.name} (${child.type || "—"})`)
              .join(", ")
          }`,
        );
      }
      lines.push(`Open tasks: ${taskCount || 0}`);
      lines.push(
        `Created: ${
          project.created_at
            ? new Date(project.created_at).toLocaleDateString()
            : "—"
        }`,
      );
      lines.push(
        `Updated: ${
          project.updated_at
            ? new Date(project.updated_at).toLocaleDateString()
            : "—"
        }`,
      );
      if (project.archived_at) {
        lines.push(
          `Archived: ${new Date(project.archived_at).toLocaleDateString()}`,
        );
      }

      return textResult(lines.join("\n"), { recordsReturned: 1 });
    }, logger),
  );

  server.registerTool(
    "update_project",
    {
      title: "Update Project",
      description: "Update a project's name, type, parent, or description. " +
        "IMPORTANT: When the user mentions facts about a project — client name, location, purpose, key people, deadlines, or any contextual detail — " +
        "proactively call this tool to store that information in the project's description. " +
        "This makes the project self-documenting so that any AI querying it later has the full picture without needing to search through individual thoughts. " +
        "Append to the existing description rather than replacing it, unless the user is correcting outdated information.",
      inputSchema: {
        id: uuidField().describe("Project UUID"),
        name: z.string().optional().describe("New name"),
        type: z.enum(PROJECT_TYPES).optional().describe("New type"),
        parent_id: uuidField().nullable().optional().describe(
          "New parent UUID, or null to remove parent",
        ),
        description: z.string().optional().describe(
          "New or updated description — include client name, purpose, location, key contacts, or any context. Append to existing description unless correcting outdated info",
        ),
      },
    },
    withMcpLogging(
      "update_project",
      async ({ id, name, type, parent_id, description }) => {
        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name;
        if (type !== undefined) updates.type = type;
        if (parent_id !== undefined) updates.parent_id = parent_id;
        if (description !== undefined) {
          updates.description = description;
          // INVARIANT 1: re-hash the project's editable prose on every edit.
          updates.content_hash = await hashContent(description);
        }

        if (Object.keys(updates).length === 0) {
          return errorResult(
            "At least one of name, type, parent_id, or description must be provided.",
          );
        }

        const { data, error } = await projectRepository.update(id, updates);

        if (error) {
          return errorResult(`Update failed: ${error.message}`);
        }
        if (!data) {
          // Affected-row verification: the update matched no row, so the UUID
          // does not exist — report not-found instead of a false success.
          return errorResult(`Project not found: no project with id ${id}`);
        }

        return textResult(
          `Project ${id} updated: ${Object.keys(updates).join(", ")}`,
        );
      },
      logger,
    ),
  );

  server.registerTool(
    "archive_project",
    {
      title: "Archive Project",
      description:
        "Archive a project, recursively archiving all child projects and their open tasks. " +
        "Archived projects are hidden from default list_projects results but not deleted — they can still be queried with include_archived. " +
        "Use this when a project is complete, cancelled, or no longer relevant. This is a significant action — confirm with the user before archiving.",
      inputSchema: {
        id: uuidField().describe("Project UUID to archive"),
      },
    },
    withMcpLogging("archive_project", async ({ id }) => {
      // Get the project name
      const { data: project, error: fetchError } = await projectRepository
        .findName(id);

      if (fetchError || !project) {
        return errorResult(
          `Project not found: ${fetchError?.message || "unknown"}`,
        );
      }

      // Recursively collect all descendant project IDs
      const allProjectIds: string[] = [id];
      let frontier = [id];
      while (frontier.length > 0) {
        const { data: childProjects } = await projectRepository
          .listActiveChildIds(
            frontier,
          );

        frontier = (childProjects || []).map((child) => child.id);
        allProjectIds.push(...frontier);
      }

      const childCount = allProjectIds.length - 1;

      // Archive all projects
      const { error: archiveError } = await projectRepository.archiveManyActive(
        allProjectIds,
      );

      if (archiveError) {
        throw new Error(`Archive projects failed: ${archiveError.message}`);
      }

      // Archive open tasks for all these projects
      const { data: tasks } = await taskRepository.findOpenIdsByProjects(
        allProjectIds,
      );

      let taskCount = 0;
      if (tasks && tasks.length > 0) {
        const taskIds = tasks.map((task) => task.id);
        const { error: taskError } = await taskRepository.archiveMany(taskIds);

        if (taskError) {
          throw new Error(`Archive tasks failed: ${taskError.message}`);
        }
        taskCount = tasks.length;
      }

      const parts = [`Archived project "${project.name}"`];
      if (childCount > 0) {
        parts.push(`${childCount} child project${childCount > 1 ? "s" : ""}`);
      }
      if (taskCount > 0) {
        parts.push(`${taskCount} task${taskCount > 1 ? "s" : ""}`);
      }

      return textResult(parts.join(" and "));
    }, logger),
  );
}
