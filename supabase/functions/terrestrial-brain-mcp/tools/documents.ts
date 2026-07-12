import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { uuidField } from "../zod-schemas.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import { parseNote } from "../parser.ts";
import {
  createDefaultExtractors,
  runExtractionPipeline,
} from "../extractors/pipeline.ts";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import { hashContent } from "../helpers.ts";
import { resolveNames } from "../repositories/name-resolution.ts";
import { DEFAULT_LIST_LIMIT, MAX_QUERY_LIMIT } from "../constants.ts";
import type { AiProvider } from "../ai/ai-provider.ts";
import type { TaskRepository } from "../repositories/task-repository.ts";
import type { ProjectRepository } from "../repositories/project-repository.ts";
import type { PersonRepository } from "../repositories/person-repository.ts";
import type { DocumentRepository } from "../repositories/document-repository.ts";
import type { ThoughtRepository } from "../repositories/thought-repository.ts";

export function register(
  server: McpServer,
  supabase: SupabaseClient,
  logger: FunctionCallLogger,
  aiProvider: AiProvider,
  taskRepository: TaskRepository,
  projectRepository: ProjectRepository,
  personRepository: PersonRepository,
  documentRepository: DocumentRepository,
  thoughtRepository: ThoughtRepository,
) {
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
        content: z.string().describe(
          "Full document text in markdown — stored verbatim, never modified",
        ),
        project_id: uuidField().describe("UUID of the owning project"),
        file_path: z.string().optional().describe(
          "Vault-relative path if this came from Obsidian — provenance only, not a write target",
        ),
        references: z.object({
          people: uuidField().array().optional().default([]).describe(
            "UUIDs of referenced people",
          ),
          tasks: uuidField().array().optional().default([]).describe(
            "UUIDs of referenced tasks",
          ),
        }).optional().describe(
          "Explicit references — if omitted, extracted automatically from content",
        ),
      },
    },
    withMcpLogging(
      "write_document",
      async ({ title, content, project_id, file_path, references }) => {
        let resolvedReferences: Record<string, string[]> = references
          ? { people: references.people || [], tasks: references.tasks || [] }
          : {};

        // Auto-extract references using the existing extraction pipeline
        if (!references) {
          try {
            const parsedNote = parseNote(content, title, null, "mcp");
            const extractedRefs = await runExtractionPipeline(
              parsedNote,
              createDefaultExtractors(),
              supabase,
              aiProvider,
              taskRepository,
              projectRepository,
              personRepository,
            );
            resolvedReferences = extractedRefs;
          } catch (pipelineError) {
            console.error(
              `write_document extraction pipeline error: ${
                (pipelineError as Error).message
              }`,
            );
            resolvedReferences = { people: [], tasks: [] };
          }
        }

        const { data, error } = await documentRepository.insert({
          project_id,
          title,
          content,
          file_path: file_path || null,
          references: resolvedReferences,
        });

        if (error || !data) {
          return errorResult(
            `Failed to store document: ${error?.message || "unknown"}`,
          );
        }

        const refParts: string[] = [];
        const peopleCount = (resolvedReferences.people || []).length;
        const taskCount = (resolvedReferences.tasks || []).length;
        const projectCount = (resolvedReferences.projects || []).length;
        if (peopleCount > 0) {
          refParts.push(
            `${peopleCount} ${peopleCount !== 1 ? "people" : "person"}`,
          );
        }
        if (taskCount > 0) {
          refParts.push(
            `${taskCount} task${taskCount !== 1 ? "s" : ""}`,
          );
        }
        if (projectCount > 0) {
          refParts.push(
            `${projectCount} project${projectCount !== 1 ? "s" : ""}`,
          );
        }
        const refSuffix = refParts.length > 0
          ? ` | References: ${refParts.join(", ")}`
          : "";

        return textResult(
          `Document stored: "${data.title}" (id: ${data.id})${refSuffix}\n` +
            `thoughts_required: true — Use capture_thought with document_ids: ["${data.id}"] to atomize this document into searchable thoughts.`,
        );
      },
      logger,
    ),
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
        id: uuidField().describe("Document UUID"),
      },
    },
    withMcpLogging("get_document", async ({ id }) => {
      const { data, error } = await documentRepository.findById(id);

      if (error || !data) {
        return error?.code === "PGRST116"
          ? textResult(`No document found with ID "${id}".`, {
            recordsReturned: 0,
          })
          : errorResult(`Error: ${error?.message || "unknown"}`);
      }

      // Resolve project name via the shared batched resolver (raw-id fallback on
      // error — finding C9 — so a failed lookup is not "unknown project").
      const projectNames = await resolveNames(supabase, "projects", [
        data.project_id,
      ]);
      const projectName = projectNames.get(data.project_id) || "unknown";

      const refs = (data.references || {}) as Record<string, string[]>;
      const lines: string[] = [
        `Title: ${data.title}`,
        `ID: ${data.id}`,
        `Project: ${projectName} (${data.project_id})`,
      ];
      if (data.file_path) lines.push(`File path: ${data.file_path}`);
      if (refs.people?.length) lines.push(`People: ${refs.people.join(", ")}`);
      if (refs.tasks?.length) lines.push(`Tasks: ${refs.tasks.join(", ")}`);
      if (refs.projects?.length) {
        lines.push(`Projects: ${refs.projects.join(", ")}`);
      }
      lines.push(`Created: ${new Date(data.created_at).toLocaleDateString()}`);
      lines.push(`Updated: ${new Date(data.updated_at).toLocaleDateString()}`);
      lines.push(`\n---\n\n${data.content}`);

      return textResult(lines.join("\n"), { recordsReturned: 1 });
    }, logger),
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
        project_id: uuidField().optional().describe(
          "Filter by project UUID",
        ),
        title_contains: z.string().optional().describe(
          "Case-insensitive substring match against document title",
        ),
        search: z.string().optional().describe(
          "Case-insensitive substring match against document content",
        ),
        limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional().default(
          DEFAULT_LIST_LIMIT,
        ).describe(
          "Max results (default 20, max 100)",
        ),
      },
    },
    withMcpLogging(
      "list_documents",
      async ({ project_id, title_contains, search, limit }) => {
        const { data, error } = await documentRepository.list({
          limit,
          projectId: project_id,
          titleContains: title_contains,
          search,
        });

        if (error) {
          return errorResult(`Error: ${error.message}`);
        }

        if (!data || data.length === 0) {
          return textResult("No documents found.", { recordsReturned: 0 });
        }

        // Resolve project names via the shared batched resolver (raw-id fallback
        // on error — finding C9).
        const projectIds = [
          ...new Set(data.map((document) => document.project_id)),
        ];
        const projectMap = await resolveNames(supabase, "projects", projectIds);

        const lines = data.map((document, index) => {
          const refs = (document.references || {}) as Record<string, string[]>;
          const parts = [
            `${index + 1}. ${document.title}`,
            `   ID: ${document.id}`,
            `   Project: ${projectMap.get(document.project_id) || "unknown"}`,
          ];
          if (document.file_path) parts.push(`   Path: ${document.file_path}`);

          const refParts: string[] = [];
          if (refs.people?.length) {
            refParts.push(`${refs.people.length} people`);
          }
          if (refs.tasks?.length) refParts.push(`${refs.tasks.length} tasks`);
          if (refs.projects?.length) {
            refParts.push(`${refs.projects.length} projects`);
          }
          if (refParts.length > 0) {
            parts.push(`   References: ${refParts.join(", ")}`);
          }

          parts.push(
            `   Created: ${new Date(document.created_at).toLocaleDateString()}`,
          );
          return parts.join("\n");
        });

        return textResult(
          `${data.length} document(s):\n\n${lines.join("\n\n")}`,
          { recordsReturned: data.length },
        );
      },
      logger,
    ),
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
        id: uuidField().describe("UUID of the document to update"),
        title: z.string().optional().describe("New document title"),
        content: z.string().optional().describe(
          "New full document text in markdown — replaces existing content verbatim",
        ),
        project_id: uuidField().optional().describe(
          "UUID of the new owning project",
        ),
      },
    },
    withMcpLogging(
      "update_document",
      async ({ id, title, content, project_id }) => {
        // Validate at least one optional field is provided
        if (
          title === undefined && content === undefined &&
          project_id === undefined
        ) {
          return errorResult(
            "At least one of title, content, or project_id must be provided.",
          );
        }

        // Verify document exists and get current data for extraction context
        const { data: existing, error: fetchError } = await documentRepository
          .findForUpdate(id);

        if (fetchError || !existing) {
          return errorResult("Document not found.");
        }

        // Build update payload
        const updates: Record<string, unknown> = {};
        if (title !== undefined) updates.title = title;
        if (content !== undefined) {
          updates.content = content;
          // INVARIANT 1: re-hash on every content edit (one update path).
          updates.content_hash = await hashContent(content);
        }
        if (project_id !== undefined) updates.project_id = project_id;

        // If content changed, re-extract references from the new content BEFORE
        // the update (the extracted refs are part of the update payload). Stale
        // thought cleanup is deferred until AFTER a successful update (see below)
        // so that a failed update never destroys the existing thoughts.
        let contentWarning = "";
        if (content !== undefined) {
          const effectiveTitle = title ?? existing.title;
          try {
            const parsedNote = parseNote(content, effectiveTitle, null, "mcp");
            const extractedRefs = await runExtractionPipeline(
              parsedNote,
              createDefaultExtractors(),
              supabase,
              aiProvider,
              taskRepository,
              projectRepository,
              personRepository,
            );
            updates.references = extractedRefs;
          } catch (pipelineError) {
            console.error(
              `update_document extraction pipeline error: ${
                (pipelineError as Error).message
              }`,
            );
            updates.references = { people: [], tasks: [] };
            contentWarning =
              " (warning: reference extraction failed — references reset to empty)";
          }
        }

        // Perform the update FIRST — before touching any thoughts.
        const { error: updateError } = await documentRepository.update(
          id,
          updates,
        );

        if (updateError) {
          // Update failed: linked thoughts are untouched and still consistent
          // with the unchanged document content.
          return errorResult(`Update failed: ${updateError.message}`);
        }

        // Update succeeded: now soft-archive the stale linked thoughts (never
        // hard-delete). A hallucinated/wrong ID must not permanently destroy
        // knowledge, and archived thoughts stay retrievable.
        let cleanupWarning = "";
        if (content !== undefined) {
          const { error: archiveError } = await thoughtRepository
            .archiveByDocumentReference(id);

          if (archiveError) {
            // Surface the failure instead of swallowing it: the document was
            // updated, but stale thoughts may still be active.
            console.error(
              `update_document thought cleanup error: ${archiveError.message}`,
            );
            cleanupWarning =
              ` (warning: thought cleanup failed — some stale thoughts may remain active: ${archiveError.message})`;
          }
        }

        const updatedFields = Object.keys(updates).filter((key) =>
          key !== "references"
        ).join(", ");
        const base =
          `Document updated: ${updatedFields}${contentWarning}${cleanupWarning}`;

        if (content !== undefined) {
          return textResult(
            `${base}\nthoughts_required: true — Previous thoughts were archived. Use capture_thought with document_ids: ["${id}"] to re-atomize the updated document.`,
          );
        }

        return textResult(base);
      },
      logger,
    ),
  );
}
