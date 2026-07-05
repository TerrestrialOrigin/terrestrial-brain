## Context

`findPersonInText(text, knownPeople)` in `extractors/name-matching.ts` is a pure, deterministic function used by the TaskExtractor (`matchPersonInText`) to assign a task to a known person when their name appears in the checkbox text. It has two tiers:

1. **Tier 1 (full-name):** `textLower.indexOf(person.name.toLowerCase())` — returns the earliest positional full-name hit. **No word-boundary check.**
2. **Tier 2 (name-part):** searches individual name parts (≥2 chars) and *does* verify the hit is not inside a larger word via `charBefore`/`charAfter` tested against `/\W/`.

Because tier 1 runs first and short-circuits, a single-word known name like "Ann" matches inside "Planning" and is returned before tier 2's guard can run. The current tier-2 guard also uses `/\W/`, which is `[^A-Za-z0-9_]` — it treats an accented letter (`é`) as a boundary character, so it mis-handles accented names.

## Goals / Non-Goals

**Goals:**
- Tier 1 rejects a full-name match that is embedded inside a larger word.
- A single shared boundary helper is used by both tiers (no duplicated logic).
- The boundary check is Unicode-aware: accented letters (`\p{L}`) and digits (`\p{N}`) count as word characters, so accented names are matched as whole words.
- Existing legitimate matches (start/end of text, adjacent to punctuation/possessives/whitespace) keep working.

**Non-Goals:**
- No change to `findPersonByName` (token-equality based, not substring based).
- No change to tier priority (full-name still beats partial) or earliest-position selection.
- No signature/API change; consumers are untouched.

## Decisions

**Decision 1 — Shared `isWordBoundaryMatch(text, index, length)` helper.**
Extract one helper that returns `true` when the `[index, index+length)` slice of `text` is bounded on both sides by a non-word character (or string edge). Both tiers call it. Rationale: the plan (Step 7) explicitly requires a single shared helper; duplication is what let the two tiers drift.

**Decision 2 — Unicode word class `[\p{L}\p{N}]` with the `u` flag, not `\w`/`\W`.**
A character is a "word character" iff it matches `/[\p{L}\p{N}]/u`. Boundary = surrounding char is absent (edge) or NOT a word character. Rationale: `\W` excludes accented letters, so `\W`-based boundaries misfire on names like "José". Chosen over `\w` (ASCII-only) and over adding `_` handling (underscore is not meaningful in personal names). Marks/combining chars are rare in this path; `\p{L}` covers the precomposed forms produced by the LLM/plugin.

**Decision 3 — Scan for the earliest *bounded* occurrence, not just the first raw occurrence.**
Tier 1 currently keys off the single `indexOf` result; if that first hit is embedded but a later occurrence is a clean word, the match is lost. The helper is applied while iterating occurrences (`indexOf(needle, from)` loop) so we select the earliest occurrence that is a real word boundary. Rationale: preserves the "earliest full-name match" contract without regressing valid later matches. Tier 2 keeps its existing single-occurrence behavior except it now delegates the boundary test to the shared helper (behavior-equivalent for its current tests).

## User Error Scenarios

- **Name embedded in a longer word** (e.g., known person "Ann", text "Planning the sprint"): previously mis-assigned; now returns no tier-1 match and falls through to tier-2/no-match. This is the core bug.
- **Empty / whitespace-only text or empty people list:** already returns `null`; unchanged.
- **Name adjacent to punctuation** ("Bub's PR", "talk to Bub.", "(Bub)"): the surrounding char (`'`, `.`, `(`, space) is a non-word char → still matches. Explicitly covered by tests.
- **Accented name adjacent to another letter** ("Josély"): `é`/`y` are word chars → correctly rejected as embedded; "José." matches. Covered by tests.

## Security Analysis

This is a pure string function over data the user already owns (their own note text and their own people list); it performs no I/O, auth, or privilege decisions, so no new attack surface is introduced. The only correctness/abuse consideration is **catastrophic backtracking / ReDoS**: the Unicode character-class regex is a fixed single-character test (`/[\p{L}\p{N}]/u`), applied a bounded number of times (once per occurrence per person), so it is linear and cannot backtrack. The occurrence-scanning loop advances `from` by at least 1 each iteration and is bounded by `text.length × knownPeople.length`, so it terminates. No `ThreatModel.md` entry beyond this note is warranted for a pure comparator with no external inputs or side effects.

## Test Strategy

All coverage is **unit-level** (Vitest) against the real, un-mocked `findPersonInText` — it is a pure function, so there is nothing to mock and a unit test fully exercises the real code path (satisfies GATE 2b: deleting the boundary check must fail a test).

- **Failing-first (reproduces C5):** known person "Ann", text "Planning the sprint" → expect `null`; must fail against current code (returns the person).
- Single-word name embedded in a longer word (both leading and trailing embedding) → no match.
- Boundary-adjacent legitimate matches still succeed: start of text, end of text, before punctuation, possessive `'s`, parentheses.
- Accented names: "José" matched as a whole word; "José" embedded in "Josély" not matched; accented char correctly counted as a word character on both sides.
- Regression: every existing `findPersonInText` and `findPersonByName` test remains green untouched.

No integration/E2E layer is added: the TaskExtractor's use of this helper is already covered by the existing extractor integration suite, and this change is behavior-preserving for all inputs except the embedded-substring bug, which has no dedicated user-facing flow beyond correct assignment.

## Risks / Trade-offs

- **[Risk] A previously-"working" (but actually wrong) embedded match disappears** → That is the intended fix; the existing extractor integration tests assert only correct assignments, so no legitimate assertion regresses. Verified by running the full suite.
- **[Trade-off] `\p{...}` requires the `u` flag and a modern runtime** → Deno and the Vitest/Node toolchain both support Unicode property escapes; no polyfill needed.
- **[Trade-off] Earliest-bounded-occurrence scan is marginally more work than a single `indexOf`** → bounded and linear; negligible for note-sized text.

## Migration Plan

Pure code change; no data migration, no schema change, no config. Rollback = revert the commit. Deploys with the normal edge-function deploy.

## Open Questions

None.
