// Bijection meta-test for the lifecycle verification harness (design D3).
//
// Parses the two Step 5 delta specs and asserts a one-to-one mapping with
// `tests/lifecycle-coverage.manifest.ts`: every `#### Scenario:` (with its
// `Tag:`) has exactly one manifest entry and vice-versa. A new, renamed, or
// removed scenario without a matching manifest update fails THIS test — the
// machine-checked guarantee that "every lifecycle scenario has a harness entry".
// It also logs the red→green burn-down. This test is GREEN by construction.

import { assert, assertEquals } from "@std/assert";
import {
  burnDown,
  COVERAGE_MANIFEST,
  type Tag,
} from "../lifecycle-coverage.manifest.ts";

interface SpecScenario {
  capability: string;
  scenario: string;
  tag: Tag;
}

const SPEC_FILES: { capability: string; url: URL }[] = [
  {
    capability: "memory-lifecycle-rules",
    url: new URL(
      "../../openspec/specs/memory-lifecycle-rules/spec.md",
      import.meta.url,
    ),
  },
  {
    capability: "integration-sync-rules",
    url: new URL(
      "../../openspec/specs/integration-sync-rules/spec.md",
      import.meta.url,
    ),
  },
];

async function parseSpecScenarios(): Promise<SpecScenario[]> {
  const scenarios: SpecScenario[] = [];
  for (const { capability, url } of SPEC_FILES) {
    const text = await Deno.readTextFile(url);
    const lines = text.split("\n");
    let current: string | null = null;
    for (const line of lines) {
      const heading = line.match(/^#### Scenario:\s*(.+?)\s*$/);
      if (heading) {
        current = heading[1];
        continue;
      }
      const tag = line.match(/^-\s*\*\*Tag:\*\*\s*(test|eval)\s*$/);
      if (tag && current) {
        scenarios.push({
          capability,
          scenario: current,
          tag: tag[1] as Tag,
        });
        current = null;
      }
    }
  }
  return scenarios;
}

function key(entry: { capability: string; scenario: string }): string {
  return `${entry.capability} :: ${entry.scenario}`;
}

Deno.test("coverage: every spec scenario maps to exactly one manifest entry", async () => {
  const specScenarios = await parseSpecScenarios();
  const specKeys = new Set(specScenarios.map(key));
  const manifestKeys = new Set(COVERAGE_MANIFEST.map(key));

  const uncovered = [...specKeys].filter((specKey) =>
    !manifestKeys.has(specKey)
  );
  const stale = [...manifestKeys].filter((specKey) => !specKeys.has(specKey));

  assertEquals(
    uncovered,
    [],
    `spec scenarios with no manifest entry: ${uncovered.join(" | ")}`,
  );
  assertEquals(
    stale,
    [],
    `manifest entries with no matching spec scenario: ${stale.join(" | ")}`,
  );

  // No duplicate manifest entries (a true bijection, not a multimap).
  assertEquals(
    manifestKeys.size,
    COVERAGE_MANIFEST.length,
    "duplicate scenario keys in the manifest",
  );
});

Deno.test("coverage: manifest tags match the spec tags", async () => {
  const specScenarios = await parseSpecScenarios();
  const tagByKey = new Map(
    specScenarios.map((scenario) => [key(scenario), scenario.tag]),
  );
  for (const entry of COVERAGE_MANIFEST) {
    assertEquals(
      entry.tag,
      tagByKey.get(key(entry)),
      `tag mismatch for "${entry.scenario}"`,
    );
  }
});

Deno.test("coverage: tier is consistent with tag", () => {
  for (const entry of COVERAGE_MANIFEST) {
    if (entry.tag === "eval") {
      assertEquals(
        entry.tier,
        "eval",
        `${entry.scenario}: eval tag needs eval tier`,
      );
    } else {
      assert(
        entry.tier === "deterministic" || entry.tier === "sync",
        `${entry.scenario}: test tag needs deterministic|sync tier, got ${entry.tier}`,
      );
    }
    if (entry.expectation === "pass-now") {
      assertEquals(
        entry.milestone,
        "shipped",
        `${entry.scenario}: pass-now must be milestone "shipped"`,
      );
    }
  }
});

Deno.test("coverage: every pass-now testRef exists and is anchored to a real test", async () => {
  const testFileCache = new Map<string, string>();
  const readTestFile = async (relativePath: string): Promise<string> => {
    const cached = testFileCache.get(relativePath);
    if (cached !== undefined) return cached;
    const url = new URL(`../../${relativePath}`, import.meta.url);
    const text = await Deno.readTextFile(url);
    testFileCache.set(relativePath, text);
    return text;
  };

  for (const entry of COVERAGE_MANIFEST) {
    if (entry.expectation !== "pass-now") continue;

    // (a) The referenced file must exist — kills dead references.
    const url = new URL(`../../${entry.testRef}`, import.meta.url);
    const stat = await Deno.stat(url).catch(() => null);
    assert(
      stat?.isFile === true,
      `testRef missing for "${entry.scenario}": ${entry.testRef}`,
    );

    // (b) If anchored, the file must contain a Deno.test whose name includes
    //     the anchor — proving the scenario maps to a real, named test.
    if (entry.testNameContains) {
      const text = await readTestFile(entry.testRef);
      const testNames = [
        ...text.matchAll(/Deno\.test\(\s*(["'`])((?:.|\n)*?)\1/g),
      ]
        .map((match) => match[2]);
      assert(
        testNames.some((name) => name.includes(entry.testNameContains!)),
        `no Deno.test in ${entry.testRef} contains "${entry.testNameContains}" for "${entry.scenario}"`,
      );
    }
  }
});

Deno.test("coverage: burn-down is reported", () => {
  const counts = burnDown();
  // The console line is the legible burn-down for Step 7 (and v1.5).
  console.log(
    `[lifecycle burn-down] pass-now=${counts.passNow} ` +
      `pending-step7=${counts.pendingStep7} pending-v1.5=${counts.pendingV15} ` +
      `total=${counts.total}`,
  );
  assertEquals(
    counts.passNow + counts.pendingStep7 + counts.pendingV15,
    counts.total,
    "every entry must be either pass-now or pending (step7|v1.5)",
  );
});
