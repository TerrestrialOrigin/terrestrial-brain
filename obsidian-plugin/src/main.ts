import {
  App,
  Menu,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AIOutputMetadata {
  id: string;
  title: string;
  file_path: string;
  content_size: number;
  created_at: string;
}

interface AIOutputContent {
  id: string;
  content: string;
}

type AIOutputDecision = "accepted" | "rejected" | "postponed";

/** Maps output ID → true if its file_path conflicts with an existing vault file. */
type ConflictInfo = Record<string, boolean>;

/** Maps conflicting output ID → user's chosen resolution. */
type ConflictResolution = Map<string, "overwrite" | "rename">;

/** Result returned by the confirmation dialog — decision plus per-file conflict choices. */
interface ConfirmationResult {
  decision: AIOutputDecision;
  resolutions: ConflictResolution;
}

// ─── Settings ────────────────────────────────────────────────────────────────

interface TBPluginSettings {
  tbEndpointUrl: string;
  excludeTag: string;
  syncDelayMinutes: number;
  pollIntervalMinutes: number;
  projectsFolderBase: string;
}

const DEFAULT_SETTINGS: TBPluginSettings = {
  tbEndpointUrl: "",
  excludeTag: "tbExclude",
  syncDelayMinutes: 5,
  pollIntervalMinutes: 10,
  projectsFolderBase: "projects",
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class TerrestrialBrainPlugin extends Plugin {
  settings: TBPluginSettings;

  // Persisted hash cache — survives Obsidian restarts, prevents duplicate syncs
  private syncedHashes: Record<string, string> = {};

  // Per-file debounce timers — we manage these manually for the long 5-min delay
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Guard to prevent overlapping poll cycles while a confirmation dialog is open
  private pollInProgress = false;

  // Tracked poll interval so it can be cleared and re-registered when settings change
  private pollIntervalId: number | null = null;

  async onload() {
    await this.loadSettings();

    // Watch for file modifications — start (or reset) a per-file timer
    this.registerEvent(
      this.app.vault.on("modify", (file: TFile) => {
        if (file.extension !== "md") return;
        this.scheduleSync(file);
      })
    );

    // Manual sync — current note (bypasses timer)
    this.addCommand({
      id: "sync-to-terrestrial-brain",
      name: "Sync current note to Terrestrial Brain",
      callback: async () => {
        const file = this.app.workspace.getActiveFile();
        if (!file) { new Notice("No active file"); return; }
        this.cancelTimer(file.path);
        await this.processNote(file, { force: true });
      },
    });

    // Manual sync — entire vault
    this.addCommand({
      id: "sync-vault-to-terrestrial-brain",
      name: "Sync entire vault to Terrestrial Brain",
      callback: async () => {
        const files = this.app.vault.getMarkdownFiles();
        const eligible = files.filter((f) => !this.isExcluded(f));
        if (eligible.length === 0) {
          new Notice("No notes to sync (all excluded or vault empty)");
          return;
        }
        const notice = new Notice(`🧠 Syncing ${eligible.length} notes...`, 0);
        let done = 0;
        let failed = 0;
        for (const file of eligible) {
          this.cancelTimer(file.path);
          try {
            await this.processNote(file, { force: true, silent: true });
            done++;
          } catch {
            failed++;
          }
          notice.setMessage(`🧠 Syncing vault... ${done + failed}/${eligible.length}`);
        }
        notice.hide();
        new Notice(
          failed === 0
            ? `✅ Vault sync complete — ${done} notes sent`
            : `⚠️ Vault sync: ${done} ok, ${failed} failed`
        );
      },
    });

    // Ribbon icon — context menu with sync and pull options
    this.addRibbonIcon("brain", "Terrestrial Brain", (event: MouseEvent) => {
      const menu = new Menu();

      menu.addItem((item) => {
        item
          .setTitle("Sync note to Terrestrial Brain")
          .setIcon("upload")
          .onClick(async () => {
            const file = this.app.workspace.getActiveFile();
            if (!file) { new Notice("No active file"); return; }
            this.cancelTimer(file.path);
            await this.processNote(file, { force: true });
          });
      });

      menu.addItem((item) => {
        item
          .setTitle("Pull AI Output from Terrestrial Brain")
          .setIcon("download")
          .onClick(async () => {
            await this.pollAIOutput({ manual: true });
          });
      });

      menu.showAtMouseEvent(event);
    });

    // Manual poll for AI output
    this.addCommand({
      id: "poll-ai-output",
      name: "Pull AI output from Terrestrial Brain",
      callback: async () => {
        await this.pollAIOutput({ manual: true });
      },
    });

    this.addSettingTab(new TBSettingTab(this.app, this));

    // Poll for AI output shortly after startup (deferred so onload completes first)
    window.setTimeout(() => this.pollAIOutput(), 2000);

    // Then poll on interval (tracked so it can be re-registered when settings change)
    this.startPollInterval();

    console.log("Terrestrial Brain Sync loaded");
  }

  onunload() {
    // Clear the poll interval
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
    }

    // Clear all pending timers on plugin unload
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  /** Start (or restart) the AI output poll interval using current settings. */
  private startPollInterval() {
    if (this.pollIntervalId !== null) {
      window.clearInterval(this.pollIntervalId);
    }
    this.pollIntervalId = this.registerInterval(
      window.setInterval(() => this.pollAIOutput(), this.settings.pollIntervalMinutes * 60000)
    );
  }

  // ─── Per-file debounce timer ───────────────────────────────────────────────
  // Each file gets its own timer. Editing the file resets its timer.
  // Only fires after debounceMs of inactivity on that specific file.

  scheduleSync(file: TFile) {
    this.cancelTimer(file.path);
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(file.path);
      await this.processNote(file);
    }, this.settings.syncDelayMinutes * 60000);
    this.debounceTimers.set(file.path, timer);
  }

  cancelTimer(filePath: string) {
    const existing = this.debounceTimers.get(filePath);
    if (existing) {
      clearTimeout(existing);
      this.debounceTimers.delete(filePath);
    }
  }

  // ─── AI Output Polling ─────────────────────────────────────────────────────

  async pollAIOutput(options: { manual?: boolean } = {}) {
    if (!this.settings.tbEndpointUrl) return;
    if (this.pollInProgress) return;

    this.pollInProgress = true;
    try {
      // Phase 1: Fetch metadata only (no content body)
      const metadataResponse = await this.callHTTP("get-pending-ai-output-metadata");
      const metadataList: AIOutputMetadata[] = metadataResponse.data as AIOutputMetadata[];

      if (!metadataList.length) {
        if (options.manual) {
          new Notice("No pending AI output to pull");
        }
        return;
      }

      // Detect conflicts: check which outputs target existing vault files
      const conflicts: ConflictInfo = {};
      for (const metadata of metadataList) {
        conflicts[metadata.id] = await this.app.vault.adapter.exists(metadata.file_path);
      }

      const result = await this.showConfirmationDialog(metadataList, conflicts);

      if (result.decision === "accepted") {
        await this.fetchAndDeliverOutputs(metadataList, result.resolutions);
      } else if (result.decision === "rejected") {
        await this.rejectOutputs(metadataList);
      }
      // "postponed" — do nothing; outputs remain pending in DB
    } catch (err) {
      console.error("TB Poll error:", err);
    } finally {
      this.pollInProgress = false;
    }
  }

  private showConfirmationDialog(
    metadataList: AIOutputMetadata[],
    conflicts: ConflictInfo,
  ): Promise<ConfirmationResult> {
    return new Promise((resolve) => {
      const modal = new AIOutputConfirmModal(this.app, metadataList, conflicts, resolve);
      modal.open();
    });
  }

  private async fetchAndDeliverOutputs(
    metadataList: AIOutputMetadata[],
    resolutions: ConflictResolution,
  ) {
    const ids = metadataList.map((metadata) => metadata.id);

    // Phase 2: Fetch full content only after user accepted
    const contentResponse = await this.callHTTP("fetch-ai-output-content", { ids });
    const contentList: AIOutputContent[] = contentResponse.data as AIOutputContent[];

    // Build a lookup map for content by ID
    const contentById = new Map<string, string>();
    for (const item of contentList) {
      contentById.set(item.id, item.content);
    }

    const deliveredIds: string[] = [];
    for (const metadata of metadataList) {
      const content = contentById.get(metadata.id);
      if (!content && content !== "") continue; // skip if content was not returned (already processed)

      // Determine write path — rename if user chose "Save as copy"
      let writePath = metadata.file_path;
      const resolution = resolutions.get(metadata.id);
      if (resolution === "rename") {
        try {
          writePath = await generateCopyPath(
            metadata.file_path,
            (path) => this.app.vault.adapter.exists(path),
          );
        } catch (error) {
          new Notice(`⚠️ ${(error as Error).message}`);
          continue; // skip this file, deliver remaining
        }
      }

      // Ensure parent folders exist
      const folder = writePath.substring(0, writePath.lastIndexOf("/"));
      if (folder) await this.app.vault.adapter.mkdir(folder);

      // Write the file
      await this.app.vault.adapter.write(writePath, content);

      // Store hash under the actual written path so modify event doesn't trigger re-ingestion
      const contentHash = simpleHash(stripFrontmatter(content).trim());
      this.syncedHashes[writePath] = contentHash;

      deliveredIds.push(metadata.id);
    }

    if (deliveredIds.length > 0) {
      await this.callHTTP("mark-ai-output-picked-up", { ids: deliveredIds });
      await this.saveSettings();
      new Notice(`🧠 ${deliveredIds.length} AI output${deliveredIds.length > 1 ? "s" : ""} delivered to vault`);
    }
  }

  private async rejectOutputs(metadataList: AIOutputMetadata[]) {
    const ids = metadataList.map((metadata) => metadata.id);
    await this.callHTTP("reject-ai-output", { ids });
    new Notice(`🧠 ${ids.length} AI output${ids.length > 1 ? "s" : ""} rejected`);
  }

  // ─── Core Logic ────────────────────────────────────────────────────────────

  async processNote(
    file: TFile,
    opts: { force?: boolean; silent?: boolean } = {}
  ) {
    if (this.isExcluded(file)) {
      if (opts.force && !opts.silent) {
        new Notice(`⏭️ "${file.basename}" is excluded from Terrestrial Brain`);
      }
      return;
    }

    if (!this.settings.tbEndpointUrl) {
      new Notice("⚠️ Terrestrial Brain: Set your MCP endpoint URL in settings");
      return;
    }

    const content = await this.app.vault.read(file);
    const stripped = stripFrontmatter(content).trim();
    if (!stripped) return;

    const hash = simpleHash(stripped);
    if (!opts.force && this.syncedHashes[file.path] === hash) return;

    if (!opts.silent) {
      new Notice(`🧠 Syncing "${file.basename}"...`, 2000);
    }

    try {
      const result = await this.callIngestNote(stripped, file.basename, file.path);

      this.syncedHashes[file.path] = hash;
      await this.saveSettings();

      if (!opts.silent) {
        new Notice(`✅ ${result}`);
      }
    } catch (err) {
      console.error("TB Plugin error:", err);
      if (!opts.silent) {
        new Notice(`❌ Terrestrial Brain: ${(err as Error).message}`);
      }
    }
  }

  // ─── Exclusion Check ───────────────────────────────────────────────────────

  isExcluded(file: TFile): boolean {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return false;

    const excludeTag = this.settings.excludeTag.replace(/^#/, "");

    // Check standalone frontmatter boolean (e.g. terrestrialBrainExclude: true)
    if (cache.frontmatter?.[excludeTag] === true) return true;

    const excludeTagLower = excludeTag.toLowerCase();
    const inlineTags = cache.tags?.map((t) => t.tag.replace(/^#/, "").toLowerCase()) || [];
    const fmTags = cache.frontmatter?.tags || [];
    const fmTagList = (Array.isArray(fmTags) ? fmTags : [fmTags]).map((t: unknown) =>
      String(t).toLowerCase()
    );

    return [...inlineTags, ...fmTagList].includes(excludeTagLower);
  }

  // ─── Direct HTTP Call ───────────────────────────────────────────────────────

  async callHTTP(endpointName: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const endpointUrl = buildEndpointUrl(this.settings.tbEndpointUrl, endpointName);

    const response = await fetch(endpointUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const responseBody = await response.text();
      throw new Error(`HTTP ${response.status}: ${responseBody}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Unknown error");
    }
    return result;
  }

  // ─── Direct HTTP call for note ingestion ───────────────────────────────────

  async callIngestNote(content: string, title: string, noteId: string): Promise<string> {
    const ingestUrl = buildEndpointUrl(this.settings.tbEndpointUrl, "ingest-note");

    const response = await fetch(ingestUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, title, note_id: noteId }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ingest ${response.status}: ${body}`);
    }

    const result = await response.json();
    if (!result.success) {
      throw new Error(result.error || "Unknown ingest error");
    }
    return result.message || "Done";
  }

  // ─── Settings Persistence ──────────────────────────────────────────────────

  async loadSettings() {
    const data = await this.loadData();
    const raw = data?.settings ?? data ?? {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, raw);

    // Normalize exclude tag — strip leading # if user entered it that way
    if (this.settings.excludeTag) {
      this.settings.excludeTag = this.settings.excludeTag.replace(/^#/, "");
    }

    // Migrate old millisecond settings to minutes
    if ("debounceMs" in raw && !("syncDelayMinutes" in raw)) {
      this.settings.syncDelayMinutes = Math.round(raw.debounceMs / 60000) || DEFAULT_SETTINGS.syncDelayMinutes;
    }
    if ("pollIntervalMs" in raw && !("pollIntervalMinutes" in raw)) {
      this.settings.pollIntervalMinutes = Math.round(raw.pollIntervalMs / 60000) || DEFAULT_SETTINGS.pollIntervalMinutes;
    }

    // Clean up legacy keys from the settings object
    delete (this.settings as unknown as Record<string, unknown>)["debounceMs"];
    delete (this.settings as unknown as Record<string, unknown>)["pollIntervalMs"];

    this.syncedHashes = data?.syncedHashes ?? {};

    // Prune hashes for files that no longer exist in the vault
    this.pruneStaleHashes();
  }

  /** Remove syncedHashes entries for files that no longer exist in the vault. */
  private pruneStaleHashes() {
    const existingPaths = new Set(
      this.app.vault.getMarkdownFiles().map((file) => file.path)
    );
    for (const path of Object.keys(this.syncedHashes)) {
      if (!existingPaths.has(path)) {
        delete this.syncedHashes[path];
      }
    }
  }

  async saveSettings() {
    await this.saveData({
      settings: this.settings,
      syncedHashes: this.syncedHashes,
    });

    // Re-register the poll interval in case pollIntervalMinutes changed
    this.startPollInterval();
  }
}

// ─── AI Output Confirmation Modal ─────────────────────────────────────────────

class AIOutputConfirmModal extends Modal {
  private metadataList: AIOutputMetadata[];
  private conflicts: ConflictInfo;
  private onResult: (result: ConfirmationResult) => void;
  private resolved = false;
  private resolutions: ConflictResolution = new Map();

  constructor(
    app: App,
    metadataList: AIOutputMetadata[],
    conflicts: ConflictInfo,
    onResult: (result: ConfirmationResult) => void,
  ) {
    super(app);
    this.metadataList = metadataList;
    this.conflicts = conflicts;
    this.onResult = onResult;

    // Initialize resolutions: conflicting files default to "overwrite"
    for (const metadata of metadataList) {
      if (conflicts[metadata.id]) {
        this.resolutions.set(metadata.id, "overwrite");
      }
    }
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", {
      text: `${this.metadataList.length} pending AI output${this.metadataList.length > 1 ? "s" : ""}`,
    });

    const listContainer = contentEl.createDiv({ cls: "tb-ai-output-list" });
    listContainer.style.maxHeight = "300px";
    listContainer.style.overflowY = "auto";
    listContainer.style.marginBottom = "16px";

    for (const metadata of this.metadataList) {
      const sizeDisplay = formatFileSize(metadata.content_size);
      const hasConflict = this.conflicts[metadata.id] === true;

      const item = listContainer.createDiv({ cls: "tb-ai-output-item" });
      item.style.padding = "6px 0";
      item.style.borderBottom = "1px solid var(--background-modifier-border)";

      const titleRow = item.createDiv({ cls: "tb-ai-output-title-row" });
      titleRow.style.display = "flex";
      titleRow.style.alignItems = "center";
      titleRow.style.gap = "8px";

      titleRow.createEl("span", {
        text: metadata.title || metadata.file_path,
        cls: "tb-ai-output-title",
      }).style.fontWeight = "600";

      // Conflict/new-file badge
      const badge = titleRow.createEl("span", {
        text: hasConflict ? "overwrites existing" : "new file",
        cls: hasConflict ? "tb-ai-output-conflict" : "tb-ai-output-new",
      });
      badge.style.fontSize = "0.8em";
      badge.style.padding = "1px 6px";
      badge.style.borderRadius = "4px";
      if (hasConflict) {
        badge.style.backgroundColor = "var(--background-modifier-error)";
        badge.style.color = "var(--text-on-accent)";
      } else {
        badge.style.backgroundColor = "var(--background-modifier-success)";
        badge.style.color = "var(--text-on-accent)";
      }

      const detailParts = [metadata.file_path, sizeDisplay];
      item.createEl("div", {
        text: detailParts.join(" · "),
        cls: "tb-ai-output-details",
      }).style.color = "var(--text-muted)";

      // Per-file overwrite/rename dropdown for conflicting files
      if (hasConflict) {
        const controlRow = item.createDiv({ cls: "tb-ai-output-conflict-control" });
        controlRow.style.marginTop = "4px";

        const select = controlRow.createEl("select", { cls: "dropdown" });
        const overwriteOption = select.createEl("option", { text: "Overwrite", value: "overwrite" });
        overwriteOption.value = "overwrite";
        const renameOption = select.createEl("option", { text: "Save as copy", value: "rename" });
        renameOption.value = "rename";
        select.value = "overwrite";

        select.addEventListener("change", () => {
          this.resolutions.set(metadata.id, select.value as "overwrite" | "rename");
        });
      }
    }

    const buttonContainer = contentEl.createDiv({ cls: "tb-ai-output-buttons" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "8px";
    buttonContainer.style.marginTop = "16px";

    const rejectButton = buttonContainer.createEl("button", { text: "Reject All" });
    rejectButton.addEventListener("click", () => {
      this.resolve("rejected");
    });

    const postponeButton = buttonContainer.createEl("button", { text: "Postpone" });
    postponeButton.addEventListener("click", () => {
      this.resolve("postponed");
    });

    const acceptButton = buttonContainer.createEl("button", {
      text: "Accept All",
      cls: "mod-cta",
    });
    acceptButton.addEventListener("click", () => {
      this.resolve("accepted");
    });
  }

  onClose() {
    // If the user closed the modal without clicking a button, treat as postpone (not rejection)
    if (!this.resolved) {
      this.onResult({ decision: "postponed", resolutions: this.resolutions });
    }
    this.contentEl.empty();
  }

  private resolve(decision: AIOutputDecision) {
    this.resolved = true;
    this.onResult({ decision, resolutions: this.resolutions });
    this.close();
  }
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

class TBSettingTab extends PluginSettingTab {
  plugin: TerrestrialBrainPlugin;

  constructor(app: App, plugin: TerrestrialBrainPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Terrestrial Brain Sync" });
    containerEl.createEl("p", {
      text: "Syncs all notes in this vault to Terrestrial Brain. Waits until you stop editing before syncing. Notes tagged with the exclude tag are always skipped.",
      cls: "setting-item-description",
    });

    new Setting(containerEl)
      .setName("Terrestrial Brain MCP Endpoint URL")
      .setDesc("Full URL including the ?key= parameter from your Supabase edge function.")
      .addText((text) =>
        text
          .setPlaceholder("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=...")
          .setValue(this.plugin.settings.tbEndpointUrl)
          .onChange(async (value) => {
            this.plugin.settings.tbEndpointUrl = value.trim();
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Exclude tag")
      .setDesc("Notes with this tag are never synced. Enter with or without the # prefix. Default: tbExclude")
      .addText((text) =>
        text
          .setPlaceholder("tbExclude")
          .setValue(this.plugin.settings.excludeTag)
          .onChange(async (value) => {
            this.plugin.settings.excludeTag = value.trim().replace(/^#/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sync delay (minutes)")
      .setDesc(
        "How long to wait after you stop editing before syncing. Default: 5 minutes. Minimum: 1 minute."
      )
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.plugin.settings.syncDelayMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value);
            if (!isNaN(parsed) && parsed >= 1) {
              this.plugin.settings.syncDelayMinutes = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("AI output poll interval (minutes)")
      .setDesc(
        "How often to check for new AI-generated output. Default: 10 minutes. Minimum: 1 minute."
      )
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.pollIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value);
            if (!isNaN(parsed) && parsed >= 1) {
              this.plugin.settings.pollIntervalMinutes = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("Projects folder base")
      .setDesc("Base folder for project files in the vault. Default: projects")
      .addText((text) =>
        text
          .setPlaceholder("projects")
          .setValue(this.plugin.settings.projectsFolderBase)
          .onChange(async (value) => {
            this.plugin.settings.projectsFolderBase = value.trim() || "projects";
            await this.plugin.saveSettings();
          })
      );
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function stripFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n?/, "");
}

export function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = (hash << 5) - hash + chr;
    hash |= 0;
  }
  return String(hash);
}

/**
 * Given a vault-relative path that already exists, find the first available
 * copy name using the pattern `Filename(N).md` starting at N=2.
 * The `existsCheck` parameter is injected for testability.
 */
/**
 * Given the MCP endpoint URL (e.g. "https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc"),
 * construct the direct ingest-note URL by inserting "/ingest-note" before the query string.
 */
export function buildEndpointUrl(tbEndpointUrl: string, endpointName: string): string {
  const questionMarkIndex = tbEndpointUrl.indexOf("?");
  if (questionMarkIndex === -1) {
    return `${tbEndpointUrl}/${endpointName}`;
  }
  const basePath = tbEndpointUrl.substring(0, questionMarkIndex);
  const queryString = tbEndpointUrl.substring(questionMarkIndex);
  return `${basePath}/${endpointName}${queryString}`;
}

export async function generateCopyPath(
  originalPath: string,
  existsCheck: (path: string) => Promise<boolean>,
): Promise<string> {
  const lastSlash = originalPath.lastIndexOf("/");
  const directory = lastSlash >= 0 ? originalPath.substring(0, lastSlash + 1) : "";
  const filename = lastSlash >= 0 ? originalPath.substring(lastSlash + 1) : originalPath;

  const dotIndex = filename.lastIndexOf(".");
  const stem = dotIndex >= 0 ? filename.substring(0, dotIndex) : filename;
  const extension = dotIndex >= 0 ? filename.substring(dotIndex) : "";

  const maxAttempts = 100;
  for (let suffix = 2; suffix <= maxAttempts + 1; suffix++) {
    const candidate = `${directory}${stem}(${suffix})${extension}`;
    if (!(await existsCheck(candidate))) {
      return candidate;
    }
  }

  throw new Error(`Could not find available copy name for "${originalPath}" after ${maxAttempts} attempts`);
}
