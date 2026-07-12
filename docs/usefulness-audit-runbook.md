# Usefulness-Score Audit Runbook

Step-by-step instructions for auditing the usefulness-score mechanism against the **live production database**. Executable by an LLM agent or a human. First run: 2026-07-10 (`codeEval/Fable20260710-UsefulnessAudit.md`).

**When to run:** before any archival/decay policy decision, after changes to the usefulness mechanism, or quarterly.

---

## Ground rules

1. **READ-ONLY.** Every query in this runbook is a `SELECT`. Never run `UPDATE`/`DELETE`/`INSERT` against prod during an audit. If a fix is needed, file a task — don't hot-fix prod.
2. **Never print or persist credentials.** The access token goes into a shell variable or stays in the keyring; it must not appear in output, files, or reports.
3. **Record what you ran and when.** Save results as `codeEval/<Agent>YYYYMMDD-UsefulnessAudit.md` using the report template at the bottom.

## Step 0 — Access

You need the project ref and one authentication path.

- **Project ref:** `cat supabase/.temp/project-ref` (repo must be linked; as of 2026-07 it is `jhqhtryqjwzhnjaqtkui`).
- **Path A — human:** open Supabase Studio → SQL Editor for the project, and paste each SQL block below directly. Skip the curl scaffolding.
- **Path B — agent/CLI (Management API):** the Supabase CLI's access token is in the system keyring on the dev machine:

```bash
PROJECT_REF=$(cat supabase/.temp/project-ref)
TOKEN=$(secret-tool lookup service "Supabase CLI")   # Linux keyring; do NOT echo
# If empty: export SUPABASE_ACCESS_TOKEN yourself or run `npx supabase login`.
```

Run each query by writing it to a file (avoids all shell-quoting problems):

```bash
run_sql() {  # usage: write SQL into /tmp/q.sql (or scratchpad), then: run_sql /tmp/q.sql
  curl -s -X POST "https://api.supabase.com/v1/projects/$PROJECT_REF/database/query" \
    -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    --data "$(jq -n --rawfile q "$1" '{query: $q}')"
}
```

Sanity check before proceeding — should return a row count, not an error:

```sql
select count(*) from thoughts;
```

## Step 1 — Corpus overview

```sql
select count(*) total,
       count(*) filter (where archived_at is not null)          archived,
       count(*) filter (where usefulness_score = 0)             score0,
       count(*) filter (where usefulness_score between 1 and 2) score1_2,
       count(*) filter (where usefulness_score between 3 and 9) score3_9,
       count(*) filter (where usefulness_score >= 10)           score10plus,
       max(usefulness_score) max_score,
       sum(usefulness_score) total_increments
from thoughts;
```

Also split by origin (note-derived thoughts belong to their note's lifecycle; conversational thoughts don't):

```sql
select (reference_id is not null) note_derived,
       count(*) n,
       count(*) filter (where usefulness_score > 0) scored
from thoughts group by 1;
```

## Step 2 — Score by age bucket

```sql
select case when created_at > now() - interval '30 days' then 'a_0-30d'
            when created_at > now() - interval '60 days' then 'b_30-60d'
            when created_at > now() - interval '90 days' then 'c_60-90d'
            else 'd_90d+' end bucket,
       count(*) n,
       count(*) filter (where usefulness_score = 0) never_useful,
       round(avg(usefulness_score), 2) avg_score,
       max(usefulness_score) max_score
from thoughts where archived_at is null
group by 1 order by 1;
```

## Step 3 — Call volume and monthly trend

```sql
select function_name, count(*) n,
       min(called_at)::date first_call, max(called_at)::date last_call
from function_call_logs group by 1 order by 2 desc;
```

```sql
select date_trunc('month', called_at)::date mo,
       count(*) filter (where function_name = 'search_thoughts')        searches,
       count(*) filter (where function_name = 'list_thoughts')          lists,
       count(*) filter (where function_name = 'get_thought_by_id')      gets,
       count(*) filter (where function_name = 'record_useful_thoughts') records,
       count(*) filter (where function_name = 'capture_thought')        captures,
       count(*) filter (where function_name = 'ingest-note')            ingests
from function_call_logs group by 1 order by 1;
```

## Step 4 — Nudge compliance

What fraction of retrievals is followed by a `record_useful_thoughts` call within 10 minutes? Run once with `search_thoughts`, once with `list_thoughts`:

```sql
with s as (select called_at from function_call_logs where function_name = 'search_thoughts'),
     r as (select called_at from function_call_logs where function_name = 'record_useful_thoughts')
select count(*) retrievals,
       count(*) filter (where exists (
         select 1 from r
         where r.called_at between s.called_at and s.called_at + interval '10 minutes'
       )) followed_by_record
from s;
```

## Step 5 — Increment-integrity check ⚠️ THE health check

For each month, of the thought ids recorded as useful, how many carry a score **today**? Recent months must be ~100%; if not, the mechanism has regressed — stop and file a bug before drawing any usage conclusions.

```sql
with calls as (
  select date_trunc('month', called_at)::date mo,
         jsonb_array_elements_text(input::jsonb -> 'thought_ids') tid
  from function_call_logs
  where function_name = 'record_useful_thoughts' and input is not null
)
select mo,
       count(*) ids_recorded,
       count(*) filter (where exists (
         select 1 from thoughts t where t.id::text = calls.tid and t.usefulness_score >= 1
       )) ids_with_score_now,
       count(*) filter (where not exists (
         select 1 from thoughts t where t.id::text = calls.tid
       )) ids_gone
from calls group by 1 order by 1;
```

Expected known-bad history (see caveats below): April 2026 shows ~7% — that is explained; it is NOT a current regression.

## Step 6 — Rubber-stamp check

A model that records (nearly) every returned id produces inflated, meaningless scores.

```sql
select date_trunc('month', called_at)::date mo,
       count(*) calls,
       round(avg(jsonb_array_length(input::jsonb -> 'thought_ids')), 1) avg_ids_per_call,
       max(jsonb_array_length(input::jsonb -> 'thought_ids')) max_ids
from function_call_logs
where function_name = 'record_useful_thoughts' and input is not null
group by 1 order by 1;
```

## Step 6a — Deduplication (dedup half)

Is any dedup enforced when a thought is written? These queries measure the *result* (duplicate rows in prod); the code map decides *where* enforcement lives (see the report). All READ-ONLY.

Exact-duplicate content among active thoughts:

```sql
select count(*) dup_groups, coalesce(sum(cnt-1),0) redundant_rows
from (
  select md5(btrim(content)) h, count(*) cnt
  from thoughts where archived_at is null
  group by 1 having count(*) > 1
) d;
```

Semantic near-duplicates — bounded HNSW nearest-neighbor over a recent sample (NOT an O(n²) scan; state the sample size and thresholds in the report, never present as an exhaustive count):

```sql
with sample as (
  select id, embedding from thoughts
  where archived_at is null and embedding is not null
  order by created_at desc limit 150
)
select count(*) sampled,
       count(*) filter (where nn_dist < 0.05) very_near_lt_005,
       count(*) filter (where nn_dist < 0.10) near_lt_010,
       count(*) filter (where nn_dist < 0.15) nearish_lt_015,
       round(avg(nn_dist)::numeric,4) avg_nn_dist
from (
  select (select min(s.embedding <=> t.embedding) from thoughts t
          where t.archived_at is null and t.embedding is not null and t.id <> s.id) nn_dist
  from sample s
) x;
```

Concrete near-dup pairs (illustrative; note whether the twin is in the same source note):

```sql
with sample as (
  select id, content, embedding, reference_id from thoughts
  where archived_at is null and embedding is not null
  order by created_at desc limit 150
)
select left(btrim(s.content),70) a, left(btrim(t.content),70) b,
       round((s.embedding <=> t.embedding)::numeric,4) dist,
       (s.reference_id is not distinct from t.reference_id) same_note
from sample s
cross join lateral (
  select content, reference_id, embedding from thoughts t2
  where t2.archived_at is null and t2.embedding is not null and t2.id <> s.id
  order by s.embedding <=> t2.embedding limit 1
) t
where (s.embedding <=> t.embedding) < 0.06
order by dist limit 10;
```

## Step 6b — Extraction (extraction half)

Does extraction validate its output against the `THOUGHT_TYPES` allowlist? The allowlist is `observation, task, idea, reference, person_note`; any other `type` value in the data means the LLM response was stored uncast/unvalidated.

Type distribution vs the allowlist (out-of-allowlist rows are the finding):

```sql
select metadata->>'type' thought_type, count(*) n
from thoughts group by 1 order by 2 desc nulls last;
```

Metadata-key coverage and deleted-integration residue:

```sql
select key, count(*) n from thoughts, lateral jsonb_object_keys(metadata) key
group by 1 order by 2 desc;
select count(*) slack_residue from thoughts where metadata ? 'slack_ts';
```

Extraction fan-out — thoughts produced per ingested note (splitter behavior):

```sql
select case when cnt=1 then '1' when cnt<=3 then '2-3' when cnt<=6 then '4-6'
            when cnt<=10 then '7-10' else '11+' end bucket, count(*) notes
from (select reference_id, count(*) cnt from thoughts where reference_id is not null group by 1) x
group by 1 order by 1;
```

## Step 7 — Save the report

Copy the template below into `codeEval/<Agent>YYYYMMDD-UsefulnessAudit.md`, fill in the numbers, and write conclusions **using the interpretation guide** — not gut feel.

---

## Known data caveats (read BEFORE interpreting)

| Caveat | Effect |
|---|---|
| **Manual score reset ~2026-04-23** (Anastasia zeroed `usefulness_score` when the usefulness logic was overhauled) | Everything recorded before ~Apr 23 2026 shows score 0 regardless of actual use. **Clean-signal epoch starts 2026-05-01.** Never interpret pre-epoch zeros. |
| **Initial vault import** | Much of the corpus came from a one-time import of a well-aged Obsidian vault. Score 0 on those is expected and largely fine — they are reference material, not evidence of a broken loop. |
| **`records_returned` column is wrong for MCP tools** (logs MCP content-block count — effectively always 1 — instead of row count; bug in `logger.ts` `withMcpLogging`, present in code and prod as of 2026-07-10; TB task filed) | Do not use `records_returned` for anything until the fix is deployed and verified. |
| **`response_characters` NULLs** in early rows | Early logging didn't populate it; NULL ≠ empty response. |
| **No retrieval tracking** | Nothing records that a thought was *returned* by search/list (only `get_thought_by_id` auto-records, and it is almost never called). "Score 0" therefore cannot distinguish "never seen" from "seen but not useful" until `last_retrieved_at` exists (planned, New-Feature-Plan Step 7). |

## Interpretation guide — how to draw conclusions

1. **Integrity before usage.** If Step 5 shows < ~95% `ids_with_score_now` for any post-epoch month, the mechanism is broken → file a bug, and treat all affected months as "no data." Only interpret usage once integrity is clean.
2. **Score 0 means "no data" by default, not "not useful."** It only becomes weak negative signal for a thought that (a) was created after the epoch, (b) is conversational (not note-derived / vault-import), and (c) — once retrieval tracking exists — was actually returned to a model and still never recorded.
3. **Compliance thresholds:** ≥ 80% of retrievals followed by a record call = healthy prompt-nudge; 50–80% = degrading, consider strengthening; < 50% = nudge failed, move enforcement server-side.
4. **Rubber-stamp detection:** post-epoch `avg_ids_per_call` above ~5, or any single call recording most of what was returned, means that period's increments are inflated — discount them in ranking decisions and consider a lifecycle rule that down-weights blanket records.
5. **Sparse-data rule:** do not rank, decay, or archive on usefulness until there are at least **~3 months of clean signal AND ~200 total increments**. Below that, usefulness may only be used as a mild additive boost in search ordering.
6. **Archival is never score-alone.** Candidates require ALL of: age (> ~120 days), score 0, no retrieval signal, and not owned by a currently-synced note. Candidates go to a human-confirmed review queue — never auto-archive from this audit.
7. **Trend beats level.** Declining monthly searches/records says more about product usage than the score distribution does; report the trend and ask *why* retrieval is falling before tuning the scoring.
8. **Update this runbook** whenever the mechanism changes (new increment paths like `builds_on`, retrieval tracking, decay jobs) — add the new signal to Steps 3–6 and note the deployment date as a new epoch boundary if semantics changed.

## Report template

```markdown
# Usefulness-Score Audit — <YYYY-MM-DD>
**Auditor:** <agent/human> · **Method:** <Studio | Management API> · **Epoch applied:** 2026-05-01
## Corpus            <Step 1–2 tables>
## Volume & trend    <Step 3 tables>
## Compliance        <Step 4 numbers, vs thresholds>
## Integrity         <Step 5 table; explicit pass/fail per post-epoch month>
## Rubber-stamp      <Step 6 table>
## Conclusions       <apply the interpretation guide point by point>
## Actions           <tasks filed, with ids>
```
