import { assertEquals } from "@std/assert";
import {
  callHTTPWithStatus,
  callTool,
  createServiceClient,
  httpUrl,
  uniqueToken,
} from "../helpers/mcp-client.ts";

// Integration tests for the GDPR erasure pathway (fix-plan Step 25, finding X7).
// forget_note / /forget-note must HARD-delete a note's snapshot + derived
// thoughts, leave unrelated notes intact, and stay idempotent.

const supabase = createServiceClient();

/** Seed a note snapshot + N thoughts linked to it; returns the snapshot id. */
async function seedNote(
  referenceId: string,
  thoughtCount: number,
): Promise<string> {
  const { data: snapshot, error: snapError } = await supabase
    .from("note_snapshots")
    .insert({
      reference_id: referenceId,
      title: "Fixture",
      content: "fixture content",
      source: "obsidian",
    })
    .select("id")
    .single();
  if (snapError || !snapshot) {
    throw new Error(`seed snapshot failed: ${snapError?.message}`);
  }

  const rows = Array.from({ length: thoughtCount }, (_, index) => ({
    content: `fixture thought ${index}`,
    note_snapshot_id: snapshot.id,
  }));
  const { error: thoughtError } = await supabase.from("thoughts").insert(rows);
  if (thoughtError) {
    throw new Error(`seed thoughts failed: ${thoughtError.message}`);
  }
  return snapshot.id;
}

async function countThoughts(snapshotId: string): Promise<number> {
  const { count } = await supabase
    .from("thoughts")
    .select("id", { count: "exact", head: true })
    .eq("note_snapshot_id", snapshotId);
  return count ?? 0;
}

async function snapshotExists(referenceId: string): Promise<boolean> {
  const { data } = await supabase
    .from("note_snapshots")
    .select("id")
    .eq("reference_id", referenceId)
    .maybeSingle();
  return data !== null;
}

Deno.test("/forget-note hard-deletes a note's snapshot and thoughts", async () => {
  const ref = `forget-http-${uniqueToken()}.md`;
  const snapshotId = await seedNote(ref, 3);
  assertEquals(await countThoughts(snapshotId), 3);

  const { status, body } = await callHTTPWithStatus("forget-note", {
    note_id: ref,
  });

  assertEquals(status, 200);
  assertEquals(body.success, true);
  assertEquals(await countThoughts(snapshotId), 0);
  assertEquals(await snapshotExists(ref), false);
});

Deno.test("forget_note MCP tool erases the note and leaves others intact", async () => {
  const target = `forget-tool-${uniqueToken()}.md`;
  const bystander = `forget-keep-${uniqueToken()}.md`;
  const targetSnapshot = await seedNote(target, 2);
  const bystanderSnapshot = await seedNote(bystander, 2);

  const text = await callTool("forget_note", { note_id: target });

  // Target gone.
  assertEquals(await countThoughts(targetSnapshot), 0);
  assertEquals(await snapshotExists(target), false);
  // Bystander untouched.
  assertEquals(await countThoughts(bystanderSnapshot), 2);
  assertEquals(await snapshotExists(bystander), true);
  // Message reports what was erased.
  assertEquals(text.includes("erased its note snapshot"), true);

  // Cleanup the bystander.
  await callTool("forget_note", { note_id: bystander });
});

Deno.test("forget_note is idempotent for unknown and already-forgotten notes", async () => {
  const ref = `forget-idem-${uniqueToken()}.md`;

  // Unknown ref → success no-op.
  const first = await callTool("forget_note", { note_id: ref });
  assertEquals(first.includes("Nothing to forget"), true);

  // Seed, forget once, forget again → still success.
  await seedNote(ref, 1);
  const second = await callTool("forget_note", { note_id: ref });
  assertEquals(second.includes("erased its note snapshot"), true);
  const third = await callTool("forget_note", { note_id: ref });
  assertEquals(third.includes("Nothing to forget"), true);
});

Deno.test("/forget-note rejects a missing note_id with 400", async () => {
  const { status, body } = await callHTTPWithStatus("forget-note", {});
  assertEquals(status, 400);
  assertEquals(body.success, false);
  assertEquals(body.error, "note_id is required");
});

Deno.test("/forget-note requires a valid access key", async () => {
  // No ?key= and no x-brain-key header → 401, nothing deleted.
  const url = httpUrl("forget-note").replace(/\?key=[^&]*/, "");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ note_id: "whatever.md" }),
  });
  assertEquals(response.status, 401);
  await response.body?.cancel();
});
