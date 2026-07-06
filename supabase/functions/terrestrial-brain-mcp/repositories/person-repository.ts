/**
 * PersonRepository — the single seam over the `people` table (fix-plan Step 17,
 * finding X2). Only operations with a current caller appear here. Injected
 * through `register(...)` and placed on `ExtractionContext` for `PeopleExtractor`.
 */

import type { RepoResult } from "./repo-result.ts";

/** The identity of a freshly-inserted / matched person. */
export interface PersonIdentity {
  id: string;
  name: string;
}

/** Row shape returned to `list_people`. */
export interface PersonListRow {
  id: string;
  name: string;
  type: string | null;
  email: string | null;
  description: string | null;
  archived_at: string | null;
  created_at: string;
}

/** Full person row read by `get_person` (`select *`). */
export interface PersonFullRow {
  id: string;
  name: string;
  type: string | null;
  email: string | null;
  description: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Values for inserting a person. Only `name` is required. */
export interface NewPersonValues {
  name: string;
  type?: string | null;
  email?: string | null;
  description?: string | null;
}

export interface PersonListFilters {
  includeArchived: boolean;
  type?: string;
}

export interface PersonRepository {
  /** Insert a person; returns the new row's id and name. */
  insert(values: NewPersonValues): Promise<RepoResult<PersonIdentity>>;

  /** List people with optional archived/type filters (ordered by name). */
  list(filters: PersonListFilters): Promise<RepoResult<PersonListRow[]>>;

  /** Full single person by id; "no rows" surfaces via the PGRST116 code. */
  findById(id: string): Promise<RepoResult<PersonFullRow>>;

  /** A single person's name by id (used before archiving). */
  findName(id: string): Promise<RepoResult<{ name: string }>>;

  /** Apply a partial update to a person. */
  update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<void>>;

  /** Soft-archive a person (sets `archived_at`). */
  archive(id: string): Promise<RepoResult<void>>;

  /** All active people (id + name) — the extractor pipeline context seed. */
  listActive(): Promise<RepoResult<PersonIdentity[]>>;
}
