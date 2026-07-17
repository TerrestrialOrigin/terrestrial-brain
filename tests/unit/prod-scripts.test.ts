// Static guards on the production deployment scripts (Step 13 — SCRIPT-1, SQL-7).
// These scripts run against a live prod project and cannot be exercised here, so
// we assert their security-critical shape from the source text. GATE 2b: revert
// the env-file change or drop the cron verification and the matching test reddens.

import { assertEquals, assertStringIncludes } from "@std/assert";

const setupScript = await Deno.readTextFile("scripts/initial-setup-prod.sh");
const deployScript = await Deno.readTextFile("scripts/deploy-update-prod.sh");

// ─── SCRIPT-1: secrets go through a private env-file, never argv ─────────────

Deno.test("initial-setup-prod: sets secrets via --env-file, not argv", () => {
  assertStringIncludes(
    setupScript,
    "npx supabase secrets set --env-file",
    "secrets must be passed via --env-file, not as process arguments",
  );
  // The old argv form embedded the secret value directly in the `secrets set`
  // command line — it must be gone.
  assertEquals(
    /secrets set "\$\{SECRETS\[@\]\}"/.test(setupScript),
    false,
    "secrets must not be passed as a KEY=value argv array to `secrets set`",
  );
  assertEquals(
    setupScript.includes('secrets set "OPENROUTER_API_KEY='),
    false,
    "a secret value must never appear in the `secrets set` argv",
  );
});

Deno.test("initial-setup-prod: the secrets env-file is private and cleaned up", () => {
  assertStringIncludes(
    setupScript,
    "umask 077",
    "env-file must be created 0600",
  );
  assertStringIncludes(setupScript, "mktemp");
  assertStringIncludes(
    setupScript,
    "trap 'rm -f \"${SECRETS_FILE:-}\"' EXIT",
    "an interrupted run must not leave the secrets file behind",
  );
});

// ─── SQL-7: both prod scripts verify the GDPR retention purge job exists ──────

for (
  const [name, script] of [
    ["initial-setup-prod", setupScript],
    ["deploy-update-prod", deployScript],
  ] as const
) {
  Deno.test(`${name}: verifies the retention purge cron job and fails loud if absent`, () => {
    assertStringIncludes(
      script,
      "cron.job where jobname = 'purge-function-call-logs-daily'",
      "must query the linked DB for the retention purge job",
    );
    assertStringIncludes(script, "npx supabase db query --linked");
    // The check must be able to fail the run — a missing job is a GDPR control
    // failing open, which must not pass silently.
    assertStringIncludes(script, "exit 1");
  });

  Deno.test(`${name}: teaches the env-file secrets form, not the argv form`, () => {
    assertStringIncludes(script, "secrets set --env-file");
    assertEquals(
      script.includes("secrets set KEY=value"),
      false,
      "the hint must not teach the world-readable argv form",
    );
  });
}
