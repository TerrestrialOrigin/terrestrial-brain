// Shared numeric limits for MCP tool input schemas. Centralized so the hard cap
// and default page sizes are named once instead of repeated as bare literals
// across the tool files.

/** Hard upper bound on any list/search `limit` parameter. */
export const MAX_QUERY_LIMIT = 100;

/** Default page size for the `list_thoughts` / `search_thoughts` tools. */
export const DEFAULT_THOUGHT_LIMIT = 10;

/** Default page size for the `list_tasks` / `list_documents` tools. */
export const DEFAULT_LIST_LIMIT = 20;
