import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderSectionBody } from "../../supabase/functions/terrestrial-brain-mcp/tools/section-format.ts";

// Pure unit tests for the section-body helper that distinguishes "empty" from
// "broken" (fix-plan Step 10, finding C9). No DB, no network.

/** Run `body` with console.error captured so we can assert on-error logging. */
function withCapturedErrors(body: () => void): string[] {
  const original = console.error;
  const captured: string[] = [];
  console.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    body();
  } finally {
    console.error = original;
  }
  return captured;
}

Deno.test("renderSectionBody: renders unavailable marker + logs on query error", () => {
  let output = "";
  const logs = withCapturedErrors(() => {
    output = renderSectionBody(
      { data: null, error: { message: "connection reset" } },
      "No open tasks.",
      (rows) => rows.map(String).join("\n"),
      "get_project_summary open tasks",
    );
  });
  assert(
    output.includes("section unavailable") &&
      output.includes("connection reset"),
    `expected unavailable marker with reason, got: ${output}`,
  );
  assert(
    logs.some((line) => line.includes("connection reset")),
    "a failed query must be logged via console.error",
  );
});

Deno.test("renderSectionBody: renders empty-state prose on successful-empty", () => {
  const output = renderSectionBody(
    { data: [], error: null },
    "No open tasks.",
    (rows) => rows.map(String).join("\n"),
    "get_project_summary open tasks",
  );
  assertEquals(output, "No open tasks.");
  assert(
    !output.includes("section unavailable"),
    "empty success must not show the marker",
  );
});

Deno.test("renderSectionBody: renders rows when data is present", () => {
  const output = renderSectionBody(
    { data: ["alpha", "beta"], error: null },
    "No open tasks.",
    (rows) => rows.map((row) => `- ${row}`).join("\n"),
    "get_project_summary open tasks",
  );
  assertEquals(output, "- alpha\n- beta");
});
