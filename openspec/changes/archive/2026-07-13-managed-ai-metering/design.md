## Context

The MCP edge function (`supabase/functions/terrestrial-brain-mcp/`) runs inside each customer's own Supabase project. Every AI call flows through the single `AiProvider` seam (`ai/ai-provider.ts`), constructed once at the composition root in `index.ts` and injected. Each MCP tool call and each direct HTTP route already writes a row to `function_call_logs` — `function_name`, `function_type ('mcp'|'http')`, `called_at timestamptz default now()`, `records_returned`, `error_details`, … — via `createFunctionCallLogger` and the `withMcpLogging` decorator (which logs the call BEFORE running the handler, forces `records_returned = 0` on an error, and strips internal `meta` before the client sees the result). There is a `(function_name, called_at)` index (the retention migration) that makes a windowed count bounded.

In the hosted product the OpenRouter key is **shared** (Terrestrial's), injected as each project's `OPENROUTER_API_KEY` secret by Step 10 provisioning, so every AI call is Terrestrial's cost. Nothing bounds it today. Step 15 adds a per-tenant monthly quota computed from `function_call_logs`, enforced at the AI-consuming entry points, off by default (self-host brings its own key). Constraints inherited from the codebase: Deno + TypeScript; parse-at-boundary config in the pure `security-config.ts` style (read env once at the root, pass parsed values in); handlers never touch `supabase.from(...)` directly (a repository/seam does); errors surface as a distinct `errorResult` (`isError: true`), never a silent empty `textResult`; the default test suite runs with `TB_AI_PROVIDER=fake` and (now) `TB_AI_MONTHLY_LIMIT` unset.

## Goals / Non-Goals

**Goals:**
- Bound managed-AI cost per tenant: enforce a configurable monthly cap on AI-consuming operations, computed from the existing `function_call_logs` telemetry with a bounded query.
- Make quota-exhaustion a distinct, user-visible state (MCP `errorResult` / HTTP `429`) — never a silent empty result, and refused BEFORE any AI call.
- Off by default: unset limit ⇒ unlimited ⇒ zero behavior change and zero query overhead for self-hosters and the existing suite.
- Every seam fakeable; the enforcement decision integration-tested against REAL `function_call_logs` telemetry (no mock on the metered path).

**Non-Goals:**
- **Token-accurate metering / per-model cost weighting** — v1 meters at call granularity (one metered call = one unit), using `function_call_logs` as the plan specifies. Token accounting is future work.
- **Per-user quotas within a project** — the deployment is single-tenant (one `MCP_ACCESS_KEY` per project), so "per-customer" == per-deployment: count all AI-metered rows in the window. No per-user column exists and none is added.
- **Setting the quota value per hosted customer** (control-plane → project secret) — that wiring is Step 16 onboarding. Step 15 delivers and verifies the enforcement mechanism; the value is an operator/provisioner-set secret.
- **Metering `write_document` / `update_document` / `update_thought`'s content path** — explicitly deferred (documented boundary D6), not a silent omission.
- **A hard security boundary** — the quota is best-effort cost control; a metering-query outage fails open (D5).

## Decisions

### D1 — Config: `TB_AI_MONTHLY_LIMIT`, parsed at the boundary, unset ⇒ unlimited
A new pure module `metering-config.ts` (no `Deno.env` access — the `security-config.ts` idiom) exposes `parseAiMonthlyLimit(raw: string | undefined): number | null`: a strictly-positive integer, else `null`. `null` means **unlimited** — the safe self-host default, matching `isKeyInQueryAllowed`/`createAiProvider`'s "unset is the safe posture." `index.ts` reads `Deno.env.get("TB_AI_MONTHLY_LIMIT")` once at the composition root and passes the parsed value into the gate. Parse, don't cast: a non-numeric or `≤ 0` value is treated as unset (unlimited) — a broken quota must never silently become `0` (which would block ALL AI).

### D2 — The metered set is ONE constant, shared by the meter and the wrapped handlers
`AI_METERED_FUNCTIONS = ["search_thoughts", "capture_thought", "ingest-note"]` lives in `metering-config.ts` and is used BOTH by the meter's count query (which `function_name`s to count) AND to decide which handlers get the `withAiQuota` wrap. Deriving both from one constant guarantees the count and the enforcement can never drift (the meter counts exactly the operations the gate guards). `ingest-note` is the HTTP route's `logName`; `search_thoughts`/`capture_thought` are the MCP tool names.

### D3 — Bounded usage meter behind a `UsageMeter` seam
A new port `UsageMeter { countMeteredCallsSince(sinceMs: number): Promise<number> }`. The real `SupabaseUsageMeter` issues ONE head-count query — `.from("function_call_logs").select("*", { count: "exact", head: true }).in("function_name", AI_METERED_FUNCTIONS).gte("called_at", iso)` — returning `count ?? 0`, bounded by the `(function_name, called_at)` index, never fetching rows (mirrors `supabase-task-repository.ts`'s head-count pattern). A deterministic fake returns a scripted count. Handlers never query `function_call_logs` directly — the meter is the seam.

### D4 — `AiQuotaGate`: pure decision over the window; short-circuits when unlimited
`AiQuotaGate.check(nowMs): Promise<QuotaDecision>` where `QuotaDecision = { allowed, limit: number | null, used, resetAtMs }`. When `limit === null` it returns `{ allowed: true, limit: null, used: 0, resetAtMs }` **without calling the meter** (zero overhead for self-host). Otherwise it computes `windowStart = startOfUtcMonthMs(nowMs)`, `used = await meter.countMeteredCallsSince(windowStart)`, and `allowed = used <= limit`, with `resetAtMs = startOfNextUtcMonthMs(nowMs)`. **Boundary semantics:** the gate is invoked from inside `withMcpLogging` (so the current call's row is ALREADY logged when `check` runs), hence `used` includes the current call and the rule `used <= limit` allows exactly `limit` metered calls per UTC month (call `limit+1` sees `used = limit+1 > limit` → denied). The UTC-month window makes the reset deterministic and legible ("resets on the 1st").

### D5 — A metering-query failure fails OPEN, loudly
If `meter.countMeteredCallsSince` throws (a transient DB error), the gate logs the error (`console.error`) and returns `allowed: true`. Rationale: the quota is a best-effort **cost cap, not a security control**; blocking a paying customer's AI because a count query hiccuped is the worse failure. This is a deliberate, documented decision (ThreatModel T30), not a swallowed error — the failure is logged and reasoned, and it degrades to the pre-Step-15 behavior (no cap), never to a wrong success/empty. (Contrast: the AUTH check fails closed; the quota, being cost control, fails open.)

### D6 — Enforcement point: `withAiQuota` inside `withMcpLogging`; a guard on the ingest route
For MCP tools, a `withAiQuota(gate, handler)` decorator wraps the metered handlers, composed INSIDE `withMcpLogging` (`withMcpLogging(name, withAiQuota(gate, handler), logger)`): it awaits `gate.check(Date.now())` and, if `!allowed`, returns `quotaExceededResult(decision)` WITHOUT calling the handler (no AI call). Because it is inside `withMcpLogging`, a refused call is still logged (`isError`, `records_returned = 0`). `registerThoughts` receives the gate and wraps `search_thoughts` + `capture_thought`. For the `ingest-note` HTTP route, `index.ts` checks the gate before `handleIngestNote` and, if denied, returns the `429` route result. **Deferred (documented boundary):** `write_document`/`update_document` and `update_thought`'s content path are AI-consuming but NOT metered in v1 — an explicit, logged scope boundary (README + this design), listed as follow-up; not a silent gap.

### D7 — Quota-exceeded is a distinct, user-visible state
`quotaExceededResult(decision)` builds `errorResult("AI quota exceeded: you've used {used} of {limit} AI operations this month. Your quota resets on {resetDate} UTC. No AI operation was performed.")`. `isError: true` ⇒ the MCP client sees an error, `withMcpLogging` logs it with `records_returned = 0` and `error_details` set. For `search_thoughts` specifically this is the whole point: an over-quota search returns a QUOTA error, never `textResult("No thoughts found …", { recordsReturned: 0 })` (which would read as "your brain is empty"). The HTTP `ingest-note` route returns `{ success: false, error: <same message> }` with status `429`.

## Risks / Trade-offs

- **[Metering by call-count, not tokens, is coarse]** → Accepted for v1 (the plan specifies `function_call_logs`, which is call-granularity). One metered call = one unit regardless of embedding-vs-completion cost. Documented; token metering is future work.
- **[Deferred surfaces (`write_document`/`update_document`/`update_thought`) are an unmetered AI path]** → A documented, logged cap boundary (D6), not silent. The dominant AI cost (conversational capture/search + bulk ingest) IS metered. Listed as explicit follow-up.
- **[Fail-open on a meter error lets AI through]** → Deliberate (D5): cost cap, not security. Logged loudly; degrades to pre-Step-15 behavior. Covered by ThreatModel T30.
- **[Concurrent metered calls could race past the cap by a few]** → The count + decision is not transactional with the logging insert, so a burst can slip a couple over the limit. Acceptable for a soft cost cap (not a hard security boundary); the overage is bounded by concurrency, and the next call re-reads the true count. Documented.
- **[UTC-month window vs. a customer's billing anchor]** → v1 uses the UTC calendar month for a deterministic, legible reset. Aligning the window to each customer's billing cycle is future work (needs the billing anchor from Step 14/16); documented.
- **[Metering adds a query to hot paths when enabled]** → One bounded head-count per metered call, index-backed; only when a limit is set (unset ⇒ no query). Acceptable.

## User-error scenarios

- **Operator sets `TB_AI_MONTHLY_LIMIT=0` or a non-number** → parsed as unset ⇒ **unlimited**, not "block everything" (a typo must never brick a customer's AI). Documented; if an operator truly wants to block AI they remove the shared key, not set a 0 quota.
- **A search runs while over quota** → a distinct quota-exceeded ERROR (never "No thoughts found"), so the user learns their quota is exhausted rather than believing their brain is empty (D7).
- **A capture runs while over quota** → refused before any AI call with the quota message; no thought is written, no embedding minted, the state is explicit.
- **Metering DB query fails transiently** → the operation is allowed (fail-open) and the error is logged; the user is not blocked by our infra hiccup (D5).
- **A brand-new project with an empty `function_call_logs`** → `used = 0`, everything allowed until the cap; empty telemetry is a valid zero, not an error.
- **Self-hoster never sets the var** → unlimited; zero behavior change, zero added query (D4).

## Security analysis (ThreatModel T30)

New surface: a cost-control quota read from `function_call_logs` and enforced in the edge function. It is a COST control, not an authorization control (auth remains the `x-tb-key` check). Threats & controls:
- **Cost-exhaustion abuse of the shared OpenRouter key** (the threat the step exists to mitigate) → per-tenant monthly cap on the dominant AI-consuming operations, refused before the AI call; bounded, index-backed usage query.
- **A metering outage silently disabling the cap** → fail-open is deliberate and LOGGED (D5); it degrades to the documented pre-Step-15 posture (no cap), never to a wrong result. Operators can alert on the logged error.
- **A quota mis-set to 0 bricking a customer's AI** → parse-at-boundary treats `≤ 0`/non-numeric as unset (unlimited), so a typo fails safe toward availability (D1).
- **Metering leaking usage detail** → the meter reads only `function_name` + `called_at` counts (no content, no ids); the quota message reports only aggregate `used`/`limit`/reset (no personal data).
- **Bypass via unmetered AI surfaces** (`write_document` etc.) → acknowledged, documented boundary (D6); not a security regression (those paths were unmetered before too), listed as follow-up.
This lands in `ThreatModel.md` as **T30**. It does not change the auth boundary (T2/T7) or any input-validation path.

## Test Strategy

The default suite runs with `TB_AI_MONTHLY_LIMIT` UNSET, so metering is OFF and the existing 675 backend tests are unaffected (the gate short-circuits). Enforcement is verified without a global env by constructing the REAL gate/meter/decorator in tests and driving REAL telemetry. Layers:
- **Unit (`tests/unit/`):** `parseAiMonthlyLimit` (positive int; unset/empty/`0`/negative/non-numeric ⇒ null); `startOfUtcMonthMs`/`startOfNextUtcMonthMs` (UTC boundaries, reset date); `AiQuotaGate.check` with a FAKE meter — null-limit short-circuits (meter NOT called), `used <= limit` boundary (allow at `used = limit`, deny at `used = limit+1`), fail-open on a throwing meter; `withAiQuota` decorator — over-quota returns `quotaExceededResult` and does NOT call the handler, under-quota calls it; `quotaExceededResult` shape (`isError: true`, message names used/limit/reset). No stack.
- **Integration (`tests/integration/managed-ai-metering.test.ts`, REAL Supabase, no mock on the metered path):** seed N `function_call_logs` rows (metered `function_name`s, `called_at` in the current UTC month) via the service client (the `log_retention.test.ts` seeding pattern); construct the REAL `SupabaseUsageMeter` + `AiQuotaGate` with `limit = N-1`/`N`/`N+1`; assert `countMeteredCallsSince` returns the true count and the gate denies/allows at the exact boundary; assert an out-of-window (previous-month `called_at`) row is NOT counted; assert non-metered `function_name`s are NOT counted; drive `withAiQuota(realGate, spyHandler)` and assert the handler is skipped when over quota and a quota `errorResult` is returned. This exercises the enforcement decision against real `function_call_logs` telemetry end-to-end (the mock-boundary rule: the fake is only the LLM, never the metered path).
- **GATE-2b mutation checks** (confirm non-vacuous): (1) make the gate ignore the limit (always allow) → the boundary integration test reddens; (2) drop the `.gte("called_at", …)` window filter → the out-of-window test reddens; (3) drop the `.in("function_name", …)` filter → the non-metered test reddens; (4) make `withAiQuota` call the handler even when denied → the decorator skip test reddens.
- **Full public gate:** `deno task test` (backend, `TB_AI_PROVIDER=fake`, `TB_AI_MONTHLY_LIMIT` unset) GREEN on a freshly `db reset` stack; `cd obsidian-plugin && npm test && npm run build`. Deno lint + fmt clean.
- **Every delta-spec scenario is tagged `test`** (deterministic) — metering has no LLM behavior; no `eval` tier.

## API contract

No new external API. The change is observable only as: (a) a new optional secret `TB_AI_MONTHLY_LIMIT` on the project; (b) when set and exhausted, AI-consuming MCP tools return an `errorResult` (`{ content:[{type:"text", text:"AI quota exceeded: …"}], isError:true }`) and the `ingest-note` HTTP route returns `429 { success:false, error:"AI quota exceeded: …" }`. Unset ⇒ identical to today. No change to the MCP tool schemas, the auth header, or the control plane.
