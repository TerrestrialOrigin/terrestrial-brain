## Context

Two naming generations coexist in the repo. The newer server files and the extractor pipeline already follow the owner's standing rules (no single-letter variables except numeric loop counters; no abbreviations unless the full name would exceed 30 chars; named constants over magic numbers; self-documenting code). The older files (`tools/thoughts.ts`, `tools/tasks.ts`, `tools/projects.ts`, `helpers.ts`) and a few plugin sites were never brought up to that standard. Steps 14–19 already deleted much of the originally-offending code (envelope/LLM/route/name-resolution duplication, god-functions), so this step sweeps only what remains.

This is the last structural-cleanup step and is intentionally a **pure refactor**: identical runtime behavior, verified by keeping both existing test suites green without modification.

## Goals / Non-Goals

**Goals:**
- Every remaining single-letter/cryptic/over-abbreviated identifier in the target files gets a descriptive name (numeric loop counters `i`/`j`/`k`-as-index excepted).
- Non-obvious magic numbers become named constants at the top of their module (or an appropriate shared location) with a name that states their meaning.
- Small correctness-neutral cruft is fixed: the `"open-brain"` server-info name, any stale "top N" comment, the misplaced/orphaned JSDoc, `if (!content && content !== "")` → `content === undefined`, a `simpleHash` collision-trade-off comment, and any stray semicolon.

**Non-Goals:**
- No behavior change of any kind. A rename that would alter serialized output, a stored value, an API field, or control flow is out of scope.
- No dependency bumps, no test-assertion tightening, no new features/bugfixes.
- No renaming of DB columns/indexes, migration files, tool names, or the `x-brain-key`/`?key=` auth surface.

## Decisions

**Decision 1 — Rename only within function bodies and private signatures; never public/serialized names.**
Local variables and internal parameter names are safe to rename. Anything that crosses a boundary — MCP tool names, JSON response field keys, DB column names, env var names, exported symbols consumed elsewhere — is left alone. Rationale: those are the only names whose change could alter behavior; renaming them would violate the zero-behavior-change goal.
_Alternative considered:_ also modernize exported helper names for consistency — rejected because it risks ripple changes and behavior/contract drift for cosmetic gain.

**Decision 2 — `name: "open-brain"` → the real product name is a safe internal change.**
This string is the MCP `serverInfo.name` reported in the initialize handshake; it is not a routing key, table name, or auth value. Changing it to match the product ("terrestrial-brain") is display-only. We confirm via grep that no code or test asserts the literal `"open-brain"`; if a test does, that assertion is updated deliberately and noted (this is the one sanctioned test edit, and only if it exists).
_Alternative considered:_ leave it — rejected; it is an active source of confusion flagged in the eval.

**Decision 3 — Named constants live at module top (or nearest existing constants block), not inlined.**
Each magic number (server result caps/thresholds; plugin `60000` ms and `2000` truncation) becomes a `const SCREAMING_SNAKE` with a name stating intent (e.g. `RECENT_ACTIVITY_LIMIT`, `POLL_TIMEOUT_MS`, `ERROR_BODY_MAX_CHARS`). Value is copied verbatim — no rounding, no unit change.

**Decision 4 — The inventory drives the task list.**
Two read-only survey passes (server + plugin) produce the exact file:line inventory of what still exists post-refactor. Tasks are generated from that inventory so we neither miss survivors nor try to fix already-deleted code.

**Test Strategy:**
- **No new test layers.** The correctness contract for a pure refactor is "the existing suites still pass, unmodified."
- **Deno suite** (`deno task test`) — integration + unit — must stay green. It exercises the renamed server code end-to-end (HTTP → edge fn → Postgres), so any accidental behavior change (a mis-scoped rename, an altered constant) surfaces as a failure.
- **Plugin vitest** (`cd obsidian-plugin && npm test`) plus `npm run build` must stay green, covering the plugin renames/constants and confirming the TypeScript still compiles.
- **`deno lint`** (and the TS compiler via `npm run build`) is the mechanical safety net for rename slips (an unrenamed reference to an old name becomes an undefined-symbol / unused-var error).
- **Mutation note:** this change asserts *absence* of behavior change, so the standard GATE 2b ("delete the line, a test goes red") is inverted — the guarantee is that deleting/renaming changes *nothing observable*, which the untouched green suite demonstrates. No failing-first test applies because there is no bug being fixed.

## Risks / Trade-offs

- **[A rename accidentally changes a serialized/observed value]** → Scope renames to locals and private params only (Decision 1); rely on the integration suite, which observes real HTTP/DB output, to catch any leak; grep for the old `"open-brain"` literal in tests before changing it.
- **[An incomplete rename leaves a dangling reference]** → `deno lint` + `deno check` and the plugin `tsc`/build fail loudly on undefined or unused identifiers; run them as a gate before declaring done.
- **[A "magic number" is actually load-bearing in two places with different intent]** → Name each occurrence by its local meaning; do not collapse two same-valued literals into one constant unless they provably represent the same concept.
- **[Scope creep into behavior changes]** → Non-goals are explicit; anything requiring a test change (beyond the sanctioned `"open-brain"` assertion, if present) is treated as a signal to stop and investigate, not to proceed.

## Migration Plan

No data or schema migration. Deploy is a normal code change; rollback is a git revert of the single commit. No env, config, or API changes for consumers.

## Open Questions

- None blocking. The exact rename targets are resolved by the survey passes; any genuinely ambiguous rename (where no descriptive name is clearly better) is left as-is rather than guessed.
