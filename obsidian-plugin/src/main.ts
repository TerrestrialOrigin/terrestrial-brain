import {
  App,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";

// ─── Types ───────────────────────────────────────────────────────────────────

interface AINote {
  id: string;
  title: string;
  content: string;
  suggested_path: string | null;
  created_at_utc: number;
}

// ─── Settings ────────────────────────────────────────────────────────────────

interface TBPluginSettings {
  tbEndpointUrl: string;
  excludeTag: string;
  debounceMs: number;
  pollIntervalMs: number;
  aiNotesFolderBase: string;
}

const DEFAULT_SETTINGS: TBPluginSettings = {
  tbEndpointUrl: "",
  excludeTag: "terrestrialBrainExclude",
  debounceMs: 300000,
  pollIntervalMs: 600000,        // 10 minutes
  aiNotesFolderBase: "AI Notes",
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

export default class TerrestrialBrainPlugin extends Plugin {
  settings: TBPluginSettings;

  // Persisted hash cache — survives Obsidian restarts, prevents duplicate syncs
  private syncedHashes: Record<string, string> = {};

  // Per-file debounce timers — we manage these manually for the long 5-min delay
  private debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

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

    // Manual poll for AI notes
    this.addCommand({
      id: "poll-ai-notes",
      name: "Pull AI notes from Terrestrial Brain",
      callback: async () => {
        await this.pollAINotes();
      },
    });

    this.addSettingTab(new TBSettingTab(this.app, this));

    // Poll for AI notes on startup
    await this.pollAINotes();

    // Then poll on interval
    this.registerInterval(
      window.setInterval(() => this.pollAINotes(), this.settings.pollIntervalMs)
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

  // ─── AI Notes Polling ──────────────────────────────────────────────────────

  async pollAINotes() {
    if (!this.settings.tbEndpointUrl) return;
    try {
      const raw = await this.callMCP("get_unsynced_ai_notes", {});
      const notes: AINote[] = JSON.parse(raw);
      if (!notes.length) return;

      const ids: string[] = [];
      for (const note of notes) {
        const path = note.suggested_path
          || `${this.settings.aiNotesFolderBase}/${note.title}.md`;

        // Ensure parent folders exist
        const folder = path.substring(0, path.lastIndexOf("/"));
        if (folder) await this.app.vault.adapter.mkdir(folder);

        // Write the file (overwrite if exists — AI notes are always authoritative)
        await this.app.vault.adapter.write(path, note.content);

        // Store hash so the modify event doesn't trigger re-ingestion
        const contentHash = simpleHash(stripFrontmatter(note.content).trim());
        this.syncedHashes[path] = contentHash;

        ids.push(note.id);
      }

      await this.callMCP("mark_notes_synced", { ids });
      await this.saveSettings();
      new Notice(`🧠 ${notes.length} AI note${notes.length > 1 ? "s" : ""} synced to vault`);
    } catch (err) {
      console.error("TB Poll error:", err);
    }
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
      .setName("AI notes poll interval (ms)")
      .setDesc(
        "How often to check for new AI-generated notes. Default 600000 (10 minutes). Minimum 60000 (1 minute)."
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
      .setName("AI notes folder")
      .setDesc("Base folder for AI-generated notes. Default: AI Notes")
      .addText((text) =>
        text
          .setPlaceholder("AI Notes")
          .setValue(this.plugin.settings.aiNotesFolderBase)
          .onChange(async (value) => {
            this.plugin.settings.aiNotesFolderBase = value.trim() || "AI Notes";
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
