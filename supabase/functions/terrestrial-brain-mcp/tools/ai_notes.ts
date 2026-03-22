import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";

export function register(server: McpServer, supabase: SupabaseClient) {
  server.registerTool(
    "create_ai_note",
    {
      title: "Create AI Note",
      description:
        "Create a markdown note that will be synced to the user's Obsidian vault. The note gets frontmatter with terrestrialBrainExclude: true so it won't be re-ingested as thoughts.",
      inputSchema: {
        title: z.string().describe("Note title"),
        content: z.string().describe("Full markdown content (without frontmatter — it will be added automatically)"),
        suggested_path: z.string().optional().describe("Suggested vault path, e.g. 'AI Notes/CarChief/analysis.md'"),
      },
    },
    async ({ title, content, suggested_path }) => {
      try {
        const now = Date.now();
        const readableDate = new Date(now).toISOString();

        // Build the full content with frontmatter
        const fullContent = `---
tb_id: ${crypto.randomUUID()}
created_utc: ${now}
created_readable: ${readableDate}
terrestrialBrainExclude: true
---

${content}`;

        const { data, error } = await supabase
          .from("ai_notes")
          .insert({
            title,
            content: fullContent,
            suggested_path: suggested_path || null,
            created_at_utc: now,
            synced_at: null,
          })
          .select("id")
          .single();

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to create AI note: ${error.message}` }],
            isError: true,
          };
        }

        const path = suggested_path || `AI Notes/${title}.md`;
        return {
          content: [{ type: "text" as const, text: `Created AI note "${title}" (id: ${data.id})\nWill sync to: ${path}` }],
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
    "get_unsynced_ai_notes",
    {
      title: "Get Unsynced AI Notes",
      description: "Returns all AI notes that haven't been synced to the Obsidian vault yet, as a JSON array.",
      inputSchema: {},
    },
    async () => {
      try {
        const { data, error } = await supabase
          .from("ai_notes")
          .select("id, title, content, suggested_path, created_at_utc")
          .is("synced_at", null)
          .order("created_at_utc", { ascending: true });

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
    "mark_notes_synced",
    {
      title: "Mark Notes Synced",
      description: "Mark AI notes as synced after the Obsidian plugin has pulled them.",
      inputSchema: {
        ids: z.array(z.string()).describe("Array of AI note UUIDs to mark as synced"),
      },
    },
    async ({ ids }) => {
      try {
        const now = Date.now();
        const { error } = await supabase
          .from("ai_notes")
          .update({ synced_at: now })
          .in("id", ids);

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to mark synced: ${error.message}` }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: `Marked ${ids.length} note${ids.length > 1 ? "s" : ""} as synced.` }],
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
