// ─── Settings ────────────────────────────────────────────────────────────────
// Settings type, defaults, a pure merge/migration function, and the settings-tab
// UI. The migration logic is pure (given raw persisted data) so it is
// unit-testable without a plugin instance.

import { App, Notice, Plugin, PluginSettingTab, Setting } from "obsidian";
import { extractKeyFromUrl, isInsecureEndpoint, isRecord, MS_PER_MINUTE } from "./utils";
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

/**
 * Boundary clamp for minute-based settings: only a finite number >= 1 is
 * accepted (rounded to a whole minute); anything else — zero, negatives, NaN,
 * a corrupted data.json value — falls back to the given default. The settings
 * UI enforces the same minimum, but the UI is not boundary validation: a 0 or
 * NaN loaded from disk would otherwise become a 0 ms setInterval/debounce.
 */
function clampMinutes(rawValue: unknown, fallbackMinutes: number): number {
  if (typeof rawValue !== "number" || !Number.isFinite(rawValue) || rawValue < 1) {
    return fallbackMinutes;
  }
  return Math.round(rawValue);
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
    syncDelayMinutes: clampMinutes(raw.syncDelayMinutes, DEFAULT_SETTINGS.syncDelayMinutes),
    pollIntervalMinutes: clampMinutes(raw.pollIntervalMinutes, DEFAULT_SETTINGS.pollIntervalMinutes),
  };

  // Normalize exclude tag — strip a leading # if the user entered it that way.
  settings.excludeTag = settings.excludeTag.replace(/^#/, "");

  // Migrate legacy millisecond settings to minutes — clamped like every other
  // boundary value, so a corrupted legacy field cannot smuggle in a value < 1.
  if ("debounceMs" in raw && !("syncDelayMinutes" in raw)) {
    const legacyMilliseconds = raw.debounceMs;
    settings.syncDelayMinutes = clampMinutes(
      typeof legacyMilliseconds === "number" ? Math.round(legacyMilliseconds / MS_PER_MINUTE) : undefined,
      DEFAULT_SETTINGS.syncDelayMinutes,
    );
  }
  if ("pollIntervalMs" in raw && !("pollIntervalMinutes" in raw)) {
    const legacyMilliseconds = raw.pollIntervalMs;
    settings.pollIntervalMinutes = clampMinutes(
      typeof legacyMilliseconds === "number" ? Math.round(legacyMilliseconds / MS_PER_MINUTE) : undefined,
      DEFAULT_SETTINGS.pollIntervalMinutes,
    );
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
    containerEl.createEl("p", {
      text: "Data flow & erasure: syncing sends a note's content and title to your " +
        "backend, where they are stored as a note snapshot and derived thoughts. " +
        "Deleting a note here erases that note's snapshot and thoughts from the " +
        "backend; the \"Forget this note in Terrestrial Brain\" command does the " +
        "same without deleting the file. Backend request logs are purged " +
        "automatically after a retention window.",
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
        "Your MCP access key. Sent as an x-tb-key request header — never as part of the URL. " +
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
    this.addMinutesSetting(containerEl, {
      name: "Sync delay (minutes)",
      desc: "How long to wait after you stop editing before syncing. Default: 5 minutes. Minimum: 1 minute. " +
        `A sync that fails is retried automatically up to ${MAX_RETRY_ATTEMPTS} times with increasing delay; ` +
        "if it still fails, the note re-syncs on your next edit.",
      placeholder: "5",
      getValue: () => this.host.settings.syncDelayMinutes,
      setValue: async (minutes) => {
        this.host.settings.syncDelayMinutes = minutes;
        await this.host.saveSettings();
      },
    });
  }

  private renderPollIntervalSetting(containerEl: HTMLElement): void {
    this.addMinutesSetting(containerEl, {
      name: "AI output poll interval (minutes)",
      desc: "How often to check for new AI-generated output. Default: 10 minutes. Minimum: 1 minute.",
      placeholder: "10",
      getValue: () => this.host.settings.pollIntervalMinutes,
      setValue: async (minutes) => {
        this.host.settings.pollIntervalMinutes = minutes;
        await this.host.saveSettings();
        // Persistence no longer restarts the timer — apply the change here.
        this.host.applyPollInterval();
      },
    });
  }

  /**
   * Shared renderer for a whole-minutes numeric setting. Invalid input (not a
   * whole number >= 1) is never silently dropped: the user gets a Notice naming
   * the constraint and the field resets to the stored value (PLUG-15).
   */
  private addMinutesSetting(
    containerEl: HTMLElement,
    options: {
      name: string;
      desc: string;
      placeholder: string;
      getValue: () => number;
      setValue: (minutes: number) => Promise<void>;
    },
  ): void {
    new Setting(containerEl)
      .setName(options.name)
      .setDesc(options.desc)
      .addText((text) =>
        text
          .setPlaceholder(options.placeholder)
          .setValue(String(options.getValue()))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) {
              await options.setValue(parsed);
            } else {
              new Notice(`${options.name}: enter a whole number ≥ 1`);
              text.setValue(String(options.getValue()));
            }
          })
      );
  }
}
