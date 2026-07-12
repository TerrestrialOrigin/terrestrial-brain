// Red-by-design markers for the lifecycle harness (design D2).
//
// Most `test`-tagged scenarios describe Step 7 (or v1.5) behavior that does not
// exist yet, so their tests FAIL on purpose. To keep a red suite meaningful
// rather than noise, every such test:
//   1. names its missing feature in the test title via `pendingName(...)`, and
//   2. carries the same documented reason in its decisive assertion message via
//      `pending(...)`.
// A red-by-design failure therefore always reads as `PENDING(<milestone>:<slug>)
// <detail>` — trivially distinguishable from a crash, a wrong route, or a typo.
//
// This file introduces NO skips. Pending scenarios are real failing assertions,
// never `.skip` / `ignore: true` (Absolute Testing Rules).

export type Milestone = "step7" | "v1.5";

/** The reason string for a red-by-design assertion message. */
export function pending(
  milestone: Milestone,
  slug: string,
  detail: string,
): string {
  return `PENDING(${milestone}:${slug}) ${detail}`;
}

/** A test name that advertises the feature it is waiting on. */
export function pendingName(
  base: string,
  milestone: Milestone,
  slug: string,
): string {
  return `${base} [PENDING(${milestone}:${slug})]`;
}
