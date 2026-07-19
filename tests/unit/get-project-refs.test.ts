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

// CORE-11 — stored metadata is external data (JSONB written by earlier code
// versions and LLM-derived pipelines); it must be structurally validated, not
// cast. Malformed shapes yield only the valid entries.

Deno.test("getProjectRefs: legacy scalar references yields no refs (CORE-11)", () => {
  assertEquals(getProjectRefs({ references: "old-string-value" }), []);
});

Deno.test("getProjectRefs: mixed-type projects array is filtered to strings (CORE-11)", () => {
  const metadata = {
    references: {
      projects: [42, "b8f5c2a4-1234-4abc-9def-000000000001", null, {
        nested: true,
      }],
    },
  };
  assertEquals(getProjectRefs(metadata), [
    "b8f5c2a4-1234-4abc-9def-000000000001",
  ]);
});

Deno.test("getProjectRefs: non-string legacy project_id yields no refs (CORE-11)", () => {
  assertEquals(getProjectRefs({ references: { project_id: 42 } }), []);
});
