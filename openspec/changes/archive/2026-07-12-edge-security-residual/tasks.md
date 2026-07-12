## 1. Config seam (parse-at-boundary, pure)

- [x] 1.1 Add `supabase/functions/terrestrial-brain-mcp/security-config.ts` with pure functions: `parseAllowedOrigins(raw?: string): string[]` (comma-split, trim, drop empties), `buildCorsOriginResolver(allowlist: string[]): (origin: string) => string | null` (reflect if listed, else null), `isKeyInQueryAllowed(raw?: string): boolean` (true only for exact `"1"`), and `resolveProvidedKey({ headerKey, queryKey, allowKeyInQuery }): string | null` (header if present; else query only when allowed; header always wins).

## 2. Unit tests (deterministic, no stack) — write first, watch RED

- [x] 2.1 Add `tests/unit/security-config.test.ts` covering `parseAllowedOrigins` (unset/empty → `[]`, messy whitespace/empty entries trimmed), `buildCorsOriginResolver` (listed reflected, unlisted → null, empty allowlist denies all), `isKeyInQueryAllowed` (`"1"` true; ``/undefined/`true`/`0` false), and `resolveProvidedKey` across all branches incl. both flag states and header-precedence (invalid-header+valid-query → header wins).
- [x] 2.2 Confirm the unit tests fail RED before wiring (module not yet imported / behavior absent), then pass once `security-config.ts` exists (GATE 2b: they pin both flag directions).

## 3. Wire into the edge function

- [x] 3.1 In `index.ts`, read `TB_ALLOWED_ORIGINS` and `TB_ALLOW_KEY_IN_QUERY` once at the composition root via `Deno.env.get` (optional vars, secure defaults — not `requireEnv`); compute `allowedOrigins`/`allowKeyInQuery`.
- [x] 3.2 Replace `cors({ origin: "*" , ... })` with `cors({ origin: buildCorsOriginResolver(allowedOrigins), ... })`, keeping `allowMethods` and `allowHeaders` unchanged.
- [x] 3.3 Replace the inline `context.req.header("x-tb-key") || url.searchParams.get("key")` with `resolveProvidedKey({ headerKey, queryKey, allowKeyInQuery })`; downstream 401 logic unchanged.

## 4. Integration tests (real local stack, no mocks on the path)

- [x] 4.1 Set `TB_ALLOWED_ORIGINS` to a known test origin in `supabase/functions/.env` (leave `TB_ALLOW_KEY_IN_QUERY` unset — the shipping default).
- [x] 4.2 Update `tests/integration/auth.test.ts`: flip the two `?key=`-accept cases to expect 401 (default-reject); keep header accept/deny cases; the "invalid header + valid query" case still 401.
- [x] 4.3 Add CORS assertions to the integration suite: allowlisted `Origin` reflected in `Access-Control-Allow-Origin` (never `*`); a disallowed origin gets no ACAO and never `*`; a valid header request with any/no origin still authenticates (non-browser path).

## 5. Docs + ThreatModel

- [x] 5.1 Update `README.md`: env-var table adds `TB_ALLOWED_ORIGINS` and `TB_ALLOW_KEY_IN_QUERY`; MCP-client config guidance notes `?key=` is off by default and requires the flag; security-model line reflects header-only default.
- [x] 5.2 Update `docs/upgrade.md`: new-vars entry + the `?key=` default-change with the remedy (`TB_ALLOW_KEY_IN_QUERY=1`, or move the key to the header).
- [x] 5.3 Update `ThreatModel.md`: T2 → Mitigated (default) for keys-in-URL; T7 → Mitigated for CORS (allowlist default-deny; note auth is the real gate).
- [x] 5.4 Reconcile the canonical `openspec/specs/mcp-server.md` CORS prose (currently `Origin: *`) with the new allowlist behavior so the source-of-truth spec is not self-contradictory after archive.

## 6. Gates & verification

- [x] 6.1 `deno lint` and `deno fmt --check` clean on changed files.
- [x] 6.2 Full backend suite green on the local stack (`deno task test`, `TB_AI_PROVIDER=fake`) — zero failures, zero skips; paste the summary line.
- [x] 6.3 `cd obsidian-plugin && npm test && npm run build` green (no plugin change, but the gate is mandatory).
- [x] 6.4 Update/run `scripts/validate-all.sh` (`npm run validate` or equivalent) if it references env vars or the edge config.
- [x] 6.5 `openspec validate edge-security-residual --strict` clean.
