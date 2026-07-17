// Database-level access control tests (findings S1, S3 — change: fix-db-security-policies).
//
// Trust model: the edge function holds the service-role key; RLS exists to lock
// the anon (publishable) key out of ALL brain data. These tests hit the local
// Supabase REST API directly with the anon key and assert denial, plus
// service-role regression assertions proving legitimate access is unchanged.
//
// Post-migration denial semantics (see openspec design D4): the fix revokes
// anon/authenticated table DML grants and function EXECUTE outright (in
// addition to service_role-scoped RLS), so every anon attempt fails at the
// privilege level: HTTP 401/403 with SQLSTATE 42501, and no state change.

import { assertEquals, assertExists } from "@std/assert";

const SUPABASE_URL = "http://localhost:55421";
const REST_URL = `${SUPABASE_URL}/rest/v1`;
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SUPABASE_SERVICE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

function restHeaders(
  apiKey: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    "apikey": apiKey,
    "Authorization": `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function serviceInsert(
  table: string,
  row: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${REST_URL}/${table}`, {
    method: "POST",
    headers: restHeaders(SUPABASE_SERVICE_KEY, {
      "Prefer": "return=representation",
    }),
    body: JSON.stringify(row),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `Service-role insert into ${table} failed: ${JSON.stringify(body)}`,
    );
  }
  return body[0];
}

async function serviceSelectById(
  table: string,
  id: string,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${REST_URL}/${table}?id=eq.${id}`, {
    headers: restHeaders(SUPABASE_SERVICE_KEY),
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(
      `Service-role select from ${table} failed: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function serviceDeleteById(table: string, id: string): Promise<void> {
  await fetch(`${REST_URL}/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers: restHeaders(SUPABASE_SERVICE_KEY),
  });
}

function uniqueName(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

// ─── Every brain-data table denies the anon publishable key (TEST-8) ─────────
// The anon key must be locked out of ALL brain data, not just `people`. A
// parameterized SELECT+INSERT denial probe runs against every public table, so
// a future migration re-granting anon DML or shipping a permissive policy on any
// table (thoughts is the most sensitive) fails here. Keep this list in sync with
// `SELECT tablename FROM pg_tables WHERE schemaname='public'`.
const BRAIN_TABLES = [
  "thoughts",
  "projects",
  "tasks",
  "note_snapshots",
  "ai_output",
  "people",
  "documents",
  "function_call_logs",
] as const;

async function assertAnonDenied(
  method: "GET" | "POST",
  table: string,
): Promise<void> {
  const init: RequestInit = { method, headers: restHeaders(SUPABASE_ANON_KEY) };
  if (method === "POST") {
    init.headers = restHeaders(SUPABASE_ANON_KEY, {
      "Content-Type": "application/json",
    });
    init.body = "{}";
  }
  const response = await fetch(`${REST_URL}/${table}?limit=1`, init);
  const body = await response.json().catch(() => null);
  assertEquals(
    response.status === 401 || response.status === 403,
    true,
    `anon ${method} on ${table} must be rejected, got ${response.status}: ${
      JSON.stringify(body)
    }`,
  );
  assertEquals(
    body?.code,
    "42501",
    `anon ${method} on ${table} must be a permission-denied error`,
  );
}

for (const table of BRAIN_TABLES) {
  Deno.test(`anon key cannot SELECT ${table}`, () =>
    assertAnonDenied("GET", table));
  Deno.test(`anon key cannot INSERT into ${table}`, () =>
    assertAnonDenied("POST", table));
}

// ─── Every exposed RPC denies the anon publishable key (TEST-8) ──────────────
// EXECUTE is revoked from anon/authenticated for every RPC; assert the anon key
// is rejected through the REST /rpc surface. Keep in sync with the public
// function list (excluding the update_updated_at trigger function).
const RPC_PROBES: ReadonlyArray<
  { name: string; args: Record<string, unknown> }
> = [
  { name: "increment_usefulness", args: { thought_ids: [] } },
  {
    name: "increment_usefulness_weighted",
    args: { thought_ids: [], weight: 1 },
  },
  { name: "thought_stats", args: { p_project_id: null } },
  { name: "purge_function_call_logs", args: { retention_days: 90 } },
  { name: "get_pending_ai_output_metadata", args: {} },
  { name: "normalize_thought_project_refs", args: { target_id: null } },
];

for (const rpc of RPC_PROBES) {
  Deno.test(`anon key cannot EXECUTE ${rpc.name}`, async () => {
    const response = await fetch(`${REST_URL}/rpc/${rpc.name}`, {
      method: "POST",
      headers: restHeaders(SUPABASE_ANON_KEY),
      body: JSON.stringify(rpc.args),
    });
    const body = await response.json().catch(() => null);
    assertEquals(
      response.status === 401 || response.status === 403 ||
        response.status === 404,
      true,
      `anon RPC ${rpc.name} must be rejected, got ${response.status}: ${
        JSON.stringify(body)
      }`,
    );
  });
}

// ─── people: anon-key denial (update/delete detail beyond the SELECT/INSERT loop) ───

Deno.test("anon key cannot update people", async () => {
  const originalEmail = "acl-update-original@example.com";
  const seededPerson = await serviceInsert("people", {
    name: uniqueName("acl-test-update"),
    type: "human",
    email: originalEmail,
  });
  try {
    const anonResponse = await fetch(
      `${REST_URL}/people?id=eq.${seededPerson.id}`,
      {
        method: "PATCH",
        headers: restHeaders(SUPABASE_ANON_KEY, {
          "Prefer": "return=representation",
        }),
        body: JSON.stringify({ email: "acl-update-tampered@example.com" }),
      },
    );
    const anonBody = await anonResponse.json();
    assertEquals(
      anonResponse.status === 401 || anonResponse.status === 403,
      true,
      `anon update must be rejected, got ${anonResponse.status}: ${
        JSON.stringify(anonBody)
      }`,
    );
    const rowsAfter = await serviceSelectById(
      "people",
      seededPerson.id as string,
    );
    assertEquals(
      rowsAfter[0].email,
      originalEmail,
      "person data must be unchanged",
    );
  } finally {
    await serviceDeleteById("people", seededPerson.id as string);
  }
});

Deno.test("anon key cannot delete from people", async () => {
  const seededPerson = await serviceInsert("people", {
    name: uniqueName("acl-test-delete"),
    type: "human",
  });
  try {
    const anonResponse = await fetch(
      `${REST_URL}/people?id=eq.${seededPerson.id}`,
      {
        method: "DELETE",
        headers: restHeaders(SUPABASE_ANON_KEY),
      },
    );
    const anonBody = await anonResponse.json().catch(() => null);
    assertEquals(
      anonResponse.status === 401 || anonResponse.status === 403,
      true,
      `anon delete must be rejected, got ${anonResponse.status}: ${
        JSON.stringify(anonBody)
      }`,
    );
    const rowsAfter = await serviceSelectById(
      "people",
      seededPerson.id as string,
    );
    assertEquals(
      rowsAfter.length,
      1,
      "person row must still exist after anon delete attempt",
    );
  } finally {
    await serviceDeleteById("people", seededPerson.id as string);
  }
});

// ─── people: service-role regression ────────────────────────────────────────

Deno.test("service role retains full CRUD on people", async () => {
  const seededPerson = await serviceInsert("people", {
    name: uniqueName("acl-test-service-crud"),
    type: "ai",
    description: "created by db_access_control regression test",
  });
  try {
    assertExists(seededPerson.id);

    const updateResponse = await fetch(
      `${REST_URL}/people?id=eq.${seededPerson.id}`,
      {
        method: "PATCH",
        headers: restHeaders(SUPABASE_SERVICE_KEY, {
          "Prefer": "return=representation",
        }),
        body: JSON.stringify({ description: "updated by regression test" }),
      },
    );
    const updatedRows = await updateResponse.json();
    assertEquals(updateResponse.ok, true);
    assertEquals(
      updatedRows.length,
      1,
      "service-role update must still affect the row",
    );
    assertEquals(updatedRows[0].description, "updated by regression test");

    const selectedRows = await serviceSelectById(
      "people",
      seededPerson.id as string,
    );
    assertEquals(
      selectedRows.length,
      1,
      "service-role select must still see the row",
    );
  } finally {
    await serviceDeleteById("people", seededPerson.id as string);
  }
  const rowsAfterDelete = await serviceSelectById(
    "people",
    seededPerson.id as string,
  );
  assertEquals(
    rowsAfterDelete.length,
    0,
    "service-role delete must still remove the row",
  );
});

// ─── increment_usefulness RPC ───────────────────────────────────────────────

Deno.test("anon key cannot execute increment_usefulness", async () => {
  const seededThought = await serviceInsert("thoughts", {
    content: uniqueName("acl-test-rpc-denial thought"),
  });
  try {
    const scoreBefore = seededThought.usefulness_score as number;

    const anonResponse = await fetch(`${REST_URL}/rpc/increment_usefulness`, {
      method: "POST",
      headers: restHeaders(SUPABASE_ANON_KEY),
      body: JSON.stringify({ thought_ids: [seededThought.id] }),
    });
    const anonBody = await anonResponse.json();
    assertEquals(
      anonResponse.status === 401 || anonResponse.status === 403 ||
        anonResponse.status === 404,
      true,
      `anon RPC must be rejected, got ${anonResponse.status}: ${
        JSON.stringify(anonBody)
      }`,
    );

    const rowsAfter = await serviceSelectById(
      "thoughts",
      seededThought.id as string,
    );
    assertEquals(
      rowsAfter[0].usefulness_score,
      scoreBefore,
      "usefulness_score must be unchanged after an anon RPC attempt",
    );
  } finally {
    await serviceDeleteById("thoughts", seededThought.id as string);
  }
});

Deno.test("service role can still execute increment_usefulness", async () => {
  const seededThought = await serviceInsert("thoughts", {
    content: uniqueName("acl-test-rpc-regression thought"),
  });
  try {
    const scoreBefore = seededThought.usefulness_score as number;

    const serviceRpcResponse = await fetch(
      `${REST_URL}/rpc/increment_usefulness`,
      {
        method: "POST",
        headers: restHeaders(SUPABASE_SERVICE_KEY),
        body: JSON.stringify({ thought_ids: [seededThought.id] }),
      },
    );
    const affectedCount = await serviceRpcResponse.json();
    assertEquals(
      serviceRpcResponse.ok,
      true,
      `service-role RPC failed: ${JSON.stringify(affectedCount)}`,
    );
    assertEquals(affectedCount, 1, "RPC must report one affected thought");

    const rowsAfter = await serviceSelectById(
      "thoughts",
      seededThought.id as string,
    );
    assertEquals(
      rowsAfter[0].usefulness_score,
      scoreBefore + 1,
      "service-role RPC must increment the score by exactly 1",
    );
  } finally {
    await serviceDeleteById("thoughts", seededThought.id as string);
  }
});

// ─── increment_usefulness_weighted: weight bounds (SQL-8) ────────────────────
// The RPC applies `usefulness_score + weight` on a persistent ranking column;
// an out-of-range weight (edge bug or LLM-derived value) must be rejected at the
// DB boundary before any mutation, not clamped or applied.

async function serviceScore(thoughtId: string): Promise<number> {
  const rows = await serviceSelectById("thoughts", thoughtId);
  return rows[0].usefulness_score as number;
}

for (const badWeight of [0, 101, -5]) {
  Deno.test(`weighted usefulness RPC rejects out-of-range weight ${badWeight}`, async () => {
    const seededThought = await serviceInsert("thoughts", {
      content: uniqueName("acl-test-weight-bounds thought"),
    });
    try {
      const scoreBefore = await serviceScore(seededThought.id as string);

      const response = await fetch(
        `${REST_URL}/rpc/increment_usefulness_weighted`,
        {
          method: "POST",
          headers: restHeaders(SUPABASE_SERVICE_KEY),
          body: JSON.stringify({
            thought_ids: [seededThought.id],
            weight: badWeight,
          }),
        },
      );
      const body = await response.json();
      assertEquals(
        response.ok,
        false,
        `out-of-range weight ${badWeight} must be rejected, got ${response.status}: ${
          JSON.stringify(body)
        }`,
      );

      const scoreAfter = await serviceScore(seededThought.id as string);
      assertEquals(
        scoreAfter,
        scoreBefore,
        "usefulness_score must be unchanged after a rejected weighted RPC",
      );
    } finally {
      await serviceDeleteById("thoughts", seededThought.id as string);
    }
  });
}

Deno.test("weighted usefulness RPC applies an in-range weight exactly", async () => {
  const seededThought = await serviceInsert("thoughts", {
    content: uniqueName("acl-test-weight-apply thought"),
  });
  try {
    const scoreBefore = await serviceScore(seededThought.id as string);
    const weight = 3;

    const response = await fetch(
      `${REST_URL}/rpc/increment_usefulness_weighted`,
      {
        method: "POST",
        headers: restHeaders(SUPABASE_SERVICE_KEY),
        body: JSON.stringify({ thought_ids: [seededThought.id], weight }),
      },
    );
    const affectedCount = await response.json();
    assertEquals(
      response.ok,
      true,
      `in-range weighted RPC failed: ${JSON.stringify(affectedCount)}`,
    );
    assertEquals(affectedCount, 1, "RPC must report one affected thought");

    const scoreAfter = await serviceScore(seededThought.id as string);
    assertEquals(
      scoreAfter,
      scoreBefore + weight,
      "in-range weighted RPC must increment the score by exactly the weight",
    );
  } finally {
    await serviceDeleteById("thoughts", seededThought.id as string);
  }
});
