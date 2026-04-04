import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { parseNote } from "../parser.ts";
import { runExtractionPipeline } from "../extractors/pipeline.ts";
import { ProjectExtractor } from "../extractors/project-extractor.ts";
import { PeopleExtractor } from "../extractors/people-extractor.ts";
import { TaskExtractor } from "../extractors/task-extractor.ts";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";

export function register(server: McpServer, supabase: SupabaseClient, logger: FunctionCallLogger) {
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
        "Response includes thoughts_required: true as a reminder. " +
        "To edit an existing document later, use update_document.",
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
    withMcpLogging("write_document", async ({ title, content, project_id, file_path, references }) => {
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
    }, logger)
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
    withMcpLogging("get_document", async ({ id }) => {
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
    }, logger)
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
    withMcpLogging("list_documents", async ({ project_id, title_contains, search, limit }) => {
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
    }, logger)
  );

  // ─── update_document ──────────────────────────────────────────────────────────

  server.registerTool(
    "update_document",
    {
      title: "Update Document",
      description:
        "Update an existing document's title, content, and/or project assignment. " +
        "At least one of title, content, or project_id must be provided. " +
        "When content is updated, stale thoughts linked to this document are automatically deleted " +
        "and references are re-extracted from the new content. " +
        "After a content update, use capture_thought with document_ids to re-atomize the document into thoughts.",
      inputSchema: {
        id: z.string().describe("UUID of the document to update"),
        title: z.string().optional().describe("New document title"),
        content: z.string().optional().describe("New full document text in markdown — replaces existing content verbatim"),
        project_id: z.string().optional().describe("UUID of the new owning project"),
      },
    },
    withMcpLogging("update_document", async ({ id, title, content, project_id }) => {
      try {
        // Validate at least one optional field is provided
        if (title === undefined && content === undefined && project_id === undefined) {
          return {
            content: [{ type: "text" as const, text: "At least one of title, content, or project_id must be provided." }],
            isError: true,
          };
        }

        // Verify document exists and get current data for extraction context
        const { data: existing, error: fetchError } = await supabase
          .from("documents")
          .select("id, title, project_id")
          .eq("id", id)
          .single();

        if (fetchError || !existing) {
          return {
            content: [{ type: "text" as const, text: "Document not found." }],
            isError: true,
          };
        }

        // Build update payload
        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (content !== undefined) updates.content = content;
        if (project_id !== undefined) updates.project_id = project_id;

        // If content changed, clean up stale thoughts and re-extract references
        let contentWarning = "";
        if (content !== undefined) {
          // Delete thoughts linked to this document (same nested JSONB pattern as project filtering)
          const { error: deleteError } = await supabase
            .from("thoughts")
            .delete()
            .contains("metadata", { references: { documents: [id] } });

          if (deleteError) {
            console.error(`update_document thought cleanup error: ${deleteError.message}`);
          }

          // Re-extract references from new content
          const effectiveTitle = title ?? existing.title;
          try {
            const parsedNote = parseNote(content, effectiveTitle, null, "mcp");
            const extractedRefs = await runExtractionPipeline(
              parsedNote,
              [new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()],
              supabase,
            );
            updates.references = extractedRefs;
          } catch (pipelineError) {
            console.error(`update_document extraction pipeline error: ${(pipelineError as Error).message}`);
            updates.references = { people: [], tasks: [] };
            contentWarning = " (warning: reference extraction failed — references reset to empty)";
          }
        }

        // Perform the update
        const { error: updateError } = await supabase
          .from("documents")
          .update(updates)
          .eq("id", id);

        if (updateError) {
          return {
            content: [{ type: "text" as const, text: `Update failed: ${updateError.message}` }],
            isError: true,
          };
        }

        const updatedFields = Object.keys(updates).filter(key => key !== "references").join(", ");
        const base = `Document updated: ${updatedFields}${contentWarning}`;

        if (content !== undefined) {
          return {
            content: [{
              type: "text" as const,
              text: `${base}\nthoughts_required: true — Previous thoughts were deleted. Use capture_thought with document_ids: ["${id}"] to re-atomize the updated document.`,
            }],
          };
        }

        return {
          content: [{ type: "text" as const, text: base }],
        };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }, logger)
  );
}
