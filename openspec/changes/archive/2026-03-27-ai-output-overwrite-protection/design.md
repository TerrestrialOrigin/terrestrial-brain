## Context

The Obsidian plugin polls for AI-generated outputs and writes them to the vault. Currently, if an AI output targets a file path that already exists, the file is silently overwritten. The confirmation dialog (`AIOutputConfirmModal`) shows pending outputs with file path and size, but does not indicate whether any conflict with existing files.

The user has no way to protect local edits from being clobbered by incoming AI output. This is especially risky when the AI regenerates content for an existing note the user has already customized.

### Current flow (relevant section)

1. `pollAIOutput()` fetches metadata → shows `AIOutputConfirmModal`
2. User clicks "Accept All" → `fetchAndDeliverOutputs()` writes every file unconditionally via `this.app.vault.adapter.write(path, content)`
3. Hashes stored under the original `file_path`

## Goals / Non-Goals

**Goals:**

- Detect conflicts (file already exists at target path) before showing the dialog
- Show conflict status per-file in the confirmation dialog — "new" vs. "overwrites existing"
- For each conflicting file, let the user choose: **Overwrite** or **Save as copy**
- Auto-generate the copy name as `Filename(2).md`, incrementing if that name is also taken
- Non-conflicting files require no extra interaction

**Non-Goals:**

- Content merging or diffing (out of scope — this is overwrite-or-rename)
- Per-file accept/reject (rejection stays all-or-nothing)
- Backend/MCP changes (conflict detection is purely client-side)
- Backup or version history of overwritten files

## Decisions

### 1. Conflict detection at dialog display time

**Decision:** Check `this.app.vault.adapter.exists(path)` for each pending output *before* constructing the modal, then pass conflict info into the dialog.

**Why over checking at write time:** The user needs to see conflicts upfront to make an informed decision. Checking only at write time would force a second dialog or silently apply defaults.

**Alternative considered:** Check at write time with a default action. Rejected because users want to see what they're overwriting before committing.

### 2. Per-file overwrite/rename toggle (only for conflicts)

**Decision:** Each conflicting file gets a dropdown or toggle in the dialog: "Overwrite" (default) or "Save as copy". Non-conflicting files show a "new file" badge and no toggle.

**Why "Overwrite" as default:** The existing behavior is overwrite. Users who don't care about conflicts get the same behavior. Users who notice the conflict indicator can switch to "Save as copy" for specific files.

**Alternative considered:** Default to "Save as copy" for safety. Rejected because in many cases the user *wants* the AI to update the existing file (e.g., regenerated project plans). Making the more common action the default reduces friction.

### 3. Copy naming convention: `Filename(N).md`

**Decision:** Strip `.md` extension, append `(2)`, re-add `.md`. If `Filename(2).md` exists, try `(3)`, `(4)`, etc. Cap at 100 attempts to prevent infinite loops (throw error if exhausted).

**Why this pattern:** Matches the user's stated preference (`PrevFilename(2)`). Familiar from OS file copy conventions (Windows, macOS). The number goes in parentheses right before the extension.

**Alternative considered:** Timestamp suffix (e.g., `Filename-2026-03-27.md`). Rejected because it's harder to read and the user explicitly requested numeric suffixes.

### 4. Hash tracking uses the actual written path

**Decision:** If a file is renamed to `Filename(2).md`, store the hash in `syncedHashes["path/to/Filename(2).md"]`, not the original `file_path`. This ensures the `modify` event handler checks the correct path.

**Why:** The re-ingestion prevention hash must match the path Obsidian will fire the `modify` event on. Using the original path would miss the actual written file and cause spurious re-ingestion.

### 5. Conflict resolution stored as a map passed to `fetchAndDeliverOutputs`

**Decision:** The modal returns both the decision ("accepted"/"rejected"/"postponed") and a `Map<string, "overwrite" | "rename">` for conflicting output IDs. `fetchAndDeliverOutputs` receives this map and applies the appropriate action per file.

**Implementation approach:** Extend `AIOutputConfirmModal` to accept conflict info and return resolution choices alongside the decision. The type `AIOutputDecision` becomes a richer result object rather than a simple string union.

### User Error Scenarios

| User error | System response |
|---|---|
| User accepts all but the vault has been modified between conflict check and write (race condition) | Acceptable: conflict check is best-effort UI hint, not a transaction lock. The write proceeds. The window is typically < 1 second. |
| User has 50+ pending outputs all targeting existing files | The scrollable list handles large counts. Each conflict item shows a toggle. No performance concern — `exists()` calls are fast local FS checks. |
| Copy name exhausts 100 attempts | Error notice shown, that specific file is skipped. Remaining files still delivered. |

### Security Analysis

This change is purely client-side UI logic within the Obsidian plugin. No new attack surface:
- No new network calls or API endpoints
- File paths are already validated server-side before insertion into `ai_output`
- The rename logic only appends `(N)` to the stem — no path traversal possible since the directory stays the same
- No user input is used to construct file paths (the rename is fully automatic)

### Test Strategy

| Layer | What to test |
|---|---|
| **Unit** | `generateCopyPath()` utility: basic rename, incrementing, cap at 100. Conflict detection logic. Modal construction with conflict info. Hash stored under actual written path (original vs renamed). |
| **E2E** | Pull AI output that conflicts with existing file → verify overwrite vs. rename behavior in real vault. Verify the renamed file exists with correct content. |

## Risks / Trade-offs

- **[Race condition]** File may be created/deleted between conflict check and write → **Mitigation:** Conflict check is a UI hint, not a guarantee. The write proceeds regardless. Acceptable for a single-user desktop app.
- **[UX complexity]** Per-file toggles add visual noise → **Mitigation:** Only shown for conflicting files. Non-conflicting files just show a clean "new" badge.
- **[Breaking behavioral change]** Existing users expect AI output to always overwrite → **Mitigation:** "Overwrite" is the default selection for conflicts, preserving existing behavior unless the user explicitly changes it.

## Open Questions

_(none — scope is clear and confined to the Obsidian plugin)_
