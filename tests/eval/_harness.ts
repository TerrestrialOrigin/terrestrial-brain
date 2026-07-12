// Scored, thresholded eval harness for the `eval`-tagged lifecycle scenarios
// (design D7).
//
// Unlike the deterministic tier, LLM-judgment scenarios (contradiction
// detection, ambiguous-type choice, near-dup keep/merge at the margin,
// reconciliation identification, ask-first phrasing) cannot be asserted
// exactly. Each is a labeled fixture set scored into a pass-rate that must meet
// a documented threshold. The tier is OPT-IN (`deno task test:eval`), uses the
// real provider, and is fail-loud without a key — never a silent skip.

import { assert } from "@std/assert";

/** The default eval pass-rate threshold (documented; per-scenario overridable). */
export const DEFAULT_EVAL_THRESHOLD = 0.8;

export interface EvalCase<Input> {
  label: string;
  input: Input;
}

export interface ScoreResult {
  rate: number;
  passed: number;
  total: number;
  failures: string[];
}

/**
 * Fail loudly if no real-LLM key is present. Mirrors the live tier's contract:
 * a keyless eval run is an obvious failure, not a green-looking skip.
 */
export function assertOpenRouterKey(): void {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key || key.length === 0) {
    throw new Error(
      "OPENROUTER_API_KEY is required for the eval tier (deno task test:eval). " +
        "This is not a skip: the eval tier scores real model behavior.",
    );
  }
}

/**
 * Run each case through `runCase` (true = the model met the labeled
 * expectation) and compute the pass-rate. Pure over `runCase`, so the scoring
 * itself is unit-testable with a synthetic `runCase` (no key needed).
 */
export async function scoreCases<Input>(
  cases: EvalCase<Input>[],
  runCase: (input: Input) => Promise<boolean>,
): Promise<ScoreResult> {
  let passed = 0;
  const failures: string[] = [];
  for (const testCase of cases) {
    let ok = false;
    try {
      ok = await runCase(testCase.input);
    } catch (error) {
      failures.push(`${testCase.label}: ${(error as Error).message}`);
      continue;
    }
    if (ok) passed += 1;
    else failures.push(testCase.label);
  }
  const total = cases.length;
  return { rate: total === 0 ? 0 : passed / total, passed, total, failures };
}

/** Assert a computed pass-rate meets the threshold, naming the failures. */
export function assertThreshold(
  name: string,
  result: ScoreResult,
  threshold: number,
): void {
  assert(
    result.rate >= threshold,
    `${name}: pass-rate ${result.passed}/${result.total} = ` +
      `${result.rate.toFixed(2)} < threshold ${threshold}. ` +
      `Failures: ${result.failures.join("; ")}`,
  );
}

/**
 * The full opt-in path: require a key, score the cases, assert the threshold.
 */
export async function scoreScenario<Input>(
  name: string,
  cases: EvalCase<Input>[],
  runCase: (input: Input) => Promise<boolean>,
  threshold: number = DEFAULT_EVAL_THRESHOLD,
): Promise<void> {
  assertOpenRouterKey();
  const result = await scoreCases(cases, runCase);
  assertThreshold(name, result, threshold);
}
