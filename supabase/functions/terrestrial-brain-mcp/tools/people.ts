import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { uuidField } from "../zod-schemas.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import { PERSON_TYPES } from "../enums.ts";
import type { PersonRepository } from "../repositories/person-repository.ts";
import type { TaskRepository } from "../repositories/task-repository.ts";

export function register(
  server: McpServer,
  _supabase: SupabaseClient,
  logger: FunctionCallLogger,
  personRepository: PersonRepository,
  taskRepository: TaskRepository,
) {
  server.registerTool(
    "create_person",
    {
      title: "Create Person",
      description:
        "Create a new person record. People can be human collaborators or AI agents. " +
        "Use this when the user mentions a new team member, client contact, or AI agent they work with. " +
        "The name must be unique — if a person with that name already exists, use update_person instead.",
      inputSchema: {
        name: z.string().describe("Person's name (must be unique)"),
        type: z.enum(PERSON_TYPES).optional().describe(
          "Person type: 'human' or 'ai'",
        ),
        email: z.string().optional().describe("Email address"),
        description: z.string().optional().describe(
          "Notes about this person — role, relationship, context",
        ),
      },
    },
    withMcpLogging(
      "create_person",
      async ({ name, type, email, description }) => {
        const { data, error } = await personRepository.insert({
          name,
          type: type || null,
          email: email || null,
          description: description || null,
        });

        if (error || !data) {
          return errorResult(
            `Failed to create person: ${error?.message || "unknown"}`,
          );
        }

        return textResult(`Created person "${data.name}" (id: ${data.id})`);
      },
      logger,
    ),
  );

  server.registerTool(
    "list_people",
    {
      title: "List People",
      description: "List all known people with optional filters. " +
        "Use this to find a person by name before assigning tasks or to answer 'who do I work with?'. " +
        "Filter by type to see only humans or AI agents.",
      inputSchema: {
        type: z.enum(PERSON_TYPES).optional().describe(
          "Filter by type: 'human' or 'ai'",
        ),
        include_archived: z.boolean().optional().default(false).describe(
          "Include archived people",
        ),
      },
    },
    withMcpLogging("list_people", async ({ type, include_archived }) => {
      const { data, error } = await personRepository.list({
        includeArchived: include_archived,
        type,
      });

      if (error) {
        return errorResult(`Error: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return textResult("No people found.", { recordsReturned: 0 });
      }

      const lines = data.map((person, index) => {
        const parts = [
          `${index + 1}. ${person.name}`,
          `   ID: ${person.id}`,
          `   Type: ${person.type || "—"}`,
        ];
        if (person.email) parts.push(`   Email: ${person.email}`);
        if (person.description) {
          parts.push(`   Description: ${person.description}`);
        }
        if (person.archived_at) {
          parts.push(
            `   Archived: ${new Date(person.archived_at).toLocaleDateString()}`,
          );
        }
        return parts.join("\n");
      });

      return textResult(`${data.length} person(s):\n\n${lines.join("\n\n")}`, {
        recordsReturned: data.length,
      });
    }, logger),
  );

  server.registerTool(
    "get_person",
    {
      title: "Get Person",
      description:
        "Get a person's details including their open assigned task count. " +
        "Use this for quick lookups when you need person metadata.",
      inputSchema: {
        id: uuidField().describe("Person UUID"),
      },
    },
    withMcpLogging("get_person", async ({ id }) => {
      const { data: person, error } = await personRepository.findById(id);

      // Unified not-found convention: a missing row on a read is data, not a
      // tool failure. `findById` uses `.single()`, so a miss surfaces as the
      // PGRST116 "no rows" code (mirrors get_thought_by_id / get_document).
      if (error && error.code !== "PGRST116") {
        return errorResult(`Error: ${error.message}`);
      }
      if (!person) {
        return textResult(`No person found with ID "${id}".`, {
          recordsReturned: 0,
        });
      }

      const { data: taskCount } = await taskRepository.countOpenByAssignee(id);

      const lines = [
        `Name: ${person.name}`,
        `ID: ${person.id}`,
        `Type: ${person.type || "—"}`,
        `Email: ${person.email || "—"}`,
        `Description: ${person.description || "—"}`,
        `Open tasks assigned: ${taskCount || 0}`,
        `Created: ${new Date(person.created_at).toLocaleDateString()}`,
        `Updated: ${new Date(person.updated_at).toLocaleDateString()}`,
      ];
      if (person.archived_at) {
        lines.push(
          `Archived: ${new Date(person.archived_at).toLocaleDateString()}`,
        );
      }

      return textResult(lines.join("\n"), { recordsReturned: 1 });
    }, logger),
  );

  server.registerTool(
    "update_person",
    {
      title: "Update Person",
      description: "Update a person's name, type, email, or description. " +
        "When the user mentions facts about a person — role changes, new contact info, context — " +
        "proactively call this to keep the person record current.",
      inputSchema: {
        id: uuidField().describe("Person UUID"),
        name: z.string().optional().describe("New name"),
        type: z.enum(PERSON_TYPES).optional().describe(
          "New type: 'human' or 'ai'",
        ),
        email: z.string().nullable().optional().describe(
          "New email, or null to clear",
        ),
        description: z.string().optional().describe(
          "New or updated description",
        ),
      },
    },
    withMcpLogging(
      "update_person",
      async ({ id, name, type, email, description }) => {
        const updates: Record<string, unknown> = {};
        if (name !== undefined) updates.name = name;
        if (type !== undefined) updates.type = type;
        if (email !== undefined) updates.email = email;
        if (description !== undefined) updates.description = description;

        if (Object.keys(updates).length === 0) {
          return errorResult(
            "At least one of name, type, email, or description must be provided.",
          );
        }

        const { data, error } = await personRepository.update(id, updates);

        if (error) {
          return errorResult(`Update failed: ${error.message}`);
        }
        if (!data) {
          // Affected-row verification: no row matched — report not-found.
          return errorResult(`Person not found: no person with id ${id}`);
        }

        return textResult(
          `Person ${id} updated: ${Object.keys(updates).join(", ")}`,
        );
      },
      logger,
    ),
  );

  server.registerTool(
    "archive_person",
    {
      title: "Archive Person",
      description:
        "Archive a person by setting archived_at. Archived people are hidden from default list_people results " +
        "but not deleted. Tasks assigned to them remain assigned. " +
        "Use this when someone is no longer relevant to active work.",
      inputSchema: {
        id: uuidField().describe("Person UUID to archive"),
      },
    },
    withMcpLogging("archive_person", async ({ id }) => {
      const { data: person, error: fetchError } = await personRepository
        .findName(id);

      if (fetchError || !person) {
        return errorResult(
          `Person not found: ${fetchError?.message || "unknown"}`,
        );
      }

      const { error } = await personRepository.archive(id);

      if (error) {
        return errorResult(`Archive failed: ${error.message}`);
      }

      return textResult(`Archived person "${person.name}"`);
    }, logger),
  );
}
