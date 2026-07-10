## 1. LICENSE.md (FSL-1.1-MIT)

- [x] 1.1 Add `LICENSE.md` at repo root with the official FSL-1.1-MIT template text, filling parameters: Licensor = Anastasia Rohner / Terrestrial Origin, year 2026, future license = MIT.
- [x] 1.2 Verify no unfilled `<placeholder>` parameter tokens remain in `LICENSE.md`.

## 2. NOTICE.md (MIT attribution)

- [x] 2.1 Add `NOTICE.md` at repo root attributing Open Brain by Nate B. Jones (MIT, published 2026-03-11, repo `NateBJones-Projects/OB1`, through commit `f3e45e1`), reproducing the MIT license text verbatim from `~/Documents/PassiveIncomeChat/evidence/LICENSE-MIT-initial-ff4ffa7.txt` including "Copyright (c) 2026 Nate B. Jones."
- [x] 2.2 Add a short framing sentence stating which parts derive (schema/server fragments) and that the NOTICE is retained permanently.

## 3. README license section

- [x] 3.1 Replace the README `## License` section body (currently bare "MIT") with: FSL-1.1-MIT (see `LICENSE.md`), the tier-split explanation (free self-host / non-compete / per-version 2-year MIT conversion), and a reference to `NOTICE.md` for third-party attribution.
- [x] 3.2 Sweep the README for any other stray "MIT"/license claims about the project's own license and reconcile (leave the third-party MIT reference intact).

## 4. ThreatModel.md compliance note

- [x] 4.1 Add a short note to `ThreatModel.md` recording that licensing/attribution compliance is now covered by `LICENSE.md` + `NOTICE.md` (compliance item, not a runtime STRIDE entry).

## 5. Testing & Verification

- [x] 5.1 Docs-consistency check: confirm `LICENSE.md` and `NOTICE.md` exist at root and satisfy every spec scenario (grep for FSL identifier, Terrestrial Origin copyright, no placeholders; Open Brain / Nate B. Jones / MIT / `f3e45e1`; MIT permission-notice sentence; README references LICENSE.md + NOTICE.md + tier split).
- [x] 5.2 Run the full suite green — `deno task test` (local stack, `TB_AI_PROVIDER=fake`) AND `cd obsidian-plugin && npm test && npm run build`. Zero failures, zero skips (docs-only change must not perturb the suite).
- [x] 5.3 Check the step off in `codeEval/Fable20260710-NewFeaturePlan.md` (Step 2) as part of this change's commit.
