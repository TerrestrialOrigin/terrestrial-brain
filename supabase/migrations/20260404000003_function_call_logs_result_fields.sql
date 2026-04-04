-- Add result tracking fields to function call logs
alter table function_call_logs
  add column records_returned integer,
  add column response_characters integer;
