import { assertEquals } from "@std/assert";
import { escapeLikePattern } from "../../supabase/functions/terrestrial-brain-mcp/escape-like.ts";

// Unit tests for the LIKE/ILIKE metacharacter escaper (Step 24, finding 5.3).

Deno.test("escapeLikePattern: escapes percent so it matches literally", () => {
  assertEquals(escapeLikePattern("50%"), "50\\%");
});

Deno.test("escapeLikePattern: escapes underscore", () => {
  assertEquals(escapeLikePattern("a_b"), "a\\_b");
});

Deno.test("escapeLikePattern: escapes backslash FIRST so added escapes are not doubled", () => {
  // A single backslash becomes an escaped backslash; a following percent is then
  // escaped once (not turned into an escaped-backslash + bare percent).
  assertEquals(escapeLikePattern("\\%"), "\\\\\\%");
});

Deno.test("escapeLikePattern: leaves ordinary text untouched", () => {
  assertEquals(escapeLikePattern("hello world"), "hello world");
});

Deno.test("escapeLikePattern: empty string stays empty", () => {
  assertEquals(escapeLikePattern(""), "");
});

Deno.test("escapeLikePattern: escapes every metacharacter in a mixed string", () => {
  assertEquals(escapeLikePattern("a%b_c\\d"), "a\\%b\\_c\\\\d");
});
