# Usefulness-Score Audit — Production Data

**Date:** 2026-07-10
**Method:** read-only SQL against the live prod project (`jhqhtryqjwzhnjaqtkui`) via the Supabase Management API query endpoint, authenticated with the CLI's stored access token. This document is the usefulness half of New-Feature-Plan Step 4 (memory-mechanism audit); the dedup/extraction half remains open.

## Corpus

| Metric | Value |
|---|---|
| Total thoughts | 1,666 (13 archived) |
| From Obsidian notes (`reference_id` set) | 1,520 across 384 notes |
| Conversation-captured | ~146 |
| usefulness_score = 0 | **1,616 (97%)** |
| score 1–2 | 45 |
| score 3 (max ever) | 5 |
| Sum of all increments | 69 |
| Active thoughts older than 90 days | 1,421 — 98% score 0 |

## Call telemetry (function_call_logs, Apr 4 → Jul 10)

- `record_useful_thoughts`: 90 calls, 537 ids recorded (509 distinct), zero logged errors.
- `search_thoughts` 71 / `list_thoughts` 90 / `get_thought_by_id` **2** (the only server-side auto-record path is almost never exercised — claude.ai fetches by search, not by id).
- **Nudge compliance is high**: 82% of searches and 94% of lists are followed by a `record_useful_thoughts` call within 10 minutes.
- Usage is small and declining: searches per month 34 → 19 → 15 → 3 (Apr→Jul). The dominant caller overall is the Obsidian plugin's `get-pending-ai-output-metadata` poll (12,853 calls) — retrieval traffic is a rounding error next to it.

## The April data loss

Month-by-month, "of the ids recorded that month, how many carry a score today":

| Month | ids recorded | with score now | verdict |
|---|---|---|---|
| Apr (≤ Apr 23, "v1") | 489 | ~28 | **~94% of increments lost** |
| Apr 23–30 ("v2") | 8 | 8 | 100% |
| May | 10 | 10 | 100% |
| Jun | 8 | 8 | 100% |
| Jul | 22 | 22 | 100% |

**Explanation (confirmed 2026-07-10 with Anastasia): the April scores were manually reset.** Anastasia ran manual updates setting `usefulness_score = 0` when the usefulness logic was overhauled (~Apr 23, the "usefulness feedback loop" change). The data supports this over code failure: the v1 and v2 handler code is IDENTICAL, v1-era calls logged success-shaped responses, and reconstructing scores purely from the post-Apr-23 increment ledger (`record_useful_thoughts` + `builds_on` + `get_thought_by_id`) reproduces current scores exactly for 32 of 41 checked thoughts (the remainder is small-scale noise/v1 residue). So the pre-Apr-23 signal wasn't lost to a bug — it was deliberately zeroed at the overhaul.

**Since 2026-05-01 the mechanism is verified working at 100%.** Treat that as the clean-signal epoch — everything before it is "no data" by design, not failure.

## Additional findings (bugs/gaps to fold into plan steps)

1. **`records_returned` telemetry is broken — confirmed in CURRENT code, not just prod**: `logger.ts` `withMcpLogging` sets `recordsReturned = result.content.length`, i.e. the number of MCP content blocks (always 1 for text results), not database rows. Present in the undeployed develop code and in prod alike. TB task filed 2026-07-10.
2. **No "was retrieved" signal exists per thought.** Only usefulness (model-volunteered) is tracked; nothing records that a thought was *returned* by search/list. A server-side `last_retrieved_at`/retrieval-count write on the search/list path would give a compliance-independent decay signal — exactly the "prompt-nudge → server-side enforcement" direction. Recommend adding to Step 7's design.
3. April's 63-id record call shows the rubber-stamp failure mode (recording everything returned). Post-overhaul batches average ~1.4 ids/call — restrained and plausible. Worth an explicit lifecycle rule in Step 5: a record call listing (nearly) every returned id carries less weight.

## Opinion / recommendation on the archival window

**Do not drive archival from usefulness_score today.** 97% zeros is not evidence of uselessness — pre-Apr-23 signal was deliberately reset, and much of the corpus is the one-time import of a well-aged Obsidian vault, where score 0 is expected and acceptable (reference material, not evidence of a broken loop). Score-0 currently means "no data," not "not useful."

Concretely:

1. **Epoch rule:** treat usefulness data as valid only from 2026-05-01. Clean signal so far: ~40 increments over ~10 weeks. That is too sparse to rank 1,666 thoughts.
2. **Use usefulness as a ranking boost, not an archival axe.** A small additive boost in search ordering is safe with sparse data; deletion/archival on the same data is not.
3. **Archival should be a multi-signal review queue, not an automatic window** — which is exactly Step 7's staleness/decay design: candidates = old (e.g. >120 days) AND never retrieved (needs finding 2's `last_retrieved_at`) AND score 0 AND not tied to a currently-synced note; surfaced for human confirmation in batches. Note-derived thoughts (91% of the corpus) already have a lifecycle owner — their note — so age-based archival mostly concerns the ~146 conversational thoughts plus orphaned note thoughts.
4. **Revisit a score-driven window ~2026-10-01** (5 months of clean signal) using retrieval + usefulness together.

## Queries used

All read-only, via `POST /v1/projects/{ref}/database/query`. Key ones: score distribution & age buckets on `thoughts`; per-function counts and monthly trends on `function_call_logs`; follow-within-10-min compliance joins; `jsonb_array_elements_text(input::jsonb->'thought_ids')` unnesting joined against `thoughts` for survival/score checks; cross-era re-record score comparison.
