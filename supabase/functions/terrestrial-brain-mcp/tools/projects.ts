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

export type ArchiveCascadeOutcome =
  | { ok: true; childCount: number; taskCount: number }
  | { ok: false; error: string };

/**
 * Archives a project and its whole active subtree (descendant projects + their
 * open tasks) as one cascade (TOOL-2). The traversal uses a visited set so a
 * parent cycle in the data terminates instead of spinning. Every read checks its
 * error channel and aborts BEFORE any write, so a failed lookup is never
 * rendered as a partial success. Writes are ordered tasks-first, projects-last:
 * a crash between them leaves the projects ACTIVE, so a re-run rediscovers the
 * whole subtree and finishes (a recoverable state).
 */
export async function archiveProjectCascade(
  projectRepository: ProjectRepository,
  taskRepository: TaskRepository,
  rootId: string,
): Promise<ArchiveCascadeOutcome> {
  // 1. Collect all descendant project ids (BFS, cycle-safe via `visited`).
  //    A failed lookup aborts BEFORE any write — nothing has been archived, so
  //    the abort is clean.
  const allProjectIds: string[] = [rootId];
  const visited = new Set<string>([rootId]);
  let frontier = [rootId];
  while (frontier.length > 0) {
    const { data: childProjects, error: childError } = await projectRepository
      .listActiveChildIds(frontier);
    if (childError) {
      return {
        ok: false,
        error: `Read child projects failed: ${childError.message}`,
      };
    }
    const next: string[] = [];
    for (const child of (childProjects || [])) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      allProjectIds.push(child.id);
      next.push(child.id);
    }
    frontier = next;
  }

  // 2. Collect open task ids for the whole subtree (before any write).
  const { data: tasks, error: tasksError } = await taskRepository
    .findOpenIdsByProjects(allProjectIds);
  if (tasksError) {
    return {
      ok: false,
      error: `Read open tasks failed: ${tasksError.message}`,
    };
  }
  const taskIds = (tasks || []).map((task) => task.id);

  // 3. Archive tasks FIRST (recoverable order): a crash here leaves the projects
  //    still active, so a re-run rediscovers the whole subtree and finishes.
  if (taskIds.length > 0) {
    const { error: taskError } = await taskRepository.archiveMany(taskIds);
    if (taskError) {
      return { ok: false, error: `Archive tasks failed: ${taskError.message}` };
    }
  }

  // 4. Archive projects LAST.
  const { error: archiveError } = await projectRepository.archiveManyActive(
    allProjectIds,
  );
  if (archiveError) {
    return {
      ok: false,
      error: `Archive projects failed: ${archiveError.message}`,
    };
  }

  return {
    ok: true,
    childCount: allProjectIds.length - 1,
    taskCount: taskIds.length,
  };
}

/**
 * Returns whether setting `proposedParentId` as the parent of `id` would create
 * a cycle in the project hierarchy (TOOL-2). Walks the proposed parent's
 * ancestor chain; if it reaches `id`, the edge closes a loop. A `visited` set
 * bounds the walk even if the existing data already contains a cycle.
 */
export async function wouldCreateProjectCycle(
  projectRepository: ProjectRepository,
  id: string,
  proposedParentId: string,
): Promise<{ cycle: boolean; error?: string }> {
  if (proposedParentId === id) return { cycle: true };
  const visited = new Set<string>();
  let current: string | null = proposedParentId;
  while (current) {
    if (current === id) return { cycle: true };
    if (visited.has(current)) break;
    visited.add(current);
    const { data, error } = await projectRepository.findById(current);
    if (error) return { cycle: false, error: error.message };
    current = data?.parent_id ?? null;
  }
  return { cycle: false };
}

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
        // Reject a parent_id that would close a cycle in the hierarchy (TOOL-2),
        // which archive_project's cascade traversal would otherwise have to spin
        // through. A null parent_id (remove parent) can never create a cycle.
        if (typeof parent_id === "string") {
          const cycleCheck = await wouldCreateProjectCycle(
            projectRepository,
            id,
            parent_id,
          );
          if (cycleCheck.error) {
            return errorResult(
              `Could not verify project hierarchy: ${cycleCheck.error}`,
            );
          }
          if (cycleCheck.cycle) {
            return errorResult(
              "Cannot set parent: this would create a cycle in the project hierarchy.",
            );
          }
        }

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

      const outcome = await archiveProjectCascade(
        projectRepository,
        taskRepository,
        id,
      );
      if (!outcome.ok) {
        return errorResult(outcome.error);
      }
      const { childCount, taskCount } = outcome;

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
