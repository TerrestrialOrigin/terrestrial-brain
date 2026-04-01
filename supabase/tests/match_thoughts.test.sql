BEGIN;
SELECT plan(9);

-- ─── Setup: insert thoughts with known embeddings ────────────────────────────
-- Using 1536-dimensional vectors. We create simple unit vectors along different axes
-- so we can control similarity precisely.

-- Create a "base" vector: all zeros except position 0 = 1.0
-- This gives us a known direction to compare against
INSERT INTO public.thoughts (id, content, embedding, metadata)
VALUES (
  'dddddddd-0000-0000-0000-000000000001',
  'High similarity thought',
  ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
  '{"type": "observation", "topics": ["test"]}'
);

-- Create a thought with the same direction (identical vector = similarity 1.0)
INSERT INTO public.thoughts (id, content, embedding, metadata)
VALUES (
  'dddddddd-0000-0000-0000-000000000002',
  'Identical direction thought',
  ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
  '{"type": "idea", "topics": ["test"]}'
);

-- Create a thought along a different axis (orthogonal = similarity 0.0)
INSERT INTO public.thoughts (id, content, embedding, metadata)
VALUES (
  'dddddddd-0000-0000-0000-000000000003',
  'Orthogonal thought',
  ('[' || array_to_string(ARRAY[0.0, 1.0] || array_fill(0.0::float, ARRAY[1534]), ',') || ']')::vector(1536),
  '{"type": "observation", "topics": ["unrelated"]}'
);

-- ─── match_thoughts returns results above threshold ──────────────────────────

-- Query with the same direction as thoughts 1 and 2, threshold 0.5
SELECT is(
  (SELECT count(*)::int FROM match_thoughts(
    ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
    0.5,
    10
  ) WHERE id IN ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000003')),
  2,
  'match_thoughts with threshold 0.5 returns only thoughts above threshold (2 similar, not the orthogonal one)'
);

-- The orthogonal thought should NOT appear with threshold > 0
SELECT ok(
  NOT EXISTS(
    SELECT 1 FROM match_thoughts(
      ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
      0.1,
      10
    ) WHERE id = 'dddddddd-0000-0000-0000-000000000003'
  ),
  'Orthogonal thought (similarity ~0) does not appear with threshold 0.1'
);

-- ─── match_thoughts respects match_count ─────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM match_thoughts(
    ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
    0.5,
    1
  ) WHERE id IN ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')),
  1,
  'match_thoughts with match_count=1 returns at most 1 result even when 2 match'
);

-- ─── Similarity values are correct ──────────────────────────────────────────

-- Identical vectors should have similarity ~1.0
SELECT ok(
  (SELECT similarity FROM match_thoughts(
    ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
    0.5,
    10
  ) WHERE id = 'dddddddd-0000-0000-0000-000000000001') > 0.99,
  'Identical vector returns similarity > 0.99'
);

-- With threshold 0.99, only exact matches should return
SELECT is(
  (SELECT count(*)::int FROM match_thoughts(
    ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
    0.99,
    10
  ) WHERE id IN ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002', 'dddddddd-0000-0000-0000-000000000003')),
  2,
  'Threshold 0.99 returns only exact-match vectors (similarity ~1.0)'
);

-- ─── match_thoughts respects filter_author ──────────────────────────────────

-- Tag thoughts 1 and 2 with different authors
UPDATE public.thoughts SET author = 'model-a', reliability = 'reliable'
  WHERE id = 'dddddddd-0000-0000-0000-000000000001';
UPDATE public.thoughts SET author = 'model-b', reliability = 'less reliable'
  WHERE id = 'dddddddd-0000-0000-0000-000000000002';

SELECT is(
  (SELECT count(*)::int FROM match_thoughts(
    ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
    0.5,
    10,
    '{}',
    'model-a',
    NULL
  ) WHERE id IN ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')),
  1,
  'filter_author=model-a returns only model-a thought (1 of 2 similar)'
);

SELECT is(
  (SELECT author FROM match_thoughts(
    ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
    0.5,
    10,
    '{}',
    'model-a',
    NULL
  ) WHERE id = 'dddddddd-0000-0000-0000-000000000001'),
  'model-a',
  'filter_author=model-a returns the correct author value'
);

-- ─── match_thoughts respects filter_reliability ─────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM match_thoughts(
    ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
    0.5,
    10,
    '{}',
    NULL,
    'less reliable'
  ) WHERE id IN ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')),
  1,
  'filter_reliability=less reliable returns only the less-reliable thought'
);

-- ─── match_thoughts with both filters ───────────────────────────────────────

SELECT is(
  (SELECT count(*)::int FROM match_thoughts(
    ('[' || array_to_string(ARRAY[1.0] || array_fill(0.0::float, ARRAY[1535]), ',') || ']')::vector(1536),
    0.5,
    10,
    '{}',
    'model-a',
    'reliable'
  ) WHERE id IN ('dddddddd-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')),
  1,
  'filter_author=model-a AND filter_reliability=reliable returns exactly the matching thought'
);

SELECT * FROM finish();
ROLLBACK;
