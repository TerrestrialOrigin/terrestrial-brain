/**
 * Pure thought-rendering helpers shared by the retrieval tools (TOOL-9).
 *
 * The project-refs preamble, provenance block, and metadata lines used to be
 * copied verbatim between `search_thoughts`, `list_thoughts`,
 * `get_thought_by_id`, and `capture_thought`'s confirmation. They live here
 * once, as pure functions (no I/O), so each registered handler reduces to
 * query → envelope → resolve names → touch → format, and the output is
 * unit-testable byte-for-byte with synthetic rows.
 */

import { getProjectRefs } from "../helpers.ts";

/** The fields every thought renderer reads — a structural subset of the row. */
export interface RenderableThought {
  id: string;
  content: string;
  created_at: string | null;
  updated_at?: string | null;
  reliability?: string | null;
  author?: string | null;
  metadata: unknown;
}

/** A search row additionally carries its similarity score. */
export interface RenderableSearchThought extends RenderableThought {
  similarity: number;
  created_at: string;
}

/** Narrows a row's stored metadata to a record (defaulting to empty). */
export function thoughtMetadata(
  thought: Pick<RenderableThought, "metadata">,
): Record<string, unknown> {
  return (thought.metadata ?? {}) as Record<string, unknown>;
}

/**
 * Validated extraction of a string-array metadata field (topics, people,
 * action_items) — non-arrays and non-string elements yield [].
 */
export function metadataStringList(
  metadata: Record<string, unknown>,
  key: string,
): string[] {
  const value = metadata[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Collects every project UUID referenced across a result set — the shared
 * preamble feeding one batched `resolveNames` call.
 */
export function collectProjectUuids(
  rows: Pick<RenderableThought, "metadata">[],
): string[] {
  const allProjectUuids: string[] = [];
  for (const thought of rows) {
    allProjectUuids.push(...getProjectRefs(thoughtMetadata(thought)));
  }
  return allProjectUuids;
}

/** `Reliability: X | Author: Y` (either side optional); null when neither set. */
export function formatProvenance(
  thought: Pick<RenderableThought, "reliability" | "author">,
): string | null {
  if (!thought.reliability && !thought.author) return null;
  const provenanceParts: string[] = [];
  if (thought.reliability) {
    provenanceParts.push(`Reliability: ${thought.reliability}`);
  }
  if (thought.author) {
    provenanceParts.push(`Author: ${thought.author}`);
  }
  return provenanceParts.join(" | ");
}

/** `Projects: <resolved names>` from metadata references; null when none. */
export function formatProjectsLine(
  metadata: Record<string, unknown>,
  projectNameMap: Map<string, string>,
): string | null {
  const projectRefs = getProjectRefs(metadata);
  if (projectRefs.length === 0) return null;
  const projectNames = projectRefs.map((uuid) =>
    projectNameMap.get(uuid) || uuid
  );
  return `Projects: ${projectNames.join(", ")}`;
}

/**
 * The Topics/People/Projects/Actions block in `search_thoughts` order.
 * Lines are unindented; callers needing indentation prefix each line.
 */
export function formatThoughtMetadataLines(
  metadata: Record<string, unknown>,
  projectNameMap: Map<string, string>,
): string[] {
  const lines: string[] = [];
  const topics = metadataStringList(metadata, "topics");
  if (topics.length) lines.push(`Topics: ${topics.join(", ")}`);
  const people = metadataStringList(metadata, "people");
  if (people.length) lines.push(`People: ${people.join(", ")}`);
  const projectsLine = formatProjectsLine(metadata, projectNameMap);
  if (projectsLine) lines.push(projectsLine);
  const actions = metadataStringList(metadata, "action_items");
  if (actions.length) lines.push(`Actions: ${actions.join("; ")}`);
  return lines;
}

/** One `search_thoughts` result block, byte-identical to the pre-refactor text. */
export function formatSearchResult(
  thought: RenderableSearchThought,
  index: number,
  projectNameMap: Map<string, string>,
): string {
  const metadata = thoughtMetadata(thought);
  const parts = [
    `--- Result ${index + 1} (${
      (thought.similarity * 100).toFixed(1)
    }% match) ---`,
    `ID: ${thought.id}`,
    `Captured: ${new Date(thought.created_at).toISOString()}`,
  ];
  if (thought.updated_at) {
    parts.push(`Updated: ${new Date(thought.updated_at).toISOString()}`);
  }
  parts.push(`Type: ${metadata.type || "unknown"}`);
  const provenance = formatProvenance(thought);
  if (provenance) parts.push(provenance);
  parts.push(...formatThoughtMetadataLines(metadata, projectNameMap));
  parts.push(`\n${thought.content}`);
  return parts.join("\n");
}

/** One `list_thoughts` entry, byte-identical to the pre-refactor text. */
export function formatListEntry(
  thought: RenderableThought,
  index: number,
  projectNameMap: Map<string, string>,
): string {
  const metadata = thoughtMetadata(thought);
  const tags = metadataStringList(metadata, "topics").join(", ");
  const parts = [
    `${index + 1}. [${
      thought.created_at
        ? new Date(thought.created_at).toISOString()
        : "unknown"
    }] (${metadata.type || "??"}${tags ? " - " + tags : ""})`,
    `   ID: ${thought.id}`,
  ];
  if (thought.updated_at) {
    parts.push(`   Updated: ${new Date(thought.updated_at).toISOString()}`);
  }
  const provenance = formatProvenance(thought);
  if (provenance) parts.push(`   ${provenance}`);
  const projectsLine = formatProjectsLine(metadata, projectNameMap);
  if (projectsLine) parts.push(`   ${projectsLine}`);
  parts.push(`   ${thought.content}`);
  return parts.join("\n");
}

/**
 * The `get_thought_by_id` detail lines (Topics/People/Actions, then raw
 * reference ids), byte-identical to the pre-refactor text.
 */
export function formatThoughtDetailLines(
  thought: RenderableThought & { reference_id?: string | null },
): string[] {
  const metadata = thoughtMetadata(thought);
  const lines: string[] = [
    `ID: ${thought.id}`,
    `Captured: ${
      thought.created_at
        ? new Date(thought.created_at).toISOString()
        : "unknown"
    }`,
  ];
  if (thought.updated_at) {
    lines.push(`Updated: ${new Date(thought.updated_at).toISOString()}`);
  }
  lines.push(`Type: ${metadata.type || "unknown"}`);
  if (thought.reference_id) lines.push(`Source: ${thought.reference_id}`);
  const topics = metadataStringList(metadata, "topics");
  if (topics.length) lines.push(`Topics: ${topics.join(", ")}`);
  const people = metadataStringList(metadata, "people");
  if (people.length) lines.push(`People: ${people.join(", ")}`);
  const actions = metadataStringList(metadata, "action_items");
  if (actions.length) lines.push(`Actions: ${actions.join("; ")}`);
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
  lines.push(`\n${thought.content}`);
  return lines;
}

/**
 * The `capture_thought` confirmation suffix (` — topics | People: … | Actions: …`),
 * byte-identical to the pre-refactor inline blocks.
 */
export function formatCaptureConfirmation(
  metadata: Record<string, unknown>,
): string {
  let confirmation = `Captured as ${metadata.type || "thought"}`;
  const topics = metadataStringList(metadata, "topics");
  if (topics.length) confirmation += ` — ${topics.join(", ")}`;
  const people = metadataStringList(metadata, "people");
  if (people.length) confirmation += ` | People: ${people.join(", ")}`;
  const actions = metadataStringList(metadata, "action_items");
  if (actions.length) confirmation += ` | Actions: ${actions.join("; ")}`;
  return confirmation;
}
