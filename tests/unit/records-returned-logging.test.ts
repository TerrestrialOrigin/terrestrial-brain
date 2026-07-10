import { assert, assertEquals } from "@std/assert";
import {
  errorResult,
  type McpToolResult,
} from "../../supabase/functions/terrestrial-brain-mcp/mcp-response.ts";
import {
  type FunctionCallLogger,
  withMcpLogging,
} from "../../supabase/functions/terrestrial-brain-mcp/logger.ts";

// Unit tests for records-returned telemetry (New-Feature-Plan Step 2b).
//
// The bug: withMcpLogging logged `records_returned = result.content.length`
// (always 1 for text results, 1 even on errors) instead of the real DB row
// count. These tests pin the corrected behavior: the decorator reads the
// handler-reported count from `result.meta`, forces 0 on the error path,
// logs the returned ids, and strips `meta` from the client-facing envelope.
//
// The fake logger implements the existing FunctionCallLogger seam (no DB, no
// network). Its `logResult` declares an OPTIONAL trailing `returnedIds` so it
// stays assignable whether or not that parameter exists on the interface yet.

interface LoggedResult {
  recordsReturned: number;
  responseCharacters: number;
  errorDetails?: string | null;
  returnedIds?: string[] | null;
}

function createFakeLogger(): {
  logger: FunctionCallLogger;
  results: LoggedResult[];
  errors: string[];
} {
  const results: LoggedResult[] = [];
  const errors: string[] = [];
  const logger: FunctionCallLogger = {
    logCall(): Promise<string | null> {
      return Promise.resolve("log-id-1");
    },
    logError(_logId, errorDetails): Promise<void> {
      errors.push(errorDetails);
      return Promise.resolve();
    },
    logResult(
      _logId,
      recordsReturned,
      responseCharacters,
      errorDetails,
      returnedIds?: string[] | null,
    ): Promise<void> {
      results.push({
        recordsReturned,
        responseCharacters,
        errorDetails,
        returnedIds,
      });
      return Promise.resolve();
    },
  };
  return { logger, results, errors };
}

// A row-returning handler that reports its real count + ids via `meta`. Built
// as a literal (McpToolResult has an index signature) so the test compiles
// against the pre-fix code and fails at the ASSERTION, not at type-check.
function reportingResult(
  text: string,
  recordsReturned: number,
  returnedIds?: string[],
): McpToolResult {
  const result: McpToolResult = { content: [{ type: "text", text }] };
  result.meta = returnedIds
    ? { recordsReturned, returnedIds }
    : { recordsReturned };
  return result;
}

Deno.test("withMcpLogging: logs the handler-reported row count, not the content-block count", async () => {
  const { logger, results } = createFakeLogger();
  const wrapped = withMcpLogging(
    "search_thoughts",
    (_args: Record<string, unknown>) =>
      Promise.resolve(
        reportingResult("Found 3 thought(s): …", 3, ["a", "b", "c"]),
      ),
    logger,
  );

  await wrapped({ query: "x" });

  assertEquals(results.length, 1);
  // Pre-fix code logs content.length === 1 here — this is the RED assertion.
  assertEquals(results[0].recordsReturned, 3);
  assertEquals(results[0].returnedIds, ["a", "b", "c"]);
  assertEquals(results[0].errorDetails, null);
});

Deno.test("withMcpLogging: an empty read logs records_returned = 0", async () => {
  const { logger, results } = createFakeLogger();
  const wrapped = withMcpLogging(
    "list_thoughts",
    (_args: Record<string, unknown>) =>
      Promise.resolve(reportingResult("No thoughts found.", 0)),
    logger,
  );

  await wrapped({});

  assertEquals(results[0].recordsReturned, 0);
});

Deno.test("withMcpLogging: an errorResult handler logs 0 returned rows with error_details", async () => {
  const { logger, results } = createFakeLogger();
  const wrapped = withMcpLogging(
    "search_thoughts",
    (_args: Record<string, unknown>) =>
      Promise.resolve(errorResult("Search error: boom")),
    logger,
  );

  await wrapped({ query: "x" });

  assertEquals(results[0].recordsReturned, 0);
  assert(results[0].errorDetails === "Search error: boom");
  assertEquals(results[0].returnedIds ?? null, null);
});

Deno.test("withMcpLogging: a thrown handler logs 0 returned rows with error_details", async () => {
  const { logger, results } = createFakeLogger();
  const wrapped = withMcpLogging(
    "search_thoughts",
    (_args: Record<string, unknown>): Promise<McpToolResult> => {
      throw new Error("db down");
    },
    logger,
  );

  await wrapped({ query: "x" });

  assertEquals(results[0].recordsReturned, 0);
  assert(results[0].errorDetails === "Error: db down");
});

Deno.test("withMcpLogging: an un-instrumented success falls back to one record", async () => {
  const { logger, results } = createFakeLogger();
  const wrapped = withMcpLogging(
    "create_task",
    (_args: Record<string, unknown>) =>
      Promise.resolve({ content: [{ type: "text" as const, text: "done" }] }),
    logger,
  );

  await wrapped({});

  assertEquals(results[0].recordsReturned, 1);
  assertEquals(results[0].returnedIds ?? null, null);
});

Deno.test("withMcpLogging: strips meta from the client-facing envelope", async () => {
  const { logger } = createFakeLogger();
  const wrapped = withMcpLogging(
    "search_thoughts",
    (_args: Record<string, unknown>) =>
      Promise.resolve(reportingResult("Found 1 thought(s): …", 1, ["a"])),
    logger,
  );

  const clientResult = await wrapped({ query: "x" });

  assertEquals("meta" in clientResult, false);
  assertEquals(clientResult.content[0].text, "Found 1 thought(s): …");
});
