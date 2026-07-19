/**
 * AiOutputRepository — the single seam over the `ai_output` table and its
 * `get_pending_ai_output_metadata` RPC (fix-plan Step 17, finding X2). Covers
 * both the MCP tools and the HTTP AI-output pull API handlers.
 */

import type { RepoResult } from "./repo-result.ts";
import type { Database } from "../database.types.ts";

/** A row from the `get_pending_ai_output_metadata` RPC (REPO-6) — metadata
 * plus content size, never the content body itself. */
export type PendingAiOutputMetadataRow =
  Database["public"]["Functions"]["get_pending_ai_output_metadata"]["Returns"][
    number
  ];

/** A pending AI-output row (full content) returned by the pull API. */
export interface PendingAiOutputRow {
  id: string;
  title: string;
  content: string;
  file_path: string;
  created_at: string;
}

/** Values for inserting an AI output. */
export interface NewAiOutputValues {
  title: string;
  content: string;
  file_path: string;
  source_context?: string | null;
}

export interface AiOutputRepository {
  /** Insert an AI output; returns the new row's id. */
  insert(values: NewAiOutputValues): Promise<RepoResult<{ id: string }>>;

  /** Pending (not picked up, not rejected) outputs, oldest first. */
  listPending(): Promise<RepoResult<PendingAiOutputRow[]>>;

  /** Lightweight pending metadata via the `get_pending_ai_output_metadata` RPC. */
  listPendingMetadata(): Promise<RepoResult<PendingAiOutputMetadataRow[]>>;

  /** Content of specific pending outputs by id. */
  findContentByIds(
    ids: string[],
  ): Promise<RepoResult<{ id: string; content: string }[]>>;

  /** Mark outputs picked up (sets `picked_up` + `picked_up_at`). */
  /** Returns the number of rows actually updated (a retry updates 0). */
  markPickedUp(ids: string[]): Promise<RepoResult<number>>;

  /** Reject outputs (sets `rejected` + `rejected_at`); returns rows updated. */
  reject(ids: string[]): Promise<RepoResult<number>>;
}
