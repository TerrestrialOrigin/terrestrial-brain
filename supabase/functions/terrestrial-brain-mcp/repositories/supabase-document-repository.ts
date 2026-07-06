/**
 * SupabaseDocumentRepository — the sole implementation of `DocumentRepository`
 * (fix-plan Step 17). Every `documents` table query formerly inline in
 * `tools/documents.ts` lives here.
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import { escapeLikePattern } from "../escape-like.ts";
import type {
  DocumentForUpdateRow,
  DocumentFullRow,
  DocumentInsertRow,
  DocumentListFilters,
  DocumentListRow,
  DocumentRepository,
  NewDocumentValues,
} from "./document-repository.ts";

export class SupabaseDocumentRepository implements DocumentRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  async insert(
    values: NewDocumentValues,
  ): Promise<RepoResult<DocumentInsertRow>> {
    const { data, error } = await this.supabase
      .from("documents")
      .insert(values)
      .select("id, title, project_id")
      .single();
    return { data, error: toRepoError(error) };
  }

  async findById(id: string): Promise<RepoResult<DocumentFullRow>> {
    const { data, error } = await this.supabase
      .from("documents")
      .select("*")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async list(
    filters: DocumentListFilters,
  ): Promise<RepoResult<DocumentListRow[]>> {
    let query = this.supabase
      .from("documents")
      .select(
        "id, title, project_id, file_path, references, created_at, updated_at",
      )
      .order("created_at", { ascending: false })
      .limit(filters.limit);

    if (filters.projectId) query = query.eq("project_id", filters.projectId);
    // Escape LIKE metacharacters so user text matches literally — a bare `%`
    // must not return every row (finding 5.3). PostgREST applies the SQL
    // default `\` escape character to the escaped pattern.
    if (filters.titleContains) {
      query = query.ilike(
        "title",
        `%${escapeLikePattern(filters.titleContains)}%`,
      );
    }
    if (filters.search) {
      query = query.ilike("content", `%${escapeLikePattern(filters.search)}%`);
    }

    const { data, error } = await query;
    return { data, error: toRepoError(error) };
  }

  async findForUpdate(id: string): Promise<RepoResult<DocumentForUpdateRow>> {
    const { data, error } = await this.supabase
      .from("documents")
      .select("id, title, project_id")
      .eq("id", id)
      .single();
    return { data, error: toRepoError(error) };
  }

  async update(
    id: string,
    updates: Record<string, unknown>,
  ): Promise<RepoResult<void>> {
    const { error } = await this.supabase
      .from("documents")
      .update(updates)
      .eq("id", id);
    return { data: null, error: toRepoError(error) };
  }
}
