## 1. Acceptance test (write first, RED)

- [x] 1.1 Add `tests/unit/branding-separation.test.ts` (deterministic docs-consistency test) that computes the repo root from `import.meta.dirname` and asserts: (a) the first prose line under `# Terrestrial Brain` in `README.md` contains no `open brain`/`open-brain`/`OB1`/`Nate` (case-insensitive) and no `subscribe`/`youtube`; (b) a repo-wide allowlisted sweep for `open.?brain|OB1|Nate` finds zero un-allowlisted marketing occurrences (allowlist: `NOTICE.md`, README `## License` section, `ThreatModel.md`, `supabase/migrations/**`, `codeEval/**`, `openspec/**`, `tests/**`, `.claude/**`, `node_modules`, `.git`, and documented false positives `hallucinated`/`originated`/`Open threads`); (c) `NOTICE.md` still contains the Nate B. Jones attribution.
- [x] 1.2 Add `--allow-read` to the `test` and `test:unit` Deno tasks in `deno.json` so the docs-consistency test can read repo files.
- [x] 1.3 Run the new test and confirm it FAILS RED against current `README.md:3` (the "Open Brain / Nate B Johnes / subscribe" line).

## 2. Branding separation edits

- [x] 2.1 Replace `README.md:3` with the neutral product tagline from `design.md` Decision 1 (no Open Brain/OB1/Nate, no endorsement copy; keep the linked-term style).
- [x] 2.2 Re-run the sweep locally; confirm every remaining `open.?brain|OB1|Nate` hit outside the allowlist is resolved (expect only retained attribution/history/false-positives to survive).
- [x] 2.3 Verify the retained set is untouched: `NOTICE.md`, README `## License` section pointer, `ThreatModel.md` factual notes, and the `20260710000001_…` migration comment are all still present and unedited.

## 3. GitHub repository description (manual — Anastasia)

- [ ] 3.1 `[Anastasia]` Update the GitHub repository description in repo Settings (or `gh repo edit --description "…"`) to the exact text from `design.md` Decision 2: *"An AI-powered second brain that connects Obsidian to a Supabase knowledge base and exposes your notes to AI agents through an MCP server."* — no Open Brain/OB1/Nate reference. Tracked as pending; not auto-completed by the code change.

## 4. ThreatModel compliance note

- [x] 4.1 Append a one-line entry to `ThreatModel.md`'s "Compliance notes (non-STRIDE)" section recording that public marketing branding was separated from third-party provenance (attribution retained in `NOTICE.md`), completing the Phase-0 branding posture. Do not alter the existing factual `ob1-fragment-rewrite` / "MIT-era Open Brain material" references.

## 5. Testing & Verification

- [x] 5.1 Confirm the new docs-consistency test now PASSES (green) after the README edit.
- [x] 5.2 `deno lint` and `deno fmt --check` clean (run `deno fmt` on the new test file first).
- [x] 5.3 Full backend suite green: `deno task test` (local stack up via `npx supabase start`, `TB_AI_PROVIDER=fake`) — zero failures, zero skips.
- [x] 5.4 Plugin gate green: `cd obsidian-plugin && npm test && npm run build`.
- [x] 5.5 `scripts/validate-all.sh` runs clean end-to-end (it already invokes `deno task test`, lint, fmt, plugin test+build — no update needed unless a gap is found).
- [x] 5.6 Walk each `product-branding` delta-spec scenario and confirm the implementation satisfies it.
