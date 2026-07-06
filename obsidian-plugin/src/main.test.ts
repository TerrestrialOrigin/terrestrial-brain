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

    expect((plugin.settings as Record<string, unknown>).projectsFolderBase).toBeUndefined();
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
    const persisted = saveData.mock.calls.at(-1)?.[0] as { syncedHashes: Record<string, string> };
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
      setTimeout: vi.fn(),
      setInterval: vi.fn().mockReturnValue(1),
      clearInterval: vi.fn(),
    };
  });
  afterEach(() => {
    if (realWindow !== undefined) (globalThis as { window?: unknown }).window = realWindow;
    else delete (globalThis as { window?: unknown }).window;
    globalThis.fetch = realFetch;
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
    await commands["sync-vault-to-terrestrial-brain"].callback();

    expect(recordedNotices.some((m) => m.includes("Vault sync complete"))).toBe(false);
    expect(recordedNotices.some((m) => /failed/i.test(m))).toBe(true);
  });
});
