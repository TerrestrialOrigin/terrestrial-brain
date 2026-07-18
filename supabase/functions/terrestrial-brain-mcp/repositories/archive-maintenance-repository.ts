/**
 * ArchiveMaintenanceRepository — the seam over the GDPR archive retention/erasure
 * RPCs (change: archive-retention-and-purge, SQL-9). `count*` is a dry-run;
 * `purge*` hard-deletes. Both are service-role only and operate over the four
 * archivable tables (thoughts, projects, tasks, people), reporting the documents
 * that a project purge would cascade-delete.
 */

import type { RepoResult } from "./repo-result.ts";

/** One row of a count/purge result: a table (or the cascade pseudo-row) + its count. */
export interface ArchiveTableCount {
  tableName: string;
  count: number;
}

export interface ArchiveMaintenanceRepository {
  /** Dry-run: per-table counts of archived rows matching the filter (deletes nothing). */
  countArchived(
    targetTable: string | null,
    archivedOnOrBefore: string | null,
  ): Promise<RepoResult<ArchiveTableCount[]>>;

  /** Hard-delete archived rows matching the filter; returns per-table deleted counts. */
  purgeArchived(
    targetTable: string | null,
    archivedOnOrBefore: string | null,
  ): Promise<RepoResult<ArchiveTableCount[]>>;
}
