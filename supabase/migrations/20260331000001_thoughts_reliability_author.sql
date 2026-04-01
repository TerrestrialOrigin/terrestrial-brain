-- Add reliability and author columns to thoughts table for provenance tracking
ALTER TABLE public.thoughts
  ADD COLUMN reliability text,
  ADD COLUMN author text;

-- Backfill: all existing thoughts were produced by the GPT-4o-mini extraction pipeline
UPDATE public.thoughts
SET reliability = 'less reliable', author = 'gpt-4o-mini'
WHERE reliability IS NULL;
