// Parse-at-boundary metering configuration (Step 15, managed-ai-metering).
//
// Pure helpers for the managed-AI monthly quota — no `Deno.env` access, so every
// branch is exhaustively unit-testable without a running stack (the
// `security-config.ts` idiom). `index.ts` reads the environment once at the
// composition root and passes the parsed values in.

/**
 * The AI-consuming operations metered by the monthly quota (design D2). This ONE
 * definition is shared by the usage meter's count query and the set of handlers
 * the quota wraps, so the operations counted are exactly the operations enforced.
 * `search_thoughts` / `capture_thought` are MCP tool names; `ingest-note` is the
 * HTTP route's log name. (Documented boundary: `write_document`/`update_document`
 * and `update_thought`'s conditional content path are AI-consuming but NOT
 * metered in v1 — see design D6.)
 */
export const AI_METERED_FUNCTIONS = [
  "search_thoughts",
  "capture_thought",
  "ingest-note",
] as const;

/**
 * Parse `TB_AI_MONTHLY_LIMIT` into a strictly-positive integer, or `null` for
 * "unlimited". Unset, empty, non-numeric, fractional, and non-positive all
 * resolve to `null` — the safe default: a misconfiguration (or a self-hoster who
 * never sets it) means unlimited, never "block all AI" (parse, don't cast).
 */
export function parseAiMonthlyLimit(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Start of the current UTC calendar month, in epoch ms (the quota window start). */
export function startOfUtcMonthMs(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

/** Start of the NEXT UTC calendar month, in epoch ms (when the quota resets). */
export function startOfNextUtcMonthMs(nowMs: number): number {
  const now = new Date(nowMs);
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
}
