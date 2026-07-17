/**
 * FakeAiProvider — the deterministic, offline implementation of `AiProvider`
 * (fix-plan Step 22, finding X6). Selected by `TB_AI_PROVIDER=fake` at the
 * `createAiProvider()` factory so the default test suite runs green with NO
 * `OPENROUTER_API_KEY` and NO network, replacing the "skips wearing a passed
 * badge" hedges that guarded around a live LLM.
 *
 * Guarantees (see `openspec/specs/ai-provider/spec.md`):
 *  - `getEmbedding` is a pure function of the text: identical text → identical
 *    1536-vector; cosine similarity rises with shared-word overlap; unit length.
 *  - `completeJson` returns a deterministic value the caller's `parse` callback
 *    accepts, for every one of the edge function's completion purposes. Extractor
 *    purposes DERIVE their matches from the request against the supplied
 *    known-entity lists, so the calling tool must genuinely process the output
 *    (GATE 2b), and an unrecognized prompt degrades to a benign default.
 *
 * The fake performs no I/O and reads no secrets; it is never selected in
 * production (any `TB_AI_PROVIDER` value other than exactly `fake` → real).
 */

import {
  AiJsonCompletionRequest,
  AiProvider,
  AiProviderParseError,
} from "./ai-provider.ts";

/** Must match the `thoughts.embedding` column: `vector(1536)`. */
const EMBEDDING_DIMENSIONS = 1536;

export class FakeAiProvider implements AiProvider {
  // -------------------------------------------------------------------------
  // Embeddings
  // -------------------------------------------------------------------------

  getEmbedding(text: string): Promise<number[]> {
    return Promise.resolve(embedText(text));
  }

  // -------------------------------------------------------------------------
  // JSON completions
  // -------------------------------------------------------------------------

  completeJson<Parsed>(
    request: AiJsonCompletionRequest,
    parse: (raw: unknown) => Parsed,
  ): Promise<Parsed> {
    let raw: unknown;
    try {
      raw = dispatch(request);
    } catch (error) {
      // An unwired purpose is a programmer error — surface it as a rejected
      // promise (loud, consistent with the async contract), NOT a parse error.
      return Promise.reject(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    // Honor the seam contract (CORE-8): a throwing `parse` surfaces as
    // AiProviderParseError, exactly as the live provider does, so callers'
    // `instanceof AiProviderParseError` fallback branches engage identically.
    try {
      return Promise.resolve(parse(raw));
    } catch (error) {
      return Promise.reject(
        new AiProviderParseError(
          "FakeAiProvider completion",
          error instanceof Error ? error.message : String(error),
        ),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Deterministic embedding: token-hash accumulation, L2-normalized
// ---------------------------------------------------------------------------

/**
 * Build a 1536-vector whose cosine similarity tracks shared-word overlap.
 * Each lowercased word token is hashed (FNV-1a) into a bucket and adds weight;
 * the vector is then L2-normalized so identical text yields the identical unit
 * vector and overlapping text yields high cosine similarity. Empty/token-less
 * text returns a fixed unit vector (bucket 0) so the norm is never zero.
 */
function embedText(text: string): number[] {
  const vector = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = tokenize(text);

  if (tokens.length === 0) {
    vector[0] = 1;
    return vector;
  }

  for (const token of tokens) {
    const bucket = fnv1a(token) % EMBEDDING_DIMENSIONS;
    vector[bucket] += 1;
  }

  return normalize(vector);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 0);
}

/** 32-bit FNV-1a hash, returned as an unsigned integer. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    // FNV prime 16777619, kept in 32-bit range via Math.imul.
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function normalize(vector: number[]): number[] {
  let sumOfSquares = 0;
  for (const value of vector) sumOfSquares += value * value;
  const magnitude = Math.sqrt(sumOfSquares);
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

// ---------------------------------------------------------------------------
// Deterministic completions: dispatch on a stable system-prompt substring
// ---------------------------------------------------------------------------

/**
 * One responder per completion purpose, dispatched on the request's stable
 * `purpose` discriminator (NOT a system-prompt substring, which drifts silently
 * — CORE-1). An unknown purpose THROWS rather than degrading to `{}`, so a new
 * call site that forgets to wire a responder fails loudly in tests. The switch
 * is exhaustive over `AiCompletionPurpose` (the `never` default is a
 * compile-time guard).
 */
function dispatch(request: AiJsonCompletionRequest): unknown {
  const { purpose, systemPrompt, userContent } = request;

  switch (purpose) {
    case "extract-metadata":
      return fakeMetadata(userContent);
    case "split-thoughts":
      return fakeSplitThoughts(userContent);
    case "reconcile":
      return fakeReconciliation(userContent);
    case "assign-task-projects":
      return fakeTaskProjectAssignments(systemPrompt, userContent);
    case "enrich-tasks":
      return fakeTaskEnrichments(systemPrompt, userContent);
    case "project-from-path":
      return fakeProjectNameFromPath(userContent);
    case "projects-by-content":
      return fakeProjectIdsByContent(systemPrompt, userContent);
    case "detect-people":
      return fakePeople(systemPrompt, userContent);
    default: {
      const exhaustive: never = purpose;
      throw new Error(
        `FakeAiProvider: no responder wired for completion purpose "${exhaustive}"`,
      );
    }
  }
}

/** A known entity line in a system prompt: `- "Name" (id: uuid)`. */
interface KnownEntity {
  name: string;
  id: string;
}

const KNOWN_ENTITY_PATTERN = /- "([^"]+)" \(id: ([^)]+)\)/g;

function parseKnownEntities(systemPrompt: string): KnownEntity[] {
  const entities: KnownEntity[] = [];
  for (const match of systemPrompt.matchAll(KNOWN_ENTITY_PATTERN)) {
    entities.push({ name: match[1], id: match[2] });
  }
  return entities;
}

/** A task line in user content: `0: "text" [under heading: "..."]`. */
interface TaskLine {
  index: number;
  text: string;
}

const TASK_LINE_PATTERN = /^(\d+):\s*"([^"]*)"/gm;

function parseTaskLines(userContent: string): TaskLine[] {
  const tasks: TaskLine[] = [];
  for (const match of userContent.matchAll(TASK_LINE_PATTERN)) {
    tasks.push({ index: Number(match[1]), text: match[2] });
  }
  return tasks;
}

function mentions(haystack: string, name: string): boolean {
  return haystack.toLowerCase().includes(name.toLowerCase());
}

// --- Responders ------------------------------------------------------------

function fakeMetadata(userContent: string): Record<string, unknown> {
  const firstWord = tokenize(userContent)[0] ?? "general";
  return {
    people: [],
    action_items: [],
    dates_mentioned: [],
    topics: [firstWord],
    type: "observation",
  };
}

function fakeSplitThoughts(userContent: string): { thoughts: string[] } {
  // Mirror the real provider's "already one coherent thought" branch: return the
  // note as a single self-contained thought so ingest deterministically yields
  // one findable thought. Strip a leading "Note title: ..." preamble line.
  const withoutTitle = userContent.replace(/^Note title:.*\n+/, "").trim();
  const thought = withoutTitle.length > 0 ? withoutTitle : userContent.trim();
  return { thoughts: thought.length > 0 ? [thought] : [] };
}

const EXISTING_ID_PATTERN = /\[ID:([^\]]+)\]/g;

function fakeReconciliation(userContent: string): {
  keep: string[];
  update: never[];
  add: never[];
  delete: never[];
} {
  // Safe no-op plan: keep every existing thought, add/update/delete nothing.
  // Re-ingest therefore preserves data (never an LLM-driven destroy).
  const keep: string[] = [];
  for (const match of userContent.matchAll(EXISTING_ID_PATTERN)) {
    keep.push(match[1]);
  }
  return { keep, update: [], add: [], delete: [] };
}

function fakeTaskProjectAssignments(
  systemPrompt: string,
  userContent: string,
): { assignments: { task_index: number; project_id: string }[] } {
  const projects = parseKnownEntities(systemPrompt);
  const tasks = parseTaskLines(userContent);
  const assignments: { task_index: number; project_id: string }[] = [];
  for (const task of tasks) {
    const project = projects.find((entry) => mentions(task.text, entry.name));
    if (project) {
      assignments.push({ task_index: task.index, project_id: project.id });
    }
  }
  return { assignments };
}

function fakeTaskEnrichments(
  systemPrompt: string,
  userContent: string,
): {
  enrichments: {
    task_index: number;
    assigned_to_id: string | null;
    due_date: null;
    cleaned_text: string;
  }[];
} {
  const people = parseKnownEntities(systemPrompt);
  const tasks = parseTaskLines(userContent);
  const enrichments = tasks.map((task) => {
    const person = people.find((entry) => mentions(task.text, entry.name));
    return {
      task_index: task.index,
      assigned_to_id: person ? person.id : null,
      due_date: null,
      cleaned_text: task.text,
    };
  });
  return { enrichments };
}

function fakeProjectNameFromPath(
  userContent: string,
): { is_project: boolean; project_name: string | null } {
  // userContent is "Path: <referenceId>". Treat a "<Name> Project" segment as a
  // project named "<Name>" (deterministic mirror of the real heuristic).
  const path = userContent.replace(/^Path:\s*/, "").trim();
  const segments = path.replace(/\.md$/i, "").split("/");
  for (const segment of segments) {
    const match = segment.match(/^(.*\S)\s+Project$/i);
    if (match) {
      return { is_project: true, project_name: match[1].trim() };
    }
  }
  return { is_project: false, project_name: null };
}

function fakeProjectIdsByContent(
  systemPrompt: string,
  userContent: string,
): { project_ids: string[] } {
  const projects = parseKnownEntities(systemPrompt);
  const projectIds = projects
    .filter((entry) => mentions(userContent, entry.name))
    .map((entry) => entry.id);
  return { project_ids: projectIds };
}

function fakePeople(
  systemPrompt: string,
  userContent: string,
): { people: { name: string; id: string }[] } {
  const known = parseKnownEntities(systemPrompt);
  const people = known
    .filter((entry) => mentions(userContent, entry.name))
    .map((entry) => ({ name: entry.name, id: entry.id }));
  return { people };
}
