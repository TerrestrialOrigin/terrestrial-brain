import { assertEquals } from "@std/assert";
import { extractIpAddress } from "../../supabase/functions/terrestrial-brain-mcp/logger.ts";

// CORE-16 — logged ip_address must come from the trusted hop of the proxy
// chain (the LAST x-forwarded-for element, appended by the platform gateway),
// and must be shape-validated so a client cannot plant arbitrary strings in
// function_call_logs.ip_address.

Deno.test("extractIpAddress: multi-hop x-forwarded-for uses the trusted last hop", () => {
  const headers = new Headers({ "x-forwarded-for": "9.9.9.9, 1.2.3.4" });
  assertEquals(extractIpAddress(headers), "1.2.3.4");
});

Deno.test("extractIpAddress: single-hop x-forwarded-for is used as-is", () => {
  const headers = new Headers({ "x-forwarded-for": "1.2.3.4" });
  assertEquals(extractIpAddress(headers), "1.2.3.4");
});

Deno.test("extractIpAddress: spoofed garbage x-forwarded-for stores null", () => {
  const headers = new Headers({ "x-forwarded-for": "not-an-ip-address" });
  assertEquals(extractIpAddress(headers), null);
});

Deno.test("extractIpAddress: garbage trailing hop stores null, not the spoofable first hop", () => {
  const headers = new Headers({
    "x-forwarded-for": "1.2.3.4, <script>alert(1)</script>",
  });
  assertEquals(extractIpAddress(headers), null);
});

Deno.test("extractIpAddress: IPv6 last hop is accepted", () => {
  const headers = new Headers({
    "x-forwarded-for": "9.9.9.9, 2001:db8:85a3::8a2e:370:7334",
  });
  assertEquals(extractIpAddress(headers), "2001:db8:85a3::8a2e:370:7334");
});

Deno.test("extractIpAddress: x-real-ip fallback still works", () => {
  const headers = new Headers({ "x-real-ip": "1.2.3.4" });
  assertEquals(extractIpAddress(headers), "1.2.3.4");
});

Deno.test("extractIpAddress: invalid x-real-ip stores null", () => {
  const headers = new Headers({ "x-real-ip": "junk-value" });
  assertEquals(extractIpAddress(headers), null);
});

Deno.test("extractIpAddress: cf-connecting-ip fallback still works", () => {
  const headers = new Headers({ "cf-connecting-ip": "5.6.7.8" });
  assertEquals(extractIpAddress(headers), "5.6.7.8");
});

Deno.test("extractIpAddress: no recognized headers stores null", () => {
  assertEquals(extractIpAddress(new Headers()), null);
});
