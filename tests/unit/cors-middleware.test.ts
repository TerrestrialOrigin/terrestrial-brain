// In-process test of the real CORS middleware the edge function mounts
// (New-Feature-Plan Step 9, edge-security-residual). It builds a throwaway Hono
// app with the EXACT shared `buildCorsOptions` config from index.ts and asserts
// the emitted `Access-Control-Allow-Origin` via `app.request()` — no network, no
// gateway. This is the honest observation of the app's CORS behavior: the local
// Supabase dev gateway (Kong) injects permissive `*` on /functions/v1/*, which
// masks the app on the network path, so the app layer is verified here directly.

import { assert, assertEquals } from "@std/assert";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { buildCorsOptions } from "../../supabase/functions/terrestrial-brain-mcp/security-config.ts";

const ALLOWED_ORIGIN = "https://console.test.terrestrial.example";
const DISALLOWED_ORIGIN = "https://evil.example";

function appFor(allowlist: string[]): Hono {
  const app = new Hono();
  app.use("*", cors(buildCorsOptions(allowlist)));
  app.all("*", (context) => context.json({ ok: true }));
  return app;
}

async function acaoFor(app: Hono, origin?: string): Promise<string | null> {
  const headers: Record<string, string> = {};
  if (origin !== undefined) {
    headers["Origin"] = origin;
  }
  const response = await app.request("/", { method: "POST", headers });
  await response.body?.cancel();
  return response.headers.get("access-control-allow-origin");
}

Deno.test("cors middleware: allowlisted origin is reflected (never '*')", async () => {
  const acao = await acaoFor(appFor([ALLOWED_ORIGIN]), ALLOWED_ORIGIN);
  assertEquals(acao, ALLOWED_ORIGIN);
});

Deno.test("cors middleware: disallowed origin gets no ACAO header", async () => {
  const acao = await acaoFor(appFor([ALLOWED_ORIGIN]), DISALLOWED_ORIGIN);
  assertEquals(acao, null);
});

Deno.test("cors middleware: unset allowlist denies every cross-origin", async () => {
  const acao = await acaoFor(appFor([]), ALLOWED_ORIGIN);
  assertEquals(acao, null);
});

Deno.test("cors middleware: never emits the wildcard for any origin", async () => {
  const app = appFor([ALLOWED_ORIGIN]);
  for (const origin of [ALLOWED_ORIGIN, DISALLOWED_ORIGIN, undefined]) {
    const acao = await acaoFor(app, origin);
    assert(acao !== "*", `wildcard leaked for origin=${origin}`);
  }
});
