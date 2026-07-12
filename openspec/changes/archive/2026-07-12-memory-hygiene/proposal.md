## Why

Steps 5–6 specified the memory & task lifecycle rules and wrote the executable
acceptance harness (`lifecycle-rules-verification`) — 23 deterministic tests
that are **red-by-design** because the enforcement does not exist yet. This
change implements that enforcement (memory hygiene), turning the red tests
green. It is the payoff of TDD at phase scale: the acceptance criteria were
written first; here they are satisfied.

## What Changes

- **Write-time deduplication gate** on every thought-creating path
  (`capture_thought`, `freshIngest`, ingest reconciliation) — a server-side
  embedding-distance check (tight cosine band) that blocks byte-identical and
  within-band restatements instead of relying on prompt-nudge compliance.
- **Supersession, not deletion:** a `superseded_by` edge on `thoughts`, a
  `resolve_supersession` tool, and `search_thoughts_by_embedding` recreated to
  exclude superseded thoughts from default retrieval (kept queryable by id). The
  *mechanism* (edge + tool + exclusion) is the deterministic, gated deliverable;
  automated capture-time contradiction *detection* (which thought to supersede)
  is model judgment on the opt-in eval tier and is wired when that tier gains its
  real-LLM harness — the deterministic gate does not depend on it.
- **INVARIANT 1 — content_hash + re-embed in the one update path:** a
  `content_hash` column on `thoughts`/`projects`/`tasks`/`documents`; every
  content edit re-hashes (and thoughts re-embed) in the single server-side update
  path, extended from thoughts to all four entities.
- **Actor model:** a `last_actor` column on `thoughts`; mutations record their
  actor (`LLM`/`user`/`sync`) through the one path (Invariant 2 structural home).
- **Temporal/staleness signal:** a `last_retrieved_at` column advanced on every
  retrieval (built on the Step-2b `returned_ids`), plus a `get_stale_thoughts`
  MCP tool surfacing a multi-signal (never score-alone) review queue.
- **Archival queue:** a `get_archival_queue` MCP tool gating on the conjunction
  (age ∧ score-0 ∧ no retrieval ∧ not synced-note-owned), surfaced for consent.
- **Task reconciliation:** a `reconcile_tasks` MCP tool proposing open tasks that
  look done per recent thoughts — asks before closing, never auto-closes.
- **Usefulness rubber-stamp down-weighting:** `record_useful_thoughts` gains an
  optional `returned_ids` (result-set) param; a selection covering nearly all of
  the set increments less per id than a selective one (new weighted RPC).
- **Extraction `type` allowlist parse:** `THOUGHT_TYPES` extended with
  `instruction`/`decision`; `extractMetadata` parses `type` against the allowlist
  and coerces out-of-allowlist/missing values to `observation` (logged).
- **BREAKING (data/schema, append-only):** one new migration adds the columns +
  RPCs; no existing migration is edited (per `docs/upgrade.md`).

## Capabilities

### New Capabilities
- `memory-hygiene`: the concrete implemented mechanism that realizes the
  `memory-lifecycle-rules` behavior — the dedup gate, the supersession edge +
  contradiction check + resolve tool, the INVARIANT-1 content_hash/re-embed
  enforcement point, the actor column, the retrieval-recency signal + staleness/
  archival/reconciliation tools, the rubber-stamp down-weighting, and the
  extraction-type allowlist parse.

### Modified Capabilities
<!-- None at the requirement level. This change implements the already-specified
     `memory-lifecycle-rules` behavior; those requirements are unchanged. The
     `lifecycle-rules-verification` harness scenarios flip red→green (tracked in
     tests/lifecycle-coverage.manifest.ts, not a spec change). -->

## Impact

- **Migration:** one append-only file adds `content_hash` (thoughts/projects/
  tasks/documents), `superseded_by`/`last_retrieved_at`/`last_actor` (thoughts),
  recreates `search_thoughts_by_embedding` (excludes superseded), adds an
  `increment_usefulness_weighted` RPC + indexes + grants; `database.types.ts`
  regenerated.
- **Edge function:** `enums.ts`, `helpers.ts` (extractMetadata + freshIngest +
  new contradiction helper), `tools/thoughts.ts` (capture/update/record + new
  tools), `tools/tasks.ts`/`tools/projects.ts`/`tools/documents.ts` (content_hash
  on update), `repositories/*` (new query methods + `NewThought` fields),
  `ai/fake-provider.ts` (contradiction responder).
- **Tests:** the 23 red-by-design lifecycle tests flip to pass; their manifest
  entries move `pending`→`pass-now`; a few Step-6 capability-probe tests are
  strengthened to assert behavior now that the surface exists.
- **ThreatModel.md:** T16–T20 move from *Specified* to *Mitigated*.
- **No change** to the Obsidian plugin.
