import {
  App,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AIOutput {
  id: string;
  title: string;
  content: string;
  file_path: string;
  created_at: string;
}

// ─── Settings ────────────────────────────────────────────────────────────────

interface TBPluginSettings {
  tbEndpointUrl: string;
  excludeTag: string;
  debounceMs: number;
  pollIntervalMs: number;
  projectsFolderBase: string;
}

const DEFAULT_SETTINGS: TBPluginSettings = {
  tbEndpointUrl: "",
  excludeTag: "terrestrialBrainExclude",
  debounceMs: 300000,
  pollIntervalMs: 600000,        // 10 minutes
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

    // Ribbon icon — sync current note immediately
    this.addRibbonIcon("brain", "Sync to Terrestrial Brain", async () => {
      const file = this.app.workspace.getActiveFile();
      if (!file) { new Notice("No active file"); return; }
      this.cancelTimer(file.path);
      await this.processNote(file, { force: true });
    });

    // Manual poll for AI output
    this.addCommand({
      id: "poll-ai-output",
      name: "Pull AI output from Terrestrial Brain",
      callback: async () => {
        await this.pollAIOutput();
      },
    });

    this.addSettingTab(new TBSettingTab(this.app, this));

    // Poll for AI output shortly after startup (deferred so onload completes first)
    window.setTimeout(() => this.pollAIOutput(), 2000);

    // Then poll on interval
    this.registerInterval(
      window.setInterval(() => this.pollAIOutput(), this.settings.pollIntervalMs)
    );

    console.log("Terrestrial Brain Sync loaded");
  }

  onunload() {
    // Clear all pending timers on plugin unload
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
  }

  // ─── Per-file debounce timer ───────────────────────────────────────────────
  // Each file gets its own timer. Editing the file resets its timer.
  // Only fires after debounceMs of inactivity on that specific file.

  scheduleSync(file: TFile) {
    this.cancelTimer(file.path);
    const timer = setTimeout(async () => {
      this.debounceTimers.delete(file.path);
      await this.processNote(file);
    }, this.settings.debounceMs);
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

  async pollAIOutput() {
    if (!this.settings.tbEndpointUrl) return;
    if (this.pollInProgress) return;

    this.pollInProgress = true;
    try {
      const raw = await this.callMCP("get_pending_ai_output", {});
      const outputs: AIOutput[] = JSON.parse(raw);
      if (!outputs.length) return;

      const accepted = await this.showConfirmationDialog(outputs);

      if (accepted) {
        await this.deliverOutputs(outputs);
      } else {
        await this.rejectOutputs(outputs);
      }
    } catch (err) {
      console.error("TB Poll error:", err);
    } finally {
      this.pollInProgress = false;
    }
  }

  private showConfirmationDialog(outputs: AIOutput[]): Promise<boolean> {
    return new Promise((resolve) => {
      const modal = new AIOutputConfirmModal(this.app, outputs, resolve);
      modal.open();
    });
  }

  private async deliverOutputs(outputs: AIOutput[]) {
    const ids: string[] = [];
    for (const output of outputs) {
      const path = output.file_path;

      // Ensure parent folders exist
      const folder = path.substring(0, path.lastIndexOf("/"));
      if (folder) await this.app.vault.adapter.mkdir(folder);

      // Write the file (overwrite if exists — AI output is authoritative)
      await this.app.vault.adapter.write(path, output.content);

      // Store hash so the modify event doesn't trigger re-ingestion
      const contentHash = simpleHash(stripFrontmatter(output.content).trim());
      this.syncedHashes[path] = contentHash;

      ids.push(output.id);
    }

    await this.callMCP("mark_ai_output_picked_up", { ids });
    await this.saveSettings();
    new Notice(`🧠 ${outputs.length} AI output${outputs.length > 1 ? "s" : ""} delivered to vault`);
  }

  private async rejectOutputs(outputs: AIOutput[]) {
    const ids = outputs.map((output) => output.id);
    await this.callMCP("reject_ai_output", { ids });
    new Notice(`🧠 ${outputs.length} AI output${outputs.length > 1 ? "s" : ""} rejected`);
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
      const result = await this.callMCP("ingest_note", {
        content: stripped,
        title: file.basename,
        note_id: file.path, // vault-relative path e.g. "Projects/CarChief/sprint-notes.md"
      });

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

  // ─── MCP Call ──────────────────────────────────────────────────────────────

  async callMCP(toolName: string, args: Record<string, unknown>): Promise<string> {
    const response = await fetch(this.settings.tbEndpointUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: Date.now(),
        method: "tools/call",
        params: { name: toolName, arguments: args },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MCP ${response.status}: ${body}`);
    }

    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      const dataLines = text
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .filter((l) => l && l !== "[DONE]");

      for (const line of dataLines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.error) throw new Error(JSON.stringify(parsed.error));
          const toolResult = parsed.result;
          if (toolResult?.isError) {
            throw new Error(toolResult?.content?.[0]?.text || "Unknown error");
          }
          return toolResult?.content?.[0]?.text || "Done";
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
      return "Done";
    } else {
      const result = await response.json();
      if (result.error) throw new Error(JSON.stringify(result.error));
      if (result.result?.isError) {
        throw new Error(result.result?.content?.[0]?.text || "Unknown error");
      }
      return result.result?.content?.[0]?.text || "Done";
    }
  }

  // ─── Settings Persistence ──────────────────────────────────────────────────

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data?.settings ?? data);
    this.syncedHashes = data?.syncedHashes ?? {};
  }

  async saveSettings() {
    await this.saveData({
      settings: this.settings,
      syncedHashes: this.syncedHashes,
    });
  }
}

// ─── AI Output Confirmation Modal ─────────────────────────────────────────────

class AIOutputConfirmModal extends Modal {
  private outputs: AIOutput[];
  private onDecision: (accepted: boolean) => void;
  private resolved = false;

  constructor(app: App, outputs: AIOutput[], onDecision: (accepted: boolean) => void) {
    super(app);
    this.outputs = outputs;
    this.onDecision = onDecision;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl("h2", {
      text: `${this.outputs.length} pending AI output${this.outputs.length > 1 ? "s" : ""}`,
    });

    const listContainer = contentEl.createDiv({ cls: "tb-ai-output-list" });
    listContainer.style.maxHeight = "300px";
    listContainer.style.overflowY = "auto";
    listContainer.style.marginBottom = "16px";

    for (const output of this.outputs) {
      const charCount = output.content.length.toLocaleString();
      const item = listContainer.createDiv({ cls: "tb-ai-output-item" });
      item.style.padding = "6px 0";
      item.style.borderBottom = "1px solid var(--background-modifier-border)";

      item.createEl("div", {
        text: output.file_path,
        cls: "tb-ai-output-path",
      }).style.fontWeight = "600";

      item.createEl("div", {
        text: `${charCount} chars`,
        cls: "tb-ai-output-size",
      }).style.color = "var(--text-muted)";
    }

    const buttonContainer = contentEl.createDiv({ cls: "tb-ai-output-buttons" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "8px";
    buttonContainer.style.marginTop = "16px";

    const rejectButton = buttonContainer.createEl("button", { text: "Reject All" });
    rejectButton.addEventListener("click", () => {
      this.resolve(false);
    });

    const acceptButton = buttonContainer.createEl("button", {
      text: "Accept All",
      cls: "mod-cta",
    });
    acceptButton.addEventListener("click", () => {
      this.resolve(true);
    });
  }

  onClose() {
    // If the user closed the modal without clicking a button, treat as rejection
    if (!this.resolved) {
      this.onDecision(false);
    }
    this.contentEl.empty();
  }

  private resolve(accepted: boolean) {
    this.resolved = true;
    this.onDecision(accepted);
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
      .setDesc("Notes with this tag are never synced. Default: terrestrialBrainExclude")
      .addText((text) =>
        text
          .setPlaceholder("terrestrialBrainExclude")
          .setValue(this.plugin.settings.excludeTag)
          .onChange(async (value) => {
            this.plugin.settings.excludeTag = value.trim().replace(/^#/, "");
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sync delay (ms)")
      .setDesc(
        "How long to wait after you stop editing before syncing. Default 300000 (5 minutes). Minimum 60000 (1 minute)."
      )
      .addText((text) =>
        text
          .setPlaceholder("300000")
          .setValue(String(this.plugin.settings.debounceMs))
          .onChange(async (value) => {
            const parsed = parseInt(value);
            if (!isNaN(parsed) && parsed >= 60000) {
              this.plugin.settings.debounceMs = parsed;
              await this.plugin.saveSettings();
            }
          })
      );

    new Setting(containerEl)
      .setName("AI output poll interval (ms)")
      .setDesc(
        "How often to check for new AI-generated output. Default 600000 (10 minutes). Minimum 60000 (1 minute)."
      )
      .addText((text) =>
        text
          .setPlaceholder("600000")
          .setValue(String(this.plugin.settings.pollIntervalMs))
          .onChange(async (value) => {
            const parsed = parseInt(value);
            if (!isNaN(parsed) && parsed >= 60000) {
              this.plugin.settings.pollIntervalMs = parsed;
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
