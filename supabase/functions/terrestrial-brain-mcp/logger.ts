import { SupabaseClient } from "@supabase/supabase-js";
import { getRequestIp } from "./requestContext.ts";
import { errorResult, type McpToolResult } from "./mcp-response.ts";

// ─── IP extraction from HTTP headers ────────────────────────────────────────

export function extractIpAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }

  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) {
    return cfIp.trim();
  }

  return null;
}

// ─── Logger interface and factory ───────────────────────────────────────────

export interface FunctionCallLogger {
  logCall(
    functionName: string,
    functionType: "mcp" | "http",
    input: Record<string, unknown>,
    ipAddress?: string | null,
  ): Promise<string | null>;

  logError(logId: string, errorDetails: string): Promise<void>;

  logResult(
    logId: string,
    recordsReturned: number,
    responseCharacters: number,
    errorDetails?: string | null,
  ): Promise<void>;
}

export function createFunctionCallLogger(
  supabase: SupabaseClient,
): FunctionCallLogger {
  return {
    async logCall(
      functionName,
      functionType,
      input,
      ipAddress,
    ): Promise<string | null> {
      try {
        const { data, error } = await supabase
          .from("function_call_logs")
          .insert({
            function_name: functionName,
            function_type: functionType,
            input: JSON.stringify(input),
            ip_address: ipAddress ?? null,
          })
          .select("id")
          .single();

        if (error) {
          console.error(`Function call logging failed: ${error.message}`);
          return null;
        }
        return data.id;
      } catch (err) {
        console.error(`Function call logging error: ${(err as Error).message}`);
        return null;
      }
    },

    async logError(logId, errorDetails): Promise<void> {
      try {
        const { error } = await supabase
          .from("function_call_logs")
          .update({ error_details: errorDetails })
          .eq("id", logId);

        if (error) {
          console.error(`Function call error logging failed: ${error.message}`);
        }
      } catch (err) {
        console.error(
          `Function call error logging error: ${(err as Error).message}`,
        );
      }
    },

    async logResult(
      logId,
      recordsReturned,
      responseCharacters,
      errorDetails,
    ): Promise<void> {
      try {
        const updatePayload: Record<string, unknown> = {
          records_returned: recordsReturned,
          response_characters: responseCharacters,
        };
        if (errorDetails) {
          updatePayload.error_details = errorDetails;
        }

        const { error } = await supabase
          .from("function_call_logs")
          .update(updatePayload)
          .eq("id", logId);

        if (error) {
          console.error(
            `Function call result logging failed: ${error.message}`,
          );
        }
      } catch (err) {
        console.error(
          `Function call result logging error: ${(err as Error).message}`,
        );
      }
    },
  };
}

// ─── MCP tool handler wrapper ───────────────────────────────────────────────

/**
 * Wraps an MCP tool handler with fire-and-forget logging.
 * Logs input before execution; always updates with result metrics afterward.
 * Owns the outer try/catch: a throwing handler is caught, logged, and returned
 * as a proper MCP error envelope (`Error: <message>`) rather than propagating —
 * so no per-handler catch block is needed (finding X1). Generic over the
 * handler's argument tuple, so no `no-explicit-any` suppression is required.
 */
export function withMcpLogging<Args extends unknown[]>(
  toolName: string,
  handler: (...args: Args) => Promise<McpToolResult>,
  logger: FunctionCallLogger,
): (...args: Args) => Promise<McpToolResult> {
  return async (...args: Args): Promise<McpToolResult> => {
    const params = (args[0] as Record<string, unknown>) || {};
    const ipAddress = getRequestIp();
    const logId = await logger.logCall(toolName, "mcp", params, ipAddress);

    let result: McpToolResult;
    try {
      result = await handler(...args);
    } catch (err) {
      result = errorResult(`Error: ${(err as Error).message}`);
    }

    if (logId) {
      const contentEntries = result.content || [];
      const recordsReturned = contentEntries.length;
      const responseCharacters = contentEntries.reduce(
        (total: number, entry: { text?: string }) =>
          total + (entry.text?.length || 0),
        0,
      );
      const errorText = result.isError
        ? (contentEntries[0]?.text || "Unknown error")
        : null;
      await logger.logResult(
        logId,
        recordsReturned,
        responseCharacters,
        errorText,
      );
    }

    return result;
  };
}
