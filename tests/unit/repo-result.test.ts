import { assertEquals } from "@std/assert";
import {
  runCount,
  runQuery,
  runWrite,
} from "../../supabase/functions/terrestrial-brain-mcp/repositories/repo-result.ts";

// Unit tests for the shared await-then-wrap helpers (REPO-3). The helpers
// accept anything PromiseLike with supabase-js's `{ data, error }` slice, so a
// plain resolved promise stands in for a query builder.

Deno.test("runQuery: error path returns null data with the mapped error", async () => {
  const result = await runQuery(
    Promise.resolve({
      // A poisoned response pairing data WITH an error: the helper must drop
      // the data so "broken" can never masquerade as a success shape.
      data: [{ id: "t1" }],
      error: { message: "boom", code: "PGRST116" },
    }),
  );

  assertEquals(result.data, null);
  assertEquals(result.error, { message: "boom", code: "PGRST116" });
});

Deno.test("runQuery: success passes data through with a null error", async () => {
  const rows = [{ id: "t1" }, { id: "t2" }];

  const result = await runQuery(Promise.resolve({ data: rows, error: null }));

  assertEquals(result.data, rows);
  assertEquals(result.error, null);
});

Deno.test("runWrite: maps the error and always keeps data null", async () => {
  const failure = await runWrite(
    Promise.resolve({ error: { message: "write failed" } }),
  );
  assertEquals(failure.data, null);
  assertEquals(failure.error, { message: "write failed" });

  const success = await runWrite(Promise.resolve({ error: null }));
  assertEquals(success, { data: null, error: null });
});

Deno.test("runCount: error path keeps data null (broken != zero, REPO-7)", async () => {
  const result = await runCount(
    Promise.resolve({ count: null, error: { message: "count failed" } }),
  );

  assertEquals(result.data, null);
  assertEquals(result.error, { message: "count failed" });
});

Deno.test("runCount: success with a null count is zero", async () => {
  const result = await runCount(
    Promise.resolve({ count: null, error: null }),
  );

  assertEquals(result.data, 0);
  assertEquals(result.error, null);
});
