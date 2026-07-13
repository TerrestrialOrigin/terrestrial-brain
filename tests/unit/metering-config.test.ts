// Unit tests for the pure metering config (Step 15, managed-ai-metering).

import { assertEquals } from "@std/assert";
import {
  parseAiMonthlyLimit,
  startOfNextUtcMonthMs,
  startOfUtcMonthMs,
} from "../../supabase/functions/terrestrial-brain-mcp/metering-config.ts";

Deno.test("parseAiMonthlyLimit accepts a positive integer", () => {
  assertEquals(parseAiMonthlyLimit("10"), 10);
  assertEquals(parseAiMonthlyLimit(" 25 "), 25);
});

Deno.test("parseAiMonthlyLimit treats unset/empty/invalid/non-positive as unlimited (null)", () => {
  assertEquals(parseAiMonthlyLimit(undefined), null);
  assertEquals(parseAiMonthlyLimit(""), null);
  assertEquals(parseAiMonthlyLimit("   "), null);
  assertEquals(parseAiMonthlyLimit("0"), null);
  assertEquals(parseAiMonthlyLimit("-5"), null);
  assertEquals(parseAiMonthlyLimit("abc"), null);
  assertEquals(parseAiMonthlyLimit("10.5"), null);
});

Deno.test("startOfUtcMonthMs floors to the 1st of the UTC month", () => {
  const mid = Date.UTC(2026, 2, 15, 12, 30, 0); // 2026-03-15T12:30Z
  assertEquals(startOfUtcMonthMs(mid), Date.UTC(2026, 2, 1));
});

Deno.test("startOfNextUtcMonthMs advances to the 1st of the next UTC month, rolling the year", () => {
  assertEquals(
    startOfNextUtcMonthMs(Date.UTC(2026, 2, 15)),
    Date.UTC(2026, 3, 1),
  );
  // December rolls into next January.
  assertEquals(
    startOfNextUtcMonthMs(Date.UTC(2026, 11, 20)),
    Date.UTC(2027, 0, 1),
  );
});
