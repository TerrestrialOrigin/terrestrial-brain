## Why

The public Terrestrial Brain repository currently has **no license file at all** — under default copyright law that makes it "all rights reserved," which contradicts the intended source-available/self-host model and blocks the hosted-product launch. Worse, the repo contains a handful of MIT-era fragments derived from Open Brain by Nate B. Jones (documented provenance) but carries **no attribution notice**, which is a live MIT-compliance gap on an already-public repo (MIT's sole condition is that the copyright + permission notice be included). This step closes both gaps before any public listing goes live.

## What Changes

- Add `LICENSE.md` at the repo root containing the full **FSL-1.1-MIT** license text (Functional Source License 1.1 with MIT future-license), copyright Anastasia Rohner / Terrestrial Origin, 2026.
- Add `NOTICE.md` at the repo root: a factual attribution stating that portions of the schema/server derive from Open Brain by Nate B. Jones, published under the MIT License on 2026-03-11 (repo `NateBJones-Projects/OB1`, through commit `f3e45e1`), reproducing the MIT license text with "Copyright (c) 2026 Nate B. Jones." This NOTICE is permanent — it stays even after the verbatim fragments are rewritten (Step 1, already done).
- Update the README `## License` section (currently just the bare word "MIT") to state the actual license (FSL-1.1-MIT) and explain the tier split: free self-host, non-compete (Functional Source), and per-version conversion to MIT two years after each release. Point at `NOTICE.md` for third-party attribution.
- **Non-goals**: this change does NOT touch the README top-of-file branding line (the "extension of Open Brain / Nate" marketing copy) — that belongs to Step 3 (`feature/BrandingSeparation`), which depends on this NOTICE existing first. It does NOT change the GitHub repo description (also Step 3). No code, schema, or behavior changes.

## Capabilities

### New Capabilities
- `licensing`: Governs which license files the repository publishes, the third-party attribution notice required for MIT-era provenance, and how the README communicates the license tier split to self-hosters.

### Modified Capabilities
<!-- None — no existing spec's behavioral requirements change. -->

## Impact

- New files: `LICENSE.md`, `NOTICE.md` (repo root).
- Modified file: `README.md` (`## License` section only).
- No source code, migrations, edge functions, plugin code, or tests change. Gates are documentation-consistency plus the existing suite staying green (renaming nothing, adding docs only).
- Downstream: unblocks Step 3 (branding separation, which references `NOTICE.md`) and Step 19 (plugin store submission, whose public listing needs a settled license).
