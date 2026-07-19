/**
 * ProjectRepository — the single seam over the `projects` table (fix-plan
 * Step 17, finding X2). Only operations with a current caller appear here.
 * Injected through `register(...)` and placed on `ExtractionContext` for
 * `ProjectExtractor`. Each method returns a `RepoResult` so handlers keep their
 * existing `{ data, error }` control flow.
 */

import type { RepoResult } from "./repo-result.ts";
import type { Row, UpdateRow } from "../supabase-client.ts";

/** The identity of a freshly-inserted / matched project. */
export type ProjectIdentity = Pick<Row<"projects">, "id" | "name">;

/** Row shape returned to `list_projects`. */
export type ProjectListRow = Pick<
  Row<"projects">,
  "id" | "name" | "type" | "parent_id" | "archived_at" | "created_at"
>;

/** Full project row read by `get_project` (`select *`). */
export type ProjectFullRow = Row<"projects">;

/** Basic child row for `get_project`. */
export type ProjectChildRow = Pick<Row<"projects">, "id" | "name" | "type">;

/** Values for inserting a project. Only `name` is required. */
export interface NewProjectValues {
  name: string;
  type?: string | null;
  parent_id?: string | null;
  description?: string | null;
}

/**
 * A partial update payload for a project, derived from the generated schema so
 * a misspelled column is a compile error (REPO-4).
 */
export type ProjectUpdate = Partial<UpdateRow<"projects">>;

export interface ProjectListFilters {
  includeArchived: boolean;
  parentId?: string;
  type?: string;
  /** Max rows to render; the impl fetches `limit + 1` to detect truncation. */
  limit: number;
}

export interface ProjectRepository {
  /** Insert a project; returns the new row's id and name. */
  insert(values: NewProjectValues): Promise<RepoResult<ProjectIdentity>>;

  /** List projects with optional archived/parent/type filters. */
  list(filters: ProjectListFilters): Promise<RepoResult<ProjectListRow[]>>;

  /** Full single project by id; "no rows" surfaces via the PGRST116 code. */
  findById(id: string): Promise<RepoResult<ProjectFullRow>>;

  /** A single project's name by id (used for parent/name lookups). */
  findName(id: string): Promise<RepoResult<{ name: string }>>;

  /**
   * The active project matching `name` case-insensitively, or `null` data when
   * none exists. Used to recover the existing id after a concurrent auto-create
   * loses the unique-index race (create-or-get, finding EXTR-7).
   */
  findByName(name: string): Promise<RepoResult<ProjectIdentity | null>>;

  /** Active children of a project (id + name + type) for `get_project`. */
  listChildrenBasic(parentId: string): Promise<RepoResult<ProjectChildRow[]>>;

  /** `parent_id` of every active child of the given parents (for child counts). */
  listChildParentIds(
    parentIds: string[],
  ): Promise<RepoResult<{ parent_id: string | null }[]>>;

  /** Ids of active direct children of the given parents (archive BFS level). */
  listActiveChildIds(
    parentIds: string[],
  ): Promise<RepoResult<{ id: string }[]>>;

  /**
   * Apply a partial update to a project. Returns the updated row's id, or
   * `null` data when no row matched `id` (so callers can report not-found
   * instead of a false success — Step 24 affected-row verification).
   */
  update(
    id: string,
    updates: ProjectUpdate,
  ): Promise<RepoResult<{ id: string }>>;

  /** Archive every still-active project in `ids`. */
  archiveManyActive(ids: string[]): Promise<RepoResult<void>>;

  /** All active projects (id + name) — the extractor pipeline context seed. */
  listActive(): Promise<RepoResult<ProjectIdentity[]>>;
}
