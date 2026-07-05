import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";

export function register(
  server: McpServer,
  supabase: SupabaseClient,
  logger: FunctionCallLogger,
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
        type: z.string().optional().describe("Person type: 'human' or 'ai'"),
        email: z.string().optional().describe("Email address"),
        description: z.string().optional().describe(
          "Notes about this person — role, relationship, context",
        ),
      },
    },
    withMcpLogging(
      "create_person",
      async ({ name, type, email, description }) => {
        const { data, error } = await supabase
          .from("people")
          .insert({
            name,
            type: type || null,
            email: email || null,
            description: description || null,
          })
          .select("id, name")
          .single();

        if (error) {
          return errorResult(`Failed to create person: ${error.message}`);
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
        type: z.string().optional().describe("Filter by type: 'human' or 'ai'"),
        include_archived: z.boolean().optional().default(false).describe(
          "Include archived people",
        ),
      },
    },
    withMcpLogging("list_people", async ({ type, include_archived }) => {
      let query = supabase
        .from("people")
        .select("id, name, type, email, description, archived_at, created_at")
        .order("name");

      if (!include_archived) query = query.is("archived_at", null);
      if (type) query = query.eq("type", type);

      const { data, error } = await query;

      if (error) {
        return errorResult(`Error: ${error.message}`);
      }

      if (!data || data.length === 0) {
        return textResult("No people found.");
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

      return textResult(`${data.length} person(s):\n\n${lines.join("\n\n")}`);
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
        id: z.string().describe("Person UUID"),
      },
    },
    withMcpLogging("get_person", async ({ id }) => {
      const { data: person, error } = await supabase
        .from("people")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !person) {
        return errorResult(`Person not found: ${error?.message || "unknown"}`);
      }

      const { count: taskCount } = await supabase
        .from("tasks")
        .select("*", { count: "exact", head: true })
        .eq("assigned_to", id)
        .in("status", ["open", "in_progress"])
        .is("archived_at", null);

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

      return textResult(lines.join("\n"));
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
        id: z.string().describe("Person UUID"),
        name: z.string().optional().describe("New name"),
        type: z.string().optional().describe("New type: 'human' or 'ai'"),
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
          return textResult("No fields to update.");
        }

        const { error } = await supabase
          .from("people")
          .update(updates)
          .eq("id", id);

        if (error) {
          return errorResult(`Update failed: ${error.message}`);
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
        id: z.string().describe("Person UUID to archive"),
      },
    },
    withMcpLogging("archive_person", async ({ id }) => {
      const { data: person, error: fetchError } = await supabase
        .from("people")
        .select("name")
        .eq("id", id)
        .single();

      if (fetchError || !person) {
        return errorResult(
          `Person not found: ${fetchError?.message || "unknown"}`,
        );
      }

      const { error } = await supabase
        .from("people")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id);

      if (error) {
        return errorResult(`Archive failed: ${error.message}`);
      }

      return textResult(`Archived person "${person.name}"`);
    }, logger),
  );
}
