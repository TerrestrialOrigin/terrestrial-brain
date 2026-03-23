# Test Plan: AI Output Lazy Fetch, Size Display, and Empty-Poll Notice

## Unit Tests (Obsidian Plugin — Vitest)

### formatFileSize utility
| Scenario | Input | Expected Output | Layer |
|----------|-------|-----------------|-------|
| Zero bytes | 0 | "0 bytes" | Unit |
| Small file | 500 | "500 bytes" | Unit |
| Exactly 1 KB | 1024 | "1.0 KB" | Unit |
| Kilobytes | 2560 | "2.5 KB" | Unit |
| Megabytes | 1572864 | "1.5 MB" | Unit |
| Gigabytes | 1610612736 | "1.5 GB" | Unit |

### pollAIOutput with two-phase fetch
| Scenario | Layer |
|----------|-------|
| Calls `get_pending_ai_output_metadata` (not old `get_pending_ai_output`) | Unit |
| On accept: calls `fetch_ai_output_content` with collected IDs, then delivers | Unit |
| On reject: does NOT call `fetch_ai_output_content`, calls `reject_ai_output` | Unit |
| Content hash is computed from fetched content (not from metadata) | Unit |
| Dialog receives metadata with `content_size` field (no `content` field) | Unit |

### Empty-poll notice
| Scenario | Layer |
|----------|-------|
| Manual poll with no pending outputs shows notice | Unit |
| Automatic poll with no pending outputs does NOT show notice | Unit |

### Dialog size display
| Scenario | Layer |
|----------|-------|
| Dialog shows formatted file size (not character count) | Unit |

## Integration Tests (Deno — against Supabase emulator)

### get_pending_ai_output_metadata
| Scenario | Layer |
|----------|-------|
| Returns metadata with content_size but no content body | Integration |
| content_size matches actual byte length of stored content | Integration |
| Filters out picked-up and rejected outputs | Integration |

### fetch_ai_output_content
| Scenario | Layer |
|----------|-------|
| Returns content for valid pending IDs | Integration |
| Returns empty array for already-picked-up IDs | Integration |
| Returns empty array for rejected IDs | Integration |
| Returns empty array for non-existent IDs | Integration |
