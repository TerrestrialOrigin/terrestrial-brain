# Design — Quota Metering Accuracy

## Context

Log rows are created by `logCall` before the quota gate runs (both at the MCP decorator and the HTTP dispatcher). A refusal or crash later stamps `error_details` on that row via `logResult(error)` / `logError`. The meter counts all metered rows in the window, so refused/failed calls inflate `used` permanently. The gate's `used <= limit` convention deliberately pre-counts the in-flight call (its row exists with `error_details` null at check time).

## Goals / Non-Goals

**Goals:** only AI-consuming (non-errored) calls count; a refusal never permanently burns quota; the clock is injectable at every enforcement point.
**Non-Goals:** eliminating the concurrent-admission race (documented tolerance); counting partial consumption of calls that fail mid-flight (a failed call is excluded even if it consumed some AI before failing — an accepted, user-favoring tolerance).

## Decisions

### D1 — Filter, keep the pre-count convention (finding's option B)

`countMeteredCallsSince` adds `.is("error_details", null)`. The gate stays `used <= limit`: the in-flight call's own row has null `error_details` and is therefore still pre-counted, so exactly `limit` calls are permitted per window. The alternative (`used < limit` + "stop pre-counting") is incoherent with rows-before-gate ordering — the in-flight row cannot be excluded by any error filter, and `<` with self-counting would permit zero calls at `limit = 1`. Residual behavior under concurrency (two at-limit calls may both refuse) is documented on `check()`; unlike before, those refusals no longer poison the rest of the month — the refused rows gain `error_details` and drop out of the count.

### D2 — Clock seam

`withAiQuota(gate, handler, now = Date.now)` — default preserves call sites; tests inject a frozen clock. `HttpRouteDeps.now: () => number` (required in the deps type; composition root supplies `Date.now`) — required rather than optional so no hidden default lives in the route layer.

### Test Strategy

- **Unit (RED first):**
  - fake Supabase client: meter chain includes `is(error_details, null)` (mutation check: removing the filter reddens);
  - real gate + fake meter: boundary — with limit N and the current call pre-counted, `used == N` allows and `used == N+1` refuses;
  - decorator rollover: fake meter keyed by the `since` it receives; frozen `now` in late January at-limit → refused; frozen `now` on Feb 1 → allowed (new window) — through `withAiQuota`'s injected clock;
  - ingest-note route via fake deps `now` (the route consults the injected clock, not the global).
- **Integration (RED first):** with a temporary limit… the live gate reads `TB_AI_MONTHLY_LIMIT` at boot, so limit manipulation isn't practical against the running stack; instead assert at the meter level with the REAL `SupabaseUsageMeter` against real rows: insert (via the logger path) one successful and one errored metered row in-window → count returns 1, not 2. That is the exact CORE-9 defect replicated on the real query.
- **Mock audit:** fakes only on the meter/client/clock seams; gate, decorator, meter query are real code under test.

## Risks / Trade-offs

- [A call that consumed AI then failed is not counted] → under-counts in the user's favor; bounded by failure rate; documented.
- [In-flight long-running calls with null error_details briefly inflate `used`] → identical to the existing pre-count convention; window is seconds.

## User Error Scenarios

- User retries after an over-quota refusal near the boundary: the refusal itself no longer consumes quota, so a legitimately-in-quota retry succeeds (this was the bug).
- Runs-twice/interleaves: the gate is read-only; log rows are per-call; no new mutation paths. Crashes-halfway: a crash after logCall leaves a row that gains `error_details` (Step 18) and is excluded — consistent.

## Security Analysis

No new inputs or privileges. The filter cannot be abused to gain quota: `error_details` is server-written telemetry, never client-controlled. Threat model unchanged.

## Migration Plan

Code-only; deploy with the edge function; rollback = revert.

## Open Questions

None.
