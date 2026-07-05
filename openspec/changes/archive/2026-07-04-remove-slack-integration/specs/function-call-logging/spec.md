## REMOVED Requirements

### Requirement: Ingest-thought function invocations are logged
**Reason**: The `ingest-thought` Edge Function (Slack capture integration) is removed entirely — the integration is unused, and the function no longer exists to produce log entries.
**Migration**: None required. Thought capture continues through the MCP `capture_thought` tool and the plugin `ingest_note` path, whose logging requirements ("MCP tool invocations are logged", "HTTP endpoint invocations are logged") are unchanged. Existing `function_call_logs` rows with `function_name = 'ingest-thought'` remain as historical data.

#### Scenario: Slack message processing is logged
- **WHEN** the `ingest-thought` function processes a Slack message
- **THEN** a row is inserted into `function_call_logs` with `function_name = 'ingest-thought'` and the message text as input

#### Scenario: Failed Slack processing logs the error
- **WHEN** the `ingest-thought` function encounters an error during processing
- **THEN** `error_details` is updated with the error message
