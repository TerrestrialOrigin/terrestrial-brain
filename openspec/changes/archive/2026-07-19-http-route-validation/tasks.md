# Tasks — http-route-validation

## 1. Extract the route layer (behavior-preserving)

- [x] 1.1 Create `http-routes.ts`: move `HTTP_ROUTES`, `HttpRouteContext`→`HttpRouteDeps` (now including `quotaGate` + `logger`), dispatcher (`dispatchHttpRoute`), matcher (`matchHttpRoute`, still endsWith for now); `index.ts` slims to composition + calls; existing integration suite green

## 2. RED tests

- [x] 2.1 Unit `tests/unit/http-routes.test.ts`: matcher nested-path fallthrough; malformed JSON → 400; ids element/empty/cap → 400 (no repo call); wrong-typed title → 400; throwing route → 500 + logError recorded; fake gate → 429; confirm RED where behavior is new
- [x] 2.2 Unit `tests/unit/field-schemas.test.ts`: due_by/email/parent_index rejects + accepts; confirm RED
- [x] 2.3 Integration: malformed JSON 400; non-UUID ids 400; retried pickup message counts 0; confirm RED

## 3. Implementation

- [x] 3.1 Per-route Zod schemas + `defineHttpRoute` typing + legacy messages; dispatcher pipeline parse→log→validate→handle (CORE-5, CORE-6)
- [x] 3.2 `idsRoute` factory replaces the three copies (CORE-14)
- [x] 3.3 Base-anchored `matchHttpRoute` (CORE-17)
- [x] 3.4 `markPickedUp`/`reject` return updated count; handlers/messages/recordCount use it (CORE-5.3)
- [x] 3.5 TOOL-15 field schemas + `z.infer` TaskInput, delete the cast
- [x] 3.6 All RED tests green; legacy integration expectations still green

## 4. Testing & Verification

- [x] 4.1 `npx supabase db reset` + full `deno task test` — zero failures, zero skips
- [x] 4.2 `cd obsidian-plugin && npm test && npm run build` — green
- [x] 4.3 `scripts/validate-all.sh` — green
- [x] 4.4 Walk delta-spec scenarios; update `docs/api-frontend-guide.md` if the pull-API message change matters to the desktop client
