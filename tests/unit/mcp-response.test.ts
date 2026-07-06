import { assert, assertEquals } from "@std/assert";
import {
  errorResult,
  type McpToolResult,
  textResult,
} from "../../supabase/functions/terrestrial-brain-mcp/mcp-response.ts";
import {
  type FunctionCallLogger,
  withMcpLogging,
} from "../../supabase/functions/terrestrial-brain-mcp/logger.ts";

// Pure, deterministic unit tests for the response-envelope helpers and the
// logging decorator's catch behavior. No DB, no network, no LLM — the logger
// is a fake implementing the existing FunctionCallLogger seam (Step 14).

// ─── textResult / errorResult envelope shapes ───────────────────────────────

Deno.test("textResult: success envelope has one text block and no isError", () => {
  const result = textResult('Created project "X" (id: 1)');
  assertEquals(result.content, [{
    type: "text",
    text: 'Created project "X" (id: 1)',
  }]);
  // Absent isError is semantically "not an error".
  assertEquals(result.isError, undefined);
});

Deno.test("errorResult: error envelope has one text block and isError true", () => {
  const result = errorResult("Failed to create project: boom");
  assertEquals(result.content, [{
    type: "text",
    text: "Failed to create project: boom",
  }]);
  assertEquals(result.isError, true);
});

// ─── withMcpLogging behavior ────────────────────────────────────────────────

interface LoggedResult {
  recordsReturned: number;
  responseCharacters: number;
  errorDetails?: string | null;
}

function createFakeLogger(): {
  logger: FunctionCallLogger;
  calls: string[];
  results: LoggedResult[];
} {
  const calls: string[] = [];
  const results: LoggedResult[] = [];
  const logger: FunctionCallLogger = {
    logCall(functionName): Promise<string | null> {
      calls.push(functionName);
      return Promise.resolve("log-id-1");
    },
    logError(): Promise<void> {
      return Promise.resolve();
    },
    logResult(
      _logId,
      recordsReturned,
      responseCharacters,
      errorDetails,
    ): Promise<void> {
      results.push({ recordsReturned, responseCharacters, errorDetails });
      return Promise.resolve();
    },
  };
  return { logger, calls, results };
}

Deno.test("withMcpLogging: passes a successful handler result through unchanged and logs it", async () => {
  const { logger, calls, results } = createFakeLogger();
  const wrapped = withMcpLogging(
    "my_tool",
    (_args: Record<string, unknown>) => Promise.resolve(textResult("hello")),
    logger,
  );

  const result = await wrapped({ some: "arg" });

  assertEquals(result, textResult("hello"));
  assertEquals(calls, ["my_tool"]);
  assertEquals(results.length, 1);
  assertEquals(results[0].recordsReturned, 1);
  assertEquals(results[0].responseCharacters, "hello".length);
  assertEquals(results[0].errorDetails, null);
});

Deno.test("withMcpLogging: catches a thrown handler error, returns errorResult, and logs it", async () => {
  const { logger, results } = createFakeLogger();
  const wrapped = withMcpLogging(
    "my_tool",
    (_args: Record<string, unknown>): Promise<McpToolResult> => {
      throw new Error("db down");
    },
    logger,
  );

  // Must NOT propagate — the wrapper owns the catch (finding X1 / GATE 2b).
  const result = await wrapped({});

  assertEquals(result.isError, true);
  assertEquals(result.content[0].text, "Error: db down");
  // The failure is recorded, not swallowed.
  assertEquals(results.length, 1);
  assert(results[0].errorDetails === "Error: db down");
});
