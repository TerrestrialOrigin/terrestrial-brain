# Tasks — Naming, dead-code, and consistency sweep (Step 26)

Inventory established by two read-only survey passes (server + plugin). Several items from the original plan were already handled by Steps 14–19 and are recorded as verified-absent in group 4 — no action needed for those.

## 1. Server renames & internal identifiers

- [x] 1.1 `tools/thoughts.ts`: rename `qEmb` → `queryEmbedding` (~L168); `m` → `metadata` in both `.map((t, i) => { const m = ... })` blocks (~L201, L350); arrow param `t` → `thought` at the search-result maps (~L200, L349), the id-projection maps (~L244, L385), the map at ~L918; `.filter((r) => r.status === "rejected")` param `r` → `result` (~L1071).
- [x] 1.2 `tools/projects.ts`: rename destructured `kids` → `childProjects` (~L318) and its downstream `.map((k) => k.id)` param `k` → `child` (~L322); arrow params `p` → `project` (~L102, L103, L109, L122); `c` → `child` (~L207); `t` → `task` (~L344).
- [x] 1.3 `helpers.ts`: rename `.filter((r) => ...)` / result-partition params `r` → `result` (~L165, L166).
- [x] 1.4 `index.ts`: fix the MCP server-info `name: "open-brain"` → `"terrestrial-brain"` (~L112); rename the route-match param `r` → `route` (~L408) and the Hono context param `c` → `context` in the swept handler(s) if trivially local (~L393). Grep tests first for the `"open-brain"` literal; only if a test asserts it, update that assertion deliberately and note it.
- [x] 1.5 `tools/tasks.ts`: confirm no remaining single-letter locals (survey found none); no rename needed unless a straggler surfaces during apply.

## 2. Server named constants

- [x] 2.1 `tools/queries.ts`: replace `.slice(0, 25)` project-thoughts cap with a named `MAX_PROJECT_THOUGHTS = 25` and confirm the adjacent "top 25" comment still matches.
- [x] 2.2 `tools/thoughts.ts`: replace the `80` archive-preview length with `ARCHIVE_PREVIEW_LENGTH = 80` (~L808-809).
- [x] 2.3 Introduce shared list/search limit constants (`DEFAULT_SEARCH_LIMIT = 10`, `DEFAULT_LIST_LIMIT = 20`, `MAX_LIST_LIMIT = 100`) and use them in the zod schemas at `tools/thoughts.ts` (search, ~L155-156, L276), `tools/tasks.ts` (~L179), `tools/documents.ts` (~L213). Value copied verbatim; behavior identical.

## 3. Plugin renames, constants & simpleHash comment

- [x] 3.1 `obsidian-plugin/src/utils.ts`: rename `simpleHash` param `str` → `input` and local `chr` → `charCode` (~L55, L58); add a comment documenting the accepted 32-bit collision trade-off above `simpleHash`.
- [x] 3.2 `obsidian-plugin/src/syncEngine.ts`: rename `processNote` param `opts` → `options` and all its uses (~L207, L210, L234, L236, L246, L252).
- [x] 3.3 Plugin time constants: add a shared `MS_PER_MINUTE = 60000` and use it at `syncEngine.ts:24` (`30 * MS_PER_MINUTE`), `settings.ts:66,70`, `main.ts:104,238`. Name the two fixed 2-second delays: `SYNCING_NOTICE_MS = 2000` (`syncEngine.ts:237`) and `INITIAL_POLL_DELAY_MS = 2000` (`main.ts:204`).

## 4. Verified-absent items (no action — record only)

- [x] 4.1 Confirm (already true): no `simpleHash` in server tree; no stray leading semicolon in `helpers.ts`; no orphaned/misplaced JSDoc (server or plugin — `buildEndpointUrl`'s JSDoc is correctly attached in `utils.ts`); no `if (!content && content !== "")` pattern (all checks already use `=== undefined`); no stale "top 10 vs slice(25)" comment mismatch. These were resolved by Steps 14–19; nothing to change.

## 5. Testing & Verification

- [x] 5.1 `deno lint` and `deno check` (or `deno task test`'s type pass) clean — catches any rename slip (undefined/unused identifiers).
- [x] 5.2 Full Deno suite green, **unmodified** except the sanctioned `"open-brain"` assertion if one exists: `deno task test` (local Supabase stack up). Paste the summary line (X passed, 0 failed, 0 skipped).
- [x] 5.3 Plugin suite green + build: `cd obsidian-plugin && npm test && npm run build`. Paste the summary line.
- [x] 5.4 Grep gates: no `qEmb`/`kids`/`chr`/` opts`/`open-brain` survivors in swept files; bare `60000`/`2000`/`25`/`80` literals replaced by their named constants where in scope.
- [x] 5.5 `/opsx:verify`, then `/opsx:archive`; check off Step 26 in `codeEval/Fable20260704-fix-plan.md`.
