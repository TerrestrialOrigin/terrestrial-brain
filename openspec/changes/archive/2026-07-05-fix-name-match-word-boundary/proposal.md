## Why

`findPersonInText` (the `matchPersonInText` behavior consumed by the TaskExtractor) matches a known person's full name against note text with a bare `indexOf` and no word-boundary check. A single-word name such as "Ann" therefore matches inside unrelated words like "Pl**ann**ing", silently assigning tasks to the wrong person. Tier 2 (name-part matching) already guards against this with a before/after boundary check, but tier 1 (full-name) runs first and wins, so the guard never applies. This is finding C5 in `codeEval/Fable20260704.md` (fix-plan Step 7).

## What Changes

- Extract the before/after word-boundary check currently inlined in tier 2 of `findPersonInText` into a single shared helper, and apply it to the tier-1 full-name match as well, so a name that appears only as a substring inside a larger word is not matched.
- Make the boundary helper Unicode-aware (using `\p{L}`/`\p{N}` with the `u` flag) so accented names such as "José" are treated as whole words and their letters are recognized as word characters on both sides of a match.
- Add failing-first unit tests to `extractors/name-matching.test.ts`: a single-word name embedded in a longer word does NOT match (tier 1); legitimate boundary-adjacent matches (punctuation, possessives, start/end of text) still do; accented-name boundary cases behave correctly.

## Capabilities

### New Capabilities
<!-- None — this is a bug fix to existing behavior. -->

### Modified Capabilities
- `task-extractor`: the "matchPersonInText supports partial name matching" requirement changes so that the full-name (tier 1) substring match is subject to the same word-boundary constraint as the partial (tier 2) match, and the boundary check is Unicode-aware.

## Non-goals

- No change to `findPersonByName` (the PeopleExtractor fallback), which matches on tokenized name parts rather than raw substrings and is not affected by the substring-embedding bug.
- No change to the two-tier priority order (full-name still takes priority over partial) or the earliest-position selection logic.
- No LLM-path or prompt changes — this fixes only the deterministic fallback matcher.

## Impact

- Code: `supabase/functions/terrestrial-brain-mcp/extractors/name-matching.ts` (`findPersonInText`, new shared boundary helper), tests in `supabase/functions/terrestrial-brain-mcp/extractors/name-matching.test.ts`.
- Consumers: `extractors/task-extractor.ts` (`matchPersonInText` → `findPersonInText`) benefits automatically; no API/signature change.
- Spec: `openspec/specs/task-extractor/spec.md` requirement "matchPersonInText supports partial name matching".
