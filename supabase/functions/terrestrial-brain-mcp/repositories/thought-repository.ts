/**
 * ThoughtRepository — the single seam over the `thoughts` table and its two
 * RPCs (`match_thoughts`, `increment_usefulness`) (fix-plan Step 16, finding X2).
 *
 * Only operations with a current caller appear here (no speculative CRUD). Each
 * method returns a `RepoResult` so handlers keep their existing `{ data, error }`
 * control flow. The interface is injected — passed through `register(...)` and
 * `handleIngestNote(...)` — never imported as a module-level singleton.
 */

import type { RepoResult } from "./repo-result.ts";

// ---------------------------------------------------------------------------
// Row & parameter shapes (hand-written until generated types land — Step 24)
// ---------------------------------------------------------------------------

/** A row from the `match_thoughts` vector-search RPC. */
export interface ThoughtMatchRow {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  similarity: number;
  created_at: string;
  updated_at: string | null;
  reliability: string | null;
  author: string | null;
}

/** A row shape used by `list_thoughts`. */
export interface ThoughtListRow {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string | null;
  reliability: string | null;
  author: string | null;
}

/** Minimal row read by `thought_stats` for in-memory aggregation. */
export interface ThoughtStatsRow {
  metadata: Record<string, unknown>;
  created_at: string;
}

/** Full single-thought row read by `get_thought_by_id`. */
export interface ThoughtDetailRow {
  id: string;
  content: string;
  metadata: Record<string, unknown>;
  reference_id: string | null;
  created_at: string;
  updated_at: string | null;
}

/** Row read by `update_thought` before applying an update. */
export interface ThoughtForUpdateRow {
  id: string;
  content: string;
  reliability: string | null;
  author: string | null;
  metadata: Record<string, unknown>;
}

/** Row read by `archive_thought` (active thoughts only). */
export interface ThoughtActiveRow {
  id: string;
  content: string;
}

/** Row read by `handleIngestNote` when fetching a note's existing thoughts. */
export interface ThoughtByReferenceRow {
  id: string;
  content: string;
  created_at: string;
}

export interface ThoughtListFilters {
  limit: number;
  includeArchived: boolean;
  type?: string;
  topic?: string;
  person?: string;
  projectId?: string;
  author?: string;
  reliability?: string;
  days?: number;
}

export interface ThoughtMatchParams {
  embedding: number[];
  threshold: number;
  count: number;
  author?: string | null;
  reliability?: string | null;
}

/** A thought to insert. Mirrors the columns callers currently populate. */
export interface NewThought {
  content: string;
  embedding: number[];
  metadata: Record<string, unknown>;
  reference_id?: string | null;
  note_snapshot_id?: string | null;
  reliability?: string;
  author?: string | null;
}

export interface ThoughtRepository {
  /** Vector search via the `match_thoughts` RPC. */
  matchByEmbedding(
    params: ThoughtMatchParams,
  ): Promise<RepoResult<ThoughtMatchRow[]>>;

  /** Recent thoughts with optional metadata/author/reliability/date filters. */
  list(filters: ThoughtListFilters): Promise<RepoResult<ThoughtListRow[]>>;

  /** Count of active (non-archived) thoughts, optionally scoped to a project. */
  countActive(projectId?: string): Promise<RepoResult<number>>;

  /** Metadata rows for the stats aggregation, optionally scoped to a project. */
  listForStats(projectId?: string): Promise<RepoResult<ThoughtStatsRow[]>>;

  /** Single thought by id; a "no rows" miss surfaces as `error.code` PGRST116. */
  findById(id: string): Promise<RepoResult<ThoughtDetailRow>>;

  /** Single thought (fields needed to apply an update). */
  findForUpdate(id: string): Promise<RepoResult<ThoughtForUpdateRow>>;

  /** Single active thought (used before archiving). */
  findActiveById(id: string): Promise<RepoResult<ThoughtActiveRow>>;

  /** Active thoughts for a note, oldest first (reconciliation input). */
  findByReference(
    referenceId: string,
  ): Promise<RepoResult<ThoughtByReferenceRow[]>>;

  /** Insert one thought. */
  insert(thought: NewThought): Promise<RepoResult<void>>;

  /** Apply a partial update to a thought. */
  update(
    id: string,
    payload: Record<string, unknown>,
  ): Promise<RepoResult<void>>;

  /** Soft-archive a thought (sets `archived_at`; never deletes). */
  archive(id: string): Promise<RepoResult<void>>;

  /** Increment usefulness for the given ids; data is the affected count. */
  incrementUsefulness(ids: string[]): Promise<RepoResult<number>>;
}
