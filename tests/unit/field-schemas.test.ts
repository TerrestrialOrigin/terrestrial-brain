import { assertEquals } from "@std/assert";
import {
  dueByField,
  emailField,
} from "../../supabase/functions/terrestrial-brain-mcp/zod-schemas.ts";

// Step 18 (http-route-validation, TOOL-15): format validation happens at the
// boundary — a hallucinated date or junk email is rejected with a clear
// message instead of failing deep in Postgres.

Deno.test("dueByField: rejects a hallucinated non-date string", () => {
  assertEquals(dueByField().safeParse("next Tuesday").success, false);
});

Deno.test("dueByField: rejects a partial timestamp", () => {
  assertEquals(dueByField().safeParse("2026-08-01T").success, false);
});

Deno.test("dueByField: accepts an ISO datetime with offset", () => {
  assertEquals(
    dueByField().safeParse("2026-08-01T12:00:00+02:00").success,
    true,
  );
});

Deno.test("dueByField: accepts a UTC (Z) datetime", () => {
  assertEquals(dueByField().safeParse("2026-08-01T12:00:00Z").success, true);
});

Deno.test("dueByField: accepts a plain ISO date", () => {
  assertEquals(dueByField().safeParse("2026-08-01").success, true);
});

Deno.test("emailField: rejects junk", () => {
  assertEquals(emailField().safeParse("not-an-email").success, false);
});

Deno.test("emailField: accepts a valid address", () => {
  assertEquals(emailField().safeParse("ann@example.com").success, true);
});
