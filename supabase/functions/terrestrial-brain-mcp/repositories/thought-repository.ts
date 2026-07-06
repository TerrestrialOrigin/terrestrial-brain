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
import type { Database } from "../database.types.ts";
import type { Row } from "../supabase-client.ts";

// ---------------------------------------------------------------------------
// Row & parameter shapes — row DTOs are projections of the generated schema
// types (Step 24), so they can no longer drift from the database.
// ---------------------------------------------------------------------------

/** A row from the `match_thoughts` vector-search RPC. */
export type ThoughtMatchRow =
  Database["public"]["Functions"]["match_thoughts"]["Returns"][number];

/** A row shape used by `list_thoughts`. */
export type ThoughtListRow = Pick<
  Row<"thoughts">,
  | "id"
  | "content"
  | "metadata"
  | "created_at"
  | "updated_at"
  | "reliability"
  | "author"
>;

/** A single `{ key, count }` bucket in the aggregated thought statistics. */
export interface ThoughtStatCount {
  key: string;
  count: number;
}

/**
 * Aggregated knowledge-base statistics, computed in the database by the
 * `thought_stats` RPC (Step 24). `types`/`topics`/`people` are already the
 * top-10 buckets ordered by descending count; `oldest`/`newest` bound the
 * active thoughts' created_at range (null when there are no thoughts).
 */
export interface ThoughtStatsResult {
  total: number;
  oldest: string | null;
  newest: string | null;
  types: ThoughtStatCount[];
  topics: ThoughtStatCount[];
  people: ThoughtStatCount[];
}

/** Full single-thought row read by `get_thought_by_id`. */
export type ThoughtDetailRow = Pick<
  Row<"thoughts">,
  "id" | "content" | "metadata" | "reference_id" | "created_at" | "updated_at"
>;

/** Row read by `update_thought` before applying an update. */
export type ThoughtForUpdateRow = Pick<
  Row<"thoughts">,
  "id" | "content" | "reliability" | "author" | "metadata"
>;

/** Row read by `archive_thought` (active thoughts only). */
export type ThoughtActiveRow = Pick<Row<"thoughts">, "id" | "content">;

/** Row read by `handleIngestNote` when fetching a note's existing thoughts. */
export type ThoughtByReferenceRow = Pick<
  Row<"thoughts">,
  "id" | "content" | "created_at"
>;

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

  /**
   * Aggregated statistics over active thoughts, computed in the database
   * (`thought_stats` RPC), optionally scoped to a project. Replaces the former
   * load-every-row client-side aggregation (finding 7.3).
   */
  stats(projectId?: string): Promise<RepoResult<ThoughtStatsResult>>;

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

  /**
   * Soft-archive every thought whose metadata references the given document id —
   * the `update_document` stale-thought cleanup. Never hard-deletes.
   */
  archiveByDocumentReference(documentId: string): Promise<RepoResult<void>>;

  /** Increment usefulness for the given ids; data is the affected count. */
  incrementUsefulness(ids: string[]): Promise<RepoResult<number>>;
}
