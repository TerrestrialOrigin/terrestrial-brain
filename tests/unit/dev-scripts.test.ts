// Static guards on the local dev-stack scripts and config (Step 14 —
// SCRIPT-2/3/4/6). The scripts drive Docker/Supabase and can't run here, so we
// assert their hygiene from source. GATE 2b: revert a fix and the matching
// assertion reddens. The strongest SCRIPT-2 check is behavioral — the whole
// suite runs against the derived port — this file locks in the rest.

import { assertEquals, assertStringIncludes } from "@std/assert";

const devScript = await Deno.readTextFile("scripts/dev.sh");
const validateScript = await Deno.readTextFile("scripts/validate-all.sh");
const denoConfig = await Deno.readTextFile("deno.json");
const supabaseConfig = await Deno.readTextFile("supabase/config.toml");

// ─── SCRIPT-4: dev.sh + gen:types use `npx supabase`, never a bare global ────

Deno.test("dev.sh invokes supabase only via npx", () => {
  // Any `supabase` invocation must be prefixed with `npx `.
  const bareInvocation = /(^|[^x] )supabase (start|stop|gen|db|status)/m;
  assertEquals(
    bareInvocation.test(devScript),
    false,
    "dev.sh must call `npx supabase ...`, not a bare global supabase",
  );
  assertStringIncludes(devScript, "npx supabase start");
});

Deno.test("gen:types task uses npx supabase", () => {
  assertStringIncludes(denoConfig, "npx supabase gen types");
});

// ─── SCRIPT-3: dev.sh resets to a blank slate by default (opt-out) ───────────

Deno.test("dev.sh resets the database by default with an opt-out", () => {
  assertStringIncludes(devScript, "npx supabase db reset");
  assertStringIncludes(
    devScript,
    "TB_DEV_KEEP_DATA",
    "there must be an opt-out to preserve a long-lived local DB",
  );
});

Deno.test("validate-all.sh resets the database before testing", () => {
  assertStringIncludes(validateScript, "npx supabase db reset");
});

// ─── SCRIPT-2: no hardcoded port; validate derives the URL dynamically ───────

Deno.test("validate-all.sh derives the API URL from the running stack", () => {
  assertStringIncludes(validateScript, "supabase status --output json");
  assertEquals(
    validateScript.includes("54321"),
    false,
    "validate-all.sh must not hardcode the default port 54321",
  );
});

Deno.test("this project uses a unique, non-default API port", () => {
  // config.toml can't express a runtime offset, so the port block is fixed and
  // must not be the stock default (which collides with other local projects).
  assertEquals(
    supabaseConfig.includes("port = 54321"),
    false,
    "the api port must be moved off the stock 54321 default",
  );
  assertStringIncludes(supabaseConfig, "port = 55421");
});

// ─── SCRIPT-6: the Deno lockfile is enabled ──────────────────────────────────

Deno.test("deno.json enables the lockfile", () => {
  assertEquals(
    /"lock"\s*:\s*false/.test(denoConfig),
    false,
    "the lockfile must be enabled for dependency-integrity pinning",
  );
});
