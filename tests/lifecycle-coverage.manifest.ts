// Coverage manifest for the lifecycle-rules verification harness (design D3).
//
// One entry per `#### Scenario:` in the two Step 5 delta specs
// (`openspec/specs/memory-lifecycle-rules` and `.../integration-sync-rules`).
// `tests/unit/lifecycle-coverage.test.ts` parses those specs and asserts a
// BIJECTION with this manifest — a new, renamed, or removed scenario without a
// matching manifest update fails the build. The manifest also drives the
// red→green burn-down count for Step 7 (and v1.5).
//
// `scenario` strings MUST match the spec headings exactly.

export type Tag = "test" | "eval";
export type Tier = "deterministic" | "eval" | "sync";
export type Milestone = "shipped" | "step7" | "v1.5";
export type Expectation = "pass-now" | "pending";

export interface CoverageEntry {
  capability: "memory-lifecycle-rules" | "integration-sync-rules";
  requirement: string;
  scenario: string;
  tag: Tag;
  tier: Tier;
  milestone: Milestone;
  expectation: Expectation;
  testRef: string;
}

export const COVERAGE_MANIFEST: CoverageEntry[] = [
  // ── memory-lifecycle-rules ────────────────────────────────────────────────
  // Requirement: Single mutation ruleset parameterized by actor
  {
    capability: "memory-lifecycle-rules",
    requirement: "Single mutation ruleset parameterized by actor",
    scenario: "Console edit flows through the same rules as an LLM edit",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/actor_model.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Single mutation ruleset parameterized by actor",
    scenario: "A consent-gated outcome renders per actor but is the same rule",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/actor_model.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Single mutation ruleset parameterized by actor",
    scenario: "No unauthorized direct-write surface exists",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/actor_model.test.ts",
  },
  // Requirement: Write-time deduplication gate
  {
    capability: "memory-lifecycle-rules",
    requirement: "Write-time deduplication gate",
    scenario: "Byte-identical capture is blocked",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/dedup_gate.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Write-time deduplication gate",
    scenario:
      "Within-note restatement on ingest is dropped in favor of the existing thought",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/dedup_gate.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Write-time deduplication gate",
    scenario:
      "Cross-context near-duplicate is preserved as a supersession candidate, not silently dropped",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/dedup_gate.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Write-time deduplication gate",
    scenario: "Distinct content well outside the band is written normally",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/dedup_gate.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Write-time deduplication gate",
    scenario: "Model picks keep-vs-merge correctly at the margin",
    tag: "eval",
    tier: "eval",
    milestone: "step7",
    expectation: "pending",
    testRef: "tests/eval/memory_evals.test.ts",
  },
  // Requirement: Extraction type is parsed against an allowlist
  {
    capability: "memory-lifecycle-rules",
    requirement: "Extraction type is parsed against an allowlist",
    scenario: "An allowed type is stored as-is",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/extraction_type_allowlist.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Extraction type is parsed against an allowlist",
    scenario: "An out-of-allowlist type is coerced to the fallback and logged",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/extraction_type_allowlist.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Extraction type is parsed against an allowlist",
    scenario:
      "Missing or unparseable metadata degrades to the documented fallback",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/extraction_type_allowlist.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Extraction type is parsed against an allowlist",
    scenario: "Model assigns the right type to ambiguous content",
    tag: "eval",
    tier: "eval",
    milestone: "step7",
    expectation: "pending",
    testRef: "tests/eval/memory_evals.test.ts",
  },
  // Requirement: Contradiction handling by supersession, not deletion
  {
    capability: "memory-lifecycle-rules",
    requirement: "Contradiction handling by supersession, not deletion",
    scenario:
      "A recorded supersession removes the older thought from default search",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/supersession.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Contradiction handling by supersession, not deletion",
    scenario: "Supersession never deletes history",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/supersession.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Contradiction handling by supersession, not deletion",
    scenario: "Recording a supersession re-embeds the surviving content",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/supersession.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Contradiction handling by supersession, not deletion",
    scenario: "Model detects a genuine contradiction",
    tag: "eval",
    tier: "eval",
    milestone: "step7",
    expectation: "pending",
    testRef: "tests/eval/memory_evals.test.ts",
  },
  // Requirement: Usefulness reinforcement with rubber-stamp down-weighting
  {
    capability: "memory-lifecycle-rules",
    requirement: "Usefulness reinforcement with rubber-stamp down-weighting",
    scenario: "A selective record increments more than a rubber-stamp",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/usefulness_reinforcement.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Usefulness reinforcement with rubber-stamp down-weighting",
    scenario: "get_thought_by_id auto-records server-side",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/usefulness_reinforcement.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Usefulness reinforcement with rubber-stamp down-weighting",
    scenario: "User and sync edits do not reinforce usefulness",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/usefulness_reinforcement.test.ts",
  },
  // Requirement: Temporal validity and staleness decay signal
  {
    capability: "memory-lifecycle-rules",
    requirement: "Temporal validity and staleness decay signal",
    scenario: "Retrieval updates the recency signal",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/temporal_staleness.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Temporal validity and staleness decay signal",
    scenario: "Score-zero alone never marks a thought stale",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/temporal_staleness.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Temporal validity and staleness decay signal",
    scenario: "Stale-review queue is exposed via a tool",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/temporal_staleness.test.ts",
  },
  // Requirement: Archival is multi-signal and human-queued
  {
    capability: "memory-lifecycle-rules",
    requirement: "Archival is multi-signal and human-queued",
    scenario: "The archival conjunction gates the queue",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/archival.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Archival is multi-signal and human-queued",
    scenario: "A synced-note-owned thought is never auto-queued for archival",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/archival.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Archival is multi-signal and human-queued",
    scenario: "Archiving a queued item is a consented state transition",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/archival.test.ts",
  },
  // Requirement: Task reconciliation is consent-based
  {
    capability: "memory-lifecycle-rules",
    requirement: "Task reconciliation is consent-based",
    scenario: "Reconciliation asks before closing",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/task_reconciliation.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Task reconciliation is consent-based",
    scenario: "Declining leaves the task open",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/task_reconciliation.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Task reconciliation is consent-based",
    scenario: "Sweep identifies done-looking tasks accurately",
    tag: "eval",
    tier: "eval",
    milestone: "step7",
    expectation: "pending",
    testRef: "tests/eval/memory_evals.test.ts",
  },
  // Requirement: Every content edit re-embeds and re-hashes (INVARIANT 1)
  {
    capability: "memory-lifecycle-rules",
    requirement: "Every content edit re-embeds and re-hashes (INVARIANT 1)",
    scenario: "Edited content is found by its new wording",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/invariant1_reembed_rehash.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Every content edit re-embeds and re-hashes (INVARIANT 1)",
    scenario: "Stored hash equals the hash of the new content",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/invariant1_reembed_rehash.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Every content edit re-embeds and re-hashes (INVARIANT 1)",
    scenario:
      "The guarantee holds for projects, tasks, and documents, not only thoughts",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/invariant1_reembed_rehash.test.ts",
  },
  {
    capability: "memory-lifecycle-rules",
    requirement: "Every content edit re-embeds and re-hashes (INVARIANT 1)",
    scenario: "Emptying content is a valid edit, still re-hashed",
    tag: "test",
    tier: "deterministic",
    milestone: "shipped",
    expectation: "pass-now",
    testRef: "tests/integration/lifecycle/invariant1_reembed_rehash.test.ts",
  },

  // ── integration-sync-rules (all v1.5, seam-gated) ─────────────────────────
  // Requirement: PMS-to-TB ingest maps native status, never board columns
  {
    capability: "integration-sync-rules",
    requirement: "PMS-to-TB ingest maps native status, never board columns",
    scenario: "New PMS item creates a TB task with an external ref",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/pms_ingest.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "PMS-to-TB ingest maps native status, never board columns",
    scenario: "Native status category is used, not board columns",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/pms_ingest.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "PMS-to-TB ingest maps native status, never board columns",
    scenario: "Upstream completion of a known task marks it done",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/pms_ingest.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "PMS-to-TB ingest maps native status, never board columns",
    scenario: "Upstream completion of an unknown item is ignored",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/pms_ingest.test.ts",
  },
  // Requirement: One owner per task; PMS owns status for PMS-origin tasks
  {
    capability: "integration-sync-rules",
    requirement: "One owner per task; PMS owns status for PMS-origin tasks",
    scenario: "PMS-origin task status follows upstream",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/status_ownership.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "One owner per task; PMS owns status for PMS-origin tasks",
    scenario: "Locally-born task is fully TB-owned",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/status_ownership.test.ts",
  },
  // Requirement: No autonomous push to the PMS
  {
    capability: "integration-sync-rules",
    requirement: "No autonomous push to the PMS",
    scenario: "TB never writes upstream unprompted",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/status_ownership.test.ts",
  },
  // Requirement: Consented close (TB to PMS)
  {
    capability: "integration-sync-rules",
    requirement: "Consented close (TB to PMS)",
    scenario: "Consent yes closes both on success",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/consented_close.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "Consented close (TB to PMS)",
    scenario: "Upstream failure keeps the TB task open",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/consented_close.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "Consented close (TB to PMS)",
    scenario: "Decline keeps the TB task open",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/consented_close.test.ts",
  },
  // Requirement: Ask-first creation (TB to PMS)
  {
    capability: "integration-sync-rules",
    requirement: "Ask-first creation (TB to PMS)",
    scenario: "Conversation-born task offered to the PMS",
    tag: "eval",
    tier: "eval",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/eval/sync_evals.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "Ask-first creation (TB to PMS)",
    scenario: "Only consent triggers upstream creation",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/consented_close.test.ts",
  },
  // Requirement: Webhook ingest is idempotent under at-least-once delivery
  {
    capability: "integration-sync-rules",
    requirement: "Webhook ingest is idempotent under at-least-once delivery",
    scenario: "Duplicate delivery does not double-ingest",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/webhook_idempotency.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "Webhook ingest is idempotent under at-least-once delivery",
    scenario: "Trivial-edit event below the change gate is ignored",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/webhook_idempotency.test.ts",
  },
  {
    capability: "integration-sync-rules",
    requirement: "Webhook ingest is idempotent under at-least-once delivery",
    scenario: "Reconciliation sweep recovers a missed event",
    tag: "test",
    tier: "sync",
    milestone: "v1.5",
    expectation: "pending",
    testRef: "tests/sync-rules/webhook_idempotency.test.ts",
  },
];

/** Burn-down summary for the harness (design D3). */
export function burnDown(entries: CoverageEntry[] = COVERAGE_MANIFEST): {
  passNow: number;
  pendingStep7: number;
  pendingV15: number;
  total: number;
} {
  return {
    passNow: entries.filter((entry) => entry.expectation === "pass-now").length,
    pendingStep7:
      entries.filter((entry) =>
        entry.expectation === "pending" && entry.milestone === "step7"
      ).length,
    pendingV15:
      entries.filter((entry) =>
        entry.expectation === "pending" && entry.milestone === "v1.5"
      ).length,
    total: entries.length,
  };
}
