// Deterministic unit coverage for the pure formatters extracted from the
// composite-query handlers (fix-plan Step 18). No DB, no network — synthetic
// data in, exact-ish string out. These pin the rendering the integration suite
// exercises end-to-end, and give the "(section unavailable: …)" C9 branch fast
// coverage a live query can't easily force.

import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  dedupeByName,
  formatProjectSummary,
  formatRecentActivity,
  type ProjectSummaryData,
  type RecentActivityData,
} from "../../supabase/functions/terrestrial-brain-mcp/tools/queries.ts";
import { RECENT_ACTIVITY_SECTION_LIMIT } from "../../supabase/functions/terrestrial-brain-mcp/constants.ts";

// ─── dedupeByName ────────────────────────────────────────────────────────────

Deno.test("dedupeByName: created wins over updated for the same name", () => {
  const entries = dedupeByName(
    [
      { name: "Alpha", type: "client", created_at: "2026-01-01T00:00:00Z" },
      { name: "Beta", type: null, created_at: "2026-01-02T00:00:00Z" },
    ],
    [
      { name: "Beta", type: null, updated_at: "2026-02-01T00:00:00Z" },
      { name: "Gamma", type: "vendor", updated_at: "2026-02-02T00:00:00Z" },
    ],
  );
  assertEquals(entries.map((e) => `${e.name}:${e.action}`), [
    "Alpha:created",
    "Beta:created",
    "Gamma:updated",
  ]);
  // Beta keeps its created date, not the updated one.
  assertEquals(entries[1].date, "2026-01-02T00:00:00Z");
});

Deno.test("dedupeByName: null inputs yield no entries", () => {
  assertEquals(dedupeByName(null, null), []);
});

// ─── formatProjectSummary ────────────────────────────────────────────────────

function baseProjectData(): ProjectSummaryData {
  return {
    project: {
      id: "p1",
      name: "Terrestrial Core",
      type: "software",
      description: "The framework",
      parent_id: null,
      archived_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-05T00:00:00Z",
    },
    parentName: null,
    children: { data: [], error: null },
    tasks: { data: [], error: null },
    personMap: new Map(),
    matchingThoughts: [],
    thoughtsError: null,
    snapshotMap: {},
  };
}

Deno.test("formatProjectSummary: renders details, tasks, thoughts, and reminder", () => {
  const data = baseProjectData();
  data.tasks = {
    data: [
      {
        id: "t1",
        content: "Write docs",
        status: "in_progress",
        due_by: "2000-01-01T00:00:00Z", // far past → OVERDUE
        assigned_to: "person-1",
        created_at: "2026-01-02T00:00:00Z",
      },
    ],
    error: null,
  };
  data.personMap = new Map([["person-1", "Ana"]]);
  data.matchingThoughts = [
    {
      id: "th1",
      content: "A useful thought",
      metadata: { type: "idea" },
      note_snapshot_id: null,
      created_at: "2026-01-03T00:00:00Z",
    },
  ];

  const out = formatProjectSummary(data);
  assertStringIncludes(out, "# Terrestrial Core");
  assertStringIncludes(out, "**Type:** software");
  assertStringIncludes(out, "## Open Tasks (1)");
  assertStringIncludes(out, "[~] Write docs (Ana)");
  assertStringIncludes(out, "(OVERDUE)");
  assertStringIncludes(out, "## Recent Thoughts (1)");
  assertStringIncludes(out, "(idea) ID: th1");
  // terse usefulness reminder with the thought id
  assertStringIncludes(
    out,
    'Reminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs: ["th1"]',
  );
});

Deno.test("formatProjectSummary: empty tasks show empty-state prose, not a failure", () => {
  const out = formatProjectSummary(baseProjectData());
  assertStringIncludes(out, "## Open Tasks (0)");
  assertStringIncludes(out, "No open tasks.");
});

Deno.test("formatProjectSummary: a failed tasks query renders unavailable, not empty", () => {
  const data = baseProjectData();
  data.tasks = { data: null, error: { message: "db exploded" } };
  const out = formatProjectSummary(data);
  assertStringIncludes(out, "## Open Tasks (?)");
  assertStringIncludes(out, "(section unavailable: db exploded)");
});

Deno.test("formatProjectSummary: no reminder when there are no matching thoughts", () => {
  const out = formatProjectSummary(baseProjectData());
  assertEquals(out.includes("record_useful_thoughts"), false);
});

// ─── formatRecentActivity ────────────────────────────────────────────────────

function baseActivityData(): RecentActivityData {
  return {
    effectiveDays: 7,
    thoughts: { data: [], error: null },
    tasksCreated: { data: [], error: null },
    tasksCompleted: { data: [], error: null },
    projectEntries: [],
    projectsError: null,
    peopleEntries: [],
    peopleError: null,
    aiOutputs: { data: [], error: null },
    projectNameMap: new Map(),
  };
}

Deno.test("formatRecentActivity: header pluralizes days and renders sections", () => {
  const data = baseActivityData();
  data.thoughts = {
    data: [
      {
        id: "th9",
        content: "captured this week",
        metadata: { type: "observation" },
        created_at: "2026-07-01T00:00:00Z",
      },
    ],
    error: null,
  };
  data.tasksCreated = {
    data: [
      {
        content: "Ship it",
        status: "open",
        project_id: "pr1",
        created_at: "2026-07-02T00:00:00Z",
      },
    ],
    error: null,
  };
  data.projectNameMap = new Map([["pr1", "Launch"]]);

  const out = formatRecentActivity(data);
  assertStringIncludes(out, "# Activity — Last 7 Days");
  assertStringIncludes(out, "## Thoughts (1)");
  assertStringIncludes(out, "(observation) ID: th9");
  assertStringIncludes(out, "## Tasks Created (1)");
  assertStringIncludes(out, "Ship it (open) [Launch]");
  assertStringIncludes(
    out,
    'Reminder: If any of these thoughts were useful, call record_useful_thoughts with their IDs: ["th9"]',
  );
});

Deno.test("formatRecentActivity: singular day and empty-state sections", () => {
  const data = baseActivityData();
  data.effectiveDays = 1;
  const out = formatRecentActivity(data);
  assertStringIncludes(out, "# Activity — Last 1 Day");
  assertStringIncludes(out, "## Thoughts (0)");
  assertStringIncludes(out, "No new thoughts.");
  assertStringIncludes(out, "No tasks created.");
});

Deno.test("formatRecentActivity: failed people query renders unavailable marker", () => {
  const data = baseActivityData();
  data.peopleError = { message: "people query failed" };
  const out = formatRecentActivity(data);
  assertStringIncludes(out, "## People (?)");
  assertStringIncludes(out, "(section unavailable: people query failed)");
});

// TOOL-10 — an over-full section (repository returns `limit + 1` rows) is sliced
// to the section limit and its heading carries a `(50+)` truncation marker.
Deno.test("formatRecentActivity: an over-cap section is sliced and marked (50+)", () => {
  const data = baseActivityData();
  const overCap = RECENT_ACTIVITY_SECTION_LIMIT + 1;
  data.tasksCreated = {
    data: Array.from({ length: overCap }, (_unused, index) => ({
      content: `Task ${index}`,
      status: "open",
      project_id: null,
      created_at: "2026-07-02T00:00:00Z",
    })),
    error: null,
  };

  const out = formatRecentActivity(data);
  assertStringIncludes(
    out,
    `## Tasks Created (${RECENT_ACTIVITY_SECTION_LIMIT}+)`,
  );
  // Exactly the limit is rendered — the (limit+1)th row is not present.
  assertEquals(out.includes(`Task ${RECENT_ACTIVITY_SECTION_LIMIT}`), false);
  assertStringIncludes(out, `Task ${RECENT_ACTIVITY_SECTION_LIMIT - 1}`);
});

// Boundary: exactly the limit (no extra probe row) shows the true count, no marker.
Deno.test("formatRecentActivity: exactly the section limit shows a plain count", () => {
  const data = baseActivityData();
  data.tasksCreated = {
    data: Array.from(
      { length: RECENT_ACTIVITY_SECTION_LIMIT },
      (_unused, index) => ({
        content: `Task ${index}`,
        status: "open",
        project_id: null,
        created_at: "2026-07-02T00:00:00Z",
      }),
    ),
    error: null,
  };

  const out = formatRecentActivity(data);
  assertStringIncludes(
    out,
    `## Tasks Created (${RECENT_ACTIVITY_SECTION_LIMIT})`,
  );
  assertEquals(out.includes(`(${RECENT_ACTIVITY_SECTION_LIMIT}+)`), false);
});

Deno.test("formatProjectSummary: a done task past its due date is never marked OVERDUE (TOOL-8)", () => {
  const data = baseProjectData();
  data.tasks = {
    data: [
      {
        id: "t-done",
        content: "Shipped feature",
        status: "done",
        due_by: "2000-01-01T00:00:00Z",
        assigned_to: null,
        created_at: "2026-01-02T00:00:00Z",
      },
    ],
    error: null,
  };

  const out = formatProjectSummary(data);
  assertStringIncludes(out, "Shipped feature");
  assertEquals(out.includes("(OVERDUE)"), false);
});
