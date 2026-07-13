// Unit tests for the AI quota gate + enforcement decorator (Step 15).

import { assert, assertEquals } from "@std/assert";
import {
  AiQuotaGate,
  quotaExceededResult,
  withAiQuota,
} from "../../supabase/functions/terrestrial-brain-mcp/ai-quota.ts";
import type { UsageMeter } from "../../supabase/functions/terrestrial-brain-mcp/usage-meter.ts";
import { textResult } from "../../supabase/functions/terrestrial-brain-mcp/mcp-response.ts";

/** Fake meter: returns a scripted count, or throws; records call count. */
class FakeMeter implements UsageMeter {
  calls = 0;
  constructor(private readonly result: number | Error) {}
  countMeteredCallsSince(_sinceMs: number): Promise<number> {
    this.calls++;
    if (this.result instanceof Error) return Promise.reject(this.result);
    return Promise.resolve(this.result);
  }
}

const NOW = Date.UTC(2026, 2, 15, 12, 0, 0);

Deno.test("an unlimited (null) limit allows without querying the meter", async () => {
  const meter = new FakeMeter(9999);
  const decision = await new AiQuotaGate(null, meter).check(NOW);
  assertEquals(decision.allowed, true);
  assertEquals(decision.limit, null);
  assertEquals(meter.calls, 0); // short-circuit: never queried
});

Deno.test("the gate allows while used <= limit and denies above it", async () => {
  const atLimit = await new AiQuotaGate(3, new FakeMeter(3)).check(NOW);
  assertEquals(atLimit.allowed, true);
  assertEquals(atLimit.used, 3);

  const overLimit = await new AiQuotaGate(3, new FakeMeter(4)).check(NOW);
  assertEquals(overLimit.allowed, false);
  assertEquals(overLimit.used, 4);
});

Deno.test("a meter failure fails open (allows) rather than blocking", async () => {
  const decision = await new AiQuotaGate(3, new FakeMeter(new Error("db down")))
    .check(NOW);
  assertEquals(decision.allowed, true);
  assertEquals(decision.used, 0);
});

Deno.test("withAiQuota skips the handler and returns a quota error when over quota", async () => {
  let handlerCalls = 0;
  const handler = () => {
    handlerCalls++;
    return Promise.resolve(textResult("ran"));
  };
  const gate = new AiQuotaGate(1, new FakeMeter(2)); // used 2 > limit 1
  const result = await withAiQuota(gate, handler)();
  assertEquals(handlerCalls, 0); // handler NOT called — no AI performed
  assertEquals(result.isError, true);
  assert(result.content[0].text.includes("AI quota exceeded"));
});

Deno.test("withAiQuota runs the handler when under quota", async () => {
  let handlerCalls = 0;
  const handler = () => {
    handlerCalls++;
    return Promise.resolve(textResult("ran"));
  };
  const gate = new AiQuotaGate(5, new FakeMeter(1)); // used 1 <= limit 5
  const result = await withAiQuota(gate, handler)();
  assertEquals(handlerCalls, 1);
  assertEquals(result.content[0].text, "ran");
  assertEquals(result.isError, undefined);
});

Deno.test("quotaExceededResult reports used/limit/reset and no content", () => {
  const result = quotaExceededResult({
    allowed: false,
    limit: 100,
    used: 100,
    resetAtMs: Date.UTC(2026, 3, 1),
  });
  assertEquals(result.isError, true);
  const text = result.content[0].text;
  assert(text.includes("100 of 100"));
  assert(text.includes("2026-04-01"));
  assert(text.includes("No AI operation was performed"));
});
