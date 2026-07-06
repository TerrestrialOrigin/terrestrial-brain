import { assertEquals } from "@std/assert";
import { SupabaseNoteSnapshotRepository } from "../../supabase/functions/terrestrial-brain-mcp/repositories/supabase-note-snapshot-repository.ts";
import { makeFakeClient } from "./fake-supabase-client.ts";

// Unit tests for SupabaseNoteSnapshotRepository (fix-plan Step 17).

Deno.test("findContentByReference: selects content by reference_id (single)", async () => {
  const { client, recorded } = makeFakeClient({ data: { content: "hi" } });
  const repo = new SupabaseNoteSnapshotRepository(client);

  const { data } = await repo.findContentByReference("notes/x.md");

  assertEquals(recorded.table, "note_snapshots");
  assertEquals(recorded.columns, "content");
  assertEquals(recorded.single, true);
  assertEquals(recorded.filters[0]?.column, "reference_id");
  assertEquals(data?.content, "hi");
});

Deno.test("upsert: upserts on reference_id conflict and returns id", async () => {
  const { client, recorded } = makeFakeClient({ data: { id: "s1" } });
  const repo = new SupabaseNoteSnapshotRepository(client);

  const { data } = await repo.upsert({
    reference_id: "notes/x.md",
    title: "X",
    content: "body",
    source: "obsidian",
  });

  assertEquals(recorded.op, "upsert");
  assertEquals(recorded.onConflict, "reference_id");
  assertEquals(recorded.single, true);
  assertEquals(recorded.payload?.reference_id, "notes/x.md");
  assertEquals(data?.id, "s1");
});
