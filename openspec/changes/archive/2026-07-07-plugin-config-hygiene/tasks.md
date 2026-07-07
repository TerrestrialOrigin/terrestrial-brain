## 1. Version alignment & versions.json

- [x] 1.1 Bump `package.json` `version` from `0.3.0` to `1.1.0` to match `manifest.json`
- [x] 1.2 Add root-level `obsidian-plugin/versions.json` = `{ "1.1.0": "1.0.0" }` (plugin version → minAppVersion)

## 2. Dependency pinning & toolchain bumps

- [x] 2.1 Pin `obsidian` devDependency from `"latest"` to `"1.12.3"` (installed, tested version)
- [x] 2.2 Bump `@types/node` to latest stable (`^26`) and `esbuild` to latest stable (`^0.28`)
- [x] 2.3 Bump `typescript` to latest stable, gated on a green build; fall back to newest 5.x that builds clean if the major jump breaks and can't be cheaply fixed (document the fallback)
- [x] 2.4 `npm install` to refresh `package-lock.json`; run `npm run build` + `npm test`, fix/fall-back any bump that reddens the gate

## 3. Manifest description trim

- [x] 3.1 Trim `manifest.json` `description` to one or two sentences
- [x] 3.2 Move the removed command/ribbon/exclude-tag usage detail into a README "Obsidian plugin" section

## 4. Modal styling → styles.css

- [x] 4.1 Create `obsidian-plugin/styles.css` with rules for the `tb-ai-output-*` classes, reproducing the current inline styling verbatim (keep `var(--…)` theme variables)
- [x] 4.2 Ensure every previously-inline-styled element in `src/confirmModal.ts` carries a `tb-ai-output-*` class (add classes to badge/title/etc. where missing)
- [x] 4.3 Remove all inline `element.style.*` assignments from `src/confirmModal.ts`
- [x] 4.4 Remove the redundant `<select>` option `value` re-assignments (keep the `select.value = "overwrite"` default selection)

## 5. Tests & verification

- [x] 5.1 Add/extend a confirmModal test asserting the styled elements carry their `tb-ai-output-*` classes and that no inline presentational styles are set (guards the styles-move regression)
- [x] 5.2 Add a small metadata consistency test/check asserting `manifest.json` and `package.json` versions match and `versions.json` covers the current version
- [x] 5.3 Run `npm run build` — green
- [x] 5.4 Run `npm test` (vitest) — zero failures, zero skips; paste the summary line
- [x] 5.5 Manual/visual confirmation the confirm modal renders identically (structure + controls unchanged)
