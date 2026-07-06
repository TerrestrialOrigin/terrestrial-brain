// ─── Injected ports ──────────────────────────────────────────────────────────
// Narrow interfaces the sync engine and AI-output poller depend on, so their
// logic is unit-testable with fakes — no Obsidian App fake required. The
// production adapters wrapping the real Obsidian API are constructed once in the
// composition root (main.ts), following the generateCopyPath(existsCheck)
// dependency-injection pattern.

import { TFile } from "obsidian";
import { AIOutputMetadata } from "./apiClient";
import { ConfirmationResult } from "./confirmModal";

/** Reads note content from the vault. */
export interface NoteReader {
  read(file: TFile): Promise<string>;
}

/** Writes files, creates folders, and probes existence in the vault. */
export interface VaultWriter {
  write(path: string, content: string): Promise<void>;
  mkdir(folder: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

/** Surfaces a message to the user (wraps Obsidian's Notice). */
export interface UserNotifier {
  notify(message: string, timeoutMs?: number): void;
}

/** Decides whether a file is excluded from syncing (wraps metadataCache). */
export interface FileClassifier {
  isExcluded(file: TFile): boolean;
}

/**
 * The persisted content-hash cache (filePath → hash). Shared by the sync engine
 * (writes on sync) and the poller (writes on delivery); persistence is a single
 * disk write shared with settings.
 */
export interface SyncedHashStore {
  get(path: string): string | undefined;
  set(path: string, hash: string): void;
  delete(path: string): void;
  persist(): Promise<void>;
}

/** Opens the confirmation dialog and resolves with the user's decision. */
export interface ConflictPrompt {
  confirm(
    metadataList: AIOutputMetadata[],
    conflicts: Record<string, boolean>,
  ): Promise<ConfirmationResult>;
}
