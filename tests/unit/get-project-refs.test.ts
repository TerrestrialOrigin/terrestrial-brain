import { assertEquals } from "@std/assert";
import { getProjectRefs } from "../../supabase/functions/terrestrial-brain-mcp/helpers.ts";

// getProjectRefs is the single boundary reader for thought->project references.
// Stored data is normalized to the `projects` array format (see migration
// 20260707000001_schema_cleanup), and no writer emits the legacy `project_id`
// string. The reader nonetheless stays tolerant of the legacy shape so a stray
// or pre-backfill row never silently loses its project link. These focused unit
// tests are the one place that proves that tolerance — consumer tests rely on
// the canonical format and do not re-fabricate the dual shape.

Deno.test("getProjectRefs: reads canonical format (projects array)", () => {
  const metadata = {
    references: { projects: ["uuid-1", "uuid-2"], tasks: ["uuid-3"] },
  };
  assertEquals(getProjectRefs(metadata), ["uuid-1", "uuid-2"]);
});

Deno.test("getProjectRefs: tolerates legacy format (project_id string)", () => {
  const metadata = { references: { project_id: "old-uuid" } };
  assertEquals(getProjectRefs(metadata), ["old-uuid"]);
});

Deno.test("getProjectRefs: returns empty when no project references", () => {
  assertEquals(getProjectRefs({}), []);
  assertEquals(getProjectRefs({ references: {} }), []);
  assertEquals(getProjectRefs({ something: "else" }), []);
});
