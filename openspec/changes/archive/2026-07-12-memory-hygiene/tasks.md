## 1. Schema migration

- [x] 1.1 Add append-only migration `2026*_memory_hygiene.sql`: `thoughts.content_hash`, `thoughts.superseded_by` (FK→thoughts, on delete set null), `thoughts.last_retrieved_at`, `thoughts.last_actor`; `projects.content_hash`, `tasks.content_hash`, `documents.content_hash`; indexes `idx_thoughts_superseded_by`, `idx_thoughts_last_retrieved_at`.
- [x] 1.2 In the same migration, recreate `search_thoughts_by_embedding` (full body + revoke/grant) adding `and superseded_by is null`; update `supabase/schemas/search_thoughts_by_embedding.sql` reference + "Last synced with:" note.
- [x] 1.3 In the same migration, add `increment_usefulness_weighted(thought_ids uuid[], weight int)` RPC (security definer, revoke/grant to service_role).
- [x] 1.4 `supabase db reset` to apply; `deno task gen:types` to regenerate `database.types.ts`; confirm pre-existing suite still green.

## 2. Extraction type allowlist (feature: type-allowlist)

- [x] 2.1 Extend `THOUGHT_TYPES` in `enums.ts` with `instruction`, `decision`; update the inline prompt list in `extractMetadata`.
- [x] 2.2 Coerce `type` against the allowlist in `extractMetadata`'s parse (out-of-allowlist/missing → `observation`, logged). Turn `extraction_type_allowlist.test.ts` green.

## 3. content_hash + INVARIANT 1 (features: content-hash, invariant1-entities)

- [x] 3.1 Add `hashContent(text)` helper (sha256 hex, Deno crypto). Add `content_hash` to `NewThought` and thread it through all four thought-write paths (`capture_thought`, `freshIngest`, `executeReconciliationPlan`, `buildThoughtUpdate`) alongside the embedding.
- [x] 3.2 Set `content_hash` in `update_task`/`update_project`/`update_document` update objects (+ insert paths). Extend re-hash to all four entities.
- [x] 3.3 Turn the 3 `invariant1_reembed_rehash.test.ts` red tests green (hash equals new content; holds for projects/tasks/documents; emptying re-hashed).

## 4. Actor model (feature: actor-model)

- [x] 4.1 Add `last_actor` to `NewThought`; record `LLM` on capture, `sync` on ingest; add optional `actor` param (`LLM|user|sync`, default `LLM`) to `update_thought` threaded into the payload.
- [x] 4.2 Turn the 3 `actor_model.test.ts` red tests green.

## 5. Write-time dedup gate (feature: dedup-gate)

- [x] 5.1 Add `ThoughtRepository.findByContentHash(hash)` and `findNearestActive(embedding, minSimilarity)`; a shared `prepareThoughtWrite` helper computing embedding+hash+dedup decision.
- [x] 5.2 Apply dedup on `capture_thought` (byte-identical/within-band → drop; cross-context → retain for supersession); wire into `freshIngest` reconciliation.
- [x] 5.3 Turn the 2 `dedup_gate.test.ts` red tests green (byte-identical, restatement); keep distinct-content pass-now.

## 6. Supersession (feature: supersession)

- [x] 6.1 Recreated search RPC excludes superseded (task 1.2). Supersession MECHANISM shipped (edge + `resolve_supersession` + exclusion); automated capture-time contradiction DETECTION is model judgment on the opt-in eval tier and is deferred to that tier's real-LLM wiring — the deterministic gate does not depend on it.
- [x] 6.2 Set `superseded_by` on a detected contradiction in the capture path; add `resolve_supersession` MCP tool (set/clear the edge). Add repo methods `setSupersededBy`/`findById` coverage.
- [x] 6.3 Turn the 3 `supersession.test.ts` red tests + the dedup cross-context test green; strengthen the supersession-effect test to assert default-search exclusion.

## 7. Retrieval recency + staleness/archival/reconcile tools (features: last-retrieved-at, staleness, archival, reconciliation)

- [x] 7.1 Add `ThoughtRepository.touchRetrieved(ids)`; call it (non-fatal) from `search_thoughts`, `list_thoughts`, `get_thought_by_id` using the existing `returnedIds`. Turn `temporal_staleness` recency test green.
- [x] 7.2 Add `get_stale_thoughts` tool + repo query (age ∧ not recently retrieved; excludes score-0-but-recent). Turn the 2 staleness tests green.
- [x] 7.3 Add `get_archival_queue` tool + repo query (the four-way conjunction, excluding synced-note-owned). Turn the 3 archival tests green.
- [x] 7.4 Add `reconcile_tasks` tool + query (open tasks whose recent thoughts suggest completion; confirm-to-close candidates, never auto-close). Turn the 2 reconciliation tests green.

## 8. Rubber-stamp down-weighting (feature: rubber-stamp)

- [x] 8.1 Add optional `returned_ids` to `record_useful_thoughts`; compute `ratio` and `weight` (0.75 threshold → 1 vs 2); call `increment_usefulness_weighted`. Add repo method.
- [x] 8.2 Update `usefulness_reinforcement.test.ts` rubber-stamp test to pass `returned_ids` (the specced result-set context); turn it green; move its manifest entry to pass-now.

## 9. Manifest, threat model, gates

- [x] 9.1 Update `tests/lifecycle-coverage.manifest.ts`: flip the 23 implemented entries `pending`→`pass-now`, `milestone: step7`→`shipped` (leave eval + v1.5 sync as-is); coverage meta-test stays green with the new burn-down.
- [x] 9.2 `ThreatModel.md`: T16, T17, T19 → **Mitigated** (enforcement now test-guarded); note the best-effort contradiction call.
- [x] 9.3 Full gate: `deno task test` GREEN (0 failed, 0 skipped) — deterministic + lifecycle tiers; `deno task test:sync-rules` still all-pending (opt-in); `deno lint` + `deno fmt --check` clean; `cd obsidian-plugin && npm test && npm run build` green. Update `docs/lifecycle-test-harness.md` burn-down.
- [x] 9.4 `openspec validate memory-hygiene --strict`; `/opsx:verify`.
