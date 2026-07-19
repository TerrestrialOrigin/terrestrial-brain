import { SupabaseClient } from "@supabase/supabase-js";
import { getRequestIp } from "./requestContext.ts";
import { errorResult, type McpToolResult } from "./mcp-response.ts";

// ─── Logged-input size cap (data minimization, finding X7) ──────────────────
// Serialized tool/endpoint input can carry full personal note content. We cap
// what a single log row retains so function_call_logs cannot accumulate
// unbounded personal data. Truncation NEVER fails the insert or the response —
// logging must stay invisible to callers.
export const MAX_LOGGED_INPUT_CHARS = 10_000;

/** Serialize input and truncate to the cap, appending a dropped-chars marker. */
export function serializeLoggedInput(input: Record<string, unknown>): string {
  const serialized = JSON.stringify(input);
  if (serialized.length <= MAX_LOGGED_INPUT_CHARS) {
    return serialized;
  }
  const droppedCount = serialized.length - MAX_LOGGED_INPUT_CHARS;
  return `${
    serialized.slice(0, MAX_LOGGED_INPUT_CHARS)
  }…[truncated ${droppedCount} chars]`;
}

// ─── IP extraction from HTTP headers ────────────────────────────────────────

// Shape gates for candidate IPs: a value that parses as neither is treated as
// absent (null) so a client can never plant arbitrary strings in
// function_call_logs.ip_address.
const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;
const IPV6_PATTERN = /^[0-9a-fA-F:]{2,45}$/;

function validateIpShape(candidate: string): string | null {
  if (IPV4_PATTERN.test(candidate)) return candidate;
  // IPv6 must contain at least one colon and only hex/colon characters.
  if (candidate.includes(":") && IPV6_PATTERN.test(candidate)) return candidate;
  return null;
}

// Trusted proxy chain: Supabase's edge gateway APPENDS the true client IP as
// the LAST x-forwarded-for hop, while earlier elements are client-controlled.
// We therefore read the last hop, falling back to the single-value headers,
// and validate the shape before storing.
export function extractIpAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",");
    const trustedHop = hops[hops.length - 1].trim();
    return validateIpShape(trustedHop);
  }

  const realIp = headers.get("x-real-ip");
  if (realIp) {
    return validateIpShape(realIp.trim());
  }

  const cfIp = headers.get("cf-connecting-ip");
  if (cfIp) {
    return validateIpShape(cfIp.trim());
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
    returnedIds?: string[] | null,
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
            input: serializeLoggedInput(input),
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
      returnedIds,
    ): Promise<void> {
      try {
        const updatePayload: Record<string, unknown> = {
          records_returned: recordsReturned,
          response_characters: responseCharacters,
        };
        if (errorDetails) {
          updatePayload.error_details = errorDetails;
        }
        // Ids only, bounded, no content — retrieval analytics (Step 2b). Written
        // only when a retrieval handler supplied ids; NULL otherwise.
        if (returnedIds && returnedIds.length > 0) {
          updatePayload.returned_ids = returnedIds;
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

    const isError = result.isError === true;

    if (logId) {
      const contentEntries = result.content || [];
      // The true returned-row count comes from the handler via `meta` — the
      // decorator only sees the rendered text envelope, whose block count is
      // always 1 for a text result. Fall back to the content-block count for
      // un-instrumented handlers (correct for single-record responses), and
      // force 0 on any error path (a thrown/isError result returns no rows).
      const recordsReturned = isError
        ? 0
        : (result.meta?.recordsReturned ?? contentEntries.length);
      const returnedIds = isError ? null : (result.meta?.returnedIds ?? null);
      const responseCharacters = contentEntries.reduce(
        (total: number, entry: { text?: string }) =>
          total + (entry.text?.length || 0),
        0,
      );
      const errorText = isError
        ? (contentEntries[0]?.text || "Unknown error")
        : null;
      await logger.logResult(
        logId,
        recordsReturned,
        responseCharacters,
        errorText,
        returnedIds,
      );
    }

    // `meta` is internal telemetry for the logger — strip it so it never leaks
    // into the JSON-RPC payload returned to the MCP client.
    const { meta: _meta, ...clientResult } = result;
    return clientResult;
  };
}
