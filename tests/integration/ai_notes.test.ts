import { assertEquals, assertExists } from "https://deno.land/std@0.224.0/assert/mod.ts";

const BASE = "http://localhost:54321/functions/v1/terrestrial-brain-mcp?key=dev-test-key-123";

async function callTool(name: string, args: Record<string, unknown>): Promise<string> {
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name, arguments: args }
    })
  });

  const text = await res.text();
  if (text.startsWith("event:")) {
    const dataLine = text.split("\n").find(l => l.startsWith("data:"));
    if (!dataLine) throw new Error("No data in SSE response");
    const parsed = JSON.parse(dataLine.slice(5).trim());
    if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
    return parsed.result?.content?.[0]?.text || "";
  }
  const parsed = JSON.parse(text);
  if (parsed.result?.isError) throw new Error(parsed.result.content?.[0]?.text || "Tool error");
  return parsed.result?.content?.[0]?.text || "";
}

// ─── AI Notes Tests ──────────────────────────────────────────────────────────

let createdNoteId: string;

Deno.test("create_ai_note creates a note", async () => {
  const result = await callTool("create_ai_note", {
    title: "Test AI Note",
    content: "# Test\n\nThis is a test AI-generated note.",
    suggested_path: "AI Notes/test-ai-note.md",
  });
  assertExists(result);
  assertEquals(result.includes("Test AI Note"), true);
  const match = result.match(/id: ([0-9a-f-]+)/);
  assertExists(match, "Should contain note id");
  createdNoteId = match![1];
});

Deno.test("get_unsynced_ai_notes shows unsynced note", async () => {
  const result = await callTool("get_unsynced_ai_notes", {});
  const notes = JSON.parse(result);
  assertEquals(Array.isArray(notes), true);

  const testNote = notes.find((n: { id: string }) => n.id === createdNoteId);
  assertExists(testNote, "Created note should appear in unsynced list");
  assertEquals(testNote.title, "Test AI Note");
  assertEquals(testNote.content.includes("terrestrialBrainExclude: true"), true);
});

Deno.test("mark_notes_synced marks notes", async () => {
  const result = await callTool("mark_notes_synced", { ids: [createdNoteId] });
  assertExists(result);
  assertEquals(result.includes("1 note"), true);
});

Deno.test("get_unsynced_ai_notes hides synced notes", async () => {
  const result = await callTool("get_unsynced_ai_notes", {});
  const notes = JSON.parse(result);
  const testNote = notes.find((n: { id: string }) => n.id === createdNoteId);
  assertEquals(testNote, undefined, "Synced note should not appear");
});
