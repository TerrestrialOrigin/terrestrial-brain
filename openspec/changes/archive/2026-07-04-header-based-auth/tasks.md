# Tasks: header-based-auth

## 1. Server — constant-time comparison

- [x] 1.1 Add `accessKeyMatches(providedKey, expectedKey)` (SHA-256 digest + branch-free XOR fold per design D1) in `supabase/functions/terrestrial-brain-mcp/index.ts` and replace the `!==` comparison at the auth check; keep `x-brain-key`-primary / `?key=`-fallback precedence unchanged
- [x] 1.2 Write `tests/integration/auth.test.ts` covering the full accept/deny matrix from test-plan.md (valid header; wrong/empty/prefix keys → 401; `?key=` fallback; header-wins-over-param; invalid header + valid param → 401; missing both → 401), against MCP root and one direct route

## 2. Plugin — header auth, settings migration, HTTPS warning

- [x] 2.1 Write the failing-first vitest: `callHTTP`/`callIngestNote` with `accessKey` set must send `x-brain-key` and must not put `key` in the URL — confirm it FAILS against current code
- [x] 2.2 Add `accessKey` to `TBPluginSettings` + `DEFAULT_SETTINGS`; send `x-brain-key` header from `callHTTP` and `callIngestNote` when non-empty; confirm 2.1's tests pass
- [x] 2.3 Add exported `extractKeyFromUrl(url): { url, key }` helper; run it in `loadSettings` (migrate `?key=` → `accessKey`, strip param, preserve other params, existing accessKey wins) and in the settings-tab URL `onChange`; vitest for all migration scenarios in the delta spec
- [x] 2.4 Add exported `isInsecureEndpoint(url)` and the persistent settings-tab warning (http:// non-localhost only); Access Key setting input (password-style text field, trimmed); update endpoint field description (no more "including ?key="); vitest for the scheme/host matrix

## 3. Documentation

- [x] 3.1 README: replace the "Row-Level Security with access-key authentication" claim with the real trust-model paragraph (design D6); document `x-brain-key` as primary and `?key=` as deprecated (kept for MCP clients); update plugin setup + troubleshooting text to the two-field settings flow
- [x] 3.2 Create `ThreatModel.md` (repo root) recording the security analysis from design.md; create `docs/api-frontend-guide.md` documenting the auth contract

## 4. Testing & Verification

- [x] 4.1 Full Deno suite green against the local stack: `deno test --allow-net --allow-env tests/` — zero failures, zero skips (338 passed)
- [x] 4.2 Plugin suite + build green: `cd obsidian-plugin && npm test && npm run build` (77 passed, build clean)
- [x] 4.3 Walk each delta-spec scenario against the implementation (requirements check); confirm GATE 2b mutation reasoning from test-plan.md holds — all 7 mcp-server scenarios covered by `tests/integration/auth.test.ts`; all 10 obsidian-plugin scenarios covered by the new vitest blocks; mutation check: removing `accessKeyMatches` fails the 401 matrix, removing header logic fails the header tests, removing the migration fails the loadSettings tests
