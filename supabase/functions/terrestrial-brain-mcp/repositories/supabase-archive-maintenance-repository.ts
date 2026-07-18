/**
 * SupabaseArchiveMaintenanceRepository — the sole implementation of
 * ArchiveMaintenanceRepository. Calls the count_archived_rows /
 * purge_archived_rows RPCs and normalizes their (row_count / deleted_count)
 * columns to a shared `{ tableName, count }` shape.
 */

import type { AppSupabaseClient } from "../supabase-client.ts";
import { type RepoResult, toRepoError } from "./repo-result.ts";
import type {
  ArchiveMaintenanceRepository,
  ArchiveTableCount,
} from "./archive-maintenance-repository.ts";

export class SupabaseArchiveMaintenanceRepository
  implements ArchiveMaintenanceRepository {
  constructor(private readonly supabase: AppSupabaseClient) {}

  async countArchived(
    targetTable: string | null,
    archivedOnOrBefore: string | null,
  ): Promise<RepoResult<ArchiveTableCount[]>> {
    const { data, error } = await this.supabase.rpc("count_archived_rows", {
      target_table: targetTable ?? undefined,
      archived_on_or_before: archivedOnOrBefore ?? undefined,
    });
    if (error) return { data: null, error: toRepoError(error) };
    return {
      data: (data ?? []).map((row) => ({
        tableName: row.table_name,
        count: row.row_count,
      })),
      error: null,
    };
  }

  async purgeArchived(
    targetTable: string | null,
    archivedOnOrBefore: string | null,
  ): Promise<RepoResult<ArchiveTableCount[]>> {
    const { data, error } = await this.supabase.rpc("purge_archived_rows", {
      target_table: targetTable ?? undefined,
      archived_on_or_before: archivedOnOrBefore ?? undefined,
    });
    if (error) return { data: null, error: toRepoError(error) };
    return {
      data: (data ?? []).map((row) => ({
        tableName: row.table_name,
        count: row.deleted_count,
      })),
      error: null,
    };
  }
}
