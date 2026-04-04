import { SupabaseClient } from "@supabase/supabase-js";

// ─── Request-scoped IP address ──────────────────────────────────────────────
// Set by index.ts before dispatching to MCP transport, read by withMcpLogging.

let currentRequestIpAddress: string | null = null;

export function setCurrentRequestIp(ipAddress: string | null): void {
  currentRequestIpAddress = ipAddress;
}

export function getCurrentRequestIp(): string | null {
  return currentRequestIpAddress;
}

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
}

export function createFunctionCallLogger(supabase: SupabaseClient): FunctionCallLogger {
  return {
    async logCall(functionName, functionType, input, ipAddress): Promise<string | null> {
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
        console.error(`Function call error logging error: ${(err as Error).message}`);
      }
    },
  };
}

// ─── MCP tool handler wrapper ───────────────────────────────────────────────

interface McpToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

/**
 * Wraps an MCP tool handler with fire-and-forget logging.
 * Logs input before execution; updates error_details if the response has isError.
 */
// deno-lint-ignore no-explicit-any
export function withMcpLogging(
  toolName: string,
  // deno-lint-ignore no-explicit-any
  handler: (...args: any[]) => Promise<McpToolResult>,
  logger: FunctionCallLogger,
  // deno-lint-ignore no-explicit-any
): (...args: any[]) => Promise<McpToolResult> {
  // deno-lint-ignore no-explicit-any
  return async (...args: any[]): Promise<McpToolResult> => {
    const params = args[0] || {};
    const ipAddress = getCurrentRequestIp();
    const logId = await logger.logCall(toolName, "mcp", params, ipAddress);

    const result = await handler(...args);

    if (result.isError && logId) {
      const errorText = result.content?.[0]?.text || "Unknown error";
      await logger.logError(logId, errorText);
    }

    return result;
  };
}
