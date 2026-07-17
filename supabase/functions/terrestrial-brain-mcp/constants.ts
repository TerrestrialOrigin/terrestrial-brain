// Shared numeric limits for MCP tool input schemas. Centralized so the hard cap
// and default page sizes are named once instead of repeated as bare literals
// across the tool files.

/** Hard upper bound on any list/search `limit` parameter. */
export const MAX_QUERY_LIMIT = 100;

/** Default page size for the `list_thoughts` / `search_thoughts` tools. */
export const DEFAULT_THOUGHT_LIMIT = 10;

/** Default page size for the `list_tasks` / `list_documents` tools. */
export const DEFAULT_LIST_LIMIT = 20;

// The `list_open_tasks_by_project` tool is a whole-brain aggregate — one call
// meant to surface every incomplete task across ALL projects, not a single
// project's page — so it is intentionally allowed a higher cap than
// MAX_QUERY_LIMIT. It stays explicitly bounded: past the cap the response
// reports truncation and the truncation is logged (never a silent fetch-all).

/** Default cap for `list_open_tasks_by_project`. */
export const DEFAULT_GROUPED_TASK_LIMIT = 500;

/** Hard upper bound for `list_open_tasks_by_project`. */
export const MAX_GROUPED_TASK_LIMIT = 1000;

/** Per-section cap for each `get_recent_activity` sub-query. Past this the
 * section heading shows a `(<limit>+)` truncation marker (never a silent cut). */
export const RECENT_ACTIVITY_SECTION_LIMIT = 50;

/** Hard cap on the extractor-seed `listActive` reads. The seed is whole-set by
 * design, but stays explicitly bounded and logs a warning if the cap is hit. */
export const LIST_ACTIVE_HARD_CAP = 1000;

/** Default/`max_rows` bound for pending AI-output metadata reads, replacing the
 * silent PostgREST 1000-row truncation. */
export const PENDING_METADATA_LIMIT = 200;

/** Schema maximum for `get_recent_activity`'s `days` window, so a huge window
 * cannot defeat the per-section caps by widening the `since` filter. */
export const MAX_RECENT_ACTIVITY_DAYS = 366;

/** Max open tasks surfaced by `reconcile_tasks`. Past this the response reports
 * truncation and asks the caller to narrow by project (never a silent cut). */
export const RECONCILE_TASK_LIMIT = 100;
