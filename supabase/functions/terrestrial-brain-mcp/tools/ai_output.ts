import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";

export function register(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "create_ai_output",
    {
      title: "Create AI Output",
      description:
        "Create markdown content that will be delivered to the user's Obsidian vault at the specified file path. The content is stored as-is (no frontmatter injection) and participates in normal ingest when delivered.",
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
        "Returns all AI output that hasn't been picked up by the Obsidian plugin yet, as a JSON array.",
      inputSchema: {},
    },
    async () => {
      try {
        const { data, error } = await supabase
          .from("ai_output")
          .select("id, title, content, file_path, created_at")
          .eq("picked_up", false)
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
        "Mark AI output as picked up after the Obsidian plugin has delivered it to the vault.",
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
}
