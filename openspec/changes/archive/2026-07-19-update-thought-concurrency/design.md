# Design — update_thought Optimistic Concurrency

## Context

`update_thought` (tools/thoughts.ts ~870-907) does: `findForUpdate(id)` → `buildThoughtUpdate` (spreads `existing.metadata`, merges reference arrays in memory) → `thoughtRepository.update(id, payload)`. Nothing prevents two interleaved read-modify-write cycles from silently losing the first writer's references. The `thoughts` table has a trigger (`thoughts_updated_at`, `00000000000000_initial.sql`) that stamps `updated_at = now()` on every UPDATE — a server-maintained etag already in place.

## Goals / Non-Goals

**Goals:**
- A stale-snapshot `update_thought` write is rejected with an explicit, retryable error — never a silent overwrite.
- Zero schema changes; reuse the trigger-maintained `updated_at`.
- Preserve behavior of every other `update` caller.

**Non-Goals:**
- Server-side retry/merge; guarding the sync/reconciliation bulk paths; a generic OCC framework for other tables (do it when a finding demands it).

## Decisions

### D1 — Etag = `updated_at`, compared server-side via a filter

`update` adds `.eq("updated_at", expectedUpdatedAt)` when the option is present, plus `.select("id")` so the result reports the matched row. PostgREST parses the ISO string back to `timestamptz`, so equality is on the parsed value (microsecond precision round-trips through PostgREST's own output — the value compared is the value previously read from the same API). Zero rows matched ⇒ either the row is gone or `updated_at` moved ⇒ both mean "re-read and retry". Alternative considered: integer `version` column — rejected (migration + trigger for no additional safety); jsonb_set RPC — rejected (protects only references, leaves content/top-level RMW unguarded).

### D2 — `update` return shape: `RepoResult<{ id: string } | null>`

`data` is the matched row identity or `null` when nothing matched. Existing callers destructure only `error` and keep compiling; fakes returning `{ data: null, error: … }` remain valid. This also removes a latent blind spot: an unguarded update of a nonexistent id previously reported indistinguishable success.
The handler treats `error` as "Update failed: …" (unchanged) and `data === null` (with the guard set) as the concurrent-edit case.

### D3 — Handler extraction (`handleUpdateThought`)

The inline closure moves to an exported `handleUpdateThought(aiProvider, thoughtRepository, args)` — same pure-move pattern as `handleListTasks`/`handleGetProject` — so the concurrency behavior is unit-testable against a fake repository (GATE 2b: removing the `expectedUpdatedAt` pass-through or the null-check reddens tests).

### D4 — Error message

`"Concurrent edit detected — this thought changed since it was read. Re-read it and retry the update."` — states cause and the exact remedy; carries no content.

### Test Strategy

- **Unit** (fake ThoughtRepository, RED first):
  1. handler passes the read row's `updated_at` as `expectedUpdatedAt` (fake records the options argument);
  2. fake reports no-match (`data: null`) → handler returns the concurrent-edit error, not the success message;
  3. fake reports a match → unchanged success message (control).
- **Unit** (fake Supabase client): `update` with the option chains `.eq("updated_at", …)` and `.select("id")`; without the option, no such filter (control, preserves old chain).
- **Integration** (real stack): capture a thought; read it via `findForUpdate`; update once (trigger bumps `updated_at`); attempt a second update with the stale `updated_at` → `data: null`, row unchanged by the stale payload; fresh re-read then update → succeeds. This is the interleaving replicated deterministically (two writes from one snapshot).
- **Mock audit**: fakes only at the repository seam; the handler and repository implementation under test are real. E2E: no user-facing UI workflow changed; the MCP-level integration test covers the new behavior end-to-end at the repo/DB layer.

## Risks / Trade-offs

- [Timestamp-equality false negatives if the string form doesn't round-trip] → the compared string is the one PostgREST itself returned for that row; PostgREST parses it back to `timestamptz` for the filter, so equality is value-level, not string-level. The integration test proves the fresh-read → update path succeeds.
- [Two updates inside one trigger-clock microsecond] → `now()` is transaction-start time with microsecond precision; two committed updates in the same microsecond are not realistic for this human/LLM-driven path, and the failure mode is a spurious retry prompt, not data loss.
- [Return-shape change ripples to fakes] → additive/optional; suite compile verifies.

## User Error Scenarios

- Model retries a genuinely-failed update with the old snapshot → gets the concurrent-edit error with explicit "re-read" instruction (deterministic, no data loss).
- Double-click / duplicate identical update from the same snapshot → first wins, second gets the retryable error (runs-twice answered: the guard makes the second a no-op with a clear signal; crashes-halfway: single UPDATE statement, atomic; interleaves: this design).
- Update of a deleted/archived-then-purged thought with the guard → same concurrent-edit error path (row missing ⇒ zero match); acceptable, message still leads to a re-read which reports not-found.

## Security Analysis

No new inputs (the etag comes from the server's own prior response, and a forged/garbled `expectedUpdatedAt` can only make the update match nothing — fail-closed). No new privileges, no new data flows, no logging of content. No ThreatModel.md change needed.

## Migration Plan

Code-only; deploy with the edge function; rollback = revert commit.

## Open Questions

None.
