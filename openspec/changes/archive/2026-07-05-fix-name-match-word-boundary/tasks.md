## 1. Replicate the bug (failing-first)

- [x] 1.1 The in-source `extractors/name-matching.test.ts` was an orphaned Vitest file run by no suite (the Deno tasks only cover `tests/`, and Deno cannot resolve the bare `vitest` import). Following the Step 5 pattern, port it to a native Deno unit test at `tests/unit/name-matching.test.ts` and delete the orphan. Add a case asserting a single-word known person "Ann" does NOT match inside "Planning the sprint" (expect `null`); run `deno test tests/unit/name-matching.test.ts` and confirm it FAILS against current code.

## 2. Fix the matcher

- [x] 2.1 Add a shared `isWordBoundaryMatch(text, index, length)` helper in `name-matching.ts` using the Unicode word class `/[\p{L}\p{N}]/u`; a boundary exists when the char before/after the slice is absent or non-word.
- [x] 2.2 Rewrite tier 1 of `findPersonInText` to scan occurrences (`indexOf(needle, from)` loop) and select the earliest occurrence that satisfies `isWordBoundaryMatch`, dropping the raw single-`indexOf` behavior.
- [x] 2.3 Rewrite tier 2 of `findPersonInText` to delegate its inline `charBefore`/`charAfter` `/\W/` test to the shared `isWordBoundaryMatch` helper (behavior-equivalent for existing tests, Unicode-correct for accented input).
- [x] 2.4 Confirm the failing test from 1.1 now passes.

## 3. Expand coverage

- [x] 3.1 Add tests: leading- and trailing-embedded single-word names do not match; boundary-adjacent legitimate matches still succeed (start of text, end of text, before `.`, possessive `'s`, parentheses).
- [x] 3.2 Add accented-name tests: "José" matched as a whole word; "José" embedded in "Josély" not matched.
- [x] 3.3 Confirm `isWordBoundaryMatch` is the ONLY boundary logic (GATE 2b: deleting the boundary check breaks at least one test).

## 4. Verification

- [x] 4.1 Run the full Deno integration suite and the plugin Vitest suite + build; zero failures, zero skips.
- [x] 4.2 `openspec validate` the change; run `/opsx:verify`.
- [x] 4.3 Check off Step 7 in `codeEval/Fable20260704-fix-plan.md`, commit, and open a PR to `develop`.
