## Context

The `thoughts` table is the core data store for Terrestrial Brain. All thoughts are currently created by two paths:

1. **`ingest_note`** — called by the Obsidian plugin via MCP JSON-RPC. Splits a full note into discrete thoughts using GPT-4o-mini. Content is paraphrased/atomized by the cheap AI, so it's lossy.
2. **`capture_thought`** — called by AI clients via MCP. Content is stored verbatim; only metadata extraction uses GPT-4o-mini.

Both paths insert into the same table with no distinction of provenance. A companion task (ID `5fc514a5`) will later enhance `capture_thought` to set `reliability = 'reliable'` and accept an `author` parameter — this change lays the groundwork by adding the columns and handling the `ingest_note` (lossy) path.

The Obsidian plugin currently calls `ingest_note` through MCP's JSON-RPC protocol (`tools/call` method). De-registering the tool from MCP breaks the plugin unless we provide an alternative HTTP endpoint.

## Goals / Non-Goals

**Goals:**
- Add `reliability` and `author` columns to `thoughts` with backfill
- De-register `ingest_note` from MCP so AI callers cannot invoke it
- Expose `ingest_note` as a direct HTTP route on the existing Hono app
- Update the Obsidian plugin to call the new HTTP route instead of MCP
- Set `reliability = 'less reliable'` and `author = 'gpt-4o-mini'` on all thoughts created by `ingest_note`

**Non-Goals:**
- Modifying `capture_thought` (handled by companion task `5fc514a5`)
- Changing the `ingest_note` logic itself (splitting, reconciliation, snapshots all stay the same)
- Adding `reliability`/`author` filtering to `list_thoughts`, `search_thoughts`, or `thought_stats`
- Changing the Slack `ingest-thought` edge function (it uses `capture_thought`, not `ingest_note`)

## Decisions

### 1. Direct Hono route on the existing edge function vs. separate edge function

**Decision:** Add a `POST /ingest-note` route on the existing `terrestrial-brain-mcp` Hono app.

**Why:** The `ingest_note` logic already lives in this edge function and depends on its helpers (`getEmbedding`, `extractMetadata`, `freshIngest`), extractors, and the shared Supabase client. Creating a separate edge function would mean duplicating all those imports or extracting a shared library — unnecessary complexity for what is fundamentally a routing change. The Hono app already has auth middleware that we can reuse.

**Alternative considered:** A new `supabase/functions/ingest-note/` edge function. Rejected because of import duplication and deployment overhead.

### 2. Refactor ingest_note logic into a standalone function

**Decision:** Extract the `ingest_note` handler body into a standalone async function `handleIngestNote(supabase, { content, title, note_id })` in `tools/thoughts.ts` (or a new `ingest-note-handler.ts` file). The Hono route calls this function directly. The MCP registration is removed.

**Why:** The current implementation is a closure inside `server.registerTool(...)`. We need the same logic callable from a plain Hono route handler. Extracting it makes the code testable and reusable without MCP coupling.

### 3. Plugin HTTP call format

**Decision:** The plugin will call `POST /ingest-note` with a plain JSON body `{ content, title, note_id }` and the same `x-brain-key` header. The response will be plain JSON `{ success: true, message: "..." }` or `{ success: false, error: "..." }`.

**Why:** The plugin currently wraps everything in JSON-RPC 2.0 format and then unwraps the response. A direct HTTP endpoint removes this unnecessary ceremony. The plugin's existing `callMCP` method is unchanged — only `processNote` switches to the new `callIngestNote` method for this one call. All other plugin-to-MCP calls (AI output, etc.) continue using `callMCP`.

### 4. Auth on the new route

**Decision:** Use the same `x-brain-key` header check. The Hono app already has a wildcard handler that checks this. We'll add a route-specific handler for `/ingest-note` that runs *before* the MCP wildcard, reusing the same auth pattern.

**Why:** Consistency with existing auth. The key is already configured in both the server and the plugin.

### 5. Route dispatch inside the wildcard handler

**Decision:** Check `url.pathname.endsWith("/ingest-note")` inside the single `app.all("*", ...)` handler rather than registering a separate `app.post("/ingest-note", ...)` route.

**Why:** Supabase Edge Functions do not pass URL subpaths to Hono's router — all requests arrive at `/` regardless of the actual URL path. A dedicated `app.post("/ingest-note")` route never matches; the MCP wildcard catches everything and returns 406 because the ingest call doesn't send `Accept: text/event-stream`. Checking the raw `url.pathname` inside the wildcard handler works reliably.

### 6. Plugin endpoint URL handling

**Decision:** Derive the `/ingest-note` URL from the existing `tbEndpointUrl` setting. The plugin already stores the full MCP endpoint URL (e.g., `https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=...`). For the ingest call, the plugin will construct the URL by replacing the path with `/functions/v1/terrestrial-brain-mcp/ingest-note` and keeping the `?key=` query parameter, OR more simply, by appending `/ingest-note` to the base URL (before the query string).

Actually, the simpler approach: since the auth middleware already reads the `x-brain-key` header, and the plugin's `callMCP` already sends this header extracted from the URL, we should instead have the plugin parse the base URL and key from `tbEndpointUrl` once. But that's over-engineering for this change.

**Revised decision:** The plugin will construct the ingest URL from the existing `tbEndpointUrl` by inserting `/ingest-note` before the query string. Example: if `tbEndpointUrl` is `https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc`, the ingest URL becomes `https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp/ingest-note?key=abc`. The server auth middleware already handles `?key=` as an alternative to the header, so this works without changes.

### 7. Backfill strategy

**Decision:** Include the backfill in the same migration file as the column additions, using a single `UPDATE thoughts SET reliability = 'less reliable', author = 'gpt-4o-mini' WHERE reliability IS NULL`.

**Why:** The table is small enough (hundreds to low thousands of rows) that an inline backfill is fine. No need for a separate script or batched migration.

### 8. Column constraints

**Decision:** Both columns are `text NULL` with no check constraint or enum type. Values are validated at the application layer.

**Why:** The set of valid values may expand (e.g., new reliability tiers, new model names). A check constraint would require a migration to add each new value. Application-level validation is sufficient for a single-user system.

### Test Strategy

- **Unit tests:** Test the extracted `handleIngestNote` function in isolation (mock Supabase, verify reliability/author are set on inserts).
- **Integration tests:** Test the `/ingest-note` HTTP route with the real Hono app (verify auth, request/response format, that the handler is called).
- **E2E tests:** Test the full Obsidian plugin sync flow — plugin calls `/ingest-note`, thoughts appear in the database with correct `reliability` and `author` values. Verify the plugin's `callMCP` still works for other tools.
- **Migration test:** Verify the migration adds columns and backfills correctly on a test database.

## User Error Scenarios

| Scenario | Handling |
|----------|----------|
| AI caller tries to call `ingest_note` via MCP after de-registration | MCP returns "tool not found" error. This is intentional — AI callers should use `capture_thought`. |
| Plugin sends request to old MCP endpoint (no update deployed) | The old MCP endpoint still has `ingest_note` registered until the server is redeployed. After redeployment, the plugin must be updated or it will get "tool not found" errors. Both must be deployed together. |
| Plugin `tbEndpointUrl` has unusual format | The URL construction for `/ingest-note` inserts the path segment before the query string. If the URL has no query string (key is in header only), the simple URL construction still works. |

## Security Analysis

No new attack surface. The `/ingest-note` route uses the same `x-brain-key` auth as all other routes. The new columns are metadata only — no new user input vectors. See existing `ThreatModel.md` for baseline threats (none exist yet, but this change doesn't introduce new ones beyond what MCP already has).

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| **Deployment ordering:** Plugin and server must be deployed together. If server deploys first, plugin breaks until updated. | Document in tasks: deploy server and plugin in same release. Server can keep the MCP registration temporarily during rollout if needed. |
| **`freshIngest` helper also needs reliability/author:** The `freshIngest()` function in `helpers.ts` inserts thoughts. It needs to receive and pass through `reliability` and `author`. | Include `freshIngest` updates in the implementation tasks. |
| **Backfill assumes all existing thoughts are GPT-4o-mini:** If any thoughts were manually inserted or came from a different model, the backfill is inaccurate. | Acceptable — all existing thoughts in production were created by the GPT-4o-mini extraction pipeline. No manual inserts exist. |

## Migration Plan

1. **Database migration** — add columns + backfill. This is backwards-compatible (nullable columns, existing code ignores them).
2. **Server update** — extract handler, add Hono route, remove MCP registration, set reliability/author on ingest path. Deploy to Supabase.
3. **Plugin update** — switch `processNote` to call `/ingest-note` directly. Build and release new plugin version.
4. **Rollback:** If issues arise, re-register `ingest_note` in MCP and revert the plugin. The database columns are harmless and don't need rollback.

## Open Questions

_(none — all decisions are resolved)_
