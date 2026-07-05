-- Test projects
insert into public.projects (id, name, type, description) values
  ('00000000-0000-0000-0000-000000000001', 'Test Proj', 'client', 'Main client project'),
  ('00000000-0000-0000-0000-000000000002', 'Terrestrial Brain', 'internal', 'Personal AI knowledge system'),
  ('00000000-0000-0000-0000-000000000003', 'Test Proj Backend', 'client', 'Backend services for Test Proj')
    -- parent will be set below
;

update public.projects
  set parent_id = '00000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-000000000003';

-- Test people
insert into public.people (id, name, type, email, description) values
  ('00000000-0000-0000-0000-100000000001', 'Alice', 'human', 'alice@example.com', 'Project lead for Test Proj'),
  ('00000000-0000-0000-0000-100000000002', 'Claude', 'ai', null, 'AI assistant for Terrestrial Brain');

-- Test tasks
insert into public.tasks (content, status, project_id) values
  ('Set up local Supabase dev environment', 'done', '00000000-0000-0000-0000-000000000002'),
  ('Write migration files for new tables', 'open', '00000000-0000-0000-0000-000000000002'),
  ('Refactor edge function into modules', 'open', '00000000-0000-0000-0000-000000000002');

-- Test thoughts with project references
insert into public.thoughts (content, metadata) values
  ('Test Proj Backend needs response caching for the record lookup endpoint.',
   '{"type": "observation", "topics": ["Test Proj", "caching"], "references": {"project_id": "00000000-0000-0000-0000-000000000001"}}'),
  ('Terrestrial Brain should support 2-way sync with Obsidian so the AI can write notes back to the human.',
   '{"type": "idea", "topics": ["Terrestrial Brain", "Obsidian"], "references": {"project_id": "00000000-0000-0000-0000-000000000002"}}');

-- Test thoughts with new-format references, reliability, and author (for list/search provenance tests)
insert into public.thoughts (content, metadata, reliability, author) values
  ('The MCP server should batch project name resolution for performance.',
   '{"type": "observation", "topics": ["MCP", "performance"], "source": "mcp", "references": {"projects": ["00000000-0000-0000-0000-000000000002"]}}',
   'reliable', 'claude-sonnet-4-6'),
  ('Test Proj record search latency is above the 100ms SLA target.',
   '{"type": "observation", "topics": ["Test Proj", "latency"], "source": "obsidian", "references": {"projects": ["00000000-0000-0000-0000-000000000001"]}}',
   'less reliable', 'gpt-4o-mini');

-- Test AI output (pending)
insert into public.ai_output (title, content, file_path, source_context) values
  ('Test Proj Caching Proposal',
   E'# Caching Proposal\n\nBased on recent thoughts captured about Test Proj Backend performance...',
   'projects/Test Proj/caching-proposal.md',
   'Seed data for testing');
