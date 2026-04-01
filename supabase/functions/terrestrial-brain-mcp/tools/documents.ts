import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { parseNote } from "../parser.ts";
import { runExtractionPipeline } from "../extractors/pipeline.ts";
import { ProjectExtractor } from "../extractors/project-extractor.ts";
import { PeopleExtractor } from "../extractors/people-extractor.ts";
import { TaskExtractor } from "../extractors/task-extractor.ts";

export function register(server: McpServer, supabase: SupabaseClient) {
  // ─── write_document ───────────────────────────────────────────────────────────

  server.registerTool(
    "write_document",
    {
      title: "Write Document",
      description:
        "Store a full long-form document (research, brief, spec, notes) in the knowledge base, linked to a project. " +
        "Content is stored verbatim — not atomized or paraphrased. " +
        "Pass a references object with people and task UUIDs if known; otherwise, references are extracted automatically from content using the same pipeline as capture_thought. " +
        "Does NOT generate thoughts — after calling this, use capture_thought to atomize the document into searchable thoughts while you still have full context. " +
        "Pass the returned document ID as document_ids to capture_thought so thoughts link back to their source document. " +
        "Response includes thoughts_required: true as a reminder.",
      inputSchema: {
        title: z.string().describe("Document title"),
        content: z.string().describe("Full document text in markdown — stored verbatim, never modified"),
        project_id: z.string().describe("UUID of the owning project"),
        file_path: z.string().optional().describe("Vault-relative path if this came from Obsidian — provenance only, not a write target"),
        references: z.object({
          people: z.string().array().optional().default([]).describe("UUIDs of referenced people"),
          tasks: z.string().array().optional().default([]).describe("UUIDs of referenced tasks"),
        }).optional().describe("Explicit references — if omitted, extracted automatically from content"),
      },
    },
    async ({ title, content, project_id, file_path, references }) => {
      try {
        let resolvedReferences: Record<string, string[]> = references
          ? { people: references.people || [], tasks: references.tasks || [] }
          : {};

        // Auto-extract references using the existing extraction pipeline
        if (!references) {
          try {
            const parsedNote = parseNote(content, title, null, "mcp");
            const extractedRefs = await runExtractionPipeline(
              parsedNote,
              [new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()],
              supabase,
            );
            resolvedReferences = extractedRefs;
          } catch (pipelineError) {
            console.error(`write_document extraction pipeline error: ${(pipelineError as Error).message}`);
            resolvedReferences = { people: [], tasks: [] };
          }
        }

        const { data, error } = await supabase
          .from("documents")
          .insert({
            project_id,
            title,
            content,
            file_path: file_path || null,
            references: resolvedReferences,
          })
          .select("id, title, project_id")
          .single();

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to store document: ${error.message}` }],
            isError: true,
          };
        }

        const refParts: string[] = [];
        const peopleCount = (resolvedReferences.people || []).length;
        const taskCount = (resolvedReferences.tasks || []).length;
        const projectCount = (resolvedReferences.projects || []).length;
        if (peopleCount > 0) refParts.push(`${peopleCount} ${peopleCount !== 1 ? "people" : "person"}`);
        if (taskCount > 0) refParts.push(`${taskCount} task${taskCount !== 1 ? "s" : ""}`);
        if (projectCount > 0) refParts.push(`${projectCount} project${projectCount !== 1 ? "s" : ""}`);
        const refSuffix = refParts.length > 0 ? ` | References: ${refParts.join(", ")}` : "";

        return {
          content: [{
            type: "text" as const,
            text: `Document stored: "${data.title}" (id: ${data.id})${refSuffix}\n` +
              `thoughts_required: true — Use capture_thought with document_ids: ["${data.id}"] to atomize this document into searchable thoughts.`,
          }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── get_document ─────────────────────────────────────────────────────────────

  server.registerTool(
    "get_document",
    {
      title: "Get Document",
      description:
        "Retrieve a full document by ID, including complete content text. " +
        "Use this when you need source-level detail from a research doc or brief, not just the atomized thoughts derived from it.",
      inputSchema: {
        id: z.string().describe("Document UUID"),
      },
    },
    async ({ id }) => {
      try {
        const { data, error } = await supabase
          .from("documents")
          .select("*")
          .eq("id", id)
          .single();

        if (error) {
          const message = error.code === "PGRST116"
            ? `No document found with ID "${id}".`
            : `Error: ${error.message}`;
          return {
            content: [{ type: "text" as const, text: message }],
            isError: error.code !== "PGRST116",
          };
        }

        // Resolve project name
        let projectName = "unknown";
        const { data: project } = await supabase
          .from("projects")
          .select("name")
          .eq("id", data.project_id)
          .single();
        if (project) projectName = project.name;

        const refs = (data.references || {}) as Record<string, string[]>;
        const lines: string[] = [
          `Title: ${data.title}`,
          `ID: ${data.id}`,
          `Project: ${projectName} (${data.project_id})`,
        ];
        if (data.file_path) lines.push(`File path: ${data.file_path}`);
        if (refs.people?.length) lines.push(`People: ${refs.people.join(", ")}`);
        if (refs.tasks?.length) lines.push(`Tasks: ${refs.tasks.join(", ")}`);
        if (refs.projects?.length) lines.push(`Projects: ${refs.projects.join(", ")}`);
        lines.push(`Created: ${new Date(data.created_at).toLocaleDateString()}`);
        lines.push(`Updated: ${new Date(data.updated_at).toLocaleDateString()}`);
        lines.push(`\n---\n\n${data.content}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // ─── list_documents ───────────────────────────────────────────────────────────

  server.registerTool(
    "list_documents",
    {
      title: "List Documents",
      description:
        "List documents in the knowledge base, with optional filters. " +
        "Filters: project_id (exact match), title_contains (case-insensitive substring match on title), " +
        "search (case-insensitive substring match on content). All filters combine with AND logic. " +
        "Returns metadata only (no content body). Use get_document with a specific ID to retrieve full content.",
      inputSchema: {
        project_id: z.string().optional().describe("Filter by project UUID"),
        title_contains: z.string().optional().describe("Case-insensitive substring match against document title"),
        search: z.string().optional().describe("Case-insensitive substring match against document content"),
        limit: z.number().optional().default(20).describe("Max results (default 20)"),
      },
    },
    async ({ project_id, title_contains, search, limit }) => {
      try {
        let query = supabase
          .from("documents")
          .select("id, title, project_id, file_path, references, created_at, updated_at")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (project_id) query = query.eq("project_id", project_id);
        if (title_contains) query = query.ilike("title", `%${title_contains}%`);
        if (search) query = query.ilike("content", `%${search}%`);

        const { data, error } = await query;

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || data.length === 0) {
          return { content: [{ type: "text" as const, text: "No documents found." }] };
        }

        // Resolve project names
        const projectIds = [...new Set(data.map(document => document.project_id))];
        const { data: projects } = await supabase
          .from("projects")
          .select("id, name")
          .in("id", projectIds);
        const projectMap: Record<string, string> = Object.fromEntries(
          (projects || []).map(project => [project.id, project.name]),
        );

        const lines = data.map((document, index) => {
          const refs = (document.references || {}) as Record<string, string[]>;
          const parts = [
            `${index + 1}. ${document.title}`,
            `   ID: ${document.id}`,
            `   Project: ${projectMap[document.project_id] || "unknown"}`,
          ];
          if (document.file_path) parts.push(`   Path: ${document.file_path}`);

          const refParts: string[] = [];
          if (refs.people?.length) refParts.push(`${refs.people.length} people`);
          if (refs.tasks?.length) refParts.push(`${refs.tasks.length} tasks`);
          if (refs.projects?.length) refParts.push(`${refs.projects.length} projects`);
          if (refParts.length > 0) parts.push(`   References: ${refParts.join(", ")}`);

          parts.push(`   Created: ${new Date(document.created_at).toLocaleDateString()}`);
          return parts.join("\n");
        });

        return {
          content: [{
            type: "text" as const,
            text: `${data.length} document(s):\n\n${lines.join("\n\n")}`,
          }],
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
