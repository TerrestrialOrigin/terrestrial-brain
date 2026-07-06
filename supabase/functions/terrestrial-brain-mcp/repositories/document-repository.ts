/**
 * DocumentRepository — the single seam over the `documents` table (fix-plan
 * Step 17, finding X2). Only operations `tools/documents.ts` calls appear here.
 */

import type { RepoResult } from "./repo-result.ts";
import type { Row } from "../supabase-client.ts";

/** The identity returned by an insert. */
export type DocumentInsertRow = Pick<
  Row<"documents">,
  "id" | "title" | "project_id"
>;

/** Full document row read by `get_document` (`select *`). */
export type DocumentFullRow = Row<"documents">;

/** Row shape returned to `list_documents` (no content body). */
export type DocumentListRow = Pick<
  Row<"documents">,
  | "id"
  | "title"
  | "project_id"
  | "file_path"
  | "references"
  | "created_at"
  | "updated_at"
>;

/** Minimal row read by `update_document` to verify existence + extraction context. */
export type DocumentForUpdateRow = Pick<
  Row<"documents">,
  "id" | "title" | "project_id"
>;

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
