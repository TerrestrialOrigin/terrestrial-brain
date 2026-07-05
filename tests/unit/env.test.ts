import {
  assert,
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { requireEnv } from "../../supabase/functions/terrestrial-brain-mcp/env.ts";

// Pure, deterministic unit tests for the fail-fast env helper (fix-plan Step 10,
// finding X5). No DB, no network. Uses a unique var name per case so parallel
// suites never collide.

Deno.test("requireEnv: returns a set value unchanged", () => {
  const name = "TB_TEST_ENV_PRESENT";
  Deno.env.set(name, "hunter2");
  try {
    assertEquals(requireEnv(name), "hunter2");
  } finally {
    Deno.env.delete(name);
  }
});

Deno.test("requireEnv: throws naming the variable when unset", () => {
  const name = "TB_TEST_ENV_MISSING";
  Deno.env.delete(name);
  const error = assertThrows(() => requireEnv(name));
  assert(
    (error as Error).message.includes(name),
    `error message must name the missing variable, got: ${
      (error as Error).message
    }`,
  );
});

Deno.test("requireEnv: throws when set to an empty string", () => {
  const name = "TB_TEST_ENV_EMPTY";
  Deno.env.set(name, "");
  try {
    const error = assertThrows(() => requireEnv(name));
    assert(
      (error as Error).message.includes(name),
      `error message must name the empty variable, got: ${
        (error as Error).message
      }`,
    );
  } finally {
    Deno.env.delete(name);
  }
});
