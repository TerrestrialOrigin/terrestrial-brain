## Context

Terrestrial Brain's public repository still leads with Open Brain / Nate B. Jones branding in two marketing surfaces:

1. `README.md:3` — the tagline directly under the `# Terrestrial Brain` H1:
   > *The project is inspired by and is an extension of "Open Brain" by Nate B Johnes (Seriously, subscribe to his youtube channel. He makes AWESOME content!)*
   This is an endorsement/marketing line (and contains the typo "Johnes").
2. The **GitHub repository description** (repo settings metadata, not a file in the tree): "An extended version of Nate B Jones' 'open brain'…".

Prior Phase-0 steps already established the *correct* home for attribution: `NOTICE.md` (Step 2) carries the permanent MIT attribution with the gratitude tone ("With gratitude to Nate B. Jones…"), and the README `## License` section (Step 2, ~line 554) carries a factual third-party-attribution pointer to `NOTICE.md`. So the branding fix is purely about removing provenance from the *marketing* headline, not about removing attribution (which must stay).

Constraint from the New-Feature-Plan standing rules: applied migrations are **append-only** — the migration comment referencing `ob1-fragment-rewrite` (`supabase/migrations/20260710000001_…sql:2`) is immutable history and must not be edited. `codeEval/` and `openspec/changes/archive/**` are historical records and are out of sweep scope by explicit plan direction.

## Goals / Non-Goals

**Goals:**
- README headline (`README.md:3`) describes the product on its own terms, with no Open Brain / OB1 / Nate reference and no "subscribe to his channel" endorsement.
- A concrete, ready-to-paste replacement for the GitHub repository description, recorded here and in `tasks.md`, with no third-party reference.
- A verified repo sweep: every surviving `open brain` / `open-brain` / `OB1` / `Nate` string outside the excluded areas is legitimate factual attribution or immutable history.

**Non-Goals:**
- Finalizing the product elevator pitch / marketing statement — that is Step 8 (`Marketing statement finalized`). This change only removes the provenance-marketing; it does not lock in final copy.
- Touching `NOTICE.md`, the README License section, `ThreatModel.md` factual notes, or any migration comment — these are the *correct* attribution/history and are deliberately retained.
- Any runtime code, schema, or API change.

## Decisions

### Decision 1: README:3 becomes a neutral product tagline (no attribution inline)

Replace line 3 with a one-line, product-only tagline and rely on the **already-existing** README License section (line ~553–556) as the pointer to `NOTICE.md`. Adding a second attribution pointer at the top would duplicate the License-section pointer and re-introduce provenance into the headline.

**Chosen replacement text for `README.md:3`:**
> *Long-term, searchable memory for your AI: an AI-powered second brain that connects your [Obsidian](https://obsidian.md) vault to a cloud knowledge base and exposes it to AI agents over [MCP](https://modelcontextprotocol.io/).*

Rationale: factual, product-first, no third-party endorsement, and intentionally not over-committing to final marketing copy (Step 8 owns that). Keeps the existing linked-term style used elsewhere in the README intro.

**Alternative considered:** put a neutral "see `NOTICE.md` for third-party attribution" pointer on line 3. Rejected — the License section already does this; a headline attribution pointer keeps provenance in the marketing zone, which is exactly what this step removes.

### Decision 2: GitHub repository description is a recorded manual action

The `gh` CLI is not installed in this environment and no PAT is available, so the description cannot be changed programmatically here. The exact replacement is recorded for Anastasia to paste into GitHub → repo Settings → Description (or via `gh repo edit --description "…"` where `gh` is available).

**Chosen replacement text for the GitHub repository description:**
> *An AI-powered second brain that connects Obsidian to a Supabase knowledge base and exposes your notes to AI agents through an MCP server.*

Rationale: product-only, ≤ GitHub's description length, no Open Brain / OB1 / Nate reference. `tasks.md` carries this as an explicit `[Anastasia]` task so the change is not falsely marked "done" while the live description still shows the old text.

### Decision 3: Sweep scope and retained occurrences

The sweep uses `grep -rniE 'open.?brain|OB1|Nate'` across the tree (excluding `.git`, `node_modules`). Every hit is triaged. Retained (legitimate) categories:
- `NOTICE.md` — permanent attribution (in scope-exclusion by plan).
- `README.md` License section — factual attribution pointing at `NOTICE.md`.
- `ThreatModel.md` — references the `ob1-fragment-rewrite` change name and "MIT-era Open Brain material" as factual design/compliance records.
- `supabase/migrations/**` — append-only history comment.
- `codeEval/**`, `openspec/changes/archive/**` — historical records (plan-excluded).
- Regex false positives: substrings `halluci**nate**d`, `origi**nate**d`, "**Open** threads" in skill/command docs and code comments — not branding.

The acceptance test encodes this allowlist so the sweep is repeatable and a *new* marketing reference introduced later would fail it.

## Risks / Trade-offs

- **[Risk] The GitHub description is settings metadata, not code — an agent cannot verify the live value here.** → Mitigation: it is an explicit `[Anastasia]` task in `tasks.md` with the exact text; the change's completion note distinguishes "repo-tree done" from "GitHub setting pending Anastasia." Not silently marked done.
- **[Risk] Over-tuning marketing copy now conflicts with Step 8.** → Mitigation: the README tagline is deliberately neutral/minimal; Step 8 explicitly owns final pitch copy and may revise it.
- **[Risk] A future contributor re-introduces a provenance-marketing line.** → Mitigation: the acceptance test (allowlist-based grep) fails on any new `open brain`/`Nate` occurrence outside the retained set.
- **[Trade-off] Regex catches false positives ("hallucinated", "originated").** → Accepted: the test's allowlist enumerates them explicitly so the signal stays clean; cheaper than a word-boundary regex that could miss real hits like "open-brain".

## Security Analysis

No new attack surface: this change touches marketing prose and a GitHub settings string only — no auth, input, code, or data path is affected. There is no new `ThreatModel.md` **threat** to add. A single-line **compliance note** will be appended to `ThreatModel.md`'s existing "Compliance notes (non-STRIDE)" section recording that public marketing branding was separated from third-party provenance (attribution retained in `NOTICE.md`), completing the Phase-0 licensing/branding posture. Editing `ThreatModel.md` to *add* this note does not conflict with Decision 3's retention of the existing factual notes there.

## User-Error Scenarios

- **User edits `README.md:3` back to a provenance-marketing line** (or a future PR re-adds "extension of Open Brain"). → The acceptance test's allowlist grep fails, catching it in CI/local gates before merge.
- **Anastasia forgets to update the GitHub description**, or pastes text that still contains "Open Brain". → The task list keeps the item open and states the exact required text; the plan checklist note records it as a pending manual setting rather than complete.
- **Someone tries to "clean up" `NOTICE.md` or the migration comment** thinking it's stray branding. → Design + spec explicitly mark these as required/append-only retained content; the acceptance test asserts `NOTICE.md` still contains the attribution, so removing it fails.

## Test Strategy

Which layers apply and why:
- **Docs-consistency test (deterministic):** an automated check (shell/Deno test in the repo's existing test layout) that (a) asserts `README.md:3` contains no `Open Brain`/`OB1`/`Nate` and no "subscribe"/"youtube" endorsement text, (b) runs the allowlist sweep and asserts zero un-allowlisted branding hits, and (c) asserts `NOTICE.md` still contains the attribution (guard against over-deletion). This is the primary gate and encodes Decision 1 & 3.
- **No unit/integration/E2E code tests** — there is no runtime behavior change; adding app-level tests would be theater. The existing full suite (`deno task test`, plugin `npm test` + `npm run build`) is run unchanged to prove the docs edit broke nothing.
- **Manual verification** for the GitHub description (settings surface, not testable from the tree) — recorded, not automated.

## Migration Plan

No data migration. Deploy = merge to `develop`. Rollback = revert the README line (trivial). The GitHub description change is independently reversible in repo settings.

## Open Questions

None blocking. Final marketing copy is intentionally deferred to Step 8.
