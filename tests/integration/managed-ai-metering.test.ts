// Integration tests for managed-AI metering (Step 15). The usage meter + quota
// gate + enforcement decorator under test are the REAL modules; they read REAL
// `function_call_logs` telemetry against the local Supabase — no mock on the
// metered path. A UNIQUE marker function-name set makes the count deterministic
// despite other tests logging real `search_thoughts`/`capture_thought` rows.

import { assert, assertEquals } from "@std/assert";
import { createServiceClient, uniqueToken } from "../helpers/mcp-client.ts";
import { startOfUtcMonthMs } from "../../supabase/functions/terrestrial-brain-mcp/metering-config.ts";
import { SupabaseUsageMeter } from "../../supabase/functions/terrestrial-brain-mcp/usage-meter.ts";
import {
  AiQuotaGate,
  withAiQuota,
} from "../../supabase/functions/terrestrial-brain-mcp/ai-quota.ts";
import { textResult } from "../../supabase/functions/terrestrial-brain-mcp/mcp-response.ts";

const supabase = createServiceClient();

Deno.test("metering: real meter counts only in-window metered rows, gate enforces the boundary", async () => {
  const marker = `metering-${uniqueToken()}`;
  const otherName = `${marker}-other`;
  const now = Date.now();
  const monthStart = startOfUtcMonthMs(now);
  const inWindow = new Date(now).toISOString();
  // One day before this UTC month started → a previous-month row, out of window.
  const prevMonth = new Date(monthStart - 24 * 60 * 60 * 1000).toISOString();

  const { error: seedError } = await supabase.from("function_call_logs").insert(
    [
      { function_name: marker, function_type: "mcp", called_at: inWindow },
      { function_name: marker, function_type: "mcp", called_at: inWindow },
      { function_name: marker, function_type: "mcp", called_at: inWindow },
      // Out of window (previous month) — must NOT be counted.
      { function_name: marker, function_type: "mcp", called_at: prevMonth },
      // A non-metered function name in-window — must NOT be counted.
      { function_name: otherName, function_type: "mcp", called_at: inWindow },
    ],
  );
  assertEquals(seedError, null);

  try {
    // The real meter, scoped to the unique marker so the count is deterministic.
    const meter = new SupabaseUsageMeter(supabase, [marker]);
    const used = await meter.countMeteredCallsSince(monthStart);
    assertEquals(used, 3); // only the 3 in-window marker rows

    // Gate boundary: allowed at used <= limit, denied above it.
    const atLimit = await new AiQuotaGate(3, meter).check(now);
    assertEquals(atLimit.allowed, true);
    const overLimit = await new AiQuotaGate(2, meter).check(now);
    assertEquals(overLimit.allowed, false);
    assertEquals(overLimit.used, 3);

    // The decorator refuses before the handler when over quota.
    let handlerCalls = 0;
    const result = await withAiQuota(new AiQuotaGate(2, meter), () => {
      handlerCalls++;
      return Promise.resolve(textResult("ran"));
    })();
    assertEquals(handlerCalls, 0);
    assertEquals(result.isError, true);
    assert(result.content[0].text.includes("AI quota exceeded"));
  } finally {
    await supabase.from("function_call_logs").delete().in("function_name", [
      marker,
      otherName,
    ]);
  }
});
