# Threat Model — plugin-modularization

This change is a structural refactor (module split + injected seams + boundary validation). It introduces no new endpoint, dependency, or persisted secret, so the attack surface is essentially unchanged. Threats are catalogued here per the project's design standard, with the mitigation each carries into the new structure.

| # | Threat | Vector | Mitigation (in this change) |
|---|--------|--------|------------------------------|
| T1 | **Access-key leakage** | Key ending up in a URL, query string, referer, or proxy log | Key stays in the `x-brain-key` header, centralized in `HttpTerrestrialBrainClient`'s single request-builder so it cannot regress on a per-call basis. `buildEndpointUrl` preserves any legacy query string but never adds the key. |
| T2 | **Cleartext transport** | User configures a plain `http://` non-local endpoint; notes + key sent in the clear | `isInsecureEndpoint` warning preserved in the settings tab (`settings.ts`). |
| T3 | **Untrusted server response drives vault writes** | A compromised/buggy endpoint returns an unexpected payload shape that flows into file-write logic | **NEW:** boundary type-guards (`isAIOutputMetadataArray`, `isAIOutputContentArray`) validate poll responses before any write; a malformed response becomes a bounded error, never a silent `as` cast. |
| T4 | **Info disclosure via error Notice** | A large server body / stack trace shown verbatim to the user | `truncateForNotice` bounding + whitespace-collapse preserved on all error paths (client throws sanitized messages; full detail only to `console.error`). |
| T5 | **Path traversal / unexpected write path from server-supplied `file_path`** | Server-supplied `file_path` used to write into the vault | Behavior unchanged from today (out of scope to re-design here); the boundary guard at least guarantees `file_path` is a string of the expected shape before use. Any stricter path validation is tracked separately (filepath-validation capability / Step 25). |
| T6 | **Secret at rest** | `accessKey` stored unencrypted in `data.json` | Unchanged and documented in the settings description (standard Obsidian plugin-data behavior); no regression introduced. |

## Residual risk / accepted

- Server-supplied `file_path` is trusted for the write location (T5) exactly as before this change — not widened, not narrowed. This refactor does not claim to fix it; it only removes the untyped cast around the surrounding payload.
- No new secret, endpoint, or dependency is added, so no new residual risk is created by the refactor itself.
