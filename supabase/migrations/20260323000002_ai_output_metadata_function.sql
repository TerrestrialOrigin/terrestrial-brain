-- Returns pending AI output metadata without the content body.
-- content_size is the byte length of the UTF-8 encoded content column.
CREATE OR REPLACE FUNCTION public.get_pending_ai_output_metadata()
RETURNS TABLE (
  id uuid,
  title text,
  file_path text,
  content_size bigint,
  created_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    ao.id,
    ao.title,
    ao.file_path,
    octet_length(ao.content)::bigint AS content_size,
    ao.created_at
  FROM public.ai_output ao
  WHERE ao.picked_up = false
    AND ao.rejected = false
  ORDER BY ao.created_at ASC;
$$;
