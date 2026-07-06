import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, mergeAndMigrateSettings } from "./settings";

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
    expect((settings as Record<string, unknown>).debounceMs).toBeUndefined();
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
    expect((settings as Record<string, unknown>).projectsFolderBase).toBeUndefined();
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
