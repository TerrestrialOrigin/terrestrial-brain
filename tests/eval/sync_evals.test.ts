// integration-sync-rules → the one `eval`-tagged scenario (ask-first phrasing).
//
// OPT-IN, scored, thresholded. The connector is a v1.5 horizon, so the seam
// throws until v1.5 wires it. Fail-loud without OPENROUTER_API_KEY.

import { scoreScenario } from "./_harness.ts";
import { evalPending } from "./_seam.ts";

// "Conversation-born task offered to the PMS" — the model asks whether to
// create it upstream, phrased as an explicit choice.
Deno.test("eval: a conversation-born task is offered to the PMS as an explicit choice", async () => {
  await scoreScenario(
    "ask-first creation phrasing",
    [
      {
        label: "new task in conversation → explicit create-in-PMS question",
        input: {
          conversation: "Let's add a task to migrate the billing webhook.",
          expected: "asks-explicit-choice",
        },
      },
      {
        label: "mere musing → does not force a PMS question",
        input: {
          conversation: "The billing webhook feels fragile lately.",
          expected: "no-forced-question",
        },
      },
    ],
    (_input) => Promise.resolve(evalPending("v1.5", "connectors")),
  );
});
