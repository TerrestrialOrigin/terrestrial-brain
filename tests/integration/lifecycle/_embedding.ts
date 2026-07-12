// Embedding-distance utilities for the lifecycle dedup tests.
//
// The dedup gate (Step 7) uses a tight cosine-distance band (0.05–0.10). These
// tests must prove their fixtures actually fall in the intended range BEFORE
// asserting the dedup rule, so a fixture that drifts out of band fails its own
// precondition instead of silently invalidating the rule under test (design D4).
//
// We compute distances from the SAME production `FakeAiProvider` the running
// edge function uses under `TB_AI_PROVIDER=fake`, so the numbers the test sees
// are the numbers the server will see.

import { assert } from "@std/assert";
import { FakeAiProvider } from "../../../supabase/functions/terrestrial-brain-mcp/ai/fake-provider.ts";

/** The dedup band, in cosine distance, from the Step 5 design (D2). */
export const DEDUP_BAND = { min: 0.05, max: 0.10 } as const;

/** Distance comfortably outside the band that counts as "distinct" (design D2). */
export const DISTINCT_MIN_DISTANCE = 0.15;

const fakeProvider = new FakeAiProvider();

/** Cosine similarity of two equal-length vectors (unit vectors → dot product). */
function cosineSimilarity(vectorA: number[], vectorB: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < vectorA.length; index++) {
    const componentA = vectorA[index] ?? 0;
    const componentB = vectorB[index] ?? 0;
    dot += componentA * componentB;
    normA += componentA * componentA;
    normB += componentB * componentB;
  }
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  return magnitude === 0 ? 0 : dot / magnitude;
}

/** Cosine DISTANCE (1 − similarity) between two texts under the fake embedding. */
export async function embedDistance(
  textA: string,
  textB: string,
): Promise<number> {
  const [vectorA, vectorB] = await Promise.all([
    fakeProvider.getEmbedding(textA),
    fakeProvider.getEmbedding(textB),
  ]);
  return 1 - cosineSimilarity(vectorA, vectorB);
}

/** Assert two texts sit inside the dedup band (a genuine near/exact duplicate). */
export async function assertInDedupBand(
  textA: string,
  textB: string,
): Promise<void> {
  const distance = await embedDistance(textA, textB);
  assert(
    distance <= DEDUP_BAND.max,
    `fixture precondition: expected cosine distance <= ${DEDUP_BAND.max} ` +
      `(inside dedup band), got ${distance.toFixed(4)}`,
  );
}

/** Assert two texts sit well outside the dedup band (genuinely distinct). */
export async function assertOutsideDedupBand(
  textA: string,
  textB: string,
): Promise<void> {
  const distance = await embedDistance(textA, textB);
  assert(
    distance >= DISTINCT_MIN_DISTANCE,
    `fixture precondition: expected cosine distance >= ${DISTINCT_MIN_DISTANCE} ` +
      `(outside dedup band), got ${distance.toFixed(4)}`,
  );
}
