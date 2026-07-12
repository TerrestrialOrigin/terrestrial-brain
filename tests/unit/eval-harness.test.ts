// Deterministic unit tests for the eval-harness scoring logic (design D7).
//
// The eval TIER runs opt-in against a real LLM, but its scoring math and
// fail-loud contract are pure and must be verified deterministically. No key,
// no network — a synthetic `runCase` drives the scorer.

import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  assertOpenRouterKey,
  assertThreshold,
  type EvalCase,
  scoreCases,
} from "../eval/_harness.ts";

const CASES: EvalCase<number>[] = [
  { label: "a", input: 1 },
  { label: "b", input: 2 },
  { label: "c", input: 3 },
  { label: "d", input: 4 },
];

Deno.test("eval-harness: scoreCases computes the pass-rate", async () => {
  // Pass the even-input cases only (2 of 4).
  const result = await scoreCases(
    CASES,
    (input) => Promise.resolve(input % 2 === 0),
  );
  assertEquals(result.passed, 2);
  assertEquals(result.total, 4);
  assertEquals(result.rate, 0.5);
  assertEquals(result.failures.sort(), ["a", "c"]);
});

Deno.test("eval-harness: a thrown case counts as a failure, not a crash", async () => {
  const result = await scoreCases(CASES, (input) => {
    if (input === 3) throw new Error("boom");
    return Promise.resolve(true);
  });
  assertEquals(result.passed, 3);
  assert(result.failures.some((failure) => failure.includes("boom")));
});

Deno.test("eval-harness: assertThreshold passes at/above and fails below", () => {
  const good = { rate: 0.9, passed: 9, total: 10, failures: [] };
  assertThreshold("ok", good, 0.8);
  const bad = { rate: 0.5, passed: 5, total: 10, failures: ["x"] };
  assertThrows(
    () => assertThreshold("bad", bad, 0.8),
    Error,
    "< threshold 0.8",
  );
});

Deno.test("eval-harness: assertOpenRouterKey is fail-loud when the key is absent", () => {
  const original = Deno.env.get("OPENROUTER_API_KEY");
  try {
    Deno.env.delete("OPENROUTER_API_KEY");
    assertThrows(
      () => assertOpenRouterKey(),
      Error,
      "OPENROUTER_API_KEY is required",
    );
    Deno.env.set("OPENROUTER_API_KEY", "sk-test");
    assertOpenRouterKey(); // present → no throw
  } finally {
    if (original === undefined) Deno.env.delete("OPENROUTER_API_KEY");
    else Deno.env.set("OPENROUTER_API_KEY", original);
  }
});

// Guard the reference: scoreScenario is the composed opt-in path.
Deno.test("eval-harness: scoreScenario requires a key before scoring", async () => {
  const original = Deno.env.get("OPENROUTER_API_KEY");
  try {
    Deno.env.delete("OPENROUTER_API_KEY");
    const { scoreScenario } = await import("../eval/_harness.ts");
    await assertRejects(
      () => scoreScenario("x", CASES, () => Promise.resolve(true)),
      Error,
      "OPENROUTER_API_KEY is required",
    );
  } finally {
    if (original === undefined) Deno.env.delete("OPENROUTER_API_KEY");
    else Deno.env.set("OPENROUTER_API_KEY", original);
  }
});
