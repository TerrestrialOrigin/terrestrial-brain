import { z } from "zod";

/**
 * Lenient UUID-format field for tool input validation (Step 24, finding 6.3).
 *
 * Matches any canonical 8-4-4-4-12 hex UUID, case-insensitive, WITHOUT
 * enforcing the RFC 4122 version/variant nibbles. Postgres `gen_random_uuid()`
 * produces v4 values, but hand-authored fixtures and legacy ids
 * (e.g. `00000000-0000-0000-0000-000000000002`) are valid identifiers that
 * strict v4 validation would wrongly reject. The goal here is to reject
 * genuinely malformed ids (e.g. `"not-a-uuid"`), not to police UUID versions,
 * so a hallucinated non-UUID cannot reach the database.
 */
const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function uuidField(): z.ZodString {
  return z.string().regex(UUID_PATTERN, "must be a valid UUID");
}

/**
 * Due-date boundary field (TOOL-15): a full ISO 8601 datetime (offset or Z
 * allowed) or a plain ISO date. Rejects hallucinated values like
 * "next Tuesday" at the door with a clear message instead of letting them
 * fail deep in Postgres as a cryptic timestamptz parse error.
 */
export function dueByField() {
  return z.union(
    [z.iso.datetime({ offset: true }), z.iso.date()],
    "must be an ISO 8601 datetime (e.g. 2026-08-01T12:00:00+02:00) or date (2026-08-01)",
  );
}

/** Email boundary field (TOOL-15): validated format, so junk is never stored. */
export function emailField() {
  return z.email("must be a valid email address");
}
