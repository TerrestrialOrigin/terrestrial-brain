import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { clearRecordedNotices, recordedNotices } from "../test/obsidian-stub";
import TerrestrialBrainPlugin from "./main";
import { DEFAULT_SETTINGS } from "./settings";

// A fake Obsidian App good enough for the composition root's wiring.
function fakeApp(overrides: {
  markdownFiles?: { path: string; basename: string; extension: string }[];
  getFileCache?: (file: unknown) => unknown;
} = {}) {
  return {
    vault: {
      on: vi.fn().mockReturnValue({}),
      getMarkdownFiles: vi.fn().mockReturnValue(overrides.markdownFiles ?? []),
      read: vi.fn().mockResolvedValue("# body"),
      adapter: {
        write: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(false),
      },
    },
    workspace: { getActiveFile: vi.fn().mockReturnValue(null) },
    metadataCache: { getFileCache: vi.fn().mockImplementation(overrides.getFileCache ?? (() => null)) },
  };
}

function newPlugin(app: ReturnType<typeof fakeApp>): TerrestrialBrainPlugin {
  const plugin = new TerrestrialBrainPlugin(app as never, {} as never);
  return plugin;
}

describe("loadSettings (composition root)", () => {
  it("drops the retired projectsFolderBase key and persists once", async () => {
    const app = fakeApp();
    const plugin = newPlugin(app);
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { tbEndpointUrl: "https://host/fn", accessKey: "k", projectsFolderBase: "projects" },
      syncedHashes: {},
    });
    const saveData = vi.fn().mockResolvedValue(undefined);
    plugin.saveData = saveData;

    await plugin.loadSettings();

    expect("projectsFolderBase" in plugin.settings).toBe(false);
    expect(plugin.settings.tbEndpointUrl).toBe("https://host/fn");
    expect(saveData).toHaveBeenCalledTimes(1);
  });

  it("does not persist when there is nothing to migrate", async () => {
    const app = fakeApp();
    const plugin = newPlugin(app);
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { tbEndpointUrl: "https://host/fn", accessKey: "set" },
      syncedHashes: {},
    });
    const saveData = vi.fn().mockResolvedValue(undefined);
    plugin.saveData = saveData;

    await plugin.loadSettings();

    expect(saveData).not.toHaveBeenCalled();
  });

  it("migrates a legacy ?key= URL into accessKey and persists", async () => {
    const app = fakeApp();
    const plugin = newPlugin(app);
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { tbEndpointUrl: "https://host/fn?key=abc" },
      syncedHashes: {},
    });
    plugin.saveData = vi.fn().mockResolvedValue(undefined);

    await plugin.loadSettings();

    expect(plugin.settings.accessKey).toBe("abc");
    expect(plugin.settings.tbEndpointUrl).toBe("https://host/fn");
  });

  it("prunes hashes for files no longer in the vault", async () => {
    const app = fakeApp({ markdownFiles: [{ path: "kept.md", basename: "kept", extension: "md" }] });
    const plugin = newPlugin(app);
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { tbEndpointUrl: "https://host/fn", accessKey: "k" },
      syncedHashes: { "kept.md": "h1", "gone.md": "h2" },
    });
    plugin.saveData = vi.fn().mockResolvedValue(undefined);

    await plugin.loadSettings();

    // Reflect through saveSettings to inspect what is persisted.
    const saveData = plugin.saveData as ReturnType<typeof vi.fn>;
    await plugin.saveSettings();
    const lastSaveCall = saveData.mock.calls[saveData.mock.calls.length - 1];
    const persisted = lastSaveCall?.[0] as { syncedHashes: Record<string, string> };
    expect(persisted.syncedHashes).toEqual({ "kept.md": "h1" });
  });
});

describe("isExcluded (composition root delegates to cache)", () => {
  it("returns true for a frontmatter tbExclude: true note", () => {
    const app = fakeApp({ getFileCache: () => ({ frontmatter: { tbExclude: true } }) });
    const plugin = newPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS };
    expect(plugin.isExcluded({ path: "t.md" } as never)).toBe(true);
  });

  it("returns false when the cache has no exclusion markers", () => {
    const app = fakeApp({ getFileCache: () => ({ frontmatter: {} }) });
    const plugin = newPlugin(app);
    plugin.settings = { ...DEFAULT_SETTINGS };
    expect(plugin.isExcluded({ path: "t.md" } as never)).toBe(false);
  });
});

describe("onload wiring — vault sync command runs through the real engine + client", () => {
  const realWindow = (globalThis as { window?: unknown }).window;
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    clearRecordedNotices();
    (globalThis as { window?: unknown }).window = {
      setTimeout: vi.fn().mockReturnValue(77),
      clearTimeout: vi.fn(),
      setInterval: vi.fn().mockReturnValue(1),
      clearInterval: vi.fn(),
    };
  });
  afterEach(() => {
    if (realWindow !== undefined) (globalThis as { window?: unknown }).window = realWindow;
    else delete (globalThis as { window?: unknown }).window;
    globalThis.fetch = realFetch;
  });

  interface WindowStub {
    setTimeout: ReturnType<typeof vi.fn>;
    clearTimeout: ReturnType<typeof vi.fn>;
    setInterval: ReturnType<typeof vi.fn>;
    clearInterval: ReturnType<typeof vi.fn>;
  }

  function windowStub(): WindowStub {
    return (globalThis as unknown as { window: WindowStub }).window;
  }

  async function loadedPlugin(): Promise<TerrestrialBrainPlugin> {
    const app = fakeApp();
    const plugin = newPlugin(app);
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { tbEndpointUrl: "https://example.com/mcp", accessKey: "k" },
      syncedHashes: {},
    });
    plugin.saveData = vi.fn().mockResolvedValue(undefined);
    plugin.addCommand = vi.fn() as never;
    await plugin.onload();
    return plugin;
  }

  it("PLUG-8: onunload clears the startup poll timeout", async () => {
    const plugin = await loadedPlugin();
    const startupTimeoutId = windowStub().setTimeout.mock.results[0]?.value as number;

    plugin.onunload();

    expect(windowStub().clearTimeout).toHaveBeenCalledWith(startupTimeoutId);
  });

  it("PLUG-7: onunload clears the poll interval and the engine timers", async () => {
    const plugin = await loadedPlugin();
    const engine = (plugin as unknown as { engine: { clearAllTimers: () => void } }).engine;
    const clearAllTimersSpy = vi.spyOn(engine, "clearAllTimers");

    plugin.onunload();

    expect(windowStub().clearInterval).toHaveBeenCalledWith(1);
    expect(clearAllTimersSpy).toHaveBeenCalled();
  });

  it("PLUG-7: applyPollInterval is a no-op for an unchanged value and re-registers on change", async () => {
    const plugin = await loadedPlugin();
    windowStub().setInterval.mockReturnValueOnce(2);
    const intervalCallsAfterLoad = windowStub().setInterval.mock.calls.length;
    expect(intervalCallsAfterLoad).toBe(1); // registered once during onload

    plugin.applyPollInterval(); // same minutes — must not re-register
    expect(windowStub().setInterval.mock.calls.length).toBe(1);
    expect(windowStub().clearInterval).not.toHaveBeenCalled();

    plugin.settings.pollIntervalMinutes = 42;
    plugin.applyPollInterval(); // changed — clears the old id, registers anew
    expect(windowStub().clearInterval).toHaveBeenCalledWith(1);
    expect(windowStub().setInterval.mock.calls.length).toBe(2);
    expect(windowStub().setInterval.mock.calls[1]?.[1]).toBe(42 * 60000);
  });

  it("reports failure (not success) when every note's ingest fails", async () => {
    const app = fakeApp({
      markdownFiles: [
        { path: "a.md", basename: "a", extension: "md" },
        { path: "b.md", basename: "b", extension: "md" },
      ],
    });
    const plugin = newPlugin(app);
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { tbEndpointUrl: "https://example.com/mcp", accessKey: "k" },
      syncedHashes: {},
    });
    plugin.saveData = vi.fn().mockResolvedValue(undefined);

    const commands: Record<string, { callback: () => Promise<void> }> = {};
    plugin.addCommand = ((cmd: { id: string; callback: () => Promise<void> }) => { commands[cmd.id] = cmd; }) as never;

    // The real HttpTerrestrialBrainClient runs; only fetch is stubbed (rejecting).
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    await plugin.onload();
    await commands["sync-vault-to-terrestrial-brain"]?.callback();

    expect(recordedNotices.some((message) => message.includes("Vault sync complete"))).toBe(false);
    expect(recordedNotices.some((message) => /failed/.test(message))).toBe(true);
  });
});
