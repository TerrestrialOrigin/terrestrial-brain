// ─── Terrestrial Brain Sync — composition root ───────────────────────────────
// This file wires the Obsidian-backed adapters to the framework-free SyncEngine
// and AiOutputPoller, and registers vault events, commands, the ribbon menu, and
// the settings tab. All business logic lives in the extracted modules; main.ts
// only composes and adapts.

import { App, Menu, Notice, Plugin, TFile } from "obsidian";
import { HttpTerrestrialBrainClient, TerrestrialBrainApiClient } from "./apiClient";
import { AIOutputConfirmModal, ConfirmationResult, ConflictInfo } from "./confirmModal";
import { AiOutputPoller } from "./aiOutputPoller";
import { SyncEngine } from "./syncEngine";
import {
  ConflictPrompt,
  FileClassifier,
  NoteReader,
  SyncedHashStore,
  UserNotifier,
  VaultWriter,
} from "./ports";
import {
  DEFAULT_SETTINGS,
  mergeAndMigrateSettings,
  TBPluginSettings,
  TBSettingTab,
} from "./settings";
import { AIOutputMetadata } from "./apiClient";
import { isExcludedByCache } from "./utils";

export default class TerrestrialBrainPlugin extends Plugin {
  settings!: TBPluginSettings;

  // Persisted hash cache — survives Obsidian restarts, prevents duplicate syncs.
  private syncedHashes: Record<string, string> = {};

  // Tracked poll interval so it can be cleared and re-registered when settings change.
  private pollIntervalId: number | null = null;

  // The pollIntervalMinutes value the current interval was registered with —
  // lets applyPollInterval() no-op when the setting has not actually changed.
  private appliedPollIntervalMinutes: number | null = null;

  private client!: TerrestrialBrainApiClient;
  private engine!: SyncEngine;
  private poller!: AiOutputPoller;

  async onload() {
    await this.loadSettings();
    this.buildCollaborators();
    this.registerVaultEvents();
    this.registerCommands();
    this.registerRibbon();
    this.addSettingTab(new TBSettingTab(this.app, this));
    this.startPolling();
    console.log("Terrestrial Brain Sync loaded");
  }

  onunload() {
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
    }
    this.engine?.clearAllTimers();
  }

  // ─── Composition ───────────────────────────────────────────────────────────

  /** Construct the API client, ports, and the engine/poller from them. */
  private buildCollaborators(): void {
    this.client = new HttpTerrestrialBrainClient({
      getEndpointUrl: () => this.settings.tbEndpointUrl,
      getAccessKey: () => this.settings.accessKey,
    });

    const notifier: UserNotifier = {
      notify: (message, timeoutMs) => {
        if (timeoutMs === undefined) new Notice(message);
        else new Notice(message, timeoutMs);
      },
    };
    const reader: NoteReader = { read: (file) => this.app.vault.read(file) };
    const writer: VaultWriter = {
      write: (path, content) => this.app.vault.adapter.write(path, content),
      mkdir: (folder) => this.app.vault.adapter.mkdir(folder),
      exists: (path) => this.app.vault.adapter.exists(path),
    };
    const classifier: FileClassifier = { isExcluded: (file) => this.isExcluded(file) };
    const hashes: SyncedHashStore = {
      get: (path) => this.syncedHashes[path],
      set: (path, hash) => { this.syncedHashes[path] = hash; },
      delete: (path) => { delete this.syncedHashes[path]; },
      persist: () => this.persistData(),
    };
    const prompt: ConflictPrompt = {
      confirm: (metadataList, conflicts) => this.showConfirmationDialog(metadataList, conflicts),
    };

    this.engine = new SyncEngine({
      client: this.client,
      reader,
      classifier,
      notifier,
      hashes,
      config: {
        getEndpointUrl: () => this.settings.tbEndpointUrl,
        getSyncDelayMs: () => this.settings.syncDelayMinutes * 60000,
      },
    });
    this.poller = new AiOutputPoller({
      client: this.client,
      writer,
      notifier,
      hashes,
      prompt,
      config: { getEndpointUrl: () => this.settings.tbEndpointUrl },
    });
  }

  // ─── Registration ──────────────────────────────────────────────────────────

  private registerVaultEvents(): void {
    // Watch for file modifications — start (or reset) a per-file timer.
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        this.engine.scheduleSync(file);
      }),
    );
    // A deleted note must not keep a pending timer or a stale hash.
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        void this.engine.handleFileDelete(file);
      }),
    );
    // A renamed note must move its timer/hash to the new path.
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (!(file instanceof TFile)) return;
        void this.engine.handleFileRename(file, oldPath);
      }),
    );
  }

  private registerCommands(): void {
    this.addCommand({
      id: "sync-to-terrestrial-brain",
      name: "Sync current note to Terrestrial Brain",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) { new Notice("No active file"); return; }
        this.engine.cancelTimer(file.path);
        await this.engine.processNote(file, { force: true });
      },
    });
    this.addCommand({
      id: "sync-vault-to-terrestrial-brain",
      name: "Sync entire vault to Terrestrial Brain",
      callback: async () => { await this.syncEntireVault(); },
    });
    this.addCommand({
      id: "poll-ai-output",
      name: "Pull AI output from Terrestrial Brain",
      callback: async () => { await this.poller.pollAIOutput({ manual: true }); },
    });
    this.addCommand({
      id: "forget-note-in-terrestrial-brain",
      name: "Forget this note in Terrestrial Brain",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension !== "md") {
          new Notice("Open a note to forget it in Terrestrial Brain");
          return;
        }
        await this.engine.forgetNote(file);
      },
    });
  }

  private registerRibbon(): void {
    this.addRibbonIcon("brain", "Terrestrial Brain", (event: MouseEvent) => {
      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle("Sync note to Terrestrial Brain")
          .setIcon("upload")
          .onClick(async () => {
            const file = this.app.workspace.getActiveFile();
            if (!file) { new Notice("No active file"); return; }
            this.engine.cancelTimer(file.path);
            await this.engine.processNote(file, { force: true });
          });
      });
      menu.addItem((item) => {
        item
          .setTitle("Pull AI Output from Terrestrial Brain")
          .setIcon("download")
          .onClick(async () => { await this.poller.pollAIOutput({ manual: true }); });
      });
      menu.showAtMouseEvent(event);
    });
  }

  private startPolling(): void {
    // Poll for AI output shortly after startup (deferred so onload completes first).
    window.setTimeout(() => this.poller.pollAIOutput(), 2000);
    // Then poll on interval (tracked so it can be re-registered when settings change).
    this.applyPollInterval();
  }

  /** Gather eligible files and hand the full-vault sync to the engine. */
  private async syncEntireVault(): Promise<void> {
    const eligible = this.app.vault.getMarkdownFiles().filter((file) => !this.isExcluded(file));
    await this.engine.syncEntireVault(eligible);
  }

  private showConfirmationDialog(
    metadataList: AIOutputMetadata[],
    conflicts: ConflictInfo,
  ): Promise<ConfirmationResult> {
    return new Promise((resolve) => {
      new AIOutputConfirmModal(this.app, metadataList, conflicts, resolve).open();
    });
  }

  /**
   * (Re)start the AI-output poll interval, but only when `pollIntervalMinutes`
   * actually differs from the value the current interval was registered with.
   * Keeps ordinary saves from starving the poll and prevents stale interval
   * registrations from accumulating (finding C10).
   */
  applyPollInterval(): void {
    if (this.appliedPollIntervalMinutes === this.settings.pollIntervalMinutes) {
      return;
    }
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
    }
    this.pollIntervalId = this.registerInterval(
      window.setInterval(() => this.poller.pollAIOutput(), this.settings.pollIntervalMinutes * 60000),
    );
    this.appliedPollIntervalMinutes = this.settings.pollIntervalMinutes;
  }

  // ─── Exclusion check (Obsidian-coupled; backs the FileClassifier port) ───────

  isExcluded(file: TFile): boolean {
    return isExcludedByCache(this.app.metadataCache.getFileCache(file), this.settings.excludeTag);
  }

  // ─── Settings persistence ────────────────────────────────────────────────────

  async loadSettings(): Promise<void> {
    const data = await this.loadData();
    const { settings, changed } = mergeAndMigrateSettings(data);
    this.settings = settings;
    this.syncedHashes = extractSyncedHashes(data);
    this.pruneStaleHashes();
    if (changed) {
      await this.persistData();
    }
  }

  /** Remove syncedHashes entries for files that no longer exist in the vault. */
  private pruneStaleHashes(): void {
    const existingPaths = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    for (const path of Object.keys(this.syncedHashes)) {
      if (!existingPaths.has(path)) {
        delete this.syncedHashes[path];
      }
    }
  }

  /**
   * Persist settings + hashes to disk. Pure persistence — no side effects.
   * Poll-interval changes are applied separately via applyPollInterval() so
   * frequent saves cannot starve or leak the poll timer (finding C10).
   */
  private async persistData(): Promise<void> {
    await this.saveData({ settings: this.settings, syncedHashes: this.syncedHashes });
  }

  async saveSettings(): Promise<void> {
    await this.persistData();
  }
}

/** Pull a validated syncedHashes map out of raw persisted data. */
function extractSyncedHashes(data: unknown): Record<string, string> {
  if (typeof data !== "object" || data === null) return {};
  const stored = (data as Record<string, unknown>).syncedHashes;
  if (typeof stored !== "object" || stored === null) return {};
  const result: Record<string, string> = {};
  for (const [path, hash] of Object.entries(stored)) {
    if (typeof hash === "string") result[path] = hash;
  }
  return result;
}

// Re-export DEFAULT_SETTINGS for any consumer that imports it from the entrypoint.
export { DEFAULT_SETTINGS };
