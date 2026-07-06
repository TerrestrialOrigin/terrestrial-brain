// ─── Sync engine ─────────────────────────────────────────────────────────────
// Owns note processing: debounced auto-sync with capped-backoff retry, the
// manual full-vault sync, and vault delete/rename lifecycle. Depends only on the
// injected ports + API client — no direct Obsidian App reference — so its logic
// is unit-testable with fakes.

import { TFile } from "obsidian";
import { TerrestrialBrainApiClient } from "./apiClient";
import {
  FileClassifier,
  NoteReader,
  SyncedHashStore,
  UserNotifier,
} from "./ports";
import { simpleHash, stripFrontmatter, truncateForNotice } from "./utils";

/** Outcome of a single processNote call — lets callers count real results. */
export type SyncOutcome = "synced" | "skipped" | "failed";

/** Maximum automatic retries for a failed scheduled (debounced) sync. */
export const MAX_RETRY_ATTEMPTS = 3;

/** Upper bound on the backoff delay between scheduled-sync retries. */
export const MAX_RETRY_DELAY_MS = 30 * 60000; // 30 minutes

export interface SyncEngineConfig {
  getEndpointUrl(): string;
  getSyncDelayMs(): number;
}

export interface SyncEngineDeps {
  client: TerrestrialBrainApiClient;
  reader: NoteReader;
  classifier: FileClassifier;
  notifier: UserNotifier;
  hashes: SyncedHashStore;
  config: SyncEngineConfig;
}

export class SyncEngine {
  // Per-file debounce timers — managed manually for the long (minutes) delay.
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(private readonly deps: SyncEngineDeps) {}

  /** For lifecycle cleanup on plugin unload. */
  clearAllTimers(): void {
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  get pendingTimerCount(): number {
    return this.debounceTimers.size;
  }

  // ─── Per-file debounce timer ───────────────────────────────────────────────
  // Each file gets its own timer. Editing the file resets its timer. Only fires
  // after the sync delay of inactivity on that specific file.

  scheduleSync(file: TFile, attempt = 0): void {
    this.cancelTimer(file.path);
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(file.path);
      try {
        const outcome = await this.processNote(file);
        // A failed scheduled sync retries with capped backoff instead of
        // silently dropping the note until its next manual edit.
        if (outcome === "failed" && attempt < MAX_RETRY_ATTEMPTS) {
          this.scheduleSync(file, attempt + 1);
        }
      } catch (error) {
        // Guards against an unhandled rejection if processNote itself throws
        // (e.g. the file was deleted during the debounce delay).
        console.error("TB scheduled sync error:", error);
        if (attempt < MAX_RETRY_ATTEMPTS) {
          this.scheduleSync(file, attempt + 1);
        }
      }
    }, this.computeSyncDelay(attempt));
    this.debounceTimers.set(file.path, timer);
  }

  /** Base debounce delay, or an exponentially-backed-off (capped) retry delay. */
  private computeSyncDelay(attempt: number): number {
    const base = this.deps.config.getSyncDelayMs();
    if (attempt === 0) return base;
    return Math.min(base * 2 ** attempt, MAX_RETRY_DELAY_MS);
  }

  cancelTimer(filePath: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
      this.debounceTimers.delete(filePath);
    }
  }

  /**
   * A deleted note: erase its backend data (GDPR right-to-erasure, Step 25),
   * drop any pending timer, and forget its stored hash. The backend forget is
   * best-effort — a failure surfaces a Notice but never throws out of the
   * handler, and the local hash cleanup still runs so a later sync/forget can
   * reconcile. Only eligible (non-excluded) markdown notes are erased.
   */
  async handleFileDelete(file: TFile): Promise<void> {
    this.cancelTimer(file.path);
    await this.forgetBackendData(file);
    if (this.deps.hashes.get(file.path) !== undefined) {
      this.deps.hashes.delete(file.path);
      await this.deps.hashes.persist();
    }
  }

  /**
   * Ask the backend to erase a note's snapshot + thoughts. Idempotent server-
   * side, so calling it for a never-synced note is a harmless no-op. Guarded so
   * a network failure or classifier error can never break the delete handler.
   */
  private async forgetBackendData(file: TFile): Promise<void> {
    if (!this.deps.config.getEndpointUrl()) return;
    try {
      if (this.deps.classifier.isExcluded(file)) return;
      await this.deps.client.forgetNote(file.path);
    } catch (error) {
      this.deps.notifier.notify(
        `⚠️ Terrestrial Brain: could not erase "${file.path}": ${
          truncateForNotice(error instanceof Error ? error.message : String(error))
        }`,
      );
    }
  }

  /**
   * Explicit user command: erase a note's backend data while KEEPING the vault
   * file. Surfaces the outcome as a Notice (success or failure) and drops the
   * local hash so a later edit re-syncs. Never throws.
   */
  async forgetNote(file: TFile): Promise<void> {
    try {
      const message = await this.deps.client.forgetNote(file.path);
      if (this.deps.hashes.get(file.path) !== undefined) {
        this.deps.hashes.delete(file.path);
        await this.deps.hashes.persist();
      }
      this.deps.notifier.notify(`🧠 ${message}`);
    } catch (error) {
      this.deps.notifier.notify(
        `⚠️ Could not forget "${file.path}": ${
          truncateForNotice(error instanceof Error ? error.message : String(error))
        }`,
      );
    }
  }

  /** A renamed note: cancel the old-path timer and re-key its hash. */
  async handleFileRename(file: TFile, oldPath: string): Promise<void> {
    this.cancelTimer(oldPath);
    const existing = this.deps.hashes.get(oldPath);
    if (existing !== undefined) {
      this.deps.hashes.set(file.path, existing);
      this.deps.hashes.delete(oldPath);
      await this.deps.hashes.persist();
    }
  }

  // ─── Manual full-vault sync ────────────────────────────────────────────────

  /**
   * Sync every eligible file, counting real outcomes from processNote's return
   * value so a total failure reports failure instead of a false success.
   */
  async syncEntireVault(
    eligible: TFile[],
  ): Promise<{ synced: number; failed: number; skipped: number }> {
    if (eligible.length === 0) {
      this.deps.notifier.notify("No notes to sync (all excluded or vault empty)");
      return { synced: 0, failed: 0, skipped: 0 };
    }

    this.deps.notifier.notify(`🧠 Syncing ${eligible.length} notes...`);
    let synced = 0;
    let failed = 0;
    let skipped = 0;
    for (const file of eligible) {
      this.cancelTimer(file.path);
      const outcome = await this.processNote(file, { force: true, silent: true });
      if (outcome === "synced") synced++;
      else if (outcome === "failed") failed++;
      else skipped++;
    }

    const skippedSuffix = skipped > 0 ? `, ${skipped} skipped` : "";
    this.deps.notifier.notify(
      failed === 0
        ? `✅ Vault sync complete — ${synced} synced${skippedSuffix}`
        : `⚠️ Vault sync: ${synced} ok, ${failed} failed${skippedSuffix}`,
    );
    return { synced, failed, skipped };
  }

  // ─── Core note processing ──────────────────────────────────────────────────

  async processNote(
    file: TFile,
    opts: { force?: boolean; silent?: boolean } = {},
  ): Promise<SyncOutcome> {
    if (this.deps.classifier.isExcluded(file)) {
      if (opts.force && !opts.silent) {
        this.deps.notifier.notify(`⏭️ "${file.basename}" is excluded from Terrestrial Brain`);
      }
      return "skipped";
    }

    if (!this.deps.config.getEndpointUrl()) {
      this.deps.notifier.notify("⚠️ Terrestrial Brain: Set your MCP endpoint URL in settings");
      return "skipped";
    }

    let content: string;
    try {
      content = await this.deps.reader.read(file);
    } catch (error) {
      // The file may have been deleted between the modify event and this read.
      console.error("TB Plugin read error:", error);
      return "skipped";
    }

    const stripped = stripFrontmatter(content).trim();
    if (!stripped) return "skipped";

    const hash = simpleHash(stripped);
    if (!opts.force && this.deps.hashes.get(file.path) === hash) return "skipped";

    if (!opts.silent) {
      this.deps.notifier.notify(`🧠 Syncing "${file.basename}"...`, 2000);
    }

    try {
      const result = await this.deps.client.ingestNote(stripped, file.basename, file.path);

      this.deps.hashes.set(file.path, hash);
      await this.deps.hashes.persist();

      if (!opts.silent) {
        this.deps.notifier.notify(`✅ ${result}`);
      }
      return "synced";
    } catch (error) {
      console.error("TB Plugin error:", error);
      if (!opts.silent) {
        this.deps.notifier.notify(`❌ Terrestrial Brain: ${truncateForNotice((error as Error).message)}`);
      }
      return "failed";
    }
  }
}
