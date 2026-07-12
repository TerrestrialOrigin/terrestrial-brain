// Deterministic unit tests for the edge-boundary security config seam
// (New-Feature-Plan Step 9, edge-security-residual). Pure functions, no stack:
// they pin both states of each operator switch (CORS allowlist,
// `TB_ALLOW_KEY_IN_QUERY`) so the wired defaults in index.ts are guarded from
// both directions (GATE 2b).

import { assert, assertEquals } from "@std/assert";
import {
  buildCorsOriginResolver,
  isKeyInQueryAllowed,
  parseAllowedOrigins,
  resolveProvidedKey,
} from "../../supabase/functions/terrestrial-brain-mcp/security-config.ts";

// ─── parseAllowedOrigins ──────────────────────────────────────────────────────

Deno.test("parseAllowedOrigins: unset yields an empty allowlist", () => {
  assertEquals(parseAllowedOrigins(undefined), []);
});

Deno.test("parseAllowedOrigins: empty string yields an empty allowlist", () => {
  assertEquals(parseAllowedOrigins(""), []);
});

Deno.test("parseAllowedOrigins: single origin", () => {
  assertEquals(parseAllowedOrigins("https://console.example"), [
    "https://console.example",
  ]);
});

Deno.test("parseAllowedOrigins: trims whitespace and drops empty entries", () => {
  assertEquals(
    parseAllowedOrigins(" https://a.example , , https://b.example ,"),
    ["https://a.example", "https://b.example"],
  );
});

// ─── buildCorsOriginResolver ──────────────────────────────────────────────────

Deno.test("buildCorsOriginResolver: reflects an allowlisted origin", () => {
  const resolve = buildCorsOriginResolver(["https://console.example"]);
  assertEquals(resolve("https://console.example"), "https://console.example");
});

Deno.test("buildCorsOriginResolver: denies an unlisted origin with null", () => {
  const resolve = buildCorsOriginResolver(["https://console.example"]);
  assertEquals(resolve("https://evil.example"), null);
});

Deno.test("buildCorsOriginResolver: empty allowlist denies every origin", () => {
  const resolve = buildCorsOriginResolver([]);
  assertEquals(resolve("https://anything.example"), null);
  assertEquals(resolve("https://console.example"), null);
});

Deno.test("buildCorsOriginResolver: never returns the wildcard", () => {
  const resolve = buildCorsOriginResolver(["https://console.example"]);
  assert(resolve("https://evil.example") !== "*");
  assert(resolve("https://console.example") !== "*");
});

// ─── isKeyInQueryAllowed ──────────────────────────────────────────────────────

Deno.test("isKeyInQueryAllowed: exactly '1' opts in", () => {
  assertEquals(isKeyInQueryAllowed("1"), true);
});

Deno.test("isKeyInQueryAllowed: unset / empty / other strings stay disabled", () => {
  assertEquals(isKeyInQueryAllowed(undefined), false);
  assertEquals(isKeyInQueryAllowed(""), false);
  assertEquals(isKeyInQueryAllowed("true"), false);
  assertEquals(isKeyInQueryAllowed("0"), false);
  assertEquals(isKeyInQueryAllowed("yes"), false);
});

// ─── resolveProvidedKey ───────────────────────────────────────────────────────

Deno.test("resolveProvidedKey: header used when present (flag off)", () => {
  assertEquals(
    resolveProvidedKey({
      headerKey: "hdr",
      queryKey: null,
      allowKeyInQuery: false,
    }),
    "hdr",
  );
});

Deno.test("resolveProvidedKey: query rejected when flag off", () => {
  assertEquals(
    resolveProvidedKey({
      headerKey: null,
      queryKey: "qry",
      allowKeyInQuery: false,
    }),
    null,
  );
});

Deno.test("resolveProvidedKey: query used when flag on and header absent", () => {
  assertEquals(
    resolveProvidedKey({
      headerKey: null,
      queryKey: "qry",
      allowKeyInQuery: true,
    }),
    "qry",
  );
});

Deno.test("resolveProvidedKey: header wins over query even when flag on", () => {
  assertEquals(
    resolveProvidedKey({
      headerKey: "hdr",
      queryKey: "qry",
      allowKeyInQuery: true,
    }),
    "hdr",
  );
});

Deno.test("resolveProvidedKey: present-but-invalid header is the value compared (query never consulted)", () => {
  // The header is present, so it is returned regardless of the flag — the auth
  // check will then reject it; the valid query param is never consulted.
  assertEquals(
    resolveProvidedKey({
      headerKey: "wrong",
      queryKey: "valid",
      allowKeyInQuery: true,
    }),
    "wrong",
  );
});

Deno.test("resolveProvidedKey: neither credential yields null", () => {
  assertEquals(
    resolveProvidedKey({
      headerKey: null,
      queryKey: null,
      allowKeyInQuery: true,
    }),
    null,
  );
});
