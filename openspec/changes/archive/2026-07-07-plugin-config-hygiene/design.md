## Context

The Obsidian plugin lives in `obsidian-plugin/`. It ships two metadata files that Obsidian and npm read independently:

- `manifest.json` — Obsidian's plugin manifest. Its `version` is the version users see; `minAppVersion` gates which Obsidian builds may load the plugin. Obsidian also reads a sibling `versions.json` (plugin-version → minAppVersion map) to decide whether an update is compatible before installing.
- `package.json` — the npm/dev build metadata and the toolchain (`devDependencies`).

Today `manifest.json` version is `1.1.0`, `package.json` is `0.3.0`, there is no `versions.json`, `obsidian` floats on `"latest"`, and the toolchain lags. The confirm modal (`src/confirmModal.ts`) sets ~25 inline `element.style.*` properties on elements that already carry `tb-ai-output-*` classes, so themes cannot restyle them; Obsidian auto-loads a root-level `styles.css` if present, which is the idiomatic home for that CSS. The manifest `description` is ~1,400 characters of command/usage prose.

Baseline before this change: `npm run build` and `npm test` (114 tests) are green. This is a hygiene change with **zero intended runtime-behavior change**.

## Goals / Non-Goals

**Goals:**
- One authoritative plugin version reported identically by `manifest.json` and `package.json`.
- A `versions.json` that Obsidian can use for compatibility gating.
- Reproducible builds: no floating dependency ranges on `obsidian`.
- Toolchain on current stable versions, with build + tests still green.
- Themeable modal styling via `styles.css`; no hard-coded inline styles.
- A concise manifest description; full usage detail in the README.

**Non-Goals:**
- No runtime/behavior change; the modal must render and behave identically.
- No visual redesign — styles move verbatim.
- No backend/migration/server-test changes.

## Decisions

### Version source of truth → `manifest.json`'s `1.1.0`
For an Obsidian plugin the manifest version is what users and the app see, so it is authoritative. `package.json` is bumped from `0.3.0` to `1.1.0` to match. `versions.json` becomes `{ "1.1.0": "1.0.0" }` (the current `minAppVersion`). *Alternative considered:* keep the two independent (dev vs. release) — rejected because divergent versions are exactly the drift this step removes, and a single number is simpler to reason about.

### Pin `obsidian` to the installed, tested version (`1.12.3`)
`"latest"` makes builds non-reproducible and can silently change the typed API surface. Pin to `1.12.3` (currently installed and green) rather than bumping to the newest published (`1.13.1`): the goal here is reproducibility and the owner's latest-*stable* rule is best served by the version we can actually verify green, not the newest untested one. Bumping the Obsidian API itself is a separate, riskier concern. *Alternative:* bump to `1.13.1` — deferred; not needed for this hygiene pass and it would change the type surface.

### Toolchain bumps: prefer current stable, gated on a green build
- `@types/node`: `^22` → `^26` (latest stable; type-only, low risk).
- `esbuild`: `^0.25` → `^0.28` (latest stable; bundler only).
- `typescript`: `5.3.3` → latest stable **iff** `tsc -noEmit` + build + tests stay green. TypeScript's latest is a major jump; if it introduces breakage that isn't a quick fix, fall back to the newest 5.x that builds clean and record the reason. The owner's rule is "latest stable that we can verify green," not "newest number regardless of breakage."

All bumps are validated by the same gate: `npm run build` (which runs `tsc -noEmit -skipLibCheck` then esbuild) and `npm test` must both pass. If any bump reddens them and can't be fixed cheaply, that specific bump is reverted to the last-green version and noted.

### Styling → root-level `styles.css` keyed on existing classes
Every inline `element.style.X = ...` in `confirmModal.ts` moves to a rule on the element's existing `tb-ai-output-*` class (adding classes only where an element currently has none, e.g. the badge/title styling). Obsidian loads `styles.css` from the plugin folder automatically — no esbuild wiring needed. Colors already reference CSS variables (`var(--background-modifier-*)` etc.), which carry over unchanged, preserving theme-awareness. *Alternative:* inject a `<style>` tag from code — rejected; `styles.css` is the documented Obsidian convention and lets user themes override.

### Remove redundant `<select>` option value re-assignment
`createEl("option", { text, value })` already sets the option's `value`; the follow-up `option.value = "..."` lines are dead. Removed. The `select.value = "overwrite"` default-selection line is kept (it selects the default option, a distinct effect).

### Trim manifest description
Reduce to one or two sentences describing what the plugin does. The removed commands/ribbon/exclude-tag prose moves into a README "Obsidian plugin" section so the information is preserved, not lost.

## Risks / Trade-offs

- **TypeScript major bump breaks the build** → Gate every bump on `npm run build` + `npm test`; fall back to the newest version that builds clean and document it. Not a blind bump.
- **`styles.css` selector misses an element that had only inline styling** → The modal renders unstyled/mis-styled. Mitigation: give every previously-inline-styled element a class and add a test asserting the classes are applied and `styles.css` contains the corresponding selectors; manual visual check of the modal.
- **Pinning `obsidian` to `1.12.3` diverges from newest published** → Accepted; reproducibility over newest. A future step can bump the Obsidian API deliberately.
- **Regenerated `package-lock.json` pulls transitive changes** → Covered by the build+test gate; lockfile committed so the state is reproducible.

## Migration Plan

1. Edit `manifest.json` (version stays `1.1.0`, trim description), `package.json` (version → `1.1.0`, pin `obsidian`, bump toolchain), add `versions.json`.
2. `npm install` to refresh the lockfile; run `npm run build` + `npm test`; adjust any bump that reddens the gate.
3. Add `styles.css`; strip inline styles + redundant `value` from `confirmModal.ts`; add/adjust a test asserting class application.
4. Move usage prose into README.
5. Re-run build + tests; confirm green.

Rollback: revert the branch; no data or schema is touched, so rollback is a pure code revert with no migration to undo.

## Open Questions

None — all decisions above are resolved; the only conditional is the TypeScript target version, resolved empirically against the build gate during implementation.
