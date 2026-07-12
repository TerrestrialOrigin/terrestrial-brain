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
