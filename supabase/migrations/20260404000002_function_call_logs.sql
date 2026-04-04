-- Function call logging for MCP tools and HTTP endpoints
create table function_call_logs (
  id uuid primary key default gen_random_uuid(),
  function_name text not null,
  function_type text not null,
  input text,
  called_at timestamptz not null default now(),
  error_details text,
  ip_address text
);

create index idx_function_call_logs_called_at on function_call_logs (called_at desc);

alter table function_call_logs enable row level security;

create policy "Service role full access"
  on function_call_logs for all
  using (auth.role() = 'service_role');
