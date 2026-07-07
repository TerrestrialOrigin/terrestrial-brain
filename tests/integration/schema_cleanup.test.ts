import { assertEquals } from "@std/assert";
import { createServiceClient, uniqueToken } from "../helpers/mcp-client.ts";

// Integration tests for the schema-cleanup migration (fix-plan Step 28,
// 20260707000001_schema_cleanup.sql) against the real local database:
//   1. created_at/updated_at are NOT NULL on thoughts/projects/tasks.
//   2. normalize_thought_project_refs collapses the legacy `project_id` string
//      into the canonical `projects` array across all three reference shapes.
// Each test owns uniquely-named fixtures and cleans them up in try/finally.

const supabase = createServiceClient();

// ── 1. Timestamp NOT NULL invariant ─────────────────────────────────────────
// Explicitly passing null overrides the column default and must be rejected.

Deno.test("thoughts.created_at rejects an explicit NULL", async () => {
  const { error } = await supabase.from("thoughts").insert({
    content: `schema-cleanup ${uniqueToken()}`,
    created_at: null,
  });
  assertEquals(error?.code, "23502"); // not_null_violation
});

Deno.test("projects.updated_at rejects an explicit NULL", async () => {
  const { error } = await supabase.from("projects").insert({
    name: `schema-cleanup ${uniqueToken()}`,
    updated_at: null,
  });
  assertEquals(error?.code, "23502");
});

Deno.test("tasks.created_at rejects an explicit NULL", async () => {
  const { error } = await supabase.from("tasks").insert({
    content: `schema-cleanup ${uniqueToken()}`,
    created_at: null,
  });
  assertEquals(error?.code, "23502");
});

// ── 2. Reference-format normalization (three shapes) ─────────────────────────

/** Insert a thought with the given references object; returns its id. */
async function insertThoughtWithRefs(
  references: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase
    .from("thoughts")
    .insert({
      content: `refs-normalize ${uniqueToken()}`,
      metadata: { type: "observation", references },
    })
    .select("id")
    .single();
  assertEquals(error, null);
  return data!.id as string;
}

async function refsOf(id: string): Promise<Record<string, unknown>> {
  const { data, error } = await supabase
    .from("thoughts")
    .select("metadata")
    .eq("id", id)
    .single();
  assertEquals(error, null);
  return (data!.metadata as { references: Record<string, unknown> }).references;
}

Deno.test("normalize: legacy-only project_id becomes a projects array", async () => {
  const id = await insertThoughtWithRefs({ project_id: "uuid-a" });
  try {
    const { error } = await supabase.rpc("normalize_thought_project_refs", {
      target_id: id,
    });
    assertEquals(error, null);
    const refs = await refsOf(id);
    assertEquals(refs.projects, ["uuid-a"]);
    assertEquals("project_id" in refs, false);
  } finally {
    await supabase.from("thoughts").delete().eq("id", id);
  }
});

Deno.test("normalize: existing projects array is preserved (no project_id key)", async () => {
  const id = await insertThoughtWithRefs({ projects: ["uuid-a", "uuid-b"] });
  try {
    const { error } = await supabase.rpc("normalize_thought_project_refs", {
      target_id: id,
    });
    assertEquals(error, null); // no-op: nothing to normalize
    const refs = await refsOf(id);
    assertEquals(refs.projects, ["uuid-a", "uuid-b"]);
    assertEquals("project_id" in refs, false);
  } finally {
    await supabase.from("thoughts").delete().eq("id", id);
  }
});

Deno.test("normalize: both shapes union and de-duplicate", async () => {
  const id = await insertThoughtWithRefs({
    project_id: "uuid-a",
    projects: ["uuid-a", "uuid-b"],
  });
  try {
    const { error } = await supabase.rpc("normalize_thought_project_refs", {
      target_id: id,
    });
    assertEquals(error, null);
    const refs = await refsOf(id);
    const projects = refs.projects as string[];
    assertEquals([...projects].sort(), ["uuid-a", "uuid-b"]);
    assertEquals("project_id" in refs, false);
  } finally {
    await supabase.from("thoughts").delete().eq("id", id);
  }
});
