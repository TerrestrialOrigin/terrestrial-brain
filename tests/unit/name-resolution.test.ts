import { assertEquals } from "@std/assert";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveNames } from "../../supabase/functions/terrestrial-brain-mcp/repositories/name-resolution.ts";

// Pure unit tests for the shared name-resolution helper (fix-plan Step 16).
// A fake Supabase client records the query and returns a canned result — no DB.

interface FakeResult {
  data?: Array<Record<string, unknown>> | null;
  error?: { message: string } | null;
}

function makeFakeSupabase(
  result: FakeResult,
): {
  supabase: SupabaseClient;
  calls: { fromCount: number; table: string; columns: string; ids: string[] };
} {
  const calls = { fromCount: 0, table: "", columns: "", ids: [] as string[] };
  const builder = {
    select(columns: string) {
      calls.columns = columns;
      return builder;
    },
    in(_column: string, ids: string[]) {
      calls.ids = ids;
      return builder;
    },
    returns() {
      return builder;
    },
    then(
      resolve: (value: FakeResult) => void,
    ) {
      resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  };
  const supabase = {
    from(table: string) {
      calls.fromCount++;
      calls.table = table;
      return builder;
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, calls };
}

Deno.test("resolveNames: maps found rows to their names", async () => {
  const { supabase, calls } = makeFakeSupabase({
    data: [
      { id: "a", name: "Alice" },
      { id: "b", name: "Bob" },
    ],
  });

  const map = await resolveNames(supabase, "people", ["a", "b"]);

  assertEquals(map.get("a"), "Alice");
  assertEquals(map.get("b"), "Bob");
  assertEquals(calls.table, "people");
  assertEquals(calls.columns, "id, name");
});

Deno.test("resolveNames: dedupes ids before querying", async () => {
  const { supabase, calls } = makeFakeSupabase({
    data: [{ id: "a", name: "Alice" }],
  });

  await resolveNames(supabase, "projects", ["a", "a", "a"]);

  assertEquals(calls.ids, ["a"]);
});

Deno.test("resolveNames: custom name column (parent task content)", async () => {
  const { supabase, calls } = makeFakeSupabase({
    data: [{ id: "t1", content: "Parent task" }],
  });

  const map = await resolveNames(supabase, "tasks", ["t1"], "content");

  assertEquals(map.get("t1"), "Parent task");
  assertEquals(calls.columns, "id, content");
});

Deno.test("resolveNames: query error falls back to raw id → id", async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const { supabase } = makeFakeSupabase({
      error: { message: "lookup boom" },
    });

    const map = await resolveNames(supabase, "projects", ["x", "y"]);

    assertEquals(map.get("x"), "x");
    assertEquals(map.get("y"), "y");
  } finally {
    console.error = originalConsoleError;
  }
});

Deno.test("resolveNames: empty input returns empty map and issues no query", async () => {
  const { supabase, calls } = makeFakeSupabase({ data: [] });

  const map = await resolveNames(supabase, "people", []);

  assertEquals(map.size, 0);
  assertEquals(calls.fromCount, 0);
});

Deno.test("resolveNames: ids not found are simply absent (caller guards)", async () => {
  const { supabase } = makeFakeSupabase({
    data: [{ id: "a", name: "Alice" }],
  });

  const map = await resolveNames(supabase, "people", ["a", "missing"]);

  assertEquals(map.get("a"), "Alice");
  assertEquals(map.has("missing"), false);
});
