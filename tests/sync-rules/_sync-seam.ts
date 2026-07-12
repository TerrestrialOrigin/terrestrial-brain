// The single v1.5 connector seam for the integration-sync-rules tests (design D6).
//
// The PMS connectors are a v1.5 horizon: no ingest tool, webhook route, or
// external-ref surface exists today, and none is built in Step 7. Rather than
// gate the default suite on scenarios that cannot go green for many releases,
// every sync test routes its actor-invocation through `syncConnector`, which
// currently raises a single documented `PENDING(v1.5:connectors-unimplemented)`
// error. The GIVEN/WHEN/THEN is fully encoded (fixtures + assertions); only the
// actor-invocation is parked here. When v1.5 wires this seam to the real
// connector, the whole tier flips red→green at one point.
//
// These tests run OPT-IN via `deno task test:sync-rules` and are NEVER skipped.

export const SYNC_PENDING_REASON =
  "PENDING(v1.5:connectors-unimplemented) integration-sync connectors are a v1.5 " +
  "horizon; this seam is wired to the real PMS connector at connector time";

export interface SyncConnector {
  /** Ingest a PMS item (create/update the mapped TB task). */
  ingestItem(item: Record<string, unknown>): Promise<Record<string, unknown>>;
  /** Deliver a webhook event (at-least-once). */
  deliverWebhook(
    event: Record<string, unknown>,
  ): Promise<Record<string, unknown>>;
  /** Attempt a consented upstream close of a PMS-origin task. */
  closeUpstream(
    taskId: string,
    consent: boolean,
  ): Promise<Record<string, unknown>>;
  /** Attempt a consented upstream create for a conversation-born task. */
  createUpstream(
    taskId: string,
    consent: boolean,
  ): Promise<Record<string, unknown>>;
  /** Run the low-frequency reconciliation sweep. */
  reconcileSweep(): Promise<Record<string, unknown>>;
}

/**
 * Returns the connector under test. Until v1.5, every method raises the single
 * documented pending reason, so each sync scenario fails red-by-design in a
 * uniform, honest way.
 */
export function syncConnector(): SyncConnector {
  const unimplemented = (): Promise<never> =>
    Promise.reject(new Error(SYNC_PENDING_REASON));
  return {
    ingestItem: unimplemented,
    deliverWebhook: unimplemented,
    closeUpstream: unimplemented,
    createUpstream: unimplemented,
    reconcileSweep: unimplemented,
  };
}
