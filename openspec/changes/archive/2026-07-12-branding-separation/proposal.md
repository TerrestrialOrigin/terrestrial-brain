## Why

The public-facing branding still markets Terrestrial Brain *through* its Open Brain / Nate B. Jones provenance: the README's opening line calls the project "an extension of 'Open Brain' by Nate B Johnes" (a marketing endorsement, plus a typo), and the GitHub repository description reads "An extended version of Nate B Jones' 'open brain'…". Before any public product listing, the product must stand on its own identity. Legally-required attribution belongs in `NOTICE.md` (factual, gratitude tone) and in the README's License section — not in the product's headline marketing copy. This is Step 3 of the New-Feature-Plan and the final Phase 0 code step gating the goodwill email and public listing.

## What Changes

- Replace the README opening line (`README.md:3`) that markets the project as "an extension of Open Brain by Nate B Johnes (subscribe to his youtube channel…)" with a neutral one-line product description that carries **no** Open Brain / OB1 / Nate reference in the headline; the gratitude/attribution tone stays in `NOTICE.md` and the factual License-section pointer stays as-is.
- Change the **GitHub repository description** (currently "An extended version of Nate B Jones' 'open brain'…") to a product-only description with no Open Brain / OB1 / Nate reference. The `gh` CLI is unavailable in this environment, so this is recorded as a **manual settings action for Anastasia**, with the exact replacement text captured in this change (`design.md`) and in `tasks.md`.
- Perform a repository-wide sweep for the strings `open brain` / `open-brain` / `OB1` / `Nate`, confirming that every surviving occurrence outside `NOTICE.md`, `codeEval/`, and openspec archives is legitimate factual attribution (pointing at `NOTICE.md`) or immutable historical record — not marketing copy.

Explicitly retained (documented as deliberate in `design.md`):
- `NOTICE.md` — the permanent MIT attribution (gratitude tone lives here).
- `README.md` License section (~line 554) — factual third-party attribution pointing at `NOTICE.md`.
- `ThreatModel.md` compliance/design notes referencing the `ob1-fragment-rewrite` change name and "MIT-era Open Brain material" — factual records, not marketing.
- The applied migration comment referencing `ob1-fragment-rewrite` — **append-only history**, never edited.
- `codeEval/` planning docs and `openspec/changes/archive/**` — historical records, left intact.

## Capabilities

### New Capabilities
- `product-branding`: Governs how the project presents its own identity in public-facing marketing surfaces (README headline, GitHub repository description). Requires that headline/marketing copy describe the product on its own terms with no third-party (Open Brain / OB1 / Nate) endorsement, while legally-required attribution is confined to `NOTICE.md` and the README License section.

### Modified Capabilities
<!-- None. The `licensing` capability (NOTICE.md / LICENSE.md / README License section) is unchanged — this change only governs marketing/headline copy, a separate concern. -->

## Impact

- **Docs / settings only — no runtime code paths.** Affected files: `README.md` (opening line), plus a recorded manual GitHub repository-settings change.
- No migrations, no API changes, no dependency changes.
- Gate: docs-consistency (the sweep) plus the full existing suite still green (`deno task test` with `TB_AI_PROVIDER=fake`; `cd obsidian-plugin && npm test && npm run build`).
- Downstream: unblocks Step L3 (goodwill email to Nate) and Step 19 (public plugin-store listing), both of which reference public branding.
