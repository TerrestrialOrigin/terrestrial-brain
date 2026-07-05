import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { withMcpLogging, type FunctionCallLogger } from "../../supabase/functions/terrestrial-brain-mcp/logger.ts";
import { runWithRequestContext } from "../../supabase/functions/terrestrial-brain-mcp/requestContext.ts";

// Deterministic reproduction of finding C8 (fix-plan Step 11): the request-scoped
// client IP must be isolated per request, so two overlapping requests never
// cross-attribute each other's IP into the function-call log.
//
// This exercises the REAL `withMcpLogging` wrapper and the REAL request-context
// helper together, faking only the DB logger (the legitimate unit boundary — the
// bug is not in the DB write). Each request scope awaits a tick BETWEEN
// establishing its context and the handler reading the IP, mirroring the real
// `await server.connect()` that sits between context-set and the tool handler's
// read in index.ts. With a module-global backing that yield lets the second
// scope's IP overwrite the first before it reads (test fails); with
// AsyncLocalStorage each scope keeps its own IP across the await (test passes).
//
// The local Supabase edge runtime cannot sustain the concurrency needed to force
// this race end-to-end (see design.md Decision 3), so this module-level test is
// the faithful, deterministic reproduction; the integration suite guards the
// single-request path and the per-request server/transport factory.

/** A logger that records the IP handed to each call, keyed by the input marker. */
function createRecordingLogger(): {
  logger: FunctionCallLogger;
  recordedIpByMarker: Map<string, string | null>;
} {
  const recordedIpByMarker = new Map<string, string | null>();
  const logger: FunctionCallLogger = {
    logCall(_functionName, _functionType, input, ipAddress): Promise<string | null> {
      const marker = (input as { marker?: string }).marker ?? "unknown";
      recordedIpByMarker.set(marker, ipAddress ?? null);
      return Promise.resolve(null);
    },
    logError(): Promise<void> {
      return Promise.resolve();
    },
    logResult(): Promise<void> {
      return Promise.resolve();
    },
  };
  return { logger, recordedIpByMarker };
}

/** Resolve on the next macrotask, forcing a real yield to the event loop. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

Deno.test("concurrent request scopes log their own IP, never cross-attributed (C8)", async () => {
  const { logger, recordedIpByMarker } = createRecordingLogger();

  // A trivial handler; the IP is captured by withMcpLogging before it runs.
  const handler = withMcpLogging(
    "list_projects",
    () =>
      Promise.resolve({
        content: [{ type: "text" as const, text: "ok" }],
      }),
    logger,
  );

  const requests = [
    { ipAddress: "10.0.0.1", marker: "req-a" },
    { ipAddress: "10.0.0.2", marker: "req-b" },
  ];

  await Promise.all(
    requests.map((request) =>
      runWithRequestContext({ ipAddress: request.ipAddress }, async () => {
        // Yield AFTER the context is set but BEFORE the handler reads the IP —
        // this is the window where a module global would be overwritten.
        await tick();
        await handler({ marker: request.marker });
      })
    ),
  );

  assertEquals(recordedIpByMarker.get("req-a"), "10.0.0.1");
  assertEquals(recordedIpByMarker.get("req-b"), "10.0.0.2");
});

Deno.test("request IP is null outside any request context", async () => {
  const { logger, recordedIpByMarker } = createRecordingLogger();
  const handler = withMcpLogging(
    "list_projects",
    () => Promise.resolve({ content: [{ type: "text" as const, text: "ok" }] }),
    logger,
  );

  await handler({ marker: "no-context" });

  assertEquals(recordedIpByMarker.get("no-context"), null);
});
