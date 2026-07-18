import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { FunctionCallLogger, withMcpLogging } from "../logger.ts";
import { errorResult, textResult } from "../mcp-response.ts";
import type {
  ArchiveMaintenanceRepository,
  ArchiveTableCount,
} from "../repositories/archive-maintenance-repository.ts";

/** The four tables that carry `archived_at` — the allowlist the RPCs validate. */
export const ARCHIVABLE_TABLES = [
  "thoughts",
  "projects",
  "tasks",
  "people",
] as const;

function renderCounts(rows: ArchiveTableCount[]): string {
  if (rows.length === 0) return "  (none)";
  return rows
    .map((row) => `  ${row.tableName}: ${row.count}`)
    .join("\n");
}

/**
 * `purge_archived` — GDPR erasure/retention over the archivable tables. It is a
 * DRY-RUN by default (returns per-table counts and deletes nothing); only an
 * explicit `confirm: true` performs the irreversible hard-delete. Purging an
 * archived project also cascade-deletes its documents; that collateral is shown
 * in the counts so it is never silent.
 */
export function register(
  server: McpServer,
  logger: FunctionCallLogger,
  archiveRepository: ArchiveMaintenanceRepository,
) {
  server.registerTool(
    "purge_archived",
    {
      title: "Purge Archived Data",
      description:
        "Permanently delete archived rows (GDPR erasure/retention) from the " +
        "archivable tables (thoughts, projects, tasks, people). DRY-RUN by " +
        "default — it returns per-table counts and deletes NOTHING unless you " +
        "pass confirm: true. With no table it targets all four tables; with a " +
        "table + on_or_before date it targets only that table's rows archived " +
        "on that date or earlier. Purging an archived project also deletes its " +
        "documents (shown in the counts). This is irreversible.",
      inputSchema: {
        table: z.enum(ARCHIVABLE_TABLES).optional().describe(
          "Restrict to one archivable table; omit to target all four",
        ),
        on_or_before: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
          .describe(
            "Only purge rows archived on this date (YYYY-MM-DD) or earlier",
          ),
        confirm: z.boolean().optional().default(false).describe(
          "Must be true to actually delete; otherwise this is a dry-run",
        ),
      },
    },
    withMcpLogging(
      "purge_archived",
      async ({ table, on_or_before, confirm }) => {
        const targetTable = table ?? null;
        const onOrBefore = on_or_before ?? null;

        if (!confirm) {
          const { data, error } = await archiveRepository.countArchived(
            targetTable,
            onOrBefore,
          );
          if (error) return errorResult(`Count failed: ${error.message}`);
          return textResult(
            `DRY RUN — would delete these archived rows (pass confirm: true to ` +
              `permanently delete):\n${renderCounts(data ?? [])}`,
          );
        }

        const { data, error } = await archiveRepository.purgeArchived(
          targetTable,
          onOrBefore,
        );
        if (error) return errorResult(`Purge failed: ${error.message}`);
        const total = (data ?? []).reduce((sum, row) => sum + row.count, 0);
        return textResult(
          `Purged ${total} archived row(s):\n${renderCounts(data ?? [])}`,
          { recordsReturned: total },
        );
      },
      logger,
    ),
  );
}
