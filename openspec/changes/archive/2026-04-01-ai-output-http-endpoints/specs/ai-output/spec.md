## REMOVED Requirements

### Requirement: get_pending_ai_output MCP tool (legacy)
**Reason**: Moved to direct HTTP endpoint at `/get-pending-ai-output`. The tool was only used by the Obsidian plugin, not by AI callers.
**Migration**: Use POST `/get-pending-ai-output` with `x-brain-key` auth. Response format changes from MCP content blocks to `{ success: true, data: [...] }`.

### Requirement: get_pending_ai_output_metadata MCP tool
**Reason**: Moved to direct HTTP endpoint at `/get-pending-ai-output-metadata`. The tool was only used by the Obsidian plugin.
**Migration**: Use POST `/get-pending-ai-output-metadata` with `x-brain-key` auth. Response format changes from MCP content blocks to `{ success: true, data: [...] }`.

### Requirement: fetch_ai_output_content MCP tool
**Reason**: Moved to direct HTTP endpoint at `/fetch-ai-output-content`. The tool was only used by the Obsidian plugin.
**Migration**: Use POST `/fetch-ai-output-content` with body `{ ids: [...] }` and `x-brain-key` auth. Response format changes from MCP content blocks to `{ success: true, data: [...] }`.

### Requirement: mark_ai_output_picked_up MCP tool
**Reason**: Moved to direct HTTP endpoint at `/mark-ai-output-picked-up`. The tool was only used by the Obsidian plugin.
**Migration**: Use POST `/mark-ai-output-picked-up` with body `{ ids: [...] }` and `x-brain-key` auth. Response format changes from MCP content blocks to `{ success: true, message: "..." }`.

### Requirement: reject_ai_output MCP tool
**Reason**: Moved to direct HTTP endpoint at `/reject-ai-output`. The tool was only used by the Obsidian plugin.
**Migration**: Use POST `/reject-ai-output` with body `{ ids: [...] }` and `x-brain-key` auth. Response format changes from MCP content blocks to `{ success: true, message: "..." }`.
