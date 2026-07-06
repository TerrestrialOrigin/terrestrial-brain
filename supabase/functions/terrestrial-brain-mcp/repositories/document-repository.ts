/**
 * DocumentRepository — the single seam over the `documents` table (fix-plan
 * Step 17, finding X2). Only operations `tools/documents.ts` calls appear here.
 */

import type { RepoResult } from "./repo-result.ts";

/** The identity returned by an insert. */
export interface DocumentInsertRow {
  id: string;
  title: string;
  project_id: string;
}

/** Full document row read by `get_document` (`select *`). */
export interface DocumentFullRow {
  id: string;
  title: string;
  content: string;
  project_id: string;
  file_path: string | null;
  references: Record<string, string[]> | null;
  created_at: string;
  updated_at: string;
}

/** Row shape returned to `list_documents` (no content body). */
export interface DocumentListRow {
  id: string;
  title: string;
  project_id: string;
  file_path: string | null;
  references: Record<string, string[]> | null;
  created_at: string;
  updated_at: string;
}

/** Minimal row read by `update_document` to verify existence + extraction context. */
export interface DocumentForUpdateRow {
  id: string;
  title: string;
  project_id: string;
}

/** Values for inserting a document. */
export interface NewDocumentValues {
  project_id: string;
  title: string;
  content: string;
  file_path?: string | null;
  references: Record<string, string[]>;
}

export interface DocumentListFilters {
  limit: number;
  projectId?: string;
  titleContains?: string;
  search?: string;
}

export interface DocumentRepository {
  /** Insert a document; returns id, title, and project_id. */
  insert(values: NewDocumentValues): Promise<RepoResult<DocumentInsertRow>>;

  /** Full single document by id; "no rows" surfaces via the PGRST116 code. */
  findById(id: string): Promise<RepoResult<DocumentFullRow>>;

  /** List documents (metadata only) with optional filters. */
  list(filters: DocumentListFilters): Promise<RepoResult<DocumentListRow[]>>;

  /** Minimal document row for `update_document`'s existence check. */
  findForUpdate(id: string): Promise<RepoResult<DocumentForUpdateRow>>;

  /** Apply a partial update to a document. */
  update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<void>>;
}
