// Managed-AI quota gate + enforcement helpers (Step 15, managed-ai-metering,
// design D4–D7). The gate decides whether an AI-consuming operation may proceed
// this UTC-month window; the decorator enforces it at the MCP boundary, refusing
// an over-quota operation BEFORE any AI call with a distinct, user-visible state.

import { errorResult, type McpToolResult } from "./mcp-response.ts";
import type { UsageMeter } from "./usage-meter.ts";
import { startOfNextUtcMonthMs, startOfUtcMonthMs } from "./metering-config.ts";

export interface QuotaDecision {
  readonly allowed: boolean;
  /** The configured limit, or null when unlimited. */
  readonly limit: number | null;
  /** Metered calls counted this window (0 when unlimited or on a meter failure). */
  readonly used: number;
  /** Epoch ms at which the window resets (start of next UTC month). */
  readonly resetAtMs: number;
}

export class AiQuotaGate {
  constructor(
    private readonly limit: number | null,
    private readonly meter: UsageMeter,
  ) {}

  /**
   * Decide whether a metered operation may proceed. When unlimited, allows
   * WITHOUT querying (zero overhead for self-host). Otherwise counts usage this
   * UTC-month window and allows while `used <= limit` — the gate is invoked after
   * the current call is logged, so `used` includes it and exactly `limit` metered
   * calls are permitted per window. A meter failure FAILS OPEN (design D5): the
   * quota is best-effort cost control, not a security boundary, so a transient
   * telemetry error must not block a legitimate operation — it is logged and
   * allowed, degrading to the pre-Step-15 (uncapped) behavior, never to a wrong
   * block or empty result.
   */
  async check(nowMs: number): Promise<QuotaDecision> {
    const resetAtMs = startOfNextUtcMonthMs(nowMs);
    if (this.limit === null) {
      return { allowed: true, limit: null, used: 0, resetAtMs };
    }
    try {
      const used = await this.meter.countMeteredCallsSince(
        startOfUtcMonthMs(nowMs),
      );
      return {
        allowed: used <= this.limit,
        limit: this.limit,
        used,
        resetAtMs,
      };
    } catch (error) {
      console.error(
        `AI quota meter failed, allowing (fail-open): ${
          (error as Error).message
        }`,
      );
      return { allowed: true, limit: this.limit, used: 0, resetAtMs };
    }
  }
}

/** The distinct, user-visible quota-exceeded message (design D7). Shared by the
 * MCP result and the HTTP `ingest-note` route so both read identically. Carries
 * only aggregate usage/limit/reset — no note or thought content. */
export function quotaExceededMessage(decision: QuotaDecision): string {
  const resetDate = new Date(decision.resetAtMs).toISOString().slice(0, 10);
  return `AI quota exceeded: you've used ${decision.used} of ${decision.limit} ` +
    `AI operations this month. Your quota resets on ${resetDate} UTC. ` +
    `No AI operation was performed.`;
}

/** Build the distinct, user-visible quota-exceeded MCP result (design D7). */
export function quotaExceededResult(decision: QuotaDecision): McpToolResult {
  return errorResult(quotaExceededMessage(decision));
}

/**
 * Wrap an AI-consuming MCP handler with a quota check (design D6). Composed
 * INSIDE `withMcpLogging` so a refused call is still logged (isError,
 * records_returned=0). When over quota, returns the quota-exceeded result WITHOUT
 * calling the handler — no embedding, no completion, no write.
 */
export function withAiQuota<Args extends unknown[]>(
  gate: AiQuotaGate,
  handler: (...args: Args) => Promise<McpToolResult>,
): (...args: Args) => Promise<McpToolResult> {
  return async (...args: Args): Promise<McpToolResult> => {
    const decision = await gate.check(Date.now());
    if (!decision.allowed) return quotaExceededResult(decision);
    return handler(...args);
  };
}
