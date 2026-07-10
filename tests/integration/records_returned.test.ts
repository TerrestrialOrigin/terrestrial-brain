import { assertEquals, assertExists } from "@std/assert";
import {
  callTool,
  SUPABASE_SERVICE_KEY,
  SUPABASE_URL,
} from "../helpers/mcp-client.ts";

// Integration coverage for records-returned telemetry (New-Feature-Plan Step 2b).
// Real local stack, real handler → logger → Postgres path, no mocks. Asserts that
// function_call_logs.records_returned equals the true returned-row count and that
// thought-retrieval calls log their returned ids in returned_ids.
//
// Correlates the log row via the unique marker embedded in the serialized `input`
// column, so it is robust to other calls in the table.

const REST = `${SUPABASE_URL}/rest/v1`;
const AUTH = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
};

interface CallLogRow {
  records_returned: number | null;
  returned_ids: string[] | null;
  error_details: string | null;
}

/** Read the most recent function_call_logs row for a tool whose input contains marker. */
async function latestLog(
  functionName: string,
  marker: string,
): Promise<CallLogRow> {
  const url = `${REST}/function_call_logs?function_name=eq.${functionName}` +
    `&input=ilike.*${encodeURIComponent(marker)}*` +
    `&select=records_returned,returned_ids,error_details` +
    `&order=called_at.desc&limit=1`;
  const res = await fetch(url, { headers: AUTH });
  const rows = await res.json() as CallLogRow[];
  assertExists(
    rows[0],
    `expected a ${functionName} log row for marker ${marker}`,
  );
  return rows[0];
}

async function deleteThoughtsByMarker(marker: string): Promise<void> {
  await fetch(
    `${REST}/thoughts?content=ilike.*${encodeURIComponent(marker)}*`,
    {
      method: "DELETE",
      headers: AUTH,
    },
  );
}

/** Parse "Found N thought(s)" / "N recent thought(s)" out of a search/list response. */
function parseCount(text: string): number {
  const match = text.match(/Found (\d+) thought|(\d+) recent thought/);
  if (!match) return 0;
  return Number(match[1] ?? match[2]);
}

Deno.test("search_thoughts logs records_returned equal to the real returned count and the returned ids", async () => {
  const marker = `rrtelemetry-search-${Date.now()}`;
  for (let index = 0; index < 3; index++) {
    await callTool("capture_thought", { content: `${marker} note ${index}` });
  }

  const response = await callTool("search_thoughts", {
    query: marker,
    limit: 10,
    threshold: 0.1,
  });
  const actualCount = parseCount(response);

  const log = await latestLog("search_thoughts", marker);
  assertEquals(
    log.records_returned,
    actualCount,
    `records_returned (${log.records_returned}) must equal the real returned count (${actualCount})`,
  );
  assertExists(log.returned_ids);
  assertEquals(
    log.returned_ids?.length,
    actualCount,
    "returned_ids length must equal the returned count",
  );

  await deleteThoughtsByMarker(marker);
});

Deno.test("search_thoughts with no matches logs records_returned = 0 and null returned_ids", async () => {
  const marker = `rrtelemetry-nomatch-${Date.now()}-zzqxv`;
  const response = await callTool("search_thoughts", {
    query: marker,
    limit: 5,
    threshold: 0.99,
  });
  assertEquals(response.includes("No thoughts found"), true);

  const log = await latestLog("search_thoughts", marker);
  assertEquals(log.records_returned, 0);
  assertEquals(log.returned_ids, null);
});

Deno.test("get_thought_by_id logs records_returned = 1 and returned_ids = [id]", async () => {
  const marker = `rrtelemetry-byid-${Date.now()}`;
  await callTool("capture_thought", { content: `${marker} single` });

  const idRes = await fetch(
    `${REST}/thoughts?content=ilike.*${
      encodeURIComponent(marker)
    }*&select=id&limit=1`,
    { headers: AUTH },
  );
  const idRows = await idRes.json() as { id: string }[];
  const thoughtId = idRows[0].id;

  await callTool("get_thought_by_id", { id: thoughtId });

  const log = await latestLog("get_thought_by_id", thoughtId);
  assertEquals(log.records_returned, 1);
  assertEquals(log.returned_ids, [thoughtId]);

  await deleteThoughtsByMarker(marker);
});
