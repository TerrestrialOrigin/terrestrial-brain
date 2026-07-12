// Edge-boundary security configuration (Step 9, edge-security-residual).
//
// Pure parse-at-boundary helpers for the two operator-controlled security
// switches: the CORS origin allowlist (`TB_ALLOWED_ORIGINS`) and the opt-in
// that re-enables the deprecated `?key=` query-param auth fallback
// (`TB_ALLOW_KEY_IN_QUERY`). Every function here is pure and free of
// `Deno.env` access so both switch states are exhaustively unit-testable
// without a running stack; `index.ts` reads the environment once at the
// composition root and passes the parsed values in.

/**
 * Parse a comma-separated `TB_ALLOWED_ORIGINS` value into a list of exact
 * origins. Surrounding whitespace is trimmed and empty entries are dropped, so
 * a trailing comma or stray spaces never produce a phantom `""` origin. An
 * unset or empty variable yields an empty allowlist (deny all cross-origin).
 */
export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Build the origin resolver Hono's `cors({ origin })` accepts. Returns the
 * request's origin only when it is in the allowlist (so it is reflected in
 * `Access-Control-Allow-Origin`), and `null` otherwise — Hono then emits no
 * `Access-Control-Allow-Origin` header, so a browser blocks the response. An
 * empty allowlist denies every cross-origin request. The wildcard `*` is never
 * produced.
 */
export function buildCorsOriginResolver(
  allowlist: string[],
): (origin: string) => string | null {
  return (origin: string) => (allowlist.includes(origin) ? origin : null);
}

/** The subset of Hono's CORS options this server configures. */
export interface CorsOptions {
  origin: (origin: string) => string | null;
  allowMethods: string[];
  allowHeaders: string[];
}

/**
 * Build the full CORS middleware options from an origin allowlist. Shared by the
 * edge function's composition root and its tests so both exercise the identical
 * configuration: default-deny origin resolution, and the fixed method/header
 * allowlists (`x-tb-key` is the only custom header the server reads).
 */
export function buildCorsOptions(allowlist: string[]): CorsOptions {
  return {
    origin: buildCorsOriginResolver(allowlist),
    allowMethods: ["POST", "GET", "OPTIONS"],
    allowHeaders: ["Content-Type", "x-tb-key"],
  };
}

/**
 * Whether the deprecated `?key=` query-param auth fallback is enabled. Only the
 * exact string `"1"` opts in; any other value — including unset, empty,
 * `"true"`, or `"0"` — leaves it disabled. An explicit sentinel avoids the
 * string-is-truthy footgun (parse, don't cast).
 */
export function isKeyInQueryAllowed(raw: string | undefined): boolean {
  return raw === "1";
}

/** Inputs to the access-key resolution decision. */
export interface ProvidedKeyInput {
  /** The `x-tb-key` header value, or `null`/`undefined` when absent. */
  headerKey: string | null | undefined;
  /** The `?key=` query-param value, or `null`/`undefined` when absent. */
  queryKey: string | null | undefined;
  /** Whether the query-param fallback is enabled (see `isKeyInQueryAllowed`). */
  allowKeyInQuery: boolean;
}

/**
 * Resolve which credential the auth check should compare. The `x-tb-key` header
 * always wins when present (preserving header precedence, including the case
 * where a present-but-invalid header must be the value compared — the query
 * param is never consulted while a header is present). When the header is
 * absent, the query param is consulted only if the fallback is enabled.
 * Returns `null` when no credential is available for comparison.
 */
export function resolveProvidedKey(input: ProvidedKeyInput): string | null {
  if (input.headerKey !== null && input.headerKey !== undefined) {
    return input.headerKey;
  }
  if (
    input.allowKeyInQuery && input.queryKey !== null &&
    input.queryKey !== undefined
  ) {
    return input.queryKey;
  }
  return null;
}
