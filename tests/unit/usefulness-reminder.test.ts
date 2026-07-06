// Pins the exact per-tone usefulness-reminder text. These strings are part of
// the tools' observable output (search_thoughts / list_thoughts / composite
// queries), so a wording drift must fail loudly here rather than silently
// changing what the model sees.

import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildUsefulnessHeader,
  buildUsefulnessReminder,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/usefulness-reminder.ts";

const IDS = ["a1", "b2"];
const IDS_JSON = JSON.stringify(IDS); // '["a1","b2"]'

Deno.test("hard tone: required-action reminder ending in candidate search ids", () => {
  const expected = [
    "⚠️ REQUIRED BEFORE NEXT USER RESPONSE:",
    "1. Call record_useful_thoughts with IDs that contributed (or empty array).",
    "2. Scan these results for contradictions/outdated data — surface to user, do NOT archive silently.",
    "",
    "NEVER skip the record_useful_thoughts step (if no thoughts were found useful, pass in an empty array)! ALWAYS do the record_useful_thoughts step (if no thoughts were found useful, pass in an empty array)!!!",
    `Candidate IDs from this search: ${IDS_JSON}`,
  ].join("\n");
  assertEquals(buildUsefulnessReminder(IDS, "hard"), expected);
});

Deno.test("soft tone: browsing reminder ending in candidate list ids", () => {
  const expected = [
    "⚠️ BEFORE NEXT USER RESPONSE:",
    "If any of these thoughts contributed to your response, call record_useful_thoughts with their IDs.",
    "If none contributed (e.g. you were just browsing), call record_useful_thoughts with an empty array to acknowledge the scan.",
    "",
    "Also scan for contradictions/outdated data — surface to user, do NOT archive silently.",
    `Candidate IDs from this list: ${IDS_JSON}`,
  ].join("\n");
  assertEquals(buildUsefulnessReminder(IDS, "soft"), expected);
});

Deno.test("terse tone: one-line reminder with the ids", () => {
  assertEquals(
    buildUsefulnessReminder(IDS, "terse"),
    `\n---\nReminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs: ${IDS_JSON}`,
  );
});

Deno.test("header wraps the reminder with a results separator", () => {
  const header = buildUsefulnessHeader(IDS, "hard");
  assertEquals(
    header,
    `${buildUsefulnessReminder(IDS, "hard")}\n\n--- Results ---\n\n`,
  );
  assertStringIncludes(header, "--- Results ---");
});

Deno.test("candidate-id line reflects the exact ids passed", () => {
  assertStringIncludes(
    buildUsefulnessReminder(["only-one"], "hard"),
    'Candidate IDs from this search: ["only-one"]',
  );
});
