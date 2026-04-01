-- Test projects
insert into public.projects (id, name, type, description) values
  ('00000000-0000-0000-0000-000000000001', 'CarChief', 'client', 'Main client project'),
  ('00000000-0000-0000-0000-000000000002', 'Terrestrial Brain', 'internal', 'Personal AI knowledge system'),
  ('00000000-0000-0000-0000-000000000003', 'CarChief Backend', 'client', 'Backend services for CarChief')
    -- parent will be set below
;

update public.projects
  set parent_id = '00000000-0000-0000-0000-000000000001'
  where id = '00000000-0000-0000-0000-000000000003';

-- Test people
insert into public.people (id, name, type, email, description) values
  ('00000000-0000-0000-0000-100000000001', 'Alice', 'human', 'alice@example.com', 'Project lead for CarChief'),
  ('00000000-0000-0000-0000-100000000002', 'Claude', 'ai', null, 'AI assistant for Terrestrial Brain');

-- Test tasks
insert into public.tasks (content, status, project_id) values
  ('Set up local Supabase dev environment', 'done', '00000000-0000-0000-0000-000000000002'),
  ('Write migration files for new tables', 'open', '00000000-0000-0000-0000-000000000002'),
  ('Refactor edge function into modules', 'open', '00000000-0000-0000-0000-000000000002');

-- Test thoughts with project references
insert into public.thoughts (content, metadata) values
  ('CarChief Backend needs Redis caching for the dealer lookup endpoint.',
   '{"type": "observation", "topics": ["CarChief", "Redis"], "references": {"project_id": "00000000-0000-0000-0000-000000000001"}}'),
  ('Terrestrial Brain should support 2-way sync with Obsidian so the AI can write notes back to the human.',
   '{"type": "idea", "topics": ["Terrestrial Brain", "Obsidian"], "references": {"project_id": "00000000-0000-0000-0000-000000000002"}}');

-- Test thoughts with new-format references, reliability, and author (for list/search provenance tests)
insert into public.thoughts (content, metadata, reliability, author) values
  ('The MCP server should batch project name resolution for performance.',
   '{"type": "observation", "topics": ["MCP", "performance"], "source": "mcp", "references": {"projects": ["00000000-0000-0000-0000-000000000002"]}}',
   'reliable', 'claude-sonnet-4-6'),
  ('CarChief dealer search latency is above the 100ms SLA target.',
   '{"type": "observation", "topics": ["CarChief", "latency"], "source": "obsidian", "references": {"projects": ["00000000-0000-0000-0000-000000000001"]}}',
   'less reliable', 'gpt-4o-mini');

-- Test AI output (pending)
insert into public.ai_output (title, content, file_path, source_context) values
  ('CarChief Redis Caching Proposal',
   E'# Redis Caching Proposal\n\nBased on recent thoughts captured about CarChief Backend performance...',
   'projects/CarChief/redis-caching-proposal.md',
   'Seed data for testing');
