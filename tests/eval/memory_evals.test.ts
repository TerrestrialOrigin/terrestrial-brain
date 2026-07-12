// memory-lifecycle-rules → the `eval`-tagged scenarios (LLM-judgment).
//
// OPT-IN, scored, thresholded (`deno task test:eval`). Real provider; fail-loud
// without OPENROUTER_API_KEY. Each scenario's labeled fixtures are the Step 7
// acceptance set; `evalCapability` throws until Step 7 wires the real pipeline,
// so an opt-in keyed run fails loudly with the pass-rate below threshold.

import { scoreScenario } from "./_harness.ts";
import { evalPending } from "./_seam.ts";

// "Model picks keep-vs-merge correctly at the margin" (dedup band edge).
Deno.test("eval: model picks keep-vs-merge correctly at the margin", async () => {
  await scoreScenario(
    "keep-vs-merge at the margin",
    [
      {
        label: "same idea, reworded → merge",
        input: {
          existing: "We decided to deploy on Fridays.",
          incoming: "The team agreed deployments happen on Fridays.",
          expected: "merge",
        },
      },
      {
        label: "adjacent but distinct → keep",
        input: {
          existing: "We decided to deploy on Fridays.",
          incoming: "We decided to freeze deploys before holidays.",
          expected: "keep",
        },
      },
    ],
    (_input) => Promise.resolve(evalPending("step7", "dedup-gate")),
  );
});

// "Model assigns the right type to ambiguous content".
Deno.test("eval: model assigns the right type to ambiguous content", async () => {
  await scoreScenario(
    "ambiguous type assignment",
    [
      {
        label: "decision-vs-observation",
        input: {
          text:
            "After the incident we will require two reviewers on every deploy.",
          expected: "decision",
        },
      },
      {
        label: "instruction-vs-task",
        input: {
          text: "Always rotate the signing key before publishing a release.",
          expected: "instruction",
        },
      },
    ],
    (_input) => Promise.resolve(evalPending("step7", "type-allowlist")),
  );
});

// "Model detects a genuine contradiction" (and not mere elaborations).
Deno.test("eval: model detects a genuine contradiction", async () => {
  await scoreScenario(
    "contradiction detection",
    [
      {
        label: "postgres → sqlite is a contradiction",
        input: {
          existing: "We chose Postgres for the store.",
          incoming: "We switched the store to SQLite.",
          expected: "contradiction",
        },
      },
      {
        label: "elaboration is NOT a contradiction",
        input: {
          existing: "We chose Postgres for the store.",
          incoming: "We chose Postgres, hosted on Supabase.",
          expected: "not-contradiction",
        },
      },
    ],
    (_input) => Promise.resolve(evalPending("step7", "supersession")),
  );
});

// "Sweep identifies done-looking tasks accurately".
Deno.test("eval: sweep identifies done-looking tasks accurately", async () => {
  await scoreScenario(
    "reconciliation identification",
    [
      {
        label: "recent thought marks task done",
        input: {
          task: "Ship the export endpoint",
          recentThought: "Shipped the export endpoint this morning.",
          expected: "done-looking",
        },
      },
      {
        label: "still-open task is not flagged",
        input: {
          task: "Ship the export endpoint",
          recentThought: "Still debugging the export endpoint's auth.",
          expected: "still-open",
        },
      },
    ],
    (_input) => Promise.resolve(evalPending("step7", "reconciliation")),
  );
});
