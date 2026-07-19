import { describe, it, expect, vi, beforeEach } from "vitest";
import { DEFAULT_SETTINGS, mergeAndMigrateSettings, SettingsHost, TBSettingTab } from "./settings";
import {
  App,
  clearRecordedNotices,
  clearRenderedSettings,
  recordedNotices,
  renderedSettings,
  TextStub,
} from "../test/obsidian-stub";

describe("mergeAndMigrateSettings — defaults & minute settings", () => {
  it("uses defaults when there is no persisted data", () => {
    const { settings, changed } = mergeAndMigrateSettings(null);
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(changed).toBe(false);
  });

  it("preserves new minute settings if already present", () => {
    const { settings } = mergeAndMigrateSettings({
      settings: { syncDelayMinutes: 3, pollIntervalMinutes: 15, tbEndpointUrl: "", excludeTag: "tbExclude" },
    });
    expect(settings.syncDelayMinutes).toBe(3);
    expect(settings.pollIntervalMinutes).toBe(15);
  });

  it("reads settings from a flat object (no nested settings key)", () => {
    const { settings } = mergeAndMigrateSettings({ syncDelayMinutes: 7 });
    expect(settings.syncDelayMinutes).toBe(7);
  });
});

describe("mergeAndMigrateSettings — ms→minutes migration", () => {
  it("migrates debounceMs / pollIntervalMs to minute fields", () => {
    const { settings } = mergeAndMigrateSettings({
      settings: { debounceMs: 300000, pollIntervalMs: 600000, tbEndpointUrl: "", excludeTag: "tbExclude" },
    });
    expect(settings.syncDelayMinutes).toBe(5);
    expect(settings.pollIntervalMinutes).toBe(10);
  });

  it("does not carry legacy ms keys onto the settings object", () => {
    const { settings } = mergeAndMigrateSettings({ settings: { debounceMs: 300000 } });
    expect("debounceMs" in settings).toBe(false);
  });
});

describe("mergeAndMigrateSettings — PLUG-4 range clamp at the load boundary", () => {
  it("clamps a zero sync delay to the default", () => {
    const { settings } = mergeAndMigrateSettings({ settings: { syncDelayMinutes: 0 } });
    expect(settings.syncDelayMinutes).toBe(DEFAULT_SETTINGS.syncDelayMinutes);
  });

  it("clamps a negative poll interval to the default", () => {
    const { settings } = mergeAndMigrateSettings({ settings: { pollIntervalMinutes: -5 } });
    expect(settings.pollIntervalMinutes).toBe(DEFAULT_SETTINGS.pollIntervalMinutes);
  });

  it("clamps NaN and non-finite values to the defaults", () => {
    expect(
      mergeAndMigrateSettings({ settings: { pollIntervalMinutes: NaN } }).settings.pollIntervalMinutes,
    ).toBe(DEFAULT_SETTINGS.pollIntervalMinutes);
    expect(
      mergeAndMigrateSettings({ settings: { syncDelayMinutes: Infinity } }).settings.syncDelayMinutes,
    ).toBe(DEFAULT_SETTINGS.syncDelayMinutes);
  });

  it("clamps a legacy ms migration that produces a value below 1 minute", () => {
    const { settings } = mergeAndMigrateSettings({ settings: { debounceMs: -300000 } });
    expect(settings.syncDelayMinutes).toBe(DEFAULT_SETTINGS.syncDelayMinutes);
  });
});

describe("mergeAndMigrateSettings — exclude tag normalization", () => {
  it("strips a leading # from the configured exclude tag", () => {
    const { settings } = mergeAndMigrateSettings({ settings: { excludeTag: "#myTag" } });
    expect(settings.excludeTag).toBe("myTag");
  });
});

describe("mergeAndMigrateSettings — obsolete key removal", () => {
  it("drops the retired projectsFolderBase key and flags a persist", () => {
    const { settings, changed } = mergeAndMigrateSettings({
      settings: { tbEndpointUrl: "https://host/fn", accessKey: "k", projectsFolderBase: "projects" },
    });
    expect("projectsFolderBase" in settings).toBe(false);
    expect(settings.tbEndpointUrl).toBe("https://host/fn");
    expect(settings.accessKey).toBe("k");
    expect(changed).toBe(true);
  });

  it("does not flag a persist when no obsolete key is present", () => {
    const { changed } = mergeAndMigrateSettings({
      settings: { tbEndpointUrl: "https://host/fn", accessKey: "already-set" },
    });
    expect(changed).toBe(false);
  });
});

describe("mergeAndMigrateSettings — legacy key-in-URL migration", () => {
  it("moves ?key= into accessKey and strips the URL, flagging a persist", () => {
    const { settings, changed } = mergeAndMigrateSettings({
      settings: { tbEndpointUrl: "https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc" },
    });
    expect(settings.accessKey).toBe("abc");
    expect(settings.tbEndpointUrl).toBe("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp");
    expect(changed).toBe(true);
  });

  it("keeps an already-set accessKey and still strips the URL", () => {
    const { settings } = mergeAndMigrateSettings({
      settings: { tbEndpointUrl: "https://host/fn?key=urlkey", accessKey: "fieldkey" },
    });
    expect(settings.accessKey).toBe("fieldkey");
    expect(settings.tbEndpointUrl).toBe("https://host/fn");
  });

  it("preserves unrelated query parameters while stripping the key", () => {
    const { settings } = mergeAndMigrateSettings({
      settings: { tbEndpointUrl: "https://host/fn?foo=1&key=abc" },
    });
    expect(settings.tbEndpointUrl).toBe("https://host/fn?foo=1");
    expect(settings.accessKey).toBe("abc");
  });
});

describe("TBSettingTab — PLUG-15 invalid numeric input feedback", () => {
  beforeEach(() => {
    clearRecordedNotices();
    clearRenderedSettings();
  });

  function renderTab() {
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const applyPollInterval = vi.fn();
    const host = {
      settings: { ...DEFAULT_SETTINGS },
      saveSettings,
      applyPollInterval,
    } as unknown as SettingsHost;
    const tab = new TBSettingTab(new App() as never, host);
    tab.display();
    return { host, saveSettings, applyPollInterval };
  }

  function minutesText(settingNamePrefix: string): TextStub {
    const setting = renderedSettings.find((entry) => entry.name.startsWith(settingNamePrefix));
    const text = setting?.texts[0];
    if (!text) throw new Error(`no text field rendered for "${settingNamePrefix}"`);
    return text;
  }

  it("accepts a valid sync delay and persists it", async () => {
    const { host, saveSettings } = renderTab();
    await minutesText("Sync delay").simulateInput("3");
    expect(host.settings.syncDelayMinutes).toBe(3);
    expect(saveSettings).toHaveBeenCalledTimes(1);
    expect(recordedNotices).toHaveLength(0);
  });

  it("rejects zero with a Notice and resets the field to the stored value", async () => {
    const { host, saveSettings } = renderTab();
    const text = minutesText("Sync delay");
    await text.simulateInput("0");
    expect(host.settings.syncDelayMinutes).toBe(DEFAULT_SETTINGS.syncDelayMinutes);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(recordedNotices.some((notice) => notice.includes("whole number"))).toBe(true);
    expect(text.value).toBe(String(DEFAULT_SETTINGS.syncDelayMinutes));
  });

  it("rejects non-numeric poll-interval input with a Notice and keeps the old cadence", async () => {
    const { host, saveSettings, applyPollInterval } = renderTab();
    const text = minutesText("AI output poll interval");
    await text.simulateInput("abc");
    expect(host.settings.pollIntervalMinutes).toBe(DEFAULT_SETTINGS.pollIntervalMinutes);
    expect(saveSettings).not.toHaveBeenCalled();
    expect(applyPollInterval).not.toHaveBeenCalled();
    expect(recordedNotices.some((notice) => notice.includes("whole number"))).toBe(true);
    expect(text.value).toBe(String(DEFAULT_SETTINGS.pollIntervalMinutes));
  });

  it("a valid poll-interval change applies the new interval", async () => {
    const { host, applyPollInterval } = renderTab();
    await minutesText("AI output poll interval").simulateInput("15");
    expect(host.settings.pollIntervalMinutes).toBe(15);
    expect(applyPollInterval).toHaveBeenCalledTimes(1);
  });
});
