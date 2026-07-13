// Managed-AI usage meter (Step 15, managed-ai-metering, design D3).
//
// Reads the deployment's AI-consuming usage from the EXISTING function_call_logs
// telemetry with a single bounded head-count query — never loading rows — over
// the `(function_name, called_at)` index. Behind a narrow seam so the quota gate
// runs in tests against a deterministic fake, and so the metered-function set is
// injected (the composition root passes AI_METERED_FUNCTIONS; a test passes a
// unique marker set to count deterministically without cross-test pollution).

import { SupabaseClient } from "@supabase/supabase-js";

export interface UsageMeter {
  /**
   * Count metered AI-consuming calls with `called_at >= sinceMs`. Throws on a
   * query failure so the caller (the quota gate) can decide its failure policy
   * (fail-open) rather than silently seeing a wrong zero.
   */
  countMeteredCallsSince(sinceMs: number): Promise<number>;
}

export class SupabaseUsageMeter implements UsageMeter {
  constructor(
    private readonly supabase: SupabaseClient,
    private readonly meteredFunctions: readonly string[],
  ) {}

  async countMeteredCallsSince(sinceMs: number): Promise<number> {
    const iso = new Date(sinceMs).toISOString();
    const { count, error } = await this.supabase
      .from("function_call_logs")
      .select("*", { count: "exact", head: true })
      .in("function_name", [...this.meteredFunctions])
      .gte("called_at", iso);
    if (error) {
      throw new Error(`usage count query failed: ${error.message}`);
    }
    return count ?? 0;
  }
}
