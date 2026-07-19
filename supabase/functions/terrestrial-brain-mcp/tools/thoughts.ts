import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { uuidField } from "../zod-schemas.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import {
  extractMetadata,
  freshIngest,
  getEmbedding,
  getProjectRefs,
  hashContent,
  resolveDedup,
} from "../helpers.ts";
import { parseNote } from "../parser.ts";
import { runExtractionForTool } from "../extractors/pipeline.ts";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { AiQuotaGate, withAiQuota } from "../ai-quota.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import { resolveNames } from "../repositories/name-resolution.ts";
import { RELIABILITIES, THOUGHT_TYPES } from "../enums.ts";
import { DEFAULT_THOUGHT_LIMIT, MAX_QUERY_LIMIT } from "../constants.ts";
import {
  buildUsefulnessHeader,
  buildUsefulnessReminder,
} from "./usefulness-reminder.ts";
import type { AiProvider } from "../ai/ai-provider.ts";
import { AiProviderParseError } from "../ai/ai-provider.ts";
import type {
  ThoughtByReferenceRow,
  ThoughtRepository,
} from "../repositories/thought-repository.ts";
import type { TaskRepository } from "../repositories/task-repository.ts";
import type { ProjectRepository } from "../repositories/project-repository.ts";
import type { PersonRepository } from "../repositories/person-repository.ts";
import type { NoteSnapshotRepository } from "../repositories/note-snapshot-repository.ts";

/** Max characters of a thought's content shown in the archive-list preview. */
const ARCHIVE_PREVIEW_LENGTH = 80;

/** Review-queue thresholds (days). Staleness/archival are multi-signal and
 * conservative — a thought must be genuinely old AND unretrieved before it is
 * even surfaced for human review (never auto-applied, never score-alone). */
const STALE_AGE_DAYS = 30;
const STALE_UNRETRIEVED_DAYS = 30;
const ARCHIVAL_AGE_DAYS = 90;
const REVIEW_QUEUE_LIMIT = 50;

/** Selecting more than this fraction of a result set is a rubber-stamp (each id
 * gets less weight than a selective pick). Relative ordering is fixed; the exact
 * threshold/curve is a tunable constant. */
const RUBBER_STAMP_RATIO = 0.75;

/** ISO timestamp `days` before now. */
function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Advances the retrieval-recency signal for the given thoughts. Best-effort by
 * design — a touch failure must never break the read that triggered it — but
 * never silent: a failure is logged with the calling site so a broken
 * `last_retrieved_at` update (which would slowly poison the stale/archival
 * review queues) is diagnosable (TOOL-5). Shared by the three retrieval sites.
 */
export async function touchRetrievedLogged(
  thoughtRepository: ThoughtRepository,
  thoughtIds: string[],
  contextLabel: string,
): Promise<void> {
  const { error } = await thoughtRepository.touchRetrieved(thoughtIds);
  if (error) {
    console.error(`${contextLabel} touchRetrieved error: ${error.message}`);
  }
}

interface ThoughtUpdateFields {
  content?: string;
  reliability?: string;
  author?: string;
  project_ids?: string[];
  document_ids?: string[];
  /** Actor of this edit: LLM | user | sync. Recorded on every mutation. */
  actor?: string;
}

/**
 * Build the update payload + human-readable field list for update_thought,
 * shared by the content and non-content cases. They differ ONLY in that the
 * content case regenerates embedding+metadata and always writes metadata, and in
 * the order fields appear in the confirmation: the content path lists reference
 * fields before top-level fields; the non-content path lists top-level fields
 * first. Both orderings are preserved verbatim from the pre-refactor branches.
 */
export async function buildThoughtUpdate(
  aiProvider: AiProvider,
  existingMetadata: Record<string, unknown>,
  fields: ThoughtUpdateFields,
): Promise<
  { updatePayload: Record<string, unknown>; updatedFields: string[] }
> {
  const { content, reliability, author, project_ids, document_ids, actor } =
    fields;
  const existingReferences = (existingMetadata.references || {}) as Record<
    string,
    string[]
  >;

  const updatePayload: Record<string, unknown> = {};
  // Every mutation records its actor through the one update path (Invariant 2).
  updatePayload.last_actor = actor ?? "LLM";
  const updatedReferences = { ...existingReferences };
  let referencesChanged = false;
  const referenceFields: string[] = [];
  if (project_ids !== undefined) {
    updatedReferences.projects = project_ids;
    referencesChanged = true;
    referenceFields.push("project_ids");
  }
  if (document_ids !== undefined) {
    updatedReferences.documents = document_ids;
    referencesChanged = true;
    referenceFields.push("document_ids");
  }

  const topLevelFields: string[] = [];
  if (reliability !== undefined) {
    updatePayload.reliability = reliability;
    topLevelFields.push("reliability");
  }
  if (author !== undefined) {
    updatePayload.author = author;
    topLevelFields.push("author");
  }

  if (content !== undefined) {
    // Content path: regenerate embedding + metadata; metadata is always
    // rewritten (re-extracted fields, preserved source, updated references).
    const [embedding, newMetadata] = await Promise.all([
      getEmbedding(aiProvider, content),
      extractMetadata(aiProvider, content),
    ]);
    updatePayload.content = content;
    updatePayload.embedding = embedding;
    // INVARIANT 1: re-hash in the one update path so the stored hash tracks the
    // current text. Emptying content is a valid edit — hash of "" is stored.
    updatePayload.content_hash = await hashContent(content);
    updatePayload.metadata = {
      ...existingMetadata,
      ...(newMetadata as Record<string, unknown>),
      source: existingMetadata.source,
      references: updatedReferences,
    };
    return {
      updatePayload,
      updatedFields: [
        "content (embedding + metadata regenerated)",
        ...referenceFields,
        ...topLevelFields,
      ],
    };
  }

  // Non-content path: no AI calls; metadata written only when references changed.
  if (referencesChanged) {
    updatePayload.metadata = {
      ...existingMetadata,
      references: updatedReferences,
    };
  }
  return {
    updatePayload,
    updatedFields: [...topLevelFields, ...referenceFields],
  };
}

export function register(
  server: McpServer,
  supabase: SupabaseClient,
  logger: FunctionCallLogger,
  aiProvider: AiProvider,
  thoughtRepository: ThoughtRepository,
  taskRepository: TaskRepository,
  projectRepository: ProjectRepository,
  personRepository: PersonRepository,
  quotaGate: AiQuotaGate,
) {
  // Tool 1: Semantic Search
  server.registerTool(
    "search_thoughts",
    {
      title: "Search Thoughts",
      description:
        "Semantic search across all captured thoughts using meaning, not keywords. " +
        "Use this when the user asks about a topic, person, idea, or decision — even if they phrase it differently from how it was originally captured. " +
        "Returns the most relevant thoughts ranked by similarity. " +
        "Optionally filter results by author (model identifier) or reliability level. " +
        "Prefer this over list_thoughts when the user has a specific question; use list_thoughts for browsing or filtering by type/date. " +
        "CRITICAL: Before your next user-facing response, you MUST call record_useful_thoughts with the IDs of any thoughts that contributed to your answer. " +
        "If none contributed, call it with an empty array to acknowledge the scan. " +
        "Also scan the returned thoughts for contradictions or clearly outdated information — if you notice any, flag them to the user in your response (do NOT archive silently).",
      inputSchema: {
        query: z.string().describe(
          "Natural language description of what to search for — works best as a phrase or sentence, not single keywords",
        ),
        limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional().default(
          DEFAULT_THOUGHT_LIMIT,
        ),
        threshold: z.number().optional().default(0.5),
        author: z.string().optional().describe(
          "Filter by the model that authored the thought, e.g. 'claude-sonnet-4-6' or 'gpt-4o-mini'",
        ),
        reliability: z.enum(RELIABILITIES).optional().describe(
          "Filter by reliability level: 'reliable' or 'less reliable'",
        ),
      },
    },
    withMcpLogging(
      "search_thoughts",
      // Metered AI operation (Step 15): refused before any embedding when over
      // quota, with a distinct quota-exceeded error (never an empty "no results").
      withAiQuota(
        quotaGate,
        async ({ query, limit, threshold, author, reliability }) => {
          const queryEmbedding = await getEmbedding(aiProvider, query);
          const { data, error } = await thoughtRepository.matchByEmbedding({
            embedding: queryEmbedding,
            threshold,
            count: limit,
            author: author || null,
            reliability: reliability || null,
          });

          if (error) {
            return errorResult(`Search error: ${error.message}`);
          }

          if (!data || data.length === 0) {
            return textResult(`No thoughts found matching "${query}".`, {
              recordsReturned: 0,
            });
          }

          // Collect all project UUIDs and resolve to names
          const allProjectUuids: string[] = [];
          for (const thought of data) {
            const projectRefs = getProjectRefs(
              (thought.metadata || {}) as Record<string, unknown>,
            );
            allProjectUuids.push(...projectRefs);
          }
          const projectNameMap = await resolveNames(
            supabase,
            "projects",
            allProjectUuids,
          );

          const results = data.map(
            (thought, i: number) => {
              const metadata = (thought.metadata ?? {}) as Record<
                string,
                unknown
              >;
              const parts = [
                `--- Result ${i + 1} (${
                  (thought.similarity * 100).toFixed(1)
                }% match) ---`,
                `ID: ${thought.id}`,
                `Captured: ${new Date(thought.created_at).toISOString()}`,
              ];
              if (thought.updated_at) {
                parts.push(
                  `Updated: ${new Date(thought.updated_at).toISOString()}`,
                );
              }
              parts.push(`Type: ${metadata.type || "unknown"}`);
              if (thought.reliability || thought.author) {
                const provenanceParts: string[] = [];
                if (thought.reliability) {
                  provenanceParts.push(
                    `Reliability: ${thought.reliability}`,
                  );
                }
                if (thought.author) {
                  provenanceParts.push(`Author: ${thought.author}`);
                }
                parts.push(provenanceParts.join(" | "));
              }
              if (Array.isArray(metadata.topics) && metadata.topics.length) {
                parts.push(
                  `Topics: ${(metadata.topics as string[]).join(", ")}`,
                );
              }
              if (Array.isArray(metadata.people) && metadata.people.length) {
                parts.push(
                  `People: ${(metadata.people as string[]).join(", ")}`,
                );
              }
              const projectRefs = getProjectRefs(
                metadata as Record<string, unknown>,
              );
              if (projectRefs.length > 0) {
                const projectNames = projectRefs.map((uuid) =>
                  projectNameMap.get(uuid) || uuid
                );
                parts.push(`Projects: ${projectNames.join(", ")}`);
              }
              if (
                Array.isArray(metadata.action_items) &&
                metadata.action_items.length
              ) {
                parts.push(
                  `Actions: ${(metadata.action_items as string[]).join("; ")}`,
                );
              }
              parts.push(`\n${thought.content}`);
              return parts.join("\n");
            },
          );

          const thoughtIds = data.map((thought: { id: string }) => thought.id);
          // search_thoughts intentionally emits the reminder as BOTH header and
          // footer: a long results block pushes the header far up the context
          // window, so repeating the required-action reminder at the end keeps it
          // adjacent to where the model resumes generating.
          // Advance the retrieval-recency signal (best-effort; a touch failure
          // never breaks the read). Independent of usefulness recording.
          await touchRetrievedLogged(
            thoughtRepository,
            thoughtIds,
            "search_thoughts",
          );

          const header = buildUsefulnessHeader(thoughtIds, "hard");
          const footer = buildUsefulnessReminder(thoughtIds, "hard");

          return textResult(
            `${header}Found ${data.length} thought(s):\n\n${
              results.join("\n\n")
            }\n\n${footer}`,
            { recordsReturned: data.length, returnedIds: thoughtIds },
          );
        },
      ),
      logger,
    ),
  );

  // Tool 2: List Recent
  server.registerTool(
    "list_thoughts",
    {
      title: "List Recent Thoughts",
      description:
        "Browse recent thoughts chronologically with optional filters. " +
        "Use this when the user wants to see what's been captured lately, review thoughts by category, or check activity for a time period. " +
        "Supports filtering by type, topic, person, time window, project, author (model identifier), or reliability level. " +
        "Prefer search_thoughts when the user has a specific question; use this for open-ended browsing like 'what did I capture this week?' or 'show me all person_notes'. " +
        "CRITICAL: Before your next user-facing response, you MUST call record_useful_thoughts with the IDs of any thoughts that contributed to your answer. " +
        "If none contributed (common when browsing), call it with an empty array to acknowledge the scan. " +
        "Also scan the returned thoughts for contradictions or clearly outdated information — if you notice any, flag them to the user in your response (do NOT archive silently).",
      inputSchema: {
        limit: z.number().int().min(1).max(MAX_QUERY_LIMIT).optional().default(
          DEFAULT_THOUGHT_LIMIT,
        ),
        type: z.enum(THOUGHT_TYPES).optional().describe(
          "Filter by type: observation, task, idea, reference, person_note",
        ),
        topic: z.string().optional().describe("Filter by topic tag"),
        person: z.string().optional().describe("Filter by person mentioned"),
        days: z.number().optional().describe(
          "Only thoughts from the last N days",
        ),
        project_id: uuidField().optional().describe(
          "Filter by project UUID — matches thoughts whose metadata.references.projects array contains this UUID",
        ),
        author: z.string().optional().describe(
          "Filter by the model that authored the thought, e.g. 'claude-sonnet-4-6' or 'gpt-4o-mini'",
        ),
        reliability: z.enum(RELIABILITIES).optional().describe(
          "Filter by reliability level: 'reliable' or 'less reliable'",
        ),
        include_archived: z.boolean().optional().default(false).describe(
          "Include archived thoughts in results (default: false)",
        ),
      },
    },
    withMcpLogging(
      "list_thoughts",
      async (
        {
          limit,
          type,
          topic,
          person,
          days,
          project_id,
          author,
          reliability,
          include_archived,
        },
      ) => {
        const { data, error } = await thoughtRepository.list({
          limit,
          includeArchived: include_archived,
          type,
          topic,
          person,
          projectId: project_id,
          author,
          reliability,
          days,
        });

        if (error) {
          return errorResult(`Error: ${error.message}`);
        }

        if (!data || !data.length) {
          return textResult("No thoughts found.", { recordsReturned: 0 });
        }

        // Collect all project UUIDs and resolve to names
        const allProjectUuids: string[] = [];
        for (const thought of data) {
          const projectRefs = getProjectRefs(
            (thought.metadata || {}) as Record<string, unknown>,
          );
          allProjectUuids.push(...projectRefs);
        }
        const projectNameMap = await resolveNames(
          supabase,
          "projects",
          allProjectUuids,
        );

        const results = data.map(
          (thought, i: number) => {
            const metadata = (thought.metadata ?? {}) as Record<
              string,
              unknown
            >;
            const tags = Array.isArray(metadata.topics)
              ? (metadata.topics as string[]).join(", ")
              : "";
            const parts = [
              `${i + 1}. [${
                thought.created_at
                  ? new Date(thought.created_at).toISOString()
                  : "unknown"
              }] (${metadata.type || "??"}${tags ? " - " + tags : ""})`,
              `   ID: ${thought.id}`,
            ];
            if (thought.updated_at) {
              parts.push(
                `   Updated: ${new Date(thought.updated_at).toISOString()}`,
              );
            }
            if (thought.reliability || thought.author) {
              const provenanceParts: string[] = [];
              if (thought.reliability) {
                provenanceParts.push(
                  `Reliability: ${thought.reliability}`,
                );
              }
              if (thought.author) {
                provenanceParts.push(`Author: ${thought.author}`);
              }
              parts.push(`   ${provenanceParts.join(" | ")}`);
            }
            const projectRefs = getProjectRefs(
              metadata as Record<string, unknown>,
            );
            if (projectRefs.length > 0) {
              const projectNames = projectRefs.map((uuid) =>
                projectNameMap.get(uuid) || uuid
              );
              parts.push(`   Projects: ${projectNames.join(", ")}`);
            }
            parts.push(`   ${thought.content}`);
            return parts.join("\n");
          },
        );

        const thoughtIds = data.map((thought: { id: string }) => thought.id);
        // Advance retrieval recency (best-effort, non-fatal).
        await touchRetrievedLogged(
          thoughtRepository,
          thoughtIds,
          "list_thoughts",
        );
        const header = buildUsefulnessHeader(thoughtIds, "soft");
        const footer = buildUsefulnessReminder(thoughtIds, "soft");

        return textResult(
          `${header}${data.length} recent thought(s):\n\n${
            results.join("\n\n")
          }\n\n${footer}`,
          { recordsReturned: data.length, returnedIds: thoughtIds },
        );
      },
      logger,
    ),
  );

  // Tool 3: Stats
  server.registerTool(
    "thought_stats",
    {
      title: "Thought Statistics",
      description:
        "Get high-level statistics about the knowledge base: total thought count, breakdown by type, most frequent topics, and people mentioned. " +
        "Optionally filter by project_id to see stats for a specific project. " +
        "Use this to orient yourself when starting a conversation, to answer 'how much is in my brain?', or to discover which topics and people appear most often.",
      inputSchema: {
        project_id: uuidField().optional().describe(
          "Filter statistics to a specific project UUID — only counts thoughts linked to this project",
        ),
      },
    },
    withMcpLogging("thought_stats", async ({ project_id }) => {
      // Aggregation is computed in the DB (thought_stats RPC), not by loading
      // every row into the function (finding 7.3).
      const { data: stats, error } = await thoughtRepository.stats(project_id);
      if (error || !stats) {
        return errorResult(
          `Error computing stats: ${error?.message || "unknown"}`,
        );
      }

      const lines: string[] = [
        `Total thoughts: ${stats.total}`,
        `Date range: ${
          stats.oldest && stats.newest
            ? new Date(stats.oldest).toLocaleDateString() +
              " → " +
              new Date(stats.newest).toLocaleDateString()
            : "N/A"
        }`,
        "",
        "Types:",
        ...stats.types.map(({ key, count }) => `  ${key}: ${count}`),
      ];

      if (stats.topics.length) {
        lines.push("", "Top topics:");
        for (const { key, count } of stats.topics) {
          lines.push(`  ${key}: ${count}`);
        }
      }

      if (stats.people.length) {
        lines.push("", "People mentioned:");
        for (const { key, count } of stats.people) {
          lines.push(`  ${key}: ${count}`);
        }
      }

      return textResult(lines.join("\n"));
    }, logger),
  );

  // Tool 4: Get Thought by ID
  server.registerTool(
    "get_thought_by_id",
    {
      title: "Get Thought by ID",
      description: "Retrieve a single thought by its UUID. " +
        "Use this when you have a specific thought ID (e.g. from search results, task references, or a previous conversation) and need its full content and metadata.",
      inputSchema: {
        id: uuidField().describe("The UUID of the thought to retrieve"),
      },
    },
    withMcpLogging("get_thought_by_id", async ({ id }) => {
      const { data, error } = await thoughtRepository.findById(id);

      if (error) {
        return error.code === "PGRST116"
          ? textResult(`No thought found with ID "${id}".`, {
            recordsReturned: 0,
          })
          : errorResult(`Error: ${error.message}`);
      }
      if (!data) {
        return textResult(`No thought found with ID "${id}".`, {
          recordsReturned: 0,
        });
      }

      // Advance retrieval recency (best-effort, non-fatal) — independent of the
      // usefulness auto-record below.
      await touchRetrievedLogged(
        thoughtRepository,
        [data.id],
        "get_thought_by_id",
      );

      // A fetch by ID implies the caller found the thought useful — auto-record
      // so the model doesn't need to make a separate record_useful_thoughts call.
      // Failures here must not break the fetch itself.
      const { error: usefulnessError } = await thoughtRepository
        .incrementUsefulness([data.id]);
      if (usefulnessError) {
        console.error(
          `get_thought_by_id auto-record error: ${usefulnessError.message}`,
        );
      }

      const metadata = (data.metadata || {}) as Record<string, unknown>;
      const lines: string[] = [
        `ID: ${data.id}`,
        `Captured: ${
          data.created_at ? new Date(data.created_at).toISOString() : "unknown"
        }`,
      ];
      if (data.updated_at) {
        lines.push(`Updated: ${new Date(data.updated_at).toISOString()}`);
      }
      lines.push(`Type: ${metadata.type || "unknown"}`);
      if (data.reference_id) lines.push(`Source: ${data.reference_id}`);
      if (Array.isArray(metadata.topics) && metadata.topics.length) {
        lines.push(`Topics: ${(metadata.topics as string[]).join(", ")}`);
      }
      if (Array.isArray(metadata.people) && metadata.people.length) {
        lines.push(`People: ${(metadata.people as string[]).join(", ")}`);
      }
      if (
        Array.isArray(metadata.action_items) && metadata.action_items.length
      ) {
        lines.push(
          `Actions: ${(metadata.action_items as string[]).join("; ")}`,
        );
      }
      const references = metadata.references as
        | Record<string, string[]>
        | undefined;
      if (references) {
        if (references.projects?.length) {
          lines.push(`Projects: ${references.projects.join(", ")}`);
        }
        if (references.tasks?.length) {
          lines.push(`Tasks: ${references.tasks.join(", ")}`);
        }
        if (references.people?.length) {
          lines.push(`People refs: ${references.people.join(", ")}`);
        }
      }
      lines.push(`\n${data.content}`);

      return textResult(lines.join("\n"), {
        recordsReturned: 1,
        returnedIds: [data.id],
      });
    }, logger),
  );

  // Tool 5: Capture Thought
  server.registerTool(
    "capture_thought",
    {
      title: "Capture Thought",
      description:
        "Save a single thought directly to the knowledge base, stored verbatim. If you are an AI, use this function — do NOT use ingest_note, which paraphrases and is for the Obsidian plugin only. " +
        "Generates an embedding and extracts metadata (type, topics, people, action items) automatically for consistency. " +
        "Each thought should be a clear, self-contained statement. " +
        "Pass your model name as author (e.g. 'claude-sonnet-4-6') and any known project_ids to link projects explicitly. " +
        "If this thought was derived from a document stored via write_document, pass the document UUID as document_ids to create a bidirectional link. " +
        "If this thought was synthesized from prior thoughts you retrieved via search_thoughts, pass their UUIDs as builds_on — each listed thought's usefulness score is incremented as a side effect, which closes the feedback loop inside this call. " +
        "builds_on is additive to record_useful_thoughts, not a replacement: a thought that both answered the user's question AND became a source for this new thought is genuinely worth crediting twice. " +
        "Reliability is hardcoded to 'reliable' for all calls to this function.",
      inputSchema: {
        content: z.string().describe(
          "The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI",
        ),
        author: z.string().optional().describe(
          "Model identifier of the AI writing this thought, e.g. 'claude-sonnet-4-6'. Stored for provenance — informational only.",
        ),
        project_ids: uuidField().array().optional().describe(
          "UUIDs of projects to explicitly associate with this thought, merged with any projects the extractor finds.",
        ),
        document_ids: uuidField().array().optional().describe(
          "UUIDs of source documents this thought was derived from (e.g. from write_document). Stored in metadata.references.documents for traceability.",
        ),
        builds_on: uuidField()
          .array()
          .optional()
          .describe(
            "UUIDs of prior thoughts this new thought was synthesized from. Each listed thought's usefulness_score is incremented by 1 as a side effect after the insert succeeds. Additive to record_useful_thoughts.",
          ),
      },
    },
    withMcpLogging(
      "capture_thought",
      // Metered AI operation (Step 15): refused before any embedding/extraction
      // when over quota, with a distinct quota-exceeded error; no thought written.
      withAiQuota(
        quotaGate,
        async ({ content, author, project_ids, document_ids, builds_on }) => {
          // Run structural parser + extractor pipeline (shared wrapper owns
          // the try/abort/warn logic — TOOL-12).
          const extractionRun = await runExtractionForTool({
            parse: () => parseNote(content, null, null, "mcp"),
            deps: {
              supabase,
              aiProvider,
              taskRepository,
              projectRepository,
              personRepository,
            },
            site: "capture_thought",
          });
          if (extractionRun.status === "aborted") {
            // A seed read failed: proceeding would risk duplicate task/project
            // writes, so abort and write nothing (EXTR-2).
            return errorResult(
              `Capture aborted — could not read existing references ` +
                `(${extractionRun.reason}). No thought was written to avoid ` +
                `duplicates; please retry.`,
            );
          }
          let references = extractionRun.references;
          const extractionWarning = extractionRun.warning;

          // Merge explicit project_ids with pipeline-detected projects (union, deduplicated)
          if (project_ids && project_ids.length > 0) {
            const pipelineProjects: string[] = references.projects || [];
            const merged = [...new Set([...pipelineProjects, ...project_ids])];
            references = { ...references, projects: merged };
          }

          // Merge explicit document_ids into references (same union pattern)
          if (document_ids && document_ids.length > 0) {
            const existing: string[] = references.documents || [];
            const merged = [...new Set([...existing, ...document_ids])];
            references = { ...references, documents: merged };
          }

          const [embedding, metadata] = await Promise.all([
            getEmbedding(aiProvider, content),
            extractMetadata(aiProvider, content),
          ]);
          const contentHash = await hashContent(content);

          // Write-time dedup gate (server-side, not prompt-nudge): a byte-identical
          // or within-band restatement is dropped in favor of the existing thought;
          // a cross-context near-duplicate is kept and routed to supersession.
          const dedup = await resolveDedup(
            thoughtRepository,
            contentHash,
            embedding,
          );
          if (dedup.duplicateOf) {
            return textResult(
              `Already captured — kept the existing thought (no duplicate created).${extractionWarning}`,
            );
          }
          // When the dedup check itself failed (CORE-2), we still capture, but
          // flag that this may duplicate an existing thought.
          const dedupNote = dedup.degraded
            ? " (note: duplicate check was unavailable, so this may duplicate an existing thought)"
            : "";

          const { error } = await thoughtRepository.insert({
            content,
            embedding,
            reliability: "reliable",
            author: author || null,
            content_hash: contentHash,
            last_actor: "LLM",
            metadata: { ...metadata, source: "mcp", references },
          });

          if (error) {
            // The partial unique index on content_hash makes exact dedup atomic
            // under concurrency (TOOL-7): a 23505 means a concurrent capture
            // already stored this exact content — the same "already captured"
            // success outcome, never an error.
            if (error.code === "23505") {
              return textResult(
                `Already captured — kept the existing thought (no duplicate created).${extractionWarning}`,
              );
            }
            return errorResult(`Failed to capture: ${error.message}`);
          }

          let buildsOnNote = "";
          if (builds_on && builds_on.length > 0) {
            const { data: creditedCount, error: buildsOnError } =
              await thoughtRepository.incrementUsefulness(builds_on);
            if (buildsOnError) {
              console.error(
                `capture_thought builds_on error: ${buildsOnError.message}`,
              );
              buildsOnNote =
                ` — failed to credit sources: ${buildsOnError.message}`;
            } else {
              buildsOnNote =
                ` — credited ${creditedCount} prior thought(s) as sources.`;
            }
          }

          const meta = metadata as Record<string, unknown>;
          let confirmation = `Captured as ${meta.type || "thought"}`;
          if (Array.isArray(meta.topics) && meta.topics.length) {
            confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
          }
          if (Array.isArray(meta.people) && meta.people.length) {
            confirmation += ` | People: ${
              (meta.people as string[]).join(", ")
            }`;
          }
          if (Array.isArray(meta.action_items) && meta.action_items.length) {
            confirmation += ` | Actions: ${
              (meta.action_items as string[]).join("; ")
            }`;
          }
          confirmation += buildsOnNote;
          confirmation += extractionWarning;
          confirmation += dedupNote;

          return textResult(confirmation);
        },
      ),
      logger,
    ),
  );

  // Tool 6: Update Thought
  server.registerTool(
    "update_thought",
    {
      title: "Update Thought",
      description:
        "Update an existing thought's content, reliability, author, or project/document associations. " +
        "At least one optional field must be provided. " +
        "When content is updated, the embedding and metadata (type, topics, people, action_items, dates_mentioned) are regenerated automatically. " +
        "When only non-content fields are updated, no AI processing occurs — changes are applied directly. " +
        "project_ids and document_ids use REPLACE semantics: the provided array becomes the new value (not merged with existing). " +
        "Pass project_ids: [] to clear all project links. " +
        "Original created_at, reference_id, note_snapshot_id, and metadata.source are always preserved.",
      inputSchema: {
        id: uuidField().describe("UUID of the thought to update"),
        content: z.string().optional().describe(
          "New thought content — triggers embedding regeneration and metadata re-extraction",
        ),
        reliability: z.enum(RELIABILITIES).optional().describe(
          "New reliability level: 'reliable' or 'less reliable'",
        ),
        author: z.string().optional().describe(
          "New author attribution, e.g. 'claude-sonnet-4-6'",
        ),
        project_ids: uuidField().array().optional().describe(
          "Replace project associations — these UUIDs become the new metadata.references.projects array",
        ),
        document_ids: uuidField().array().optional().describe(
          "Replace document associations — these UUIDs become the new metadata.references.documents array",
        ),
        actor: z.enum(["LLM", "user", "sync"]).optional().describe(
          "Who is making this edit (default LLM). The console passes 'user'; connectors pass 'sync' — all through this same update path.",
        ),
      },
    },
    withMcpLogging(
      "update_thought",
      async (
        { id, content, reliability, author, project_ids, document_ids, actor },
      ) => {
        // Validate at least one optional field is provided
        if (
          content === undefined &&
          reliability === undefined &&
          author === undefined &&
          project_ids === undefined &&
          document_ids === undefined
        ) {
          return errorResult(
            "At least one of content, reliability, author, project_ids, or document_ids must be provided.",
          );
        }

        // Fetch existing thought
        const { data: existing, error: fetchError } = await thoughtRepository
          .findForUpdate(id);

        if (fetchError || !existing) {
          return errorResult("Thought not found.");
        }

        const existingMetadata = (existing.metadata || {}) as Record<
          string,
          unknown
        >;

        const { updatePayload, updatedFields } = await buildThoughtUpdate(
          aiProvider,
          existingMetadata,
          { content, reliability, author, project_ids, document_ids, actor },
        );

        const { error: updateError } = await thoughtRepository.update(
          id,
          updatePayload,
        );

        if (updateError) {
          return errorResult(`Update failed: ${updateError.message}`);
        }

        return textResult(`Thought updated: ${updatedFields.join(", ")}`);
      },
      logger,
    ),
  );

  // Tool 7: Record Useful Thoughts
  server.registerTool(
    "record_useful_thoughts",
    {
      title: "Record Useful Thoughts",
      description:
        "Record which thoughts were useful during this interaction by incrementing their usefulness score. " +
        "Call this after every search_thoughts call — it is required, not optional. " +
        "Pass the IDs of thoughts that contributed to your answer. " +
        "If none of the returned thoughts contributed, pass an empty array to acknowledge the scan — an empty array is the correct input in that case, not a reason to skip the call. " +
        "This feedback loop helps surface the most valuable thoughts in future queries. " +
        "Pass returned_ids (the full set of IDs a preceding search/list returned) so a " +
        "SELECTIVE pick counts for more per thought than a rubber-stamp that marks nearly everything useful.",
      inputSchema: {
        thought_ids: uuidField()
          .array()
          .describe(
            "Array of thought UUIDs that were useful in this interaction. Pass [] if no returned thought contributed — that is the correct value, not a reason to skip the call.",
          ),
        returned_ids: uuidField()
          .array()
          .optional()
          .describe(
            "The full result set (all IDs the preceding search/list returned) the selection was drawn from. Enables rubber-stamp down-weighting; defaults to the selection itself when omitted.",
          ),
      },
    },
    withMcpLogging(
      "record_useful_thoughts",
      async ({ thought_ids, returned_ids }) => {
        // Rubber-stamp down-weighting: a selection covering nearly all of the
        // result set carries little information, so each id gets less. The
        // observable rule (selective out-weights all-selecting per id) is fixed;
        // the exact curve is a tunable constant.
        const resultSetSize = returned_ids && returned_ids.length > 0
          ? returned_ids.length
          : thought_ids.length;
        const ratio = resultSetSize > 0
          ? thought_ids.length / resultSetSize
          : 1;
        const weight = ratio > RUBBER_STAMP_RATIO ? 1 : 2;

        const { data: affectedCount, error } = await thoughtRepository
          .incrementUsefulnessWeighted(thought_ids, weight);

        if (error) {
          return errorResult(`Failed to record usefulness: ${error.message}`);
        }

        return textResult(
          `Recorded usefulness for ${affectedCount} thought(s) out of ${thought_ids.length} provided.`,
        );
      },
      logger,
    ),
  );

  // Tool 8: Archive Thought
  server.registerTool(
    "archive_thought",
    {
      title: "Archive Thought",
      description: "Archive a thought by setting its archived_at timestamp. " +
        "Archived thoughts are hidden from search, listing, and stats by default — they are not deleted and can still be retrieved with include_archived. " +
        "Use this when a thought is outdated, incorrect, or no longer relevant. Confirm with the user before archiving.",
      inputSchema: {
        id: uuidField().describe("UUID of the thought to archive"),
      },
    },
    withMcpLogging("archive_thought", async ({ id }) => {
      const { data: thought, error: fetchError } = await thoughtRepository
        .findActiveById(id);

      if (fetchError || !thought) {
        return errorResult(
          `Thought not found or already archived: ${
            fetchError?.message || "unknown"
          }`,
        );
      }

      const { error: archiveError } = await thoughtRepository.archive(id);

      if (archiveError) {
        return errorResult(`Archive failed: ${archiveError.message}`);
      }

      const preview = thought.content.length > ARCHIVE_PREVIEW_LENGTH
        ? thought.content.slice(0, ARCHIVE_PREVIEW_LENGTH) + "…"
        : thought.content;
      return textResult(`Archived thought: "${preview}"`);
    }, logger),
  );

  // Tool: Resolve Supersession — set or clear the supersedes edge (reversible).
  server.registerTool(
    "resolve_supersession",
    {
      title: "Resolve Supersession",
      description:
        "Mark one thought as superseded by another (contradiction handling by " +
        "supersession, not deletion), or clear an existing supersedes edge. A " +
        "superseded thought is excluded from default search but kept and " +
        "retrievable by id, so the edge is fully reversible.",
      inputSchema: {
        id: uuidField().describe("UUID of the thought being superseded"),
        superseded_by: uuidField().optional().describe(
          "UUID of the replacing thought; omit to CLEAR the edge (un-supersede)",
        ),
      },
    },
    withMcpLogging("resolve_supersession", async ({ id, superseded_by }) => {
      const { error } = await thoughtRepository.setSupersededBy(
        id,
        superseded_by ?? null,
      );
      if (error) return errorResult(`Resolve failed: ${error.message}`);
      return textResult(
        superseded_by
          ? `Thought ${id} marked superseded by ${superseded_by}.`
          : `Cleared the supersedes edge on thought ${id}.`,
      );
    }, logger),
  );

  // Tool: Get Stale Thoughts — a review queue (multi-signal, never score alone).
  server.registerTool(
    "get_stale_thoughts",
    {
      title: "Get Stale Thoughts",
      description:
        "Return a review queue of thoughts that look stale: old AND not " +
        "retrieved recently. This is a REVIEW surface only — nothing is " +
        "archived automatically. A score-0 thought that was retrieved recently " +
        "is NOT stale (score 0 means 'no data', not 'not useful').",
      inputSchema: {},
    },
    withMcpLogging("get_stale_thoughts", async () => {
      const { data, error } = await thoughtRepository.findStale(
        isoDaysAgo(STALE_AGE_DAYS),
        isoDaysAgo(STALE_UNRETRIEVED_DAYS),
        REVIEW_QUEUE_LIMIT,
      );
      if (error) return errorResult(`Stale query failed: ${error.message}`);
      const rows = data ?? [];
      return textResult(
        formatReviewQueue("stale", rows),
        {
          recordsReturned: rows.length,
          returnedIds: rows.map((row) => row.id),
        },
      );
    }, logger),
  );

  // Tool: Get Archival Queue — the full conjunction, surfaced for consent.
  server.registerTool(
    "get_archival_queue",
    {
      title: "Get Archival Queue",
      description:
        "Return the archival review queue: thoughts that are old AND score 0 AND " +
        "never retrieved AND not owned by a synced note. Surfaced for a " +
        "consented archive decision — never auto-applied. Confirm with the user " +
        "before archiving any item (use archive_thought).",
      inputSchema: {},
    },
    withMcpLogging("get_archival_queue", async () => {
      const { data, error } = await thoughtRepository.findArchivalCandidates(
        isoDaysAgo(ARCHIVAL_AGE_DAYS),
        REVIEW_QUEUE_LIMIT,
      );
      if (error) return errorResult(`Archival query failed: ${error.message}`);
      const rows = data ?? [];
      return textResult(
        formatReviewQueue("archival", rows),
        {
          recordsReturned: rows.length,
          returnedIds: rows.map((row) => row.id),
        },
      );
    }, logger),
  );
}

/** Render a review queue as a compact, id-first text block. */
function formatReviewQueue(
  label: string,
  rows: { id: string; content: string; created_at: string | null }[],
): string {
  if (rows.length === 0) {
    return `No thoughts in the ${label} review queue.`;
  }
  const lines = rows.map((row) => {
    const preview = row.content.length > ARCHIVE_PREVIEW_LENGTH
      ? row.content.slice(0, ARCHIVE_PREVIEW_LENGTH) + "…"
      : row.content;
    return `- ${row.id}: "${preview}"`;
  });
  return `${rows.length} thought(s) in the ${label} review queue ` +
    `(review only — not auto-applied):\n${lines.join("\n")}`;
}

// ─── Standalone ingest_note handler (called via direct HTTP route, not MCP) ──

const INGEST_PROVENANCE = {
  reliability: "less reliable",
  author: "gpt-4o-mini",
};

// The repository DTO for a note's existing thoughts is the single source of
// truth for this shape (Step 24) — no separate hand-written duplicate.
type ExistingThought = ThoughtByReferenceRow;

export interface ReconciliationPlan {
  keep: string[];
  update: { id: string; content: string }[];
  add: string[];
  delete: string[];
}

/**
 * Runtime schema for the LLM reconciliation plan (TOOL-1). The plan drives
 * irreversible mutations (content overwrite, archive), so it is PARSED, never
 * cast: a wrong shape (non-array field, an `update` entry missing `content`, an
 * `add` entry that is an object rather than a bare string) fails validation and
 * is thrown as an `AiProviderParseError`, which the caller degrades to a safe
 * fresh ingest. Ids are validated structurally here; the belonging check (that
 * an id is actually one of THIS note's thoughts) is a separate allowlist pass in
 * `filterPlanToKnownIds`, so a hallucinated UUID can never reach a mutation.
 */
const ReconciliationPlanSchema = z.object({
  keep: z.array(z.string()).default([]),
  update: z.array(z.object({ id: z.string(), content: z.string().min(1) }))
    .default([]),
  add: z.array(z.string().min(1)).default([]),
  delete: z.array(z.string()).default([]),
});

/**
 * Drops every `keep`/`update`/`delete` id that is not one of this note's own
 * thoughts (TOOL-1 allowlist). A valid-but-foreign UUID from the LLM would
 * otherwise overwrite or archive an unrelated thought. `add` entries are new
 * content, not ids, so they are never allowlisted.
 */
function filterPlanToKnownIds(
  plan: ReconciliationPlan,
  knownIds: Set<string>,
): ReconciliationPlan {
  const droppedIds: string[] = [];
  const isKnown = (id: string): boolean => {
    if (knownIds.has(id)) return true;
    droppedIds.push(id);
    return false;
  };
  const filtered: ReconciliationPlan = {
    keep: plan.keep.filter(isKnown),
    update: plan.update.filter((item) => isKnown(item.id)),
    add: plan.add,
    delete: plan.delete.filter(isKnown),
  };
  if (droppedIds.length > 0) {
    console.warn(
      `Reconciliation dropped ${droppedIds.length} hallucinated id(s) not in this note: ${
        droppedIds.join(", ")
      }`,
    );
  }
  return filtered;
}

interface IngestResult {
  success: boolean;
  message?: string;
  error?: string;
}

/** Map a freshIngest McpToolResult onto the ingest-route result shape. */
function freshIngestResult(
  result: { isError?: boolean; content: { text: string }[] },
): IngestResult {
  return {
    success: !result.isError,
    message: result.content[0].text,
    ...(result.isError ? { error: result.content[0].text } : {}),
  };
}

/**
 * Step 0 — skip if the stored snapshot content equals the incoming content
 * (prevents duplicate ingestion from Obsidian Sync). Returns false when there is
 * no note_id to compare against.
 */
async function checkUnchanged(
  noteSnapshotRepository: NoteSnapshotRepository,
  noteId: string | undefined,
  content: string,
): Promise<boolean> {
  if (!noteId) return false;
  const { data: existing } = await noteSnapshotRepository
    .findContentByReference(noteId);
  return !!(existing && existing.content === content);
}

/**
 * Step 1 — upsert the note snapshot, returning its id (or null when there is no
 * note_id, or the upsert failed — a failure is logged, never thrown).
 */
async function upsertSnapshot(
  noteSnapshotRepository: NoteSnapshotRepository,
  noteId: string | undefined,
  title: string | undefined,
  content: string,
): Promise<string | null> {
  if (!noteId) return null;
  const { data: snapshot, error: snapshotError } = await noteSnapshotRepository
    .upsert({
      reference_id: noteId,
      title: title || null,
      content,
      source: "obsidian",
    });
  if (snapshotError) {
    console.error(`Note snapshot upsert failed: ${snapshotError.message}`);
    return null;
  }
  return snapshot?.id ?? null;
}

/** Step 4 — fetch active thoughts already captured for this note. */
async function fetchExistingThoughts(
  thoughtRepository: ThoughtRepository,
  noteId: string | undefined,
): Promise<ExistingThought[]> {
  if (!noteId) return [];
  const { data, error } = await thoughtRepository.findByReference(noteId);
  if (error) {
    throw new Error(`Failed to fetch existing thoughts: ${error.message}`);
  }
  return data || [];
}

/**
 * Step 6 — ask the LLM to reconcile the updated note against its existing
 * thoughts. Returns the plan, or `null` to signal "fall back to a fresh ingest"
 * (an unparseable plan). A transport-level failure aborts the reconcile (throws),
 * matching the pre-refactor behavior exactly.
 */
export async function requestReconciliationPlan(
  aiProvider: AiProvider,
  existingThoughts: ExistingThought[],
  title: string | undefined,
  content: string,
): Promise<ReconciliationPlan | null> {
  const existingForPrompt = existingThoughts
    .map((thought) =>
      `[ID:${thought.id}] (captured ${
        thought.created_at
          ? new Date(thought.created_at).toLocaleDateString()
          : "unknown"
      })\n${thought.content}`
    )
    .join("\n\n");

  const knownIds = new Set(existingThoughts.map((thought) => thought.id));

  try {
    const rawPlan = await aiProvider.completeJson(
      {
        purpose: "reconcile",
        systemPrompt:
          `You reconcile an updated note with its previously captured thoughts in a personal knowledge base.

You will receive:
- EXISTING THOUGHTS: previously captured thoughts, each tagged with [ID:uuid]
- NEW NOTE CONTENT: the current version of the note

Produce a reconciliation plan:
- "keep": IDs of thoughts that are still accurate and essentially unchanged
- "update": thoughts whose core idea is the same but details changed — provide revised content (1-3 sentences, self-contained)
- "add": genuinely new topics or ideas not represented in any existing thought
- "delete": IDs of thoughts whose topic no longer appears in the note

Rules:
- Do NOT duplicate. Same idea expressed differently = keep the existing one.
- Do NOT add a thought for something you are already updating.
- Every thought must be fully self-contained — readable without context.
- Preserve specificity: names, dates, project names, decisions, dollar amounts.
- Prefix decisions with "Decision:", tasks with "TODO:", preserve magical working framing naturally.

Return ONLY valid JSON in this exact structure:
{
  "keep": ["id1", "id2"],
  "update": [{"id": "id3", "content": "revised text"}],
  "add": ["new thought 1", "new thought 2"],
  "delete": ["id4"]
}`,
        userContent:
          `EXISTING THOUGHTS:\n${existingForPrompt}\n\n---\n\nNEW NOTE CONTENT (title: ${
            title || "untitled"
          }):\n${content}`,
      },
      (raw) => {
        const parsed = ReconciliationPlanSchema.safeParse(raw);
        if (!parsed.success) {
          throw new AiProviderParseError(
            "reconciliation plan",
            parsed.error.message,
          );
        }
        return parsed.data;
      },
    );
    // Allowlist ids to this note's thoughts BEFORE any mutation can see them.
    return filterPlanToKnownIds(rawPlan, knownIds);
  } catch (reconcileError) {
    if (!(reconcileError instanceof AiProviderParseError)) {
      throw reconcileError;
    }
    console.warn("Reconciliation parse failed, falling back to fresh ingest");
    return null;
  }
}

interface ReconcileContext {
  noteSnapshotId: string | null;
  noteId: string | undefined;
  title: string | undefined;
  references: Record<string, string[]>;
}

interface ReconcileCounts {
  updated: number;
  added: number;
  deleted: number;
  failures: number;
  opsLength: number;
}

/**
 * Step 7 — execute a reconciliation plan: update revised thoughts, add new ones,
 * and SOFT-ARCHIVE (never hard-delete) the removed ones. Each op runs
 * concurrently; counts reflect what actually succeeded.
 */
export async function executeReconciliationPlan(
  thoughtRepository: ThoughtRepository,
  aiProvider: AiProvider,
  plan: ReconciliationPlan,
  ctx: ReconcileContext,
): Promise<ReconcileCounts> {
  const { noteSnapshotId, noteId, title, references } = ctx;
  const ops: Promise<void>[] = [];
  let updated = 0, added = 0, deleted = 0;

  for (const updateItem of (plan.update || [])) {
    ops.push((async () => {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(aiProvider, updateItem.content),
        extractMetadata(aiProvider, updateItem.content),
      ]);
      const { error } = await thoughtRepository.update(updateItem.id, {
        content: updateItem.content,
        embedding,
        content_hash: await hashContent(updateItem.content),
        last_actor: "sync",
        note_snapshot_id: noteSnapshotId,
        reliability: INGEST_PROVENANCE.reliability,
        author: INGEST_PROVENANCE.author,
        metadata: {
          ...metadata,
          source: "obsidian",
          note_title: title || null,
          updated_at: new Date().toISOString(),
          references,
        },
      });
      if (error) {
        throw new Error(`Update failed for ${updateItem.id}: ${error.message}`);
      }
      updated++;
    })());
  }

  for (const thoughtContent of (plan.add || [])) {
    // Schema (TOOL-1) guarantees each add entry is a non-empty string — no cast.
    ops.push((async () => {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(aiProvider, thoughtContent),
        extractMetadata(aiProvider, thoughtContent),
      ]);
      const { error } = await thoughtRepository.insert({
        content: thoughtContent,
        embedding,
        reference_id: noteId || null,
        note_snapshot_id: noteSnapshotId,
        content_hash: await hashContent(thoughtContent),
        last_actor: "sync",
        reliability: INGEST_PROVENANCE.reliability,
        author: INGEST_PROVENANCE.author,
        metadata: {
          ...metadata,
          source: "obsidian",
          note_title: title || null,
          references,
        },
      });
      if (error) throw new Error(`Insert failed: ${error.message}`);
      added++;
    })());
  }

  for (const id of (plan.delete || [])) {
    ops.push((async () => {
      // Soft-archive, never hard-delete: an LLM-produced (and possibly
      // hallucinated) ID must never permanently destroy captured knowledge.
      // Archived thoughts stay retrievable and are excluded from the next
      // reconciliation fetch (which filters archived_at IS NULL).
      const { error } = await thoughtRepository.archive(id);
      if (error) {
        throw new Error(`Archive failed for ${id}: ${error.message}`);
      }
      deleted++;
    })());
  }

  const results = await Promise.allSettled(ops);
  // Log every rejection reason (ids + error messages only, never note content)
  // so a recurring "N failed" sync is diagnosable from logs (TOOL-13).
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(`reconciliation op failure: ${String(result.reason)}`);
    }
  }
  const failures =
    results.filter((result) => result.status === "rejected").length;
  return { updated, added, deleted, failures, opsLength: ops.length };
}

/**
 * Build the "Synced …" summary message + error flag from a completed
 * reconciliation. Pure — no I/O. `isError` is true only when EVERY op failed.
 */
export function formatIngestSummary(params: {
  keep: number;
  counts: ReconcileCounts;
  references: Record<string, string[]>;
  title: string | undefined;
  noteId: string | undefined;
}): { message: string; isError: boolean } {
  const { keep, counts, references, title, noteId } = params;
  const { updated, added, deleted, failures, opsLength } = counts;

  const parts: string[] = [];
  if (keep > 0) parts.push(`${keep} unchanged`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (added > 0) parts.push(`${added} added`);
  if (deleted > 0) parts.push(`${deleted} removed`);
  if (failures > 0) parts.push(`${failures} failed`);

  const taskCount = references.tasks?.length || 0;
  const projectCount = references.projects?.length || 0;
  const peopleCount = references.people?.length || 0;
  const extractionParts: string[] = [];
  if (taskCount > 0) {
    extractionParts.push(
      `${taskCount} task${taskCount !== 1 ? "s" : ""} detected`,
    );
  }
  if (projectCount > 0) {
    extractionParts.push(
      `${projectCount} project${projectCount !== 1 ? "s" : ""} linked`,
    );
  }
  if (peopleCount > 0) {
    extractionParts.push(
      `${peopleCount} ${peopleCount !== 1 ? "people" : "person"} referenced`,
    );
  }
  const extractionSuffix = extractionParts.length > 0
    ? ` | ${extractionParts.join(", ")}`
    : "";

  const message = `Synced "${title || noteId || "note"}": ${
    parts.join(", ") || "no changes"
  }${extractionSuffix}`;
  const isError = failures > 0 && failures === opsLength;
  return { message, isError };
}

export async function handleIngestNote(
  supabase: SupabaseClient,
  aiProvider: AiProvider,
  thoughtRepository: ThoughtRepository,
  taskRepository: TaskRepository,
  projectRepository: ProjectRepository,
  personRepository: PersonRepository,
  noteSnapshotRepository: NoteSnapshotRepository,
  { content, title, note_id }: {
    content: string;
    title?: string;
    note_id?: string;
  },
): Promise<IngestResult> {
  try {
    if (await checkUnchanged(noteSnapshotRepository, note_id, content)) {
      return { success: true, message: "Note unchanged — skipped." };
    }

    const noteSnapshotId = await upsertSnapshot(
      noteSnapshotRepository,
      note_id,
      title,
      content,
    );

    const extractionRun = await runExtractionForTool({
      parse: () =>
        parseNote(content, title || null, note_id || null, "obsidian"),
      deps: {
        supabase,
        aiProvider,
        taskRepository,
        projectRepository,
        personRepository,
      },
      site: "ingest_note",
    });
    if (extractionRun.status === "aborted") {
      // A seed read failed: aborting avoids duplicate task/project writes on a
      // transient DB error during re-ingest (EXTR-2). Nothing has been written.
      return {
        success: false,
        error:
          `Sync aborted — could not read existing references (${extractionRun.reason}). ` +
          `No thoughts or tasks were written to avoid duplicates; please retry.`,
      };
    }
    const references = extractionRun.references;
    const extractionWarning = extractionRun.warning;

    // Fresh split + insert, used for both "no existing thoughts" and the
    // unparseable-plan fallback below.
    const runFreshIngest = async () =>
      freshIngestResult(
        await freshIngest(
          thoughtRepository,
          aiProvider,
          content,
          title,
          note_id,
          noteSnapshotId,
          references,
          INGEST_PROVENANCE,
        ),
      );

    // Appends any partial-extraction warning (EXTR-6) to a result's message so
    // a successful sync still reports that some reference writes failed.
    const appendWarning = (result: IngestResult): IngestResult =>
      extractionWarning && result.message
        ? { ...result, message: result.message + extractionWarning }
        : result;

    const existingThoughts = await fetchExistingThoughts(
      thoughtRepository,
      note_id,
    );

    // No existing thoughts → fresh split and insert.
    if (existingThoughts.length === 0) {
      return appendWarning(await runFreshIngest());
    }

    // Existing thoughts found → reconcile. A null plan (unparseable) degrades to
    // a fresh ingest, exactly as before.
    const plan = await requestReconciliationPlan(
      aiProvider,
      existingThoughts,
      title,
      content,
    );
    if (plan === null) {
      return appendWarning(await runFreshIngest());
    }

    const counts = await executeReconciliationPlan(
      thoughtRepository,
      aiProvider,
      plan,
      { noteSnapshotId, noteId: note_id, title, references },
    );

    const { message, isError } = formatIngestSummary({
      keep: (plan.keep || []).length,
      counts,
      references,
      title,
      noteId: note_id,
    });

    return appendWarning({
      success: !isError,
      message,
      ...(isError ? { error: message } : {}),
    });
  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}
