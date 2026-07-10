## Context

Every MCP tool call flows through `withMcpLogging` (`logger.ts`), which writes a
`function_call_logs` row before the handler runs and updates it with result metrics after.
Today the "after" update computes:

```ts
const recordsReturned = contentEntries.length;   // result.content.length
```

`result.content` is the MCP envelope's array of *content blocks*. Every handler returns
exactly one text block via `textResult(...)` (or `errorResult(...)`), so `records_returned`
is **always 1** — including on the error path (`errorResult` also has one block). A
`search_thoughts` returning 12 thoughts, one returning 0, and one that errored all log `1`.

The New-Feature-Plan Step 4 audit needs retrieval *volume* from this column, and Step 7's
`last_retrieved_at` decay needs to know *which* thought ids came back. The decorator cannot
compute the row count itself — it only sees the rendered text envelope, not the underlying
DB rows. The count must come from the handler, which is the only code that holds `data.length`.

Constraints:
- `function_call_logs` is service-role-only telemetry (RLS). No external consumer.
- Migrations are append-only (`docs/upgrade.md`).
- The MCP client payload must not change — `records_returned` is internal; nothing new should
  leak into the JSON-RPC response.
- `McpToolResult` already has an index signature (`[key: string]: unknown`), so an extra field
  is structurally allowed without a type break.

## Goals / Non-Goals

**Goals:**
- `records_returned` reflects the true number of DB rows a read tool returned (0 when empty).
- The error path logs `records_returned = 0` (thrown handler or `isError`), not 1.
- Thought retrieval calls (`search_thoughts`, `list_thoughts`, `get_thought_by_id`) log the
  returned thought ids in a bounded, content-free `returned_ids` column.
- The handler→logger seam is explicit, minimal, and type-safe (no `any`, no cast of external data).
- The MCP client-facing envelope is unchanged (the seam field is stripped before return).

**Non-Goals:**
- Implementing `last_retrieved_at` / retrieval-count decay or any usefulness scoring (Step 7).
- Instrumenting mutation tools with a row count — they fall back to 1 (the single affected record).
- Backfilling historical rows; the clean-signal epoch starts at deploy.
- Touching `response_characters` (already correct) or `input` truncation.

## Decisions

### D1 — Thread the count through a `meta` field on the result envelope (handler → decorator seam)

Handlers attach an optional `meta` to their result; the decorator reads it. Chosen over the
alternatives because the decorator provably cannot know the row count, and `meta` keeps the
information flowing along the value the handler already returns — no second return channel, no
handler signature change, no out-of-band mutable state (which would violate the request-isolation
invariant the logging layer already respects).

```ts
// mcp-response.ts
export interface ResultMeta {
  recordsReturned?: number;   // real DB row count for this response
  returnedIds?: string[];     // ids of the returned entities (bounded), content-free
}
export interface McpToolResult {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  meta?: ResultMeta;
  [key: string]: unknown;
}
export function textResult(text: string, meta?: ResultMeta): McpToolResult {
  const result: McpToolResult = { content: [{ type: "text", text }] };
  if (meta) result.meta = meta;        // attach ONLY when provided — keeps bare textResult() deep-equal-stable
  return result;
}
```

`errorResult` gains no `meta` — errors are forced to 0 by the decorator regardless.

**Alternatives considered:**
- *Change every handler to return a `{ result, count }` tuple.* Rejected: touches ~40 call sites,
  breaks the uniform `McpToolResult` return type, and the MCP registration path expects the envelope.
- *A module-level "last count" variable the handler sets and the decorator reads.* Rejected outright:
  request-scoped data in module mutables is exactly the interleave bug the CLAUDE.md invariants and
  the existing `requestContext` AsyncLocalStorage seam forbid.
- *Parse the count back out of the rendered text.* Rejected: brittle string-scraping of the very
  output we control; re-introduces a parse where we already hold the number.

### D2 — Decorator: handler-reported count, hard 0 on error, content-length fallback

```ts
const isError = result.isError === true;
const recordsReturned = isError ? 0 : (result.meta?.recordsReturned ?? contentEntries.length);
const returnedIds = isError ? null : (result.meta?.returnedIds ?? null);
```

- **Error → 0** unconditionally (fixes the "errors log 1" half of the bug and satisfies the
  bug-fix test).
- **Success with `meta.recordsReturned`** → the real count (including 0 for empty reads, which
  the empty branches set explicitly).
- **Success without `meta`** → falls back to `contentEntries.length` (= 1), which is correct for
  single-record responses (get/create/update/archive return one record) and is the current
  behavior — so un-instrumented handlers are unaffected. This makes the change strictly additive.

**Strip `meta` before returning to the client** so it never enters the JSON-RPC payload:

```ts
const { meta: _meta, ...clientResult } = result;
return clientResult;
```

Destructuring an object with no `meta` yields the identical object shape, so bare `textResult(...)`
handlers still return their exact previous envelope (preserves the `mcp-response-envelope`
pass-through scenario and its existing test).

### D3 — `returned_ids` as a nullable `jsonb` column on `function_call_logs`

Chosen over a dedicated join table or a `uuid[]` column:
- **Leaner than a table:** the ids belong to the same call row; no join, no second insert, no
  second failure mode in a fire-and-forget logger.
- **`jsonb` over `uuid[]`:** matches the existing analytics idiom — the Step 4 audit already unnests
  `input::jsonb->'thought_ids'` via `jsonb_array_elements_text`; `returned_ids` will unnest the same
  way. Avoids coupling the log column to the `uuid` type (ids are logged as strings, exactly as the
  model receives them).
- **Nullable:** only thought-retrieval calls populate it; every other call (and all historical rows)
  stay `NULL`, which reads as "no retrieval ids for this call" — distinct from `records_returned = 0`.

Bounded by construction: only `search_thoughts` / `list_thoughts` / `get_thought_by_id` set it, each
capped by the query `limit` (≤ `MAX_QUERY_LIMIT = 100`). **Ids only, never content** — GDPR data
minimization (the same principle as the 10k input cap).

`logResult` gains an optional trailing `returnedIds` parameter (backward-compatible: existing fake
loggers implementing four parameters remain assignable in TypeScript's structural typing).

### D4 — Which handlers report, and what they report

| Tool | `recordsReturned` | `returnedIds` |
|---|---|---|
| `search_thoughts`, `list_thoughts` | `data.length` (0 on empty) | thought ids |
| `get_thought_by_id` | 1 found / 0 not-found | `[id]` found / none |
| `get_tasks`, `list_people`, `list_projects`, `list_documents` | `data.length` (0 on empty) | — |
| `get_person`, `get_project`, `get_document` | 1 found / 0 not-found | — |
| everything else (create/update/archive/capture/stats/summaries) | unchanged (falls back to 1) | — |

Empty branches (`"No thoughts found."` etc.) **must** set `meta.recordsReturned = 0` explicitly,
otherwise the fallback would log 1 for an empty read.

### D5 — Test Strategy

- **Unit (deterministic, `test`-tagged):** extend/add a decorator test using the existing fake
  `FunctionCallLogger` seam (no DB/network). Assert: a handler returning
  `textResult("…", { recordsReturned: 3, returnedIds: [a,b,c] })` logs `records_returned = 3` and
  `returned_ids = [a,b,c]`; an empty-meta (`recordsReturned: 0`) handler logs 0; a thrown handler and
  an `errorResult` handler both log 0 with `error_details` set; a bare `textResult` handler still
  logs 1 (regression guard for un-instrumented handlers); the returned client envelope has no `meta`
  key. **Bug-fix rule:** the `recordsReturned: 3 → logs 3` assertion fails against current code (which
  logs `content.length = 1`) — written and shown RED first.
- **Integration (real local stack, `TB_AI_PROVIDER=fake`, no mocks on path):** capture N unique
  thoughts, `search_thoughts` for them, then read the latest `search_thoughts` row from
  `function_call_logs` and assert `records_returned = N` and `returned_ids` has N ids; a no-match
  search logs `records_returned = 0`; `get_thought_by_id` on a known id logs `records_returned = 1`
  and `returned_ids = [id]`. This exercises the real handler → logger → Postgres path end to end.
- **GATE 2b mutation check:** reverting the decorator to `contentEntries.length` reddens both the
  unit `logs 3` assertion and the integration `= N` assertion.

## Risks / Trade-offs

- **[Handler forgets to set `meta` on a new read tool]** → it silently falls back to 1, quietly
  under-reporting. *Mitigation:* the integration test covers the primary read paths; the fallback is
  a safe, non-crashing default (never a wrong-but-plausible large number); documented in D4 so future
  read tools follow the table.
- **[Empty branch forgets `recordsReturned: 0`]** → logs 1 for an empty read. *Mitigation:* explicit
  no-match integration assertion (`= 0`) catches it for the thought path; every empty branch touched
  in this change sets it.
- **[`meta` leaks to the MCP client]** → protocol noise / info exposure. *Mitigation:* the decorator
  strips `meta`; a unit assertion checks the returned envelope has no `meta` key.
- **[`returned_ids` accumulates personal-linkable data]** → it stores ids only (opaque UUIDs, no
  content), inside the same service-role-only table already governed by the 90-day
  `purge_function_call_logs` retention window. No new retention surface. (See ThreatModel T14.)
- **[Migration ordering]** → append-only, additive nullable column; no backfill, no rewrite of
  existing rows; safe to deploy independently and to roll back by ignoring the column.

## Migration Plan

1. Add migration `supabase/migrations/20260710000002_function_call_logs_returned_ids.sql`:
   `alter table function_call_logs add column returned_ids jsonb;` (nullable, no default, no backfill).
2. `deno task gen:types` against the local stack to regenerate `database.types.ts`.
3. Deploy is additive; the new column is nullable and written only by the updated function. Rollback =
   redeploy the prior function; the orphan nullable column is inert and purged by retention like any row.

## Open Questions

- None blocking. (Whether non-thought reads should also log `returned_ids` is deferred — Step 7 only
  needs thought retrieval ids; adding others later is a strictly additive follow-up.)

## Security analysis

Recorded in `ThreatModel.md` as **T14** (returned-ids logging, GDPR data minimization). Summary: the
new `returned_ids` column stores opaque entity UUIDs only — never note/thought content — in the
existing service-role-only, RLS-protected, retention-bounded `function_call_logs` table. It widens no
auth surface (same `x-tb-key` gate), adds no external consumer, and is subject to the same 90-day
`purge_function_call_logs` window and RLS as every other column.

**User-error scenarios:**
- *A read returns zero rows* → handler sets `recordsReturned = 0`; logged as 0, `returned_ids` null/absent
  — distinguishable from "not a read" (null) and from a former false 1.
- *A handler throws / returns an error* → decorator forces `records_returned = 0` and records
  `error_details`; no partial/misleading count.
- *A caller passes a huge `limit`* → bounded by `MAX_QUERY_LIMIT = 100`; `returned_ids` cannot grow
  unbounded.
- *Logging itself fails (DB hiccup)* → unchanged fire-and-forget behavior: the tool response is never
  affected and the failure is written to console (existing invariant preserved).
