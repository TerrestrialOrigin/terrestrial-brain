import type { AiProvider } from "./ai/ai-provider.ts";
import { AiProviderParseError } from "./ai/ai-provider.ts";
import type { ThoughtRepository } from "./repositories/thought-repository.ts";
import { THOUGHT_TYPES } from "./enums.ts";

/**
 * Parse the extracted `type` against the THOUGHT_TYPES allowlist (parse, don't
 * cast). A hallucinated or missing value is coerced to the documented fallback
 * `observation` and logged, so a bad LLM `type` never reaches `metadata.type`.
 */
export function coerceThoughtType(
  raw: unknown,
): Record<string, unknown> {
  const metadata = (raw && typeof raw === "object")
    ? { ...(raw as Record<string, unknown>) }
    : {};
  const candidate = metadata.type;
  if (
    typeof candidate === "string" &&
    (THOUGHT_TYPES as readonly string[]).includes(candidate)
  ) {
    return metadata;
  }
  if (candidate !== undefined) {
    console.warn(
      `extractMetadata: coercing out-of-allowlist type "${
        String(candidate)
      }" to "observation".`,
    );
  }
  return { ...metadata, type: "observation" };
}

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

/**
 * SHA-256 hex of the content — the stored `content_hash` (INVARIANT 1). Stamped
 * wherever content is written so the hash tracks the current text and the sync
 * dedup gate operates on it. Emptying content is a valid edit: hash of "" is a
 * real value, never swallowed.
 */
export async function hashContent(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const UNCATEGORIZED_METADATA = {
  topics: ["uncategorized"],
  type: "observation",
};

/**
 * Cosine-similarity floor for the write-time dedup gate — a tight band
 * (similarity ≥ 0.90 ⇔ cosine distance ≤ 0.10), distinct from the 0.5 read-side
 * retrieval threshold (Step 5 design D2). A hit at this floor is effectively the
 * same thought, not merely a relevant one.
 */
export const DEDUP_MIN_SIMILARITY = 0.90;

/**
 * Write-time deduplication decision. Returns the id of an existing active thought
 * this content duplicates (byte-identical via content_hash, or within the tight
 * embedding band), or null when the content is genuinely new. Server-side — never
 * prompt-nudge.
 */
export async function resolveDedup(
  thoughtRepository: ThoughtRepository,
  contentHash: string,
  embedding: number[],
): Promise<{ duplicateOf: string | null; degraded: boolean }> {
  // CORE-2: a failed lookup must NOT read as "genuinely new". Surface a degraded
  // outcome so the caller can flag that the dedup gate could not run, instead of
  // silently admitting a duplicate.
  const { data: exact, error: exactError } = await thoughtRepository
    .findByContentHash(contentHash);
  if (exactError) {
    console.error(
      `resolveDedup: content-hash lookup failed: ${exactError.message}`,
    );
    return { duplicateOf: null, degraded: true };
  }
  if (exact && exact.length > 0) {
    return { duplicateOf: exact[0].id, degraded: false };
  }
  const { data: near, error: nearError } = await thoughtRepository
    .matchByEmbedding({
      embedding,
      threshold: DEDUP_MIN_SIMILARITY,
      count: 1,
      author: null,
      reliability: null,
    });
  if (nearError) {
    console.error(
      `resolveDedup: embedding match failed: ${nearError.message}`,
    );
    return { duplicateOf: null, degraded: true };
  }
  if (near && near.length > 0) {
    return { duplicateOf: near[0].id, degraded: false };
  }
  return { duplicateOf: null, degraded: false };
}

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
        purpose: "extract-metadata",
        systemPrompt:
          `You are given a single captured thought. Produce a JSON object that summarizes it using exactly these fields:
- "people": names of any individuals the text refers to; use [] when nobody is named.
- "action_items": concrete to-dos the text implies; use [] when there are none.
- "dates_mentioned": any calendar dates the text refers to, each formatted as YYYY-MM-DD; use [] when there are none.
- "topics": one to three concise topic tags; always include at least one.
- "type": the single best-fit category, chosen from "observation", "task", "idea", "reference", "person_note", "instruction", "decision".
Base every field on what the text actually supports — do not invent details it does not contain.`,
        userContent: text,
      },
      (raw) => coerceThoughtType(raw),
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

/**
 * Parses the LLM split response into a list of standalone thought strings.
 * One malformed element (null, wrong type, missing/empty `thought`) is skipped,
 * never allowed to crash the whole batch (CORE-12).
 */
export function parseSplitThoughts(raw: unknown): string[] {
  const thoughtsValue = typeof raw === "object" && raw !== null
    ? (raw as { thoughts?: unknown }).thoughts
    : undefined;
  const items: unknown[] = Array.isArray(thoughtsValue) ? thoughtsValue : [];
  const collected: string[] = [];
  for (const item of items) {
    if (typeof item === "string") {
      if (item.trim().length > 0) collected.push(item);
    } else if (
      typeof item === "object" && item !== null && "thought" in item &&
      typeof (item as { thought: unknown }).thought === "string"
    ) {
      const thought = (item as { thought: string }).thought;
      if (thought.trim().length > 0) collected.push(thought);
    }
  }
  return collected;
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
        purpose: "split-thoughts",
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
      (raw): string[] => parseSplitThoughts(raw),
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
      const contentHash = await hashContent(thoughtContent);
      const { error } = await thoughtRepository.insert({
        content: thoughtContent,
        embedding,
        reference_id: note_id || null,
        note_snapshot_id: noteSnapshotId || null,
        content_hash: contentHash,
        last_actor: "sync",
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
      // A 23505 unique-violation on content_hash means this exact content is
      // already captured (the partial unique index, TOOL-7) — not a failure.
      if (error && error.code !== "23505") throw new Error(error.message);
    }),
  );

  // Log every rejection reason (error messages only, never note content) so a
  // recurring ingest failure is diagnosable from logs (TOOL-13).
  for (const result of results) {
    if (result.status === "rejected") {
      console.error(
        `freshIngest thought-insert failure: ${String(result.reason)}`,
      );
    }
  }

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
