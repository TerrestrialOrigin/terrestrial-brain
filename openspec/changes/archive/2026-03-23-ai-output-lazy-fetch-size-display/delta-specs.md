# Delta Specs: AI Output Lazy Fetch, Size Display, and Empty-Poll Notice

## DS-1: Metadata-only poll

**GIVEN** AI outputs exist that are not picked up and not rejected
**WHEN** the plugin calls `get_pending_ai_output_metadata`
**THEN** the response is a JSON array of objects with fields: `id`, `title`, `file_path`, `content_size` (integer, bytes), `created_at`
**AND** the response does NOT contain a `content` field

## DS-2: Content fetch on accept

**GIVEN** the user clicks "Accept All" in the confirmation dialog
**WHEN** the plugin calls `fetch_ai_output_content` with the pending output IDs
**THEN** the response is a JSON array of objects with fields: `id`, `content`
**AND** only outputs that are still pending (not picked up, not rejected) are returned

## DS-3: No content fetch on reject

**GIVEN** the user clicks "Reject All" in the confirmation dialog
**WHEN** the plugin processes the rejection
**THEN** `fetch_ai_output_content` is NOT called
**AND** `reject_ai_output` IS called with the output IDs

## DS-4: Human-readable file size display

**GIVEN** the confirmation dialog is shown with pending AI outputs
**WHEN** the user views the dialog
**THEN** each output row displays the file size in human-readable format (bytes, KB, MB, or GB as appropriate)
**AND** the size is NOT displayed as a character count

## DS-5: Empty manual poll notice

**GIVEN** the user manually triggers "Pull AI Output" (via command or ribbon menu)
**WHEN** there are no pending AI outputs
**THEN** the plugin shows a notice: "No pending AI output to pull"

## DS-6: Silent automatic poll on empty

**GIVEN** the automatic background poll fires
**WHEN** there are no pending AI outputs
**THEN** no notice is shown to the user

## DS-7: Network failure during content fetch

**GIVEN** the user clicks "Accept All"
**WHEN** the `fetch_ai_output_content` call fails (network error, server error)
**THEN** the plugin shows an error notice
**AND** the outputs are NOT marked as picked up (they remain pending for retry)

## DS-8: Fetch returns empty for already-processed outputs

**GIVEN** outputs were accepted by another client or marked picked-up between metadata poll and content fetch
**WHEN** `fetch_ai_output_content` is called with those IDs
**THEN** an empty array is returned (no error)
