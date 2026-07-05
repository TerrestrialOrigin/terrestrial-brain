# Test Plan: header-based-auth

Maps every delta-spec scenario to a test layer. Layers available in this repo: Deno integration suite (`tests/integration/`, real local Supabase stack, no mocks on the tested path) and plugin vitest unit suite (`obsidian-plugin/src/main.test.ts`, fetch mocked at the boundary). There is no browser E2E layer for the plugin (it runs inside Obsidian, not a web page); the Deno integration tier exercises the real HTTP auth path end-to-end, including the GATE-1 denial cases.

## mcp-server delta scenarios → tests

| Scenario | Layer | Test |
|---|---|---|
| Correct key accepted | Integration | `tests/integration/auth.test.ts` — MCP root + one direct route with valid `x-brain-key` → non-401, `list_thoughts` tool call succeeds |
| Wrong key rejected (prefix match, wrong length, empty) | Integration | same file — each variant → 401 with `{"error": "Invalid or missing access key"}` |
| Header authentication accepted | Integration | valid header, no query param → authenticated |
| Query-param fallback still accepted | Integration | valid `?key=`, no header → authenticated (also implicitly covered by the entire existing suite, which uses `?key=` URLs) |
| Header wins over query param | Integration | valid header + invalid `?key=` → authenticated |
| Invalid header with valid query param rejected | Integration | invalid header + valid `?key=` → 401 |
| Missing credentials rejected | Integration | neither header nor param → 401 |

Constant-time property itself is not timing-testable in an integration suite; it is enforced by construction (D1) and covered by the accept/reject correctness matrix above.

## obsidian-plugin delta scenarios → tests

| Scenario | Layer | Test |
|---|---|---|
| Header sent on generic HTTP calls (and no `key` in URL) | Unit (vitest) | mock `fetch`, call `callHTTP`, assert `x-brain-key` header present and URL has no `key` param — written FIRST against current code to demonstrate the change (fails: key currently rides the URL, no header) |
| Header sent on note ingestion | Unit | same pattern via `callIngestNote` |
| Empty key omits the header | Unit | `accessKey: ""` → no `x-brain-key` in fetch init |
| Migration on load | Unit | seed `loadData` with `?key=` URL + empty accessKey → assert extracted + stripped |
| Existing accessKey wins | Unit | seed both → assert field value kept, URL stripped |
| Other query parameters preserved | Unit | `?foo=1&key=abc` → `?foo=1` |
| Paste into settings tab migrates immediately | Unit | exercise the shared extraction helper the onChange handler uses (`extractKeyFromUrl`), same cases as load-migration |
| Plain HTTP production endpoint warns | Unit | `isInsecureEndpoint("http://example.com/...")` → true |
| Localhost/127.0.0.1 HTTP does not warn | Unit | → false (both hosts, with ports) |
| HTTPS does not warn | Unit | → false |

## Regression

- Full Deno suite (`deno test --allow-net --allow-env tests/`) — proves `?key=` fallback unbroken (all existing files authenticate that way).
- Full plugin suite + `npm run build` in `obsidian-plugin/`.

## Gate mapping

- **GATE 1 (E2E/denial):** the integration auth matrix includes explicit denial cases (wrong key, missing key) against the real running server.
- **GATE 2 (integration, no mocks):** `auth.test.ts` has zero mocks — real HTTP against the real edge function.
- **GATE 2b (mutation):** removing the constant-time compare in favor of accepting any key fails the 401 cases; removing the plugin header logic fails the header-presence tests; removing the migration fails the extraction tests.
- **GATE 3 (boots):** `npm run build` (plugin) + local stack serving the function.
- **GATE 4 (full suites):** Deno suite + plugin vitest, zero failures/skips.
