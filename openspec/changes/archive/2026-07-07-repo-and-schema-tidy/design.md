## Context

`Fable20260704` remediation Step 28 is the last, cross-cutting hygiene pass. All prior steps (security, correctness, repository/AI-provider seams, decomposition, stub mode, CI, GDPR, naming sweep) are complete. What remains are the low-severity items the earlier steps deliberately left for a final sweep: repo-root clutter, OpenSpec spec duplicates, schema nullability/reference-format drift, and the un-discoverable `match_thoughts` source of truth.

Current state relevant to this change:
- `.gitignore` is the stock GitHub Node template (Bower/Gatsby/VuePress noise); the real repo is a Deno edge function + an Obsidian plugin (which has its own `obsidian-plugin/.gitignore`).
- `tests/node_modules/` exists on disk but is untracked and has no `tests/package.json` — an orphan.
- `Planning/Done/` holds five pre-OpenSpec planning docs, tracked in git, superseded by `openspec/changes/archive/` (~30 changes). User approved deletion.
- `openspec/specs/` has two capabilities present as BOTH a legacy flat `<name>.md` and the canonical `<name>/spec.md`: `extractor-pipeline` and `task-extractor`. The flat files are stale duplicates.
- Timestamp nullability drifts: `thoughts`/`projects`/`tasks` declare `created_at`/`updated_at` as `timestamptz null default now()`; later tables (`people`, `documents`) use `not null default now()`.
- Thought→project references live in JSONB `metadata.references` in two coexisting shapes: legacy `{ project_id: "uuid" }` (string) and current `{ projects: ["uuid", ...] }` (array). `getProjectRefs` in `helpers.ts` branches on both.
- `match_thoughts` is re-created in full across 4 migrations; the live definition is only findable by locating the latest-sorting migration.
- `.vscode/settings.json` lists 13 `deno.unstable` flags; the code uses only `node:async_hooks` (needs `bare-node-builtins`).

## Goals / Non-Goals

**Goals:**
- Remove repo-root and spec-tree clutter with zero behavior change.
- Guarantee `created_at`/`updated_at` are always populated (NOT NULL) on the three core tables.
- Normalize stored thought→project references to the single `projects` array format, then reduce the code/tests that had to straddle both.
- Make the live `match_thoughts` definition discoverable from a single canonical file and document the convention.
- Trim the copy-pasted editor unstable-flag list to what the code needs.
- Surface `scripts/*.sh` in the README.

**Non-Goals:**
- Renaming existing indexes (only document the convention for new ones).
- Enforcing FK integrity on references; orphaned project UUIDs remain acceptable.
- Renaming `documents."references"`; changing `simpleHash`; altering migration idempotency; de-brittling test string assertions — all deliberately out of scope per the plan.

## Decisions

### D1 — Keep `getProjectRefs` defensive; simplify only what the backfill makes safe
Even after the one-time backfill, `getProjectRefs` KEEPS reading the legacy `project_id` string as a fallback. Rationale: the reader is the boundary parse (CLAUDE.md "parse, don't cast"); an external/older row that slips in must not silently drop its project link. What we simplify is downstream: tests that fabricate the legacy shape to prove dual-handling collapse to asserting the reader still tolerates it (one focused unit test) rather than every consumer test carrying both shapes. The stored data is normalized; the reader stays tolerant. This is a smaller, safer change than deleting the fallback and matches "empty vs broken."

*Alternative considered:* delete the legacy branch entirely. Rejected — it converts an old-format row from "degraded but linked" into "silently unlinked," a data-loss-shaped regression for zero real benefit.

### D2 — Backfill migration is idempotent and crash-safe
Single new append-only migration. Order: (1) `UPDATE ... SET created_at = coalesce(created_at, now())` (and `updated_at`) for each of the three tables — idempotent, only touches NULLs; (2) `ALTER TABLE ... ALTER COLUMN ... SET NOT NULL`; (3) reference backfill as a targeted `UPDATE thoughts` that rewrites rows whose `metadata->'references'->>'project_id'` is present into a `projects` array (merging with any existing array, de-duplicated) and drops the legacy key. All statements are re-runnable: step 3 only matches rows that still carry `project_id`, so a second run is a no-op. No delete-then-write anywhere.

*Alternative considered:* separate migrations per concern. Rejected — they share one logical intent ("normalize the three core tables' invariants") and one migration keeps the atomic unit obvious; Supabase applies migrations transactionally per file.

### D3 — `match_thoughts` canonical file is declarative reference, NOT wired into apply order
Add `supabase/schemas/match_thoughts.sql` containing the current full `create or replace function match_thoughts(...)` — a human-readable always-latest mirror. It is explicitly a REFERENCE copy: migrations remain the executable source (append-only, never edited). `docs/upgrade.md` documents the rule: "when you change `match_thoughts`, add a new migration that re-creates it in full AND update `supabase/schemas/match_thoughts.sql` to match." This gives a single discoverable definition without adopting Supabase's declarative-schema apply pipeline (which would risk reordering/rewriting the established linear migration history — out of scope and risky this late).

*Alternative considered:* adopt `supabase db diff`/declarative schemas wholesale. Rejected — large, risky, and unnecessary for the one function that actually suffers the "which migration wins" problem.

### D4 — Trim `deno.unstable` to the minimal used set
Keep only `bare-node-builtins` (required so the editor resolves `node:async_hooks` in `requestContext.ts`). Drop `byonm`, `sloppy-imports`, `unsafe-proto`, `webgpu`, `broadcast-channel`, `worker-options`, `cron`, `kv`, `ffi`, `fs`, `http`, `net` — none are exercised (code uses `npm:`/`jsr:` specifiers with explicit `.ts` extensions, no `__proto__`, no Deno.cron/KV/FFI/Worker). Verify with `deno check` on the functions after trimming; if the editor/LSP needs a specific flag we removed, the check surfaces it.

### D5 — Curated `.gitignore`
Replace with a lean list scoped to this repo: OS cruft (`.DS_Store`), editor (`.idea/`), env files (`.env`, `.env.*`, keeping `!.env.example` if present), Deno (`deno.lock` is intentionally absent — `"lock": false`), Supabase local (`supabase/.temp/`, `supabase/.branches/`), plugin build output already covered by `obsidian-plugin/.gitignore`, and generic `node_modules/`, `*.log`, coverage. No Bower/Gatsby/Grunt/VuePress sections. Confirm nothing currently ignored-and-needed becomes tracked and nothing currently tracked becomes ignored (`git status` + `git ls-files` diff check).

## Risks / Trade-offs

- **[Backfill mis-merges an existing `projects` array]** → The UPDATE unions the legacy `project_id` into the existing array and de-dupes; a row already normalized has no `project_id` key so it is skipped entirely. Covered by a migration test seeding all three shapes (legacy-only, array-only, both).
- **[NOT NULL fails because a genuine NULL exists]** → The `coalesce` backfill runs first in the same migration, so no NULL survives to the `SET NOT NULL`. If a NULL slips in between statements (single-file transaction — it can't), the migration fails loudly rather than silently, which is the correct outcome.
- **[Removing a `deno.unstable` flag breaks the editor experience]** → `deno check` verifies the function typechecks with the trimmed set; the flags only affect LSP/editor diagnostics, not the Supabase runtime, so worst case is a re-add, not a production issue.
- **[Deleting the flat spec files confuses OpenSpec tooling]** → The canonical `<name>/spec.md` directories are what `openspec` reads; the flat `.md` siblings are legacy artifacts outside the managed structure. Verify `openspec list`/validate still pass after removal.
- **[`.gitignore` rewrite accidentally ignores tracked files]** → Git keeps tracking already-tracked files regardless of `.gitignore`; the risk is only newly-ignored-untracked. Diff `git status --ignored` before/after.

## Migration Plan

1. Land repo-hygiene edits (`.gitignore`, `.vscode`, README, remove Planning/, flat specs, orphan `tests/node_modules/`) — no runtime effect.
2. Add the schema-cleanup migration; apply locally via `supabase migration up` (or `db reset`) against the running stack.
3. Add the canonical `match_thoughts.sql` and `docs/upgrade.md` convention text.
4. Simplify `getProjectRefs`-related tests; run full Deno suite (`TB_AI_PROVIDER=fake`) + plugin vitest/build.
5. Rollback: the migration is additive and idempotent; reverting the branch plus a `supabase db reset` restores prior state (local only — production not touched in this step).

## Open Questions

None — the one decision requiring user input (fate of `Planning/`) was resolved to "delete."
