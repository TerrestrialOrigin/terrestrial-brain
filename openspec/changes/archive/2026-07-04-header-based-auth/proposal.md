# Proposal: header-based-auth

## Why

The shared access key travels in URL query strings end to end, and the server compares it non-constant-time (findings S4/X4, part of S5 in `codeEval/Fable20260704.md`; Step 3 of `codeEval/Fable20260704-fix-plan.md`):

1. **Server** (`supabase/functions/terrestrial-brain-mcp/index.ts:62-63`): already accepts an `x-brain-key` header, but also accepts `?key=` and compares with `!==` — a timing side channel on the only secret protecting the whole system.
2. **Plugin** (`obsidian-plugin/src/main.ts`): the settings tab instructs the user to paste the URL *including* `?key=`, and `buildEndpointUrl` propagates that query string onto every request. Keys in URLs land in edge/proxy logs, browser history, and Referer headers. The plugin also never warns when the endpoint is plain `http://`, silently sending notes + key in cleartext.
3. **README** claims "Row-Level Security with access-key authentication," overselling the model. The real trust model is a single shared secret at the edge; RLS's role is anon lockout only (finding S5).

## What Changes

- **Server:** replace the `!==` key comparison with a constant-time comparison. `x-brain-key` header stays primary; `?key=` keeps working but is documented as deprecated.
- **Plugin:** send the key in an `x-brain-key` header on every request (`callHTTP`, `callIngestNote`); stop embedding it in URLs. New dedicated `accessKey` settings field with its own settings-tab input. Settings migration: when the stored endpoint URL contains `?key=`, extract the key into `accessKey` and strip the query string from the URL. Warn in the settings tab when the endpoint is not `https://` (allowing `http://localhost` / `http://127.0.0.1`).
- **README:** document the actual trust model (single shared secret at the edge; RLS = anon lockout), document `x-brain-key` as the supported auth mechanism, and mark `?key=` deprecated.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `mcp-server` (`openspec/specs/mcp-server.md`): Authentication requirement changes — key comparison SHALL be constant-time; `x-brain-key` header is the primary mechanism, `?key=` is a deprecated fallback.
- `obsidian-plugin` (`openspec/specs/obsidian-plugin/spec.md`): Settings gain a dedicated `accessKey` field (with `?key=`-in-URL migration); all HTTP calls send `x-brain-key`; `buildEndpointUrl` no longer carries a key query string; settings tab warns on non-HTTPS endpoints.

## Non-goals

- No removal of the `?key=` fallback on the server (deprecation only — removal would break existing deployments mid-migration).
- No change to the single-shared-secret model itself (multi-user auth, per-client keys, token rotation are out of scope).
- No plugin modularization (Step 21) — changes stay inside the existing `main.ts` structure.
- No encryption of the key at rest in `data.json` (standard Obsidian practice; documented, not changed).

## Impact

- **Server:** `supabase/functions/terrestrial-brain-mcp/index.ts` (auth block only).
- **Plugin:** `obsidian-plugin/src/main.ts` (`TBPluginSettings`, `loadSettings` migration, `callHTTP`, `callIngestNote`, `buildEndpointUrl`, settings tab) + `main.test.ts`.
- **Docs:** `README.md` (trust model section, setup instructions).
- **Tests:** server integration tests (header accept/deny, query-param fallback); plugin vitest (header construction, URL-key migration, HTTPS warning).
- **Deployment/compat:** existing clients using `?key=` keep working. Existing plugin installs migrate automatically on next load.
