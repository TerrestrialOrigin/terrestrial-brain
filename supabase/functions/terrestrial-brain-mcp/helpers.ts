import type { AiProvider } from "./ai/ai-provider.ts";
import { AiProviderParseError } from "./ai/ai-provider.ts";
import type { ThoughtRepository } from "./repositories/thought-repository.ts";

// ---------------------------------------------------------------------------
// Backwards-compatible references reader
// ---------------------------------------------------------------------------

/**
 * Reads project references from thought metadata, supporting both
 * the old `{ project_id: "uuid" }` and new `{ projects: ["uuid"] }` formats.
 */
export function getProjectRefs(metadata: Record<string, unknown>): string[] {
  const refs = metadata?.references as Record<string, unknown> | undefined;
  if (!refs) return [];
  if (Array.isArray(refs.projects)) return refs.projects as string[];
  if (typeof refs.project_id === "string") return [refs.project_id];
  return [];
}

export function getEmbedding(
  aiProvider: AiProvider,
  text: string,
): Promise<number[]> {
  // Thin delegate over the injected seam; keeps a single import surface for the
  // thoughts handlers and preserves the throw-on-failure contract.
  return aiProvider.getEmbedding(text);
}

const UNCATEGORIZED_METADATA = {
  topics: ["uncategorized"],
  type: "observation",
};

export async function extractMetadata(
  aiProvider: AiProvider,
  text: string,
): Promise<Record<string, unknown>> {
  // Metadata is best-effort enrichment: a failure (HTTP or unparseable body)
  // must NOT abort ingestion, but it must be observable — otherwise an LLM outage
  // renders identically to a genuinely uncategorizable thought (finding C9).
  // Log, then degrade.
  try {
    return await aiProvider.completeJson(
      {
        systemPrompt:
          `Extract metadata from the user's captured thought. Return JSON with:
- "people": array of people mentioned (empty if none)
- "action_items": array of implied to-dos (empty if none)
- "dates_mentioned": array of dates YYYY-MM-DD (empty if none)
- "topics": array of 1-3 short topic tags (always at least one)
- "type": one of "observation", "task", "idea", "reference", "person_note"
Only extract what's explicitly there.`,
        userContent: text,
      },
      (raw) => raw as Record<string, unknown>,
    );
  } catch (error) {
    console.warn(
      `extractMetadata: falling back to uncategorized. ${
        (error as Error).message
      }`,
    );
    return { ...UNCATEGORIZED_METADATA };
  }
}

export async function freshIngest(
  thoughtRepository: ThoughtRepository,
  aiProvider: AiProvider,
  content: string,
  title: string | undefined,
  note_id: string | undefined,
  noteSnapshotId?: string | null,
  references?: Record<string, string[]>,
  provenance?: { reliability: string; author: string },
): Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> {
  // Split the note into standalone thoughts. An HTTP failure aborts ingestion
  // (throws); an unparseable response degrades to treating the whole note as a
  // single thought — matching the pre-refactor behavior exactly.
  let thoughts: string[] = [];
  try {
    thoughts = await aiProvider.completeJson(
      {
        systemPrompt:
          `You split notes into discrete, standalone thoughts for a personal knowledge base.

RULES:
- Each thought must be fully self-contained — readable without any other context
- Preserve specificity: names, dates, project names, tool names, decisions, dollar amounts
- Each thought is 1–3 sentences. No walls of text.
- Prefix decisions with "Decision:", tasks with "TODO:"
- Preserve magical working / ritual / synchronicity framing naturally
- Split on topic boundaries — Java features and a magick working are two separate thoughts
- Skip: bare headings, lone tags, empty sections
- If the entire note is already a single coherent thought, return it as a single-item array

Return ONLY valid JSON: {"thoughts": ["thought 1", "thought 2", ...]}`,
        userContent: title ? `Note title: ${title}\n\n${content}` : content,
      },
      (raw): string[] => {
        const parsed = raw as { thoughts?: unknown };
        const collected: string[] = [];
        if (Array.isArray(parsed.thoughts)) {
          for (const item of parsed.thoughts) {
            if (typeof item === "string" && item.trim().length > 0) {
              collected.push(item);
            } else if (
              typeof item === "object" && item.thought &&
              typeof item.thought === "string" && item.thought.trim().length > 0
            ) {
              collected.push(item.thought);
            }
          }
        }
        return collected;
      },
    );
  } catch (error) {
    if (error instanceof AiProviderParseError) {
      // Unparseable split response → keep the note as one thought.
      thoughts = [content.trim()];
    } else {
      // HTTP/transport failure → abort ingestion (unchanged behavior).
      throw error;
    }
  }

  if (thoughts.length === 0) {
    return {
      content: [{
        type: "text" as const,
        text: "No thoughts extracted — note may be empty.",
      }],
    };
  }

  const pipelineRefs = references || {};

  const results = await Promise.allSettled(
    thoughts.map(async (thoughtContent) => {
      const [embedding, metadata] = await Promise.all([
        getEmbedding(aiProvider, thoughtContent),
        extractMetadata(aiProvider, thoughtContent),
      ]);
      const { error } = await thoughtRepository.insert({
        content: thoughtContent,
        embedding,
        reference_id: note_id || null,
        note_snapshot_id: noteSnapshotId || null,
        metadata: {
          ...metadata,
          source: "obsidian",
          note_title: title || null,
          references: pipelineRefs,
        },
        ...(provenance
          ? { reliability: provenance.reliability, author: provenance.author }
          : {}),
      });
      if (error) throw new Error(error.message);
    }),
  );

  const succeeded =
    results.filter((result) => result.status === "fulfilled").length;
  const failed =
    results.filter((result) => result.status === "rejected").length;

  const taskCount = pipelineRefs.tasks?.length || 0;
  const projectCount = pipelineRefs.projects?.length || 0;
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
  const extractionSuffix = extractionParts.length > 0
    ? ` — ${extractionParts.join(", ")}`
    : "";

  return {
    content: [{
      type: "text" as const,
      text: `Captured ${succeeded} thought${succeeded !== 1 ? "s" : ""} from "${
        title || "note"
      }"${failed > 0 ? ` — ${failed} failed` : ""}${extractionSuffix}`,
    }],
    isError: failed === thoughts.length,
  };
}
