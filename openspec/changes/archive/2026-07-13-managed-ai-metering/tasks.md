# Tasks — Step 15 Managed AI + usage metering (`managed-ai-metering`)

> All code lands in THIS public repo, `supabase/functions/terrestrial-brain-mcp/`. Metering is OFF by default (`TB_AI_MONTHLY_LIMIT` unset) so the existing suite is unaffected. Follow the parse-at-boundary (`security-config.ts`), repository-head-count, and `errorResult` patterns. Tests assert RED-first where they encode new behavior; GATE-2b mutation checks prove non-vacuity.

## 1. Metering config (parse-at-boundary, pure)

- [x] 1.1 Add `metering-config.ts`: `parseAiMonthlyLimit(raw: string | undefined): number | null` (strictly-positive integer else null), `startOfUtcMonthMs(nowMs)`, `startOfNextUtcMonthMs(nowMs)`, and the shared `AI_METERED_FUNCTIONS = ["search_thoughts","capture_thought","ingest-note"]` constant. No `Deno.env` access (mirror `security-config.ts`).

## 2. Usage meter seam

- [x] 2.1 Add `usage-meter.ts`: the `UsageMeter` port (`countMeteredCallsSince(sinceMs): Promise<number>`) and `SupabaseUsageMeter` — one head-count query (`.select("*", { count: "exact", head: true }).in("function_name", AI_METERED_FUNCTIONS).gte("called_at", iso)`) returning `count ?? 0` (bounded by the `(function_name, called_at)` index; never loads rows).

## 3. Quota gate + enforcement helpers

- [x] 3.1 Add `ai-quota.ts`: `AiQuotaGate` (`check(nowMs): Promise<QuotaDecision>` where `QuotaDecision = { allowed, limit, used, resetAtMs }`) — null limit ⇒ allow without querying; else `used = meter.countMeteredCallsSince(startOfUtcMonthMs(now))`, `allowed = used <= limit`, `resetAtMs = startOfNextUtcMonthMs(now)`; a throwing meter is caught → logged → allowed (fail-open, D5).
- [x] 3.2 Add `quotaExceededResult(decision)` (in `ai-quota.ts` or `mcp-response.ts`) → `errorResult("AI quota exceeded: you've used {used} of {limit} AI operations this month. Your quota resets on {resetDate} UTC. No AI operation was performed.")`.
- [x] 3.3 Add `withAiQuota(gate, handler)` MCP decorator: `await gate.check(Date.now())`; if `!allowed` return `quotaExceededResult` WITHOUT calling `handler`; else call it. Composes inside `withMcpLogging`.

## 4. Wire enforcement at the AI-consuming entry points

- [x] 4.1 Thread an `AiQuotaGate` param into `registerThoughts` (index.ts `createMcpServer` → `registerThoughts`); wrap the `search_thoughts` and `capture_thought` handlers with `withAiQuota(gate, …)` inside their existing `withMcpLogging(...)`.
- [x] 4.2 In `index.ts`, construct the gate at the composition root: read `Deno.env.get("TB_AI_MONTHLY_LIMIT")` once, `parseAiMonthlyLimit`, build `new SupabaseUsageMeter(supabase)` + `new AiQuotaGate(limit, meter)`; pass it into `createMcpServer`/`registerThoughts`.
- [x] 4.3 Guard the `ingest-note` HTTP route: before `handleIngestNote`, `await gate.check(Date.now())`; if denied return a `429` route result (extend `HttpRouteResult` status union to include `429`) carrying the quota message. Confirm `withMcpLogging` still logs a denied MCP call as `isError`/`records_returned=0`.

## 5. Testing & Verification

- [x] 5.1 Unit tests (`tests/unit/metering-config.test.ts`, `ai-quota.test.ts`): `parseAiMonthlyLimit` (positive int; unset/empty/`0`/negative/non-numeric ⇒ null); `startOfUtcMonthMs`/`startOfNextUtcMonthMs` UTC boundaries; `AiQuotaGate.check` with a FAKE meter — null-limit short-circuits (meter NOT called), `used <= limit` boundary (allow at `used=limit`, deny at `limit+1`), fail-open on a throwing meter; `withAiQuota` — over-quota returns `quotaExceededResult` and does NOT call the handler, under-quota calls it; `quotaExceededResult` shape.
- [x] 5.2 Integration test (`tests/integration/managed-ai-metering.test.ts`, REAL stack, no mock on the metered path): seed `function_call_logs` rows (metered names, current-month `called_at`; plus a previous-month metered row and a current-month non-metered row) via the service client; assert `SupabaseUsageMeter.countMeteredCallsSince` returns only the in-window metered count; assert `AiQuotaGate` denies/allows at the exact `limit` boundary; drive `withAiQuota(realGate, spyHandler)` and assert the handler is skipped + a quota `errorResult` returned when over quota.
- [x] 5.3 GATE-2b mutation checks: (1) gate ignores the limit (always allow) → boundary test reddens; (2) drop `.gte("called_at", …)` → out-of-window test reddens; (3) drop `.in("function_name", …)` → non-metered test reddens; (4) `withAiQuota` calls handler when denied → skip test reddens. Record results; revert probes.
- [x] 5.4 Full public gate on a freshly `db reset` + seeded stack: `deno task test` (`TB_AI_PROVIDER=fake`, `TB_AI_MONTHLY_LIMIT` unset) GREEN; `cd obsidian-plugin && npm test && npm run build`; `deno lint` + `deno fmt --check` clean. Paste the counts.
- [x] 5.5 Docs: README env-table row + `.env.example` for `TB_AI_MONTHLY_LIMIT` (unset ⇒ unlimited; the metered-set + deferred-surface boundary); `ThreatModel.md` T30; tick the Step-15 checkbox in `codeEval/Fable20260710-NewFeaturePlan.md`.
- [x] 5.6 `openspec validate managed-ai-metering --strict` clean; `/opsx:verify`.
