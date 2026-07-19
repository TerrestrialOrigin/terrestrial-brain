/**
 * ThoughtRepository — the single seam over the `thoughts` table and its two
 * RPCs (`search_thoughts_by_embedding`, `increment_usefulness`) (fix-plan Step 16, finding X2).
 *
 * Only operations with a current caller appear here (no speculative CRUD). Each
 * method returns a `RepoResult` so handlers keep their existing `{ data, error }`
 * control flow. The interface is injected — passed through `register(...)` and
 * `handleIngestNote(...)` — never imported as a module-level singleton.
 */

import type { RepoResult } from "./repo-result.ts";
import type { Database } from "../database.types.ts";
import type { Row, UpdateRow } from "../supabase-client.ts";

// ---------------------------------------------------------------------------
// Row & parameter shapes — row DTOs are projections of the generated schema
// types (Step 24), so they can no longer drift from the database.
// ---------------------------------------------------------------------------

/** A row from the `search_thoughts_by_embedding` vector-search RPC. */
export type ThoughtMatchRow =
  Database["public"]["Functions"]["search_thoughts_by_embedding"]["Returns"][
    number
  ];

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

/** A row shape for the staleness / archival review queues. */
export type ReviewQueueRow = Pick<
  Row<"thoughts">,
  | "id"
  | "content"
  | "created_at"
  | "usefulness_score"
  | "last_retrieved_at"
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

/** Row read by `update_thought` before applying an update. `updated_at` is the
 * optimistic-concurrency etag passed back via `update`'s guard (TOOL-6). */
export type ThoughtForUpdateRow = Pick<
  Row<"thoughts">,
  "id" | "content" | "reliability" | "author" | "metadata" | "updated_at"
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
  /** SHA-256 of content (INVARIANT 1); stamped on every write path. */
  content_hash?: string;
  /** Actor of the mutation: LLM | user | sync (Invariant 2). */
  last_actor?: string;
}

/**
 * A partial update payload for a thought, derived from the generated schema so
 * a misspelled column is a compile error (REPO-4). Two columns are re-typed to
 * what callers actually build: `embedding` (pgvector, which typegen maps to
 * `string`) is the JSON `number[]` the RPC/runtime accepts, and `metadata`
 * (jsonb `Json`) is the plain object the metadata extractor produces — the
 * same two typegen limitations `NewThought` bridges on the insert path.
 */
export type ThoughtUpdate =
  & Partial<Omit<UpdateRow<"thoughts">, "embedding" | "metadata">>
  & {
    embedding?: number[];
    metadata?: Record<string, unknown>;
  };

// ---------------------------------------------------------------------------
// Role interfaces (REPO-2) — the full repository is the sum of five concerns.
// Handlers that use only one concern can depend on just that role; fakes and
// the Supabase implementation still provide the whole `ThoughtRepository`.
// ---------------------------------------------------------------------------

/** Search & retrieval reads over the `thoughts` table and its search RPC. */
export interface ThoughtReads {
  /** Vector search via the `search_thoughts_by_embedding` RPC. */
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

  /** Active, non-superseded thoughts with an exact content-hash (write dedup). */
  findByContentHash(hash: string): Promise<RepoResult<{ id: string }[]>>;
}

/** The write path: insert, partial update, and soft-archive. */
export interface ThoughtWrites {
  /** Insert one thought. */
  insert(thought: NewThought): Promise<RepoResult<void>>;

  /**
   * Apply a partial update to a thought. When `options.expectedUpdatedAt` is
   * provided, the update additionally filters on `updated_at` (optimistic
   * concurrency, TOOL-6): a stale snapshot matches zero rows. `data` carries the
   * matched row's id, or `null` when nothing matched (with `error` null).
   */
  update(
    id: string,
    payload: ThoughtUpdate,
    options?: { expectedUpdatedAt?: string },
  ): Promise<RepoResult<{ id: string } | null>>;

  /** Soft-archive a thought (sets `archived_at`; never deletes). */
  archive(id: string): Promise<RepoResult<void>>;
}

/** The stale/archival human-review queues and the supersedes edge. */
export interface ThoughtReviewQueues {
  /**
   * Stale-review queue: active thoughts older than `olderThanIso` that have not
   * been retrieved since `staleBeforeIso` (retrieval-recency, NOT score alone —
   * a recently-retrieved score-0 thought is excluded). Bounded by `limit`.
   */
  findStale(
    olderThanIso: string,
    staleBeforeIso: string,
    limit: number,
  ): Promise<RepoResult<ReviewQueueRow[]>>;

  /**
   * Archival-review queue: the full conjunction — older than `olderThanIso` AND
   * `usefulness_score = 0` AND never retrieved (`last_retrieved_at` null) AND not
   * owned by a synced note (`note_snapshot_id` null). Bounded by `limit`.
   */
  findArchivalCandidates(
    olderThanIso: string,
    limit: number,
  ): Promise<RepoResult<ReviewQueueRow[]>>;

  /** Set (or clear) the supersedes edge from a thought to its replacement. */
  setSupersededBy(
    id: string,
    supersededBy: string | null,
  ): Promise<RepoResult<void>>;
}

/** Usefulness scoring & the retrieval-recency signal. */
export interface ThoughtUsefulness {
  /** Advance the retrieval-recency signal for the given ids (non-fatal). */
  touchRetrieved(ids: string[]): Promise<RepoResult<void>>;

  /** Increment usefulness for the given ids; data is the affected count. */
  incrementUsefulness(ids: string[]): Promise<RepoResult<number>>;

  /** Weighted usefulness increment (rubber-stamp down-weighting). */
  incrementUsefulnessWeighted(
    ids: string[],
    weight: number,
  ): Promise<RepoResult<number>>;
}

/** Bulk removal paths: user-initiated erasure and document stale-thought cleanup. */
export interface ThoughtErasure {
  /**
   * Soft-archive every thought whose metadata references the given document id —
   * the `update_document` stale-thought cleanup. Never hard-deletes.
   */
  archiveByDocumentReference(documentId: string): Promise<RepoResult<void>>;

  /**
   * HARD-delete every thought derived from a note snapshot; data is the count
   * removed. Unlike `archive`, this permanently erases rows — used only by the
   * user-initiated `forget_note` erasure pathway (GDPR right-to-erasure, Step
   * 25), never from an LLM reconciliation path.
   */
  deleteByNoteSnapshot(snapshotId: string): Promise<RepoResult<number>>;
}

/** The full seam — every concern together (what implementations provide). */
export interface ThoughtRepository
  extends
    ThoughtReads,
    ThoughtWrites,
    ThoughtReviewQueues,
    ThoughtUsefulness,
    ThoughtErasure {}
