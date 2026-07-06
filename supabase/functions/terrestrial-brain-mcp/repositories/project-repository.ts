/**
 * ProjectRepository — the single seam over the `projects` table (fix-plan
 * Step 17, finding X2). Only operations with a current caller appear here.
 * Injected through `register(...)` and placed on `ExtractionContext` for
 * `ProjectExtractor`. Each method returns a `RepoResult` so handlers keep their
 * existing `{ data, error }` control flow.
 */

import type { RepoResult } from "./repo-result.ts";

/** The identity of a freshly-inserted / matched project. */
export interface ProjectIdentity {
  id: string;
  name: string;
}

/** Row shape returned to `list_projects`. */
export interface ProjectListRow {
  id: string;
  name: string;
  type: string | null;
  parent_id: string | null;
  archived_at: string | null;
  created_at: string;
}

/** Full project row read by `get_project` (`select *`). */
export interface ProjectFullRow {
  id: string;
  name: string;
  type: string | null;
  description: string | null;
  parent_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Basic child row for `get_project`. */
export interface ProjectChildRow {
  id: string;
  name: string;
  type: string | null;
}

/** Values for inserting a project. Only `name` is required. */
export interface NewProjectValues {
  name: string;
  type?: string | null;
  parent_id?: string | null;
  description?: string | null;
}

export interface ProjectListFilters {
  includeArchived: boolean;
  parentId?: string;
  type?: string;
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

  /** Active children of a project (id + name + type) for `get_project`. */
  listChildrenBasic(parentId: string): Promise<RepoResult<ProjectChildRow[]>>;

  /** `parent_id` of every active child of the given parents (for child counts). */
  listChildParentIds(
    parentIds: string[],
  ): Promise<RepoResult<{ parent_id: string }[]>>;

  /** Ids of active direct children of the given parents (archive BFS level). */
  listActiveChildIds(
    parentIds: string[],
  ): Promise<RepoResult<{ id: string }[]>>;

  /** Apply a partial update to a project. */
  update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<void>>;

  /** Archive every still-active project in `ids`. */
  archiveManyActive(ids: string[]): Promise<RepoResult<void>>;

  /** All active projects (id + name) — the extractor pipeline context seed. */
  listActive(): Promise<RepoResult<ProjectIdentity[]>>;
}
