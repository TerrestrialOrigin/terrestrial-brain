// Static guards on scripts/purge-archived.sh (SQL-9). The script drives a
// destructive DB operation and can't run against prod here, so we assert its
// safety shape from source. GATE 2b: drop a guard and the matching test reddens.

import { assertEquals, assertStringIncludes } from "@std/assert";

const script = await Deno.readTextFile("scripts/purge-archived.sh");

Deno.test("purge-archived.sh runs the count (dry-run) before purging", () => {
  const countAt = script.indexOf("count_archived_rows");
  const purgeAt = script.indexOf("purge_archived_rows");
  assertEquals(countAt >= 0 && purgeAt >= 0, true);
  assertEquals(
    countAt < purgeAt,
    true,
    "the dry-run count must run before the purge",
  );
});

Deno.test("purge-archived.sh requires typing PURGE for the delete-everything case", () => {
  assertStringIncludes(script, "Type PURGE to proceed");
  assertStringIncludes(script, 'reply" != "PURGE"');
});

Deno.test("purge-archived.sh supports a --yes automation bypass", () => {
  assertStringIncludes(script, "--yes");
  assertStringIncludes(script, "ASSUME_YES");
});

Deno.test("purge-archived.sh validates the table against the allowlist", () => {
  assertStringIncludes(
    script,
    'ARCHIVABLE=("thoughts" "projects" "tasks" "people")',
  );
  assertStringIncludes(script, "is not an archivable table");
});

Deno.test("purge-archived.sh uses npx supabase db query", () => {
  assertStringIncludes(script, "npx supabase db query");
});
