## 1. Database Migration

- [x] 1.1 Create migration `20260404000002_function_call_logs.sql` with `function_call_logs` table (id, function_name, function_type, input, called_at, error_details, ip_address), RLS enabled, service-role policy, and index on `called_at DESC`

## 2. Logging Utility

- [x] 2.1 Create `supabase/functions/terrestrial-brain-mcp/logger.ts` with `createFunctionCallLogger()` factory, `logCall()` and `logError()` methods, and `extractIpAddress()` helper
- [x] 2.2 Create `withMcpLogging()` higher-order function that wraps MCP tool handlers with logging (log before execution, update error_details on isError responses)

## 3. MCP Tool Instrumentation

- [x] 3.1 Update `tools/thoughts.ts` — wrap all tool handlers (search_thoughts, list_thoughts, thought_stats, capture_thought, get_thought_by_id, update_thought, record_useful_thoughts) with logging
- [x] 3.2 Update `tools/projects.ts` — wrap all tool handlers (create_project, list_projects, get_project, update_project, archive_project) with logging
- [x] 3.3 Update `tools/tasks.ts` — wrap all tool handlers (create_task, list_tasks, get_tasks, update_task, archive_task) with logging
- [x] 3.4 Update `tools/people.ts` — wrap all tool handlers (create_person, list_people, get_person, update_person, archive_person) with logging
- [x] 3.5 Update `tools/documents.ts` — wrap all tool handlers (write_document, get_document, list_documents, update_document) with logging
- [x] 3.6 Update `tools/ai_output.ts` — wrap all MCP tool handlers (create_ai_output, create_tasks_with_output) with logging
- [x] 3.7 Update `tools/queries.ts` — wrap all tool handlers (get_project_summary, get_recent_activity) with logging

## 4. HTTP Endpoint Instrumentation

- [x] 4.1 Update `index.ts` — add IP extraction and logging to all 6 HTTP endpoint blocks (ingest-note, get-pending-ai-output, get-pending-ai-output-metadata, fetch-ai-output-content, mark-ai-output-picked-up, reject-ai-output)

## 5. Ingest-Thought Function Instrumentation

- [x] 5.1 Update `ingest-thought/index.ts` — add logger instance and log the `processMessage()` invocation with message content and any errors

## 6. Testing & Verification

- [x] 6.1 Deploy migration and verify `function_call_logs` table exists with correct schema
- [x] 6.2 Invoke MCP tools and verify log rows are created with correct function_name, function_type, input, and called_at
- [x] 6.3 Trigger an error scenario and verify error_details is populated
- [x] 6.4 Invoke HTTP endpoints and verify log rows with function_type='http'
- [x] 6.5 Verify logging failures do not break tool/endpoint responses (test with console inspection)
