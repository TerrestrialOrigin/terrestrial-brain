// ─── Settings ────────────────────────────────────────────────────────────────
// Settings type, defaults, a pure merge/migration function, and the settings-tab
// UI. The migration logic is pure (given raw persisted data) so it is
// unit-testable without a plugin instance.

import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { extractKeyFromUrl, isInsecureEndpoint } from "./utils";
import { MAX_RETRY_ATTEMPTS } from "./syncEngine";

export interface TBPluginSettings {
  tbEndpointUrl: string;
  accessKey: string;
  excludeTag: string;
  syncDelayMinutes: number;
  pollIntervalMinutes: number;
}

export const DEFAULT_SETTINGS: TBPluginSettings = {
  tbEndpointUrl: "",
  accessKey: "",
  excludeTag: "tbExclude",
  syncDelayMinutes: 5,
  pollIntervalMinutes: 10,
};

/**
 * Settings keys that older plugin versions persisted but that are no longer
 * part of the settings model. When any of these is present in loaded data, the
 * cleaned settings are persisted once so the stale key is dropped from disk.
 * - `debounceMs` / `pollIntervalMs`: superseded by the minutes-based fields.
 * - `projectsFolderBase`: a dead setting that was rendered/persisted but never read.
 */
export const OBSOLETE_SETTING_KEYS = ["debounceMs", "pollIntervalMs", "projectsFolderBase"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build a validated `TBPluginSettings` from raw persisted data, applying all
 * migrations: minutes-from-milliseconds, exclude-tag normalization, dropping
 * obsolete keys, and moving a legacy `?key=` out of the endpoint URL.
 * Returns `changed: true` when the on-disk copy should be re-persisted (an
 * obsolete key was present, or the URL key was migrated).
 */
export function mergeAndMigrateSettings(
  rawData: unknown,
): { settings: TBPluginSettings; changed: boolean } {
  const container = isRecord(rawData) ? rawData : {};
  const raw = isRecord(container.settings) ? container.settings : container;

  const settings: TBPluginSettings = {
    tbEndpointUrl: typeof raw.tbEndpointUrl === "string" ? raw.tbEndpointUrl : DEFAULT_SETTINGS.tbEndpointUrl,
    accessKey: typeof raw.accessKey === "string" ? raw.accessKey : DEFAULT_SETTINGS.accessKey,
    excludeTag: typeof raw.excludeTag === "string" ? raw.excludeTag : DEFAULT_SETTINGS.excludeTag,
    syncDelayMinutes: typeof raw.syncDelayMinutes === "number" ? raw.syncDelayMinutes : DEFAULT_SETTINGS.syncDelayMinutes,
    pollIntervalMinutes: typeof raw.pollIntervalMinutes === "number" ? raw.pollIntervalMinutes : DEFAULT_SETTINGS.pollIntervalMinutes,
  };

  // Normalize exclude tag — strip a leading # if the user entered it that way.
  settings.excludeTag = settings.excludeTag.replace(/^#/, "");

  // Migrate legacy millisecond settings to minutes.
  if ("debounceMs" in raw && !("syncDelayMinutes" in raw)) {
    const ms = raw.debounceMs;
    settings.syncDelayMinutes = (typeof ms === "number" ? Math.round(ms / 60000) : 0) || DEFAULT_SETTINGS.syncDelayMinutes;
  }
  if ("pollIntervalMs" in raw && !("pollIntervalMinutes" in raw)) {
    const ms = raw.pollIntervalMs;
    settings.pollIntervalMinutes = (typeof ms === "number" ? Math.round(ms / 60000) : 0) || DEFAULT_SETTINGS.pollIntervalMinutes;
  }

  let changed = OBSOLETE_SETTING_KEYS.some((key) => key in raw);

  // Migrate a legacy `?key=` query parameter out of the endpoint URL.
  const { url, key } = extractKeyFromUrl(settings.tbEndpointUrl);
  if (url !== settings.tbEndpointUrl) {
    settings.tbEndpointUrl = url;
    if (key && !settings.accessKey) {
      settings.accessKey = key;
    }
    changed = true;
  }

  return { settings, changed };
}

/** The plugin surface the settings tab needs — decouples it from the concrete class. */
export interface SettingsHost extends Plugin {
  settings: TBPluginSettings;
  saveSettings(): Promise<void>;
  applyPollInterval(): void;
}

export class TBSettingTab extends PluginSettingTab {
  private host: SettingsHost;

  constructor(app: App, host: SettingsHost) {
    super(app, host);
    this.host = host;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Terrestrial Brain Sync" });
    containerEl.createEl("p", {
      text: "Syncs all notes in this vault to Terrestrial Brain. Waits until you stop editing before syncing. Notes tagged with the exclude tag are always skipped.",
      cls: "setting-item-description",
    });

    this.renderEndpointSetting(containerEl);
    this.renderAccessKeySetting(containerEl);
    this.renderExcludeTagSetting(containerEl);
    this.renderSyncDelaySetting(containerEl);
    this.renderPollIntervalSetting(containerEl);
  }

  private renderEndpointSetting(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Terrestrial Brain MCP Endpoint URL")
      .setDesc(
        "URL of your Supabase edge function, without the ?key= parameter. " +
        "If you paste a URL that still contains ?key=, the key is moved into the Access key field automatically."
      )
      .addText((text) =>
        text
          .setPlaceholder("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp")
          .setValue(this.host.settings.tbEndpointUrl)
          .onChange(async (value) => {
            const { url, key } = extractKeyFromUrl(value.trim());
            this.host.settings.tbEndpointUrl = url;
            const keyWasExtracted = key !== "" && !this.host.settings.accessKey;
            if (keyWasExtracted) {
              this.host.settings.accessKey = key;
            }
            await this.host.saveSettings();
            updateInsecureWarning();
            // Re-render so both fields show the migrated values.
            if (keyWasExtracted) {
              this.display();
            }
          })
      );

    const insecureWarning = containerEl.createEl("p", {
      text: "⚠️ This endpoint uses unencrypted http:// — your notes and access key would be sent in cleartext. Use https:// unless this is a local test server.",
      cls: "setting-item-description tb-insecure-endpoint-warning",
    });
    insecureWarning.style.color = "var(--text-error)";
    const updateInsecureWarning = () => {
      insecureWarning.style.display = isInsecureEndpoint(this.host.settings.tbEndpointUrl)
        ? ""
        : "none";
    };
    updateInsecureWarning();
  }

  private renderAccessKeySetting(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Access key")
      .setDesc(
        "Your MCP access key. Sent as an x-brain-key request header — never as part of the URL. " +
        "Stored unencrypted in this vault's plugin data. Required for syncing."
      )
      .addText((text) => {
        text
          .setPlaceholder("your MCP access key")
          .setValue(this.host.settings.accessKey)
          .onChange(async (value) => {
            this.host.settings.accessKey = value.trim();
            await this.host.saveSettings();
          });
        text.inputEl.type = "password";
      });
  }

  private renderExcludeTagSetting(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Exclude tag")
      .setDesc("Notes with this tag are never synced. Enter with or without the # prefix. Default: tbExclude")
      .addText((text) =>
        text
          .setPlaceholder("tbExclude")
          .setValue(this.host.settings.excludeTag)
          .onChange(async (value) => {
            this.host.settings.excludeTag = value.trim().replace(/^#/, "");
            await this.host.saveSettings();
          })
      );
  }

  private renderSyncDelaySetting(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("Sync delay (minutes)")
      .setDesc(
        "How long to wait after you stop editing before syncing. Default: 5 minutes. Minimum: 1 minute. " +
        `A sync that fails is retried automatically up to ${MAX_RETRY_ATTEMPTS} times with increasing delay; ` +
        "if it still fails, the note re-syncs on your next edit."
      )
      .addText((text) =>
        text
          .setPlaceholder("5")
          .setValue(String(this.host.settings.syncDelayMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value);
            if (!isNaN(parsed) && parsed >= 1) {
              this.host.settings.syncDelayMinutes = parsed;
              await this.host.saveSettings();
            }
          })
      );
  }

  private renderPollIntervalSetting(containerEl: HTMLElement): void {
    new Setting(containerEl)
      .setName("AI output poll interval (minutes)")
      .setDesc(
        "How often to check for new AI-generated output. Default: 10 minutes. Minimum: 1 minute."
      )
      .addText((text) =>
        text
          .setPlaceholder("10")
          .setValue(String(this.host.settings.pollIntervalMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value);
            if (!isNaN(parsed) && parsed >= 1) {
              this.host.settings.pollIntervalMinutes = parsed;
              await this.host.saveSettings();
              // Persistence no longer restarts the timer — apply the change here.
              this.host.applyPollInterval();
            }
          })
      );
  }
}
