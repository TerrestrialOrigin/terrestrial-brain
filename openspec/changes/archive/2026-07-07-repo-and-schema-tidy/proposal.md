## Why

This is the final step of the `Fable20260704` remediation plan — a hygiene and consistency sweep that cleans up what the earlier refactors left behind. The repo carries a stock Node `.gitignore`, an orphan `tests/node_modules/`, superseded top-level planning docs, and duplicate OpenSpec spec entries; the schema carries nullability drift (`created_at`/`updated_at` nullable on early tables), a legacy dual-format for thought→project references that every consumer must branch on, and a `match_thoughts` function whose source of truth is "whichever migration sorts last." None of this is a live defect, but each is a papercut that makes the codebase harder to reason about, and this step exists specifically to retire them now that the structural refactors are complete.

## What Changes

- **Repo hygiene**: replace the stock Node `.gitignore` with a curated one scoped to this project; remove the orphan untracked `tests/node_modules/` directory; delete the tracked `Planning/Done/` historical planning docs (superseded by `openspec/changes/archive/`, user-approved); remove the two stale flat OpenSpec spec files (`extractor-pipeline.md`, `task-extractor.md`) that duplicate the canonical `<name>/spec.md` directory entries.
- **Schema cleanup migration** (new append-only migration): backfill any NULL `created_at`/`updated_at` then set them `NOT NULL` on `thoughts`, `projects`, `tasks`; backfill legacy `metadata.references.project_id` (string) into the `metadata.references.projects` (array) format on `thoughts`.
- **Code/test simplification**: now that the backfill guarantees a single reference format, simplify `getProjectRefs` (`helpers.ts`) and any tests that depend on the dual format — while keeping a defensive read for forward-compatibility as documented.
- **`match_thoughts` canonical source**: add a clearly-marked canonical always-latest copy of the function (declarative schema file) so the current definition is discoverable without diffing migrations; document the "functions are re-created in full per migration; the canonical file mirrors the latest" convention in `docs/upgrade.md`.
- **Conventions documented**: record the index-naming convention going forward (without renaming existing indexes) in `docs/upgrade.md`.
- **Misc**: trim the copy-pasted `deno.unstable` flag list in `.vscode/settings.json` to only what the code actually uses (`bare-node-builtins`, needed for `node:async_hooks`); add a `scripts/*.sh` reference to the README setup/deploy section.

## Capabilities

### New Capabilities
- `schema-conventions`: the durable schema/repo invariants this change commits to going forward — mandatory-timestamp columns, a single canonical thought→project reference format, a discoverable canonical `match_thoughts` definition, and documented index-naming/migration conventions.

### Modified Capabilities
<!-- No existing capability's spec-level requirements change. The metadata reader keeps a
     defensive backward-compatible path; only the stored data is normalized. -->

## Non-goals

- No renaming of existing database indexes (only the convention for *new* ones is documented).
- No FK-integrity enforcement on thought→project references (orphaned UUIDs remain acceptable, per the existing blessed behavior).
- No renaming of the `documents."references"` reserved-word column (deliberately out of scope per the plan's "no planned action" list).
- No change to `simpleHash`, migration idempotency strategy, or test-assertion string-brittleness (all deliberately deferred/accepted elsewhere in the plan).
- No behavior change to any MCP tool beyond the reference-format normalization.

## Impact

- **Files removed**: `Planning/Done/*`, `openspec/specs/extractor-pipeline.md`, `openspec/specs/task-extractor.md`, untracked `tests/node_modules/`.
- **Files changed**: `.gitignore`, `.vscode/settings.json`, `README.md`, `docs/upgrade.md`, `supabase/functions/terrestrial-brain-mcp/helpers.ts` (+ affected tests).
- **Files added**: one new `supabase/migrations/*.sql` (backfill + NOT NULL), one canonical `supabase/schemas/match_thoughts.sql` (declarative reference copy).
- **Data**: one-time normalization of legacy `metadata.references.project_id` → `projects`; NULL timestamps backfilled to `now()` where absent.
- **Test layers**: Deno suite (`TB_AI_PROVIDER=fake`) and Obsidian plugin vitest/build must stay green; `docs/fresh-install.md` walkthrough must still apply cleanly.
