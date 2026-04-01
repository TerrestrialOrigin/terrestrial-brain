import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedding, extractMetadata, freshIngest, getProjectRefs, resolveProjectNames } from "../helpers.ts";
import { parseNote } from "../parser.ts";
import { runExtractionPipeline } from "../extractors/pipeline.ts";
import { ProjectExtractor } from "../extractors/project-extractor.ts";
import { TaskExtractor } from "../extractors/task-extractor.ts";
import { PeopleExtractor } from "../extractors/people-extractor.ts";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const OPENROUTER_API_KEY = Deno.env.get("OPENROUTER_API_KEY")!;

export function register(server: McpServer, supabase: SupabaseClient) {
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
        "Prefer this over list_thoughts when the user has a specific question; use list_thoughts for browsing or filtering by type/date.",
      inputSchema: {
        query: z.string().describe("Natural language description of what to search for — works best as a phrase or sentence, not single keywords"),
        limit: z.number().optional().default(10),
        threshold: z.number().optional().default(0.5),
        author: z.string().optional().describe("Filter by the model that authored the thought, e.g. 'claude-sonnet-4-6' or 'gpt-4o-mini'"),
        reliability: z.string().optional().describe("Filter by reliability level, e.g. 'reliable' or 'less reliable'"),
      },
    },
    async ({ query, limit, threshold, author, reliability }) => {
      try {
        const qEmb = await getEmbedding(query);
        const { data, error } = await supabase.rpc("match_thoughts", {
          query_embedding: qEmb,
          match_threshold: threshold,
          match_count: limit,
          filter: {},
          filter_author: author || null,
          filter_reliability: reliability || null,
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Search error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || data.length === 0) {
          return {
            content: [{ type: "text" as const, text: `No thoughts found matching "${query}".` }],
          };
        }

        // Collect all project UUIDs and resolve to names
        const allProjectUuids: string[] = [];
        for (const thought of data) {
          const projectRefs = getProjectRefs((thought.metadata || {}) as Record<string, unknown>);
          allProjectUuids.push(...projectRefs);
        }
        const projectNameMap = await resolveProjectNames(supabase, allProjectUuids);

        const results = data.map(
          (
            t: {
              content: string;
              metadata: Record<string, unknown>;
              similarity: number;
              created_at: string;
              updated_at: string | null;
              reliability: string | null;
              author: string | null;
            },
            i: number
          ) => {
            const m = t.metadata || {};
            const parts = [
              `--- Result ${i + 1} (${(t.similarity * 100).toFixed(1)}% match) ---`,
              `Captured: ${new Date(t.created_at).toISOString()}`,
            ];
            if (t.updated_at) {
              parts.push(`Updated: ${new Date(t.updated_at).toISOString()}`);
            }
            parts.push(`Type: ${m.type || "unknown"}`);
            if (t.reliability || t.author) {
              const provenanceParts: string[] = [];
              if (t.reliability) provenanceParts.push(`Reliability: ${t.reliability}`);
              if (t.author) provenanceParts.push(`Author: ${t.author}`);
              parts.push(provenanceParts.join(" | "));
            }
            if (Array.isArray(m.topics) && m.topics.length)
              parts.push(`Topics: ${(m.topics as string[]).join(", ")}`);
            if (Array.isArray(m.people) && m.people.length)
              parts.push(`People: ${(m.people as string[]).join(", ")}`);
            const projectRefs = getProjectRefs(m as Record<string, unknown>);
            if (projectRefs.length > 0) {
              const projectNames = projectRefs.map((uuid) => projectNameMap.get(uuid) || uuid);
              parts.push(`Projects: ${projectNames.join(", ")}`);
            }
            if (Array.isArray(m.action_items) && m.action_items.length)
              parts.push(`Actions: ${(m.action_items as string[]).join("; ")}`);
            parts.push(`\n${t.content}`);
            return parts.join("\n");
          }
        );

        return {
          content: [{
            type: "text" as const,
            text: `Found ${data.length} thought(s):\n\n${results.join("\n\n")}`,
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

  // Tool 2: List Recent
  server.registerTool(
    "list_thoughts",
    {
      title: "List Recent Thoughts",
      description:
        "Browse recent thoughts chronologically with optional filters. " +
        "Use this when the user wants to see what's been captured lately, review thoughts by category, or check activity for a time period. " +
        "Supports filtering by type, topic, person, time window, project, author (model identifier), or reliability level. " +
        "Prefer search_thoughts when the user has a specific question; use this for open-ended browsing like 'what did I capture this week?' or 'show me all person_notes'.",
      inputSchema: {
        limit: z.number().optional().default(10),
        type: z.string().optional().describe("Filter by type: observation, task, idea, reference, person_note"),
        topic: z.string().optional().describe("Filter by topic tag"),
        person: z.string().optional().describe("Filter by person mentioned"),
        days: z.number().optional().describe("Only thoughts from the last N days"),
        project_id: z.string().optional().describe("Filter by project UUID — matches thoughts whose metadata.references.projects array contains this UUID"),
        author: z.string().optional().describe("Filter by the model that authored the thought, e.g. 'claude-sonnet-4-6' or 'gpt-4o-mini'"),
        reliability: z.string().optional().describe("Filter by reliability level, e.g. 'reliable' or 'less reliable'"),
      },
    },
    async ({ limit, type, topic, person, days, project_id, author, reliability }) => {
      try {
        let q = supabase
          .from("thoughts")
          .select("content, metadata, created_at, updated_at, reliability, author")
          .order("created_at", { ascending: false })
          .limit(limit);

        if (type) q = q.contains("metadata", { type });
        if (topic) q = q.contains("metadata", { topics: [topic] });
        if (person) q = q.contains("metadata", { people: [person] });
        if (project_id) q = q.contains("metadata", { references: { projects: [project_id] } });
        if (author) q = q.eq("author", author);
        if (reliability) q = q.eq("reliability", reliability);
        if (days) {
          const since = new Date();
          since.setDate(since.getDate() - days);
          q = q.gte("created_at", since.toISOString());
        }

        const { data, error } = await q;

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }

        if (!data || !data.length) {
          return { content: [{ type: "text" as const, text: "No thoughts found." }] };
        }

        // Collect all project UUIDs and resolve to names
        const allProjectUuids: string[] = [];
        for (const thought of data) {
          const projectRefs = getProjectRefs((thought.metadata || {}) as Record<string, unknown>);
          allProjectUuids.push(...projectRefs);
        }
        const projectNameMap = await resolveProjectNames(supabase, allProjectUuids);

        const results = data.map(
          (
            t: { content: string; metadata: Record<string, unknown>; created_at: string; updated_at: string | null; reliability: string | null; author: string | null },
            i: number
          ) => {
            const m = t.metadata || {};
            const tags = Array.isArray(m.topics) ? (m.topics as string[]).join(", ") : "";
            const parts = [`${i + 1}. [${new Date(t.created_at).toISOString()}] (${m.type || "??"}${tags ? " - " + tags : ""})`];
            if (t.updated_at) {
              parts.push(`   Updated: ${new Date(t.updated_at).toISOString()}`);
            }
            if (t.reliability || t.author) {
              const provenanceParts: string[] = [];
              if (t.reliability) provenanceParts.push(`Reliability: ${t.reliability}`);
              if (t.author) provenanceParts.push(`Author: ${t.author}`);
              parts.push(`   ${provenanceParts.join(" | ")}`);
            }
            const projectRefs = getProjectRefs(m as Record<string, unknown>);
            if (projectRefs.length > 0) {
              const projectNames = projectRefs.map((uuid) => projectNameMap.get(uuid) || uuid);
              parts.push(`   Projects: ${projectNames.join(", ")}`);
            }
            parts.push(`   ${t.content}`);
            return parts.join("\n");
          }
        );

        return {
          content: [{
            type: "text" as const,
            text: `${data.length} recent thought(s):\n\n${results.join("\n\n")}`,
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
        project_id: z.string().optional().describe("Filter statistics to a specific project UUID — only counts thoughts linked to this project"),
      },
    },
    async ({ project_id }) => {
      try {
        let countQuery = supabase
          .from("thoughts")
          .select("*", { count: "exact", head: true });
        if (project_id) countQuery = countQuery.contains("metadata", { references: { projects: [project_id] } });
        const { count } = await countQuery;

        let dataQuery = supabase
          .from("thoughts")
          .select("metadata, created_at")
          .order("created_at", { ascending: false });
        if (project_id) dataQuery = dataQuery.contains("metadata", { references: { projects: [project_id] } });
        const { data } = await dataQuery;

        const types: Record<string, number> = {};
        const topics: Record<string, number> = {};
        const people: Record<string, number> = {};

        for (const r of data || []) {
          const m = (r.metadata || {}) as Record<string, unknown>;
          if (m.type) types[m.type as string] = (types[m.type as string] || 0) + 1;
          if (Array.isArray(m.topics))
            for (const t of m.topics) topics[t as string] = (topics[t as string] || 0) + 1;
          if (Array.isArray(m.people))
            for (const p of m.people) people[p as string] = (people[p as string] || 0) + 1;
        }

        const sort = (o: Record<string, number>): [string, number][] =>
          Object.entries(o)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10);

        const lines: string[] = [
          `Total thoughts: ${count}`,
          `Date range: ${
            data?.length
              ? new Date(data[data.length - 1].created_at).toLocaleDateString() +
                " → " +
                new Date(data[0].created_at).toLocaleDateString()
              : "N/A"
          }`,
          "",
          "Types:",
          ...sort(types).map(([k, v]) => `  ${k}: ${v}`),
        ];

        if (Object.keys(topics).length) {
          lines.push("", "Top topics:");
          for (const [k, v] of sort(topics)) lines.push(`  ${k}: ${v}`);
        }

        if (Object.keys(people).length) {
          lines.push("", "People mentioned:");
          for (const [k, v] of sort(people)) lines.push(`  ${k}: ${v}`);
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (err: unknown) {
        return {
          content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 4: Get Thought by ID
  server.registerTool(
    "get_thought_by_id",
    {
      title: "Get Thought by ID",
      description:
        "Retrieve a single thought by its UUID. " +
        "Use this when you have a specific thought ID (e.g. from search results, task references, or a previous conversation) and need its full content and metadata.",
      inputSchema: {
        id: z.string().uuid().describe("The UUID of the thought to retrieve"),
      },
    },
    async ({ id }) => {
      try {
        const { data, error } = await supabase
          .from("thoughts")
          .select("id, content, metadata, reference_id, created_at, updated_at")
          .eq("id", id)
          .single();

        if (error) {
          const message = error.code === "PGRST116"
            ? `No thought found with ID "${id}".`
            : `Error: ${error.message}`;
          return {
            content: [{ type: "text" as const, text: message }],
            isError: error.code !== "PGRST116",
          };
        }

        const metadata = (data.metadata || {}) as Record<string, unknown>;
        const lines: string[] = [
          `ID: ${data.id}`,
          `Captured: ${new Date(data.created_at).toISOString()}`,
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
        if (Array.isArray(metadata.action_items) && metadata.action_items.length) {
          lines.push(`Actions: ${(metadata.action_items as string[]).join("; ")}`);
        }
        const references = metadata.references as Record<string, string[]> | undefined;
        if (references) {
          if (references.projects?.length) lines.push(`Projects: ${references.projects.join(", ")}`);
          if (references.tasks?.length) lines.push(`Tasks: ${references.tasks.join(", ")}`);
          if (references.people?.length) lines.push(`People refs: ${references.people.join(", ")}`);
        }
        lines.push(`\n${data.content}`);

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
        "Reliability is hardcoded to 'reliable' for all calls to this function.",
      inputSchema: {
        content: z.string().describe("The thought to capture — a clear, standalone statement that will make sense when retrieved later by any AI"),
        author: z.string().optional().describe("Model identifier of the AI writing this thought, e.g. 'claude-sonnet-4-6'. Stored for provenance — informational only."),
        project_ids: z.string().array().optional().describe("UUIDs of projects to explicitly associate with this thought, merged with any projects the extractor finds."),
        document_ids: z.string().array().optional().describe("UUIDs of source documents this thought was derived from (e.g. from write_document). Stored in metadata.references.documents for traceability."),
      },
    },
    async ({ content, author, project_ids, document_ids }) => {
      try {
        // Run structural parser + extractor pipeline
        let references: Record<string, string[]> = {};
        try {
          const parsedNote = parseNote(content, null, null, "mcp");
          references = await runExtractionPipeline(
            parsedNote,
            [new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()],
            supabase,
          );
        } catch (pipelineError) {
          console.error(`capture_thought pipeline error: ${(pipelineError as Error).message}`);
        }

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
          getEmbedding(content),
          extractMetadata(content),
        ]);

        const { error } = await supabase.from("thoughts").insert({
          content,
          embedding,
          reliability: "reliable",
          author: author || null,
          metadata: { ...metadata, source: "mcp", references },
        });

        if (error) {
          return {
            content: [{ type: "text" as const, text: `Failed to capture: ${error.message}` }],
            isError: true,
          };
        }

        const meta = metadata as Record<string, unknown>;
        let confirmation = `Captured as ${meta.type || "thought"}`;
        if (Array.isArray(meta.topics) && meta.topics.length)
          confirmation += ` — ${(meta.topics as string[]).join(", ")}`;
        if (Array.isArray(meta.people) && meta.people.length)
          confirmation += ` | People: ${(meta.people as string[]).join(", ")}`;
        if (Array.isArray(meta.action_items) && meta.action_items.length)
          confirmation += ` | Actions: ${(meta.action_items as string[]).join("; ")}`;

        return {
          content: [{ type: "text" as const, text: confirmation }],
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

// ─── Standalone ingest_note handler (called via direct HTTP route, not MCP) ──

const INGEST_PROVENANCE = { reliability: "less reliable", author: "gpt-4o-mini" };

export async function handleIngestNote(
  supabase: SupabaseClient,
  { content, title, note_id }: { content: string; title?: string; note_id?: string },
): Promise<{ success: boolean; message?: string; error?: string }> {
  try {
    // Step 1: Upsert note snapshot
    let noteSnapshotId: string | null = null;
    if (note_id) {
      const { data: snapshot, error: snapshotError } = await supabase
        .from("note_snapshots")
        .upsert(
          { reference_id: note_id, title: title || null, content, source: "obsidian" },
          { onConflict: "reference_id" },
        )
        .select("id")
        .single();

      if (snapshotError) {
        console.error(`Note snapshot upsert failed: ${snapshotError.message}`);
      } else {
        noteSnapshotId = snapshot.id;
      }
    }

    // Step 2: Structural parse
    const parsedNote = parseNote(content, title || null, note_id || null, "obsidian");

    // Step 3: Run extractor pipeline
    let references: Record<string, string[]> = {};
    try {
      references = await runExtractionPipeline(
        parsedNote,
        [new ProjectExtractor(), new PeopleExtractor(), new TaskExtractor()],
        supabase,
      );
    } catch (pipelineError) {
      console.error(`Extractor pipeline error: ${(pipelineError as Error).message}`);
    }

    // Step 4: Fetch existing thoughts for this note
    type ExistingThought = { id: string; content: string; created_at: string };
    let existingThoughts: ExistingThought[] = [];

    if (note_id) {
      const { data, error } = await supabase
        .from("thoughts")
        .select("id, content, created_at")
        .eq("reference_id", note_id)
        .order("created_at", { ascending: true });

      if (error) throw new Error(`Failed to fetch existing thoughts: ${error.message}`);
      existingThoughts = data || [];
    }

    // Step 5: No existing thoughts → fresh split and insert
    if (existingThoughts.length === 0) {
      const result = await freshIngest(supabase, content, title, note_id, noteSnapshotId, references, INGEST_PROVENANCE);
      return {
        success: !result.isError,
        message: result.content[0].text,
        ...(result.isError ? { error: result.content[0].text } : {}),
      };
    }

    // Step 6: Existing thoughts found → reconcile with updated note
    const existingForPrompt = existingThoughts
      .map((t) => `[ID:${t.id}] (captured ${new Date(t.created_at).toLocaleDateString()})\n${t.content}`)
      .join("\n\n");

    const reconcileResponse = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: `You reconcile an updated note with its previously captured thoughts in a personal knowledge base.

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
          },
          {
            role: "user",
            content: `EXISTING THOUGHTS:\n${existingForPrompt}\n\n---\n\nNEW NOTE CONTENT (title: ${title || "untitled"}):\n${content}`,
          },
        ],
      }),
    });

    if (!reconcileResponse.ok) {
      const msg = await reconcileResponse.text().catch(() => "");
      throw new Error(`OpenRouter reconcile failed: ${reconcileResponse.status} ${msg}`);
    }

    const reconcileData = await reconcileResponse.json();
    let plan: {
      keep: string[];
      update: { id: string; content: string }[];
      add: string[];
      delete: string[];
    } = { keep: [], update: [], add: [], delete: [] };

    try {
      plan = JSON.parse(reconcileData.choices[0].message.content);
    } catch {
      console.warn("Reconciliation parse failed, falling back to fresh ingest");
      const result = await freshIngest(supabase, content, title, note_id, noteSnapshotId, references, INGEST_PROVENANCE);
      return {
        success: !result.isError,
        message: result.content[0].text,
        ...(result.isError ? { error: result.content[0].text } : {}),
      };
    }

    // Step 7: Execute reconciliation plan
    const ops: Promise<void>[] = [];
    let updated = 0, added = 0, deleted = 0;

    for (const updateItem of (plan.update || [])) {
      ops.push((async () => {
        const [embedding, metadata] = await Promise.all([
          getEmbedding(updateItem.content),
          extractMetadata(updateItem.content),
        ]);
        const { error } = await supabase
          .from("thoughts")
          .update({
            content: updateItem.content,
            embedding,
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
          })
          .eq("id", updateItem.id);
        if (error) throw new Error(`Update failed for ${updateItem.id}: ${error.message}`);
        updated++;
      })());
    }

    for (const addItem of (plan.add || [])) {
      const thoughtContent = typeof addItem === "string" ? addItem : (addItem as unknown as { thought: string }).thought || addItem;
      ops.push((async () => {
        const [embedding, metadata] = await Promise.all([
          getEmbedding(thoughtContent as string),
          extractMetadata(thoughtContent as string),
        ]);
        const { error } = await supabase.from("thoughts").insert({
          content: thoughtContent,
          embedding,
          reference_id: note_id || null,
          note_snapshot_id: noteSnapshotId,
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
        const { error } = await supabase.from("thoughts").delete().eq("id", id);
        if (error) throw new Error(`Delete failed for ${id}: ${error.message}`);
        deleted++;
      })());
    }

    const results = await Promise.allSettled(ops);
    const failures = results.filter((r) => r.status === "rejected").length;

    const kept = (plan.keep || []).length;
    const parts: string[] = [];
    if (kept > 0) parts.push(`${kept} unchanged`);
    if (updated > 0) parts.push(`${updated} updated`);
    if (added > 0) parts.push(`${added} added`);
    if (deleted > 0) parts.push(`${deleted} removed`);
    if (failures > 0) parts.push(`${failures} failed`);

    const taskCount = references.tasks?.length || 0;
    const projectCount = references.projects?.length || 0;
    const peopleCount = references.people?.length || 0;
    const extractionParts: string[] = [];
    if (taskCount > 0) extractionParts.push(`${taskCount} task${taskCount !== 1 ? "s" : ""} detected`);
    if (projectCount > 0) extractionParts.push(`${projectCount} project${projectCount !== 1 ? "s" : ""} linked`);
    if (peopleCount > 0) extractionParts.push(`${peopleCount} ${peopleCount !== 1 ? "people" : "person"} referenced`);
    const extractionSuffix = extractionParts.length > 0 ? ` | ${extractionParts.join(", ")}` : "";

    const message = `Synced "${title || note_id || "note"}": ${parts.join(", ") || "no changes"}${extractionSuffix}`;
    const isError = failures > 0 && failures === ops.length;

    return {
      success: !isError,
      message,
      ...(isError ? { error: message } : {}),
    };

  } catch (err: unknown) {
    return {
      success: false,
      error: (err as Error).message,
    };
  }
}
