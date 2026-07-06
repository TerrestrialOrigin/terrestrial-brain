/**
 * Canonical allowlists for the closed-set (enum-valued) tool parameters.
 *
 * These are the single source of truth used to build the Zod `z.enum(...)`
 * schemas at the tool boundary, so an out-of-domain value is rejected before it
 * reaches Postgres (findings 6.3).
 *
 * Enforcement provenance:
 * - TASK_STATUSES  — enforced in the DB by `tasks_status_check`
 *   (migration 20260321000002_tasks.sql).
 * - PERSON_TYPES   — enforced in the DB by the `people.type` CHECK
 *   (migration 20260324000001_people.sql).
 * - THOUGHT_TYPES  — edge-only allowlist. `thoughts.type` lives in the
 *   `metadata` JSONB with no DB CHECK; these are the canonical values the
 *   extraction pipeline produces and the tool descriptions document.
 * - PROJECT_TYPES  — edge-only allowlist. `projects.type` is a free `text`
 *   column (only documented by a comment in 20260321000001_projects.sql).
 * - RELIABILITIES  — edge-only allowlist. `thoughts.reliability` is a free
 *   `text` column; these are the two values the pipeline writes
 *   (see backfill in 20260331000001_thoughts_reliability_author.sql).
 */

export const TASK_STATUSES = [
  "open",
  "in_progress",
  "done",
  "deferred",
] as const;

export const THOUGHT_TYPES = [
  "observation",
  "task",
  "idea",
  "reference",
  "person_note",
] as const;

export const PROJECT_TYPES = [
  "client",
  "personal",
  "research",
  "internal",
] as const;

export const PERSON_TYPES = ["human", "ai"] as const;

export const RELIABILITIES = ["reliable", "less reliable"] as const;
