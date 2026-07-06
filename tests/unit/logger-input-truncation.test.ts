import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  MAX_LOGGED_INPUT_CHARS,
  serializeLoggedInput,
} from "../../supabase/functions/terrestrial-brain-mcp/logger.ts";

// Unit tests for logged-input truncation (fix-plan Step 25, finding X7).
// function_call_logs must not accumulate unbounded personal content per row.

Deno.test("serializeLoggedInput: within-cap input is stored unchanged", () => {
  const input = { content: "a short note", title: "T" };
  const serialized = serializeLoggedInput(input);

  assertEquals(serialized, JSON.stringify(input));
  // No truncation marker on a small payload.
  assertEquals(serialized.includes("[truncated"), false);
});

Deno.test("serializeLoggedInput: oversized input is truncated with a marker", () => {
  const bigContent = "x".repeat(MAX_LOGGED_INPUT_CHARS + 500);
  const serialized = serializeLoggedInput({ content: bigContent });

  const full = JSON.stringify({ content: bigContent });
  const droppedCount = full.length - MAX_LOGGED_INPUT_CHARS;

  // Prefix is exactly the cap, followed by the dropped-chars marker.
  assertEquals(
    serialized.startsWith(full.slice(0, MAX_LOGGED_INPUT_CHARS)),
    true,
  );
  assertStringIncludes(serialized, `[truncated ${droppedCount} chars]`);
});

Deno.test("serializeLoggedInput: input exactly at the cap is not truncated", () => {
  // Build a payload whose serialized length is exactly the cap.
  const overhead = JSON.stringify({ content: "" }).length; // {"content":""}
  const filler = "y".repeat(MAX_LOGGED_INPUT_CHARS - overhead);
  const serialized = serializeLoggedInput({ content: filler });

  assertEquals(serialized.length, MAX_LOGGED_INPUT_CHARS);
  assertEquals(serialized.includes("[truncated"), false);
});
