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

const SUPABASE_URL = "http://localhost:54321";
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

// ─── people: anon-key denial ────────────────────────────────────────────────

Deno.test("anon key cannot read people", async () => {
  const seededPerson = await serviceInsert("people", {
    name: uniqueName("acl-test-read"),
    type: "human",
    email: "acl-read@example.com",
  });
  try {
    const anonResponse = await fetch(
      `${REST_URL}/people?id=eq.${seededPerson.id}`,
      {
        headers: restHeaders(SUPABASE_ANON_KEY),
      },
    );
    const anonBody = await anonResponse.json();
    assertEquals(
      anonResponse.status === 401 || anonResponse.status === 403,
      true,
      `anon select must be rejected, got ${anonResponse.status}: ${
        JSON.stringify(anonBody)
      }`,
    );
    assertEquals(
      anonBody.code,
      "42501",
      "rejection must be a permission-denied error",
    );
  } finally {
    await serviceDeleteById("people", seededPerson.id as string);
  }
});

Deno.test("anon key cannot insert into people", async () => {
  const attemptedName = uniqueName("acl-test-insert");
  const anonResponse = await fetch(`${REST_URL}/people`, {
    method: "POST",
    headers: restHeaders(SUPABASE_ANON_KEY, {
      "Prefer": "return=representation",
    }),
    body: JSON.stringify({ name: attemptedName, type: "human" }),
  });
  const anonBody = await anonResponse.json();
  try {
    assertEquals(
      anonResponse.status === 401 || anonResponse.status === 403,
      true,
      `anon insert must be rejected, got ${anonResponse.status}: ${
        JSON.stringify(anonBody)
      }`,
    );
    assertEquals(
      anonBody.code,
      "42501",
      "rejection must be a row-level security violation",
    );

    const serviceCheckResponse = await fetch(
      `${REST_URL}/people?name=eq.${attemptedName}`,
      { headers: restHeaders(SUPABASE_SERVICE_KEY) },
    );
    const serviceCheckRows = await serviceCheckResponse.json();
    assertEquals(
      serviceCheckRows.length,
      0,
      "no row may be created by an anon insert",
    );
  } finally {
    // If the insert wrongly succeeded (the pre-fix bug), remove the row.
    if (Array.isArray(anonBody) && anonBody[0]?.id) {
      await serviceDeleteById("people", anonBody[0].id as string);
    }
  }
});

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
