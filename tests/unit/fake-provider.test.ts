import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertInstanceOf,
} from "@std/assert";
import { FakeAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts";
import { OpenRouterAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/openrouter-provider.ts";
import { createAiProvider } from "../../supabase/functions/terrestrial-brain-mcp/ai/factory.ts";

// Pure, deterministic unit tests pinning the FakeAiProvider itself (Step 22).
// No DB, no network, no LLM. These are the layer that guarantees the fake's
// determinism and similarity behavior; the integration suite relies on it.

const fake = new FakeAiProvider();

function cosine(first: number[], second: number[]): number {
  let dot = 0;
  let firstMag = 0;
  let secondMag = 0;
  for (let index = 0; index < first.length; index++) {
    dot += first[index] * second[index];
    firstMag += first[index] * first[index];
    secondMag += second[index] * second[index];
  }
  return dot / (Math.sqrt(firstMag) * Math.sqrt(secondMag));
}

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

Deno.test("getEmbedding: 1536-length unit vector", async () => {
  const vector = await fake.getEmbedding("a note about gardening and compost");
  assertEquals(vector.length, 1536);
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  assertAlmostEquals(magnitude, 1, 1e-9);
});

Deno.test("getEmbedding: identical text yields identical vectors", async () => {
  const text = "Decision: migrate the database on Friday";
  const first = await fake.getEmbedding(text);
  const second = await fake.getEmbedding(text);
  assertEquals(first, second);
});

Deno.test("getEmbedding: empty text does not throw and stays unit length", async () => {
  const vector = await fake.getEmbedding("");
  assertEquals(vector.length, 1536);
  const magnitude = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  assertAlmostEquals(magnitude, 1, 1e-9);
});

Deno.test("getEmbedding: overlapping text is more similar than unrelated", async () => {
  const stored = await fake.getEmbedding(
    "The rabbit hutch project needs new hinges and a latch",
  );
  const overlapping = await fake.getEmbedding(
    "rabbit hutch project hinges latch",
  );
  const unrelated = await fake.getEmbedding(
    "quarterly tax filing spreadsheet reminder",
  );
  const overlapSimilarity = cosine(stored, overlapping);
  const unrelatedSimilarity = cosine(stored, unrelated);
  assert(
    overlapSimilarity > unrelatedSimilarity,
    `overlap ${overlapSimilarity} should exceed unrelated ${unrelatedSimilarity}`,
  );
  // Self-similarity is exactly 1.
  assertAlmostEquals(cosine(stored, stored), 1, 1e-9);
});

// ---------------------------------------------------------------------------
// completeJson dispatch — one hard assertion per purpose. `parse` receives the
// raw value; here we pass it through unchanged to inspect the fake's output.
// ---------------------------------------------------------------------------

const identity = (raw: unknown) => raw;

Deno.test("completeJson: metadata shape", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt:
        "Extract metadata from the user's captured thought. Return JSON with:",
      userContent: "Gardening notes for spring",
    },
    identity,
  ) as Record<string, unknown>;
  assertEquals(Array.isArray(raw.topics), true);
  assertEquals(raw.type, "observation");
});

Deno.test("completeJson: note split returns a non-empty thought", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt: "You split notes into discrete, standalone thoughts",
      userContent: "Note title: Ideas\n\nBuild a compost bin this weekend.",
    },
    identity,
  ) as { thoughts: string[] };
  assertEquals(raw.thoughts.length >= 1, true);
  assert(raw.thoughts[0].includes("compost bin"));
});

Deno.test("completeJson: reconciliation keeps all existing ids, deletes none", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt:
        "You reconcile an updated note with its previously captured thoughts",
      userContent: "EXISTING THOUGHTS:\n[ID:aaa] first\n\n[ID:bbb] second",
    },
    identity,
  ) as { keep: string[]; delete: string[]; add: string[] };
  assertEquals(raw.keep.sort(), ["aaa", "bbb"]);
  assertEquals(raw.delete, []);
  assertEquals(raw.add, []);
});

Deno.test("completeJson: task→project echoes a mentioned known project", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt:
        `You match tasks to projects.\n\nKNOWN PROJECTS:\n- "Rabbit Hutch" (id: proj-1)\n- "Taxes" (id: proj-2)`,
      userContent:
        `TASKS:\n0: "Fix the Rabbit Hutch latch"\n1: "Water the plants"`,
    },
    identity,
  ) as { assignments: { task_index: number; project_id: string }[] };
  assertEquals(raw.assignments, [{ task_index: 0, project_id: "proj-1" }]);
});

Deno.test("completeJson: task enrichment assigns a mentioned known person", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt:
        `You extract metadata from task descriptions. Today is 2026-07-06.\n\nKNOWN PEOPLE:\n- "Alice" (id: person-1)`,
      userContent: `TASKS:\n0: "Ask Alice about the invoice"`,
    },
    identity,
  ) as {
    enrichments: {
      task_index: number;
      assigned_to_id: string | null;
      cleaned_text: string;
    }[];
  };
  assertEquals(raw.enrichments[0].assigned_to_id, "person-1");
  assertEquals(raw.enrichments[0].cleaned_text, "Ask Alice about the invoice");
});

Deno.test("completeJson: project-name-from-path detects a '<Name> Project' segment", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt: "You analyze file paths from an Obsidian vault",
      userContent: "Path: notes/Rabbit Hutch Project.md",
    },
    identity,
  ) as { is_project: boolean; project_name: string | null };
  assertEquals(raw.is_project, true);
  assertEquals(raw.project_name, "Rabbit Hutch");
});

Deno.test("completeJson: project-by-content echoes a mentioned known project id", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt:
        `You identify which projects a note is about.\n\nKNOWN PROJECTS:\n- "Rabbit Hutch" (id: proj-1)\n- "Taxes" (id: proj-2)`,
      userContent: "Today I worked on the Rabbit Hutch build.",
    },
    identity,
  ) as { project_ids: string[] };
  assertEquals(raw.project_ids, ["proj-1"]);
});

Deno.test("completeJson: people detection echoes a known person named in the note", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt:
        `You identify people mentioned in a note.\n\nKNOWN PEOPLE:\n- "Alice" (id: person-1)\n- "Bob" (id: person-2)`,
      userContent: "Met with Alice about the plan.",
    },
    identity,
  ) as { people: { name: string; id: string }[] };
  assertEquals(raw.people, [{ name: "Alice", id: "person-1" }]);
});

Deno.test("completeJson: unrecognized prompt degrades to an empty object", async () => {
  const raw = await fake.completeJson(
    {
      systemPrompt: "Some brand new prompt we have never seen",
      userContent: "x",
    },
    identity,
  );
  assertEquals(raw, {});
});

// ---------------------------------------------------------------------------
// Factory selection
// ---------------------------------------------------------------------------

Deno.test("factory: TB_AI_PROVIDER=fake selects FakeAiProvider", () => {
  const previous = Deno.env.get("TB_AI_PROVIDER");
  try {
    Deno.env.set("TB_AI_PROVIDER", "fake");
    assertInstanceOf(createAiProvider(), FakeAiProvider);
  } finally {
    if (previous === undefined) Deno.env.delete("TB_AI_PROVIDER");
    else Deno.env.set("TB_AI_PROVIDER", previous);
  }
});

Deno.test("factory: any other value selects the live provider", () => {
  const previous = Deno.env.get("TB_AI_PROVIDER");
  try {
    for (const value of ["", "Fake", "real", "openrouter"]) {
      Deno.env.set("TB_AI_PROVIDER", value);
      assertInstanceOf(createAiProvider(), OpenRouterAiProvider);
    }
    Deno.env.delete("TB_AI_PROVIDER");
    assertInstanceOf(createAiProvider(), OpenRouterAiProvider);
  } finally {
    if (previous === undefined) Deno.env.delete("TB_AI_PROVIDER");
    else Deno.env.set("TB_AI_PROVIDER", previous);
  }
});
