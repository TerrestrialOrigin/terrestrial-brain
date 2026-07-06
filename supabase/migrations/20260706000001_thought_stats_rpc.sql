-- thought_stats aggregation RPC (Step 24, findings 7.3 — bounded queries).
--
-- Replaces the edge function's "load every active thought's metadata and count
-- in memory" path with a single SQL aggregate. The function returns one JSONB
-- object the tool formats verbatim, so tool output is unchanged.
--
-- Filtering mirrors the previous supabase-js query exactly:
--   - active thoughts only (archived_at IS NULL)
--   - optional project scope via the JSONB containment the client used:
--     metadata @> {"references":{"projects":["<uuid>"]}}
--
-- Top-N (10) for types/topics/people matches the tool's prior `.slice(0, 10)`.
-- Ties are ordered by key for determinism (counts are identical either way).

create or replace function public.thought_stats(p_project_id uuid default null)
returns jsonb
language sql
stable
security invoker
as $$
  with filtered as (
    select metadata, created_at
    from public.thoughts
    where archived_at is null
      and (
        p_project_id is null
        or metadata @> jsonb_build_object(
             'references',
             jsonb_build_object('projects', jsonb_build_array(p_project_id::text))
           )
      )
  ),
  type_counts as (
    select metadata ->> 'type' as key, count(*)::int as count
    from filtered
    where coalesce(metadata ->> 'type', '') <> ''
    group by metadata ->> 'type'
    order by count desc, key asc
    limit 10
  ),
  topic_counts as (
    select topic as key, count(*)::int as count
    from filtered,
      lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(metadata -> 'topics') = 'array' then metadata -> 'topics'
          else '[]'::jsonb
        end
      ) as topic
    group by topic
    order by count desc, key asc
    limit 10
  ),
  people_counts as (
    select person as key, count(*)::int as count
    from filtered,
      lateral jsonb_array_elements_text(
        case
          when jsonb_typeof(metadata -> 'people') = 'array' then metadata -> 'people'
          else '[]'::jsonb
        end
      ) as person
    group by person
    order by count desc, key asc
    limit 10
  )
  select jsonb_build_object(
    'total', (select count(*)::int from filtered),
    'oldest', (select min(created_at) from filtered),
    'newest', (select max(created_at) from filtered),
    'types', coalesce(
      (select jsonb_agg(jsonb_build_object('key', key, 'count', count)) from type_counts),
      '[]'::jsonb
    ),
    'topics', coalesce(
      (select jsonb_agg(jsonb_build_object('key', key, 'count', count)) from topic_counts),
      '[]'::jsonb
    ),
    'people', coalesce(
      (select jsonb_agg(jsonb_build_object('key', key, 'count', count)) from people_counts),
      '[]'::jsonb
    )
  );
$$;

-- EXECUTE is service_role only, consistent with 20260704000001. The default
-- privileges set there already revoke from public/anon/authenticated for new
-- functions, but state it explicitly so this RPC's grants are self-documenting
-- and independently verifiable.
revoke execute on function public.thought_stats(uuid) from public, anon, authenticated;
grant execute on function public.thought_stats(uuid) to service_role;
