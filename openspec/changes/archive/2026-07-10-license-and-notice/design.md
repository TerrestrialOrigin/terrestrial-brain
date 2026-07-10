## Context

Terrestrial Brain's public GitHub repo has **no `LICENSE` file**, so it defaults to all-rights-reserved — inconsistent with the intended source-available/self-host model and a blocker for the hosted-product launch. It also contains documented MIT-era fragments from Open Brain (Nate B. Jones) with **no attribution notice**, which is a live breach of MIT's sole condition (include the copyright + permission notice). The provenance is fully worked out in `~/Documents/PassiveIncomeChat/TransferredToObsidian/TerrestrialBrainMonitizationLegality.md` and corroborated by the evidence bundle (`~/Documents/PassiveIncomeChat/evidence/`, including the MIT-era `LICENSE` text from OB1 commit `ff4ffa7` and a dated license-history log). The verbatim fragments themselves were already re-expressed in Step 1 (`ob1-fragment-rewrite`); the NOTICE is kept permanently regardless, as cheap insurance and honest attribution.

This is a **documentation-only** change: three files, no code, no schema, no behavior. It is the first Phase-0 legal step and unblocks Step 3 (branding separation references `NOTICE.md`).

## Goals / Non-Goals

**Goals:**
- Publish `LICENSE.md` = full FSL-1.1-MIT text, copyright Anastasia Rohner / Terrestrial Origin, 2026, with the MIT future-license (2-year per-version conversion).
- Publish `NOTICE.md` = factual third-party attribution to Open Brain by Nate B. Jones (MIT, 2026-03-11, repo `NateBJones-Projects/OB1` through `f3e45e1`) reproducing the MIT license text verbatim with "Copyright (c) 2026 Nate B. Jones."
- Replace the README's bare `## License` → "MIT" with an accurate FSL-1.1-MIT section explaining the tier split and pointing to `NOTICE.md`.

**Non-Goals:**
- The README top-of-file branding line ("extension of Open Brain / Nate…") — deferred to Step 3 (`feature/BrandingSeparation`), which depends on this NOTICE existing.
- The GitHub repo description change — also Step 3.
- Any rewrite of the fragments themselves — done in Step 1.
- Dual-licensing mechanics, CLA, or a commercial-license grant document — not in scope for the free self-host tier.

## Decisions

**Decision 1 — FSL-1.1-MIT (not Apache/AGPL/BSL).** The work plan and legality doc both specify FSL-1.1-MIT: source-available, non-compete for 2 years, then each version converts to MIT. It matches the "free self-host + paid hosted" business model (the Functional Source License's "Competing Use" clause protects the hosted offering while still letting users self-host and modify). *Alternatives considered:* AGPL (copyleth network clause is stronger but does not stop a competitor offering a paid host, which is the exact thing we're protecting); BSL-1.1 (FSL is the modern, simpler successor with a fixed 2-year change date and a standard MIT future license). We use the **official FSL-1.1-MIT template text verbatim**, filling only the `<curly-brace>` parameters, so the license is a recognized SPDX identifier and not a bespoke variant.

**Decision 2 — Reproduce the OB1 MIT text verbatim from the archived evidence, not retyped.** `NOTICE.md` embeds the exact MIT text captured at OB1 commit `ff4ffa7` (`evidence/LICENSE-MIT-initial-ff4ffa7.txt`), preserving "Copyright (c) 2026 Nate B. Jones." Retyping risks a transcription error that would weaken the compliance claim. *Alternative:* link to OB1's git history instead of embedding — rejected, because MIT requires the notice be *included in* copies, and upstream history could theoretically be rewritten; embedding makes compliance self-contained.

**Decision 3 — Two separate files (`LICENSE.md` + `NOTICE.md`), both at repo root.** `LICENSE.md` is the project's own license (what GitHub detects and displays). `NOTICE.md` is the third-party attribution, kept distinct so it is unambiguous which copyright applies to which material and so the NOTICE survives independently of any future license change. Both use the `.md` extension to match the repo's existing convention (README.md, ThreatModel.md) and OB1's own `LICENSE.md`.

**Decision 4 — README section is descriptive, links out.** The `## License` section states "FSL-1.1-MIT (see LICENSE.md)", summarizes the tier split in plain language (free self-host / non-compete / converts to MIT 2 years after each release), and references `NOTICE.md` for third-party attribution — it does not duplicate the full license text (single source of truth in `LICENSE.md`).

### Test Strategy

No runtime code changes, so there are no new unit/integration/E2E tests. Verification is documentation-consistency plus the existing suite staying green:
- **Docs-consistency checks** (the spec scenarios below): `LICENSE.md` exists at root and contains the FSL-1.1-MIT identifier + Terrestrial Origin copyright with no unfilled `<placeholders>`; `NOTICE.md` exists at root, names Open Brain / Nate B. Jones / MIT / `f3e45e1`, and contains the MIT permission-notice paragraph; README's `## License` section no longer says only "MIT" and references the license file. These are checkable by grep/file-existence assertions.
- **Regression:** the full existing suite (`deno task test` with `TB_AI_PROVIDER=fake`, and `cd obsidian-plugin && npm test && npm run build`) must remain green — a docs-only change must not perturb it.

### User-Error Scenarios

- *A self-hoster assumes "MIT" from the old README and builds a competing hosted service.* → The README section and `LICENSE.md` now make the non-compete FSL terms explicit, removing the misleading bare "MIT".
- *A contributor/redistributor strips `NOTICE.md`.* → The README `## License` section references NOTICE as required attribution, and FSL/MIT both require the notice to travel with copies; the spec pins its presence at repo root.
- *Unfilled template placeholders ship (e.g. `<curly>` params left in the FSL text).* → A spec scenario asserts no `<…>` placeholder tokens remain, and the license-file review is part of task verification.

### Security / Threat-Model Note

This change adds no attack surface (no code, no inputs, no auth path). The relevant "threat" is **legal/compliance exposure**, not a runtime vulnerability, so it is recorded in `ThreatModel.md` as a compliance item rather than a new STRIDE entry: shipping a public repo with third-party MIT material and no attribution is the risk being closed here. `ThreatModel.md` gets a short note that licensing/attribution is now covered by `LICENSE.md` + `NOTICE.md`.

## Risks / Trade-offs

- **[Wrong FSL parameters — e.g. incorrect Change Date or Licensor name].** → Use the official FSL-1.1-MIT template and fill only the documented parameters; the spec asserts the copyright holder and that no placeholders remain. The 2-year conversion is a property of the FSL template itself, not a value we invent.
- **[NOTICE over- or under-claims the derivation].** → Wording mirrors the legality doc's vetted language exactly ("portions of the schema/server derive from…"), and an IP-attorney review (Step L4) is already scheduled before the paid listing — this step makes that review cheaper, it does not replace it.
- **[Bare-"MIT" README line elsewhere in docs].** → Sweep for other "MIT"/license mentions during apply; only the third-party MIT (in NOTICE) should remain, plus the FSL future-license reference.

## Migration Plan

No deployment, no migration, no rollback complexity — adding two files and editing a README section. If anything is wrong, it is corrected by a follow-up docs commit. No database migration, no released-artifact impact.

## Open Questions

- None blocking. The exact product-name trademark (Step L2) and attorney sign-off (Step L4) are separate, already-tracked human steps; this change uses "Terrestrial Origin / Anastasia Rohner, 2026" as the licensor per the plan.
