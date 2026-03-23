import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the obsidian module before importing main
// Track Notice constructions for assertion
const noticeMessages: string[] = [];

vi.mock("obsidian", () => ({
  App: class {},
  Menu: class {
    items: { title: string; icon: string; callback: () => void }[] = [];
    addItem(callback: (item: any) => void) {
      const item = {
        title: "",
        icon: "",
        callback: () => {},
        setTitle(title: string) { item.title = title; return item; },
        setIcon(icon: string) { item.icon = icon; return item; },
        onClick(cb: () => void) { item.callback = cb; return item; },
      };
      callback(item);
      this.items.push(item);
      return this;
    }
    showAtMouseEvent() {}
  },
  Modal: class {
    app: any;
    contentEl = {
      empty() {},
      createEl() { return { style: {} }; },
      createDiv() { return { style: {}, createDiv() { return { style: {}, createEl() { return { style: {} }; } }; }, createEl() { return { style: {}, addEventListener() {} }; } }; },
    };
    constructor(app: any) { this.app = app; }
    open() {}
    close() {}
  },
  Notice: class {
    constructor(message?: string) { if (message) noticeMessages.push(message); }
    setMessage() {}
    hide() {}
  },
  Plugin: class {
    app = {};
    loadData = vi.fn();
    saveData = vi.fn();
    registerEvent() {}
    registerInterval() {}
    addCommand() {}
    addRibbonIcon() {}
    addSettingTab() {}
  },
  PluginSettingTab: class {
    constructor() {}
  },
  Setting: class {
    constructor() {}
    setName() { return this; }
    setDesc() { return this; }
    addText() { return this; }
  },
  TFile: class {},
}));

import TerrestrialBrainPlugin, { stripFrontmatter, simpleHash, formatFileSize } from "./main";

// ─── Helper: create a partial plugin instance for testing ────────────────────

function createTestPlugin(overrides: {
  excludeTag?: string;
  frontmatter?: Record<string, unknown> | null;
  inlineTags?: { tag: string }[];
  tbEndpointUrl?: string;
} = {}): TerrestrialBrainPlugin {
  const plugin = Object.create(TerrestrialBrainPlugin.prototype);

  plugin.settings = {
    tbEndpointUrl: overrides.tbEndpointUrl ?? "",
    excludeTag: overrides.excludeTag ?? "terrestrialBrainExclude",
    syncDelayMinutes: 5,
    pollIntervalMinutes: 10,
    projectsFolderBase: "projects",
  };

  plugin.syncedHashes = {};
  plugin.debounceTimers = new Map();
  plugin.pollInProgress = false;

  // Auto-accept confirmation dialog in tests (real modal blocks forever)
  plugin.showConfirmationDialog = vi.fn().mockResolvedValue(true);

  const cache = overrides.frontmatter === undefined && overrides.inlineTags === undefined
    ? null
    : {
        frontmatter: overrides.frontmatter ?? null,
        tags: overrides.inlineTags ?? null,
      };

  plugin.app = {
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue(cache),
    },
    vault: {
      adapter: {
        write: vi.fn().mockResolvedValue(undefined),
        mkdir: vi.fn().mockResolvedValue(undefined),
      },
      read: vi.fn(),
      getMarkdownFiles: vi.fn().mockReturnValue([]),
    },
    workspace: {
      getActiveFile: vi.fn().mockReturnValue(null),
    },
  };

  plugin.saveSettings = vi.fn().mockImplementation(async () => {
    await plugin.saveData({
      settings: plugin.settings,
      syncedHashes: plugin.syncedHashes,
    });
  });
  plugin.saveData = vi.fn().mockResolvedValue(undefined);
  plugin.callMCP = vi.fn().mockResolvedValue("[]");

  return plugin;
}

// ─── Helper: set up two-phase mock for callMCP ────────────────────────────────

function setupTwoPhaseCallMCP(
  plugin: TerrestrialBrainPlugin,
  metadata: { id: string; title: string; file_path: string; content_size: number; created_at: string }[],
  contentItems: { id: string; content: string }[],
) {
  plugin.callMCP = vi.fn()
    .mockResolvedValueOnce(JSON.stringify(metadata))     // get_pending_ai_output_metadata
    .mockResolvedValueOnce(JSON.stringify(contentItems))  // fetch_ai_output_content
    .mockResolvedValueOnce("ok");                         // mark_ai_output_picked_up
}

// ─── isExcluded tests ────────────────────────────────────────────────────────

describe("isExcluded", () => {
  it("returns true for frontmatter boolean terrestrialBrainExclude: true", () => {
    const plugin = createTestPlugin({
      frontmatter: { terrestrialBrainExclude: true },
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(true);
  });

  it("returns false for frontmatter boolean terrestrialBrainExclude: false", () => {
    const plugin = createTestPlugin({
      frontmatter: { terrestrialBrainExclude: false },
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(false);
  });

  it("returns true for tag-array exclusion (existing behavior)", () => {
    const plugin = createTestPlugin({
      frontmatter: { tags: ["terrestrialBrainExclude"] },
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(true);
  });

  it("returns true for inline tag exclusion", () => {
    const plugin = createTestPlugin({
      frontmatter: {},
      inlineTags: [{ tag: "#terrestrialBrainExclude" }],
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(true);
  });

  it("returns false when no exclusion markers are present", () => {
    const plugin = createTestPlugin({
      frontmatter: {},
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(false);
  });

  it("returns false when no metadata cache exists", () => {
    const plugin = createTestPlugin();
    // Cache returns null by default when no overrides
    plugin.app.metadataCache.getFileCache = vi.fn().mockReturnValue(null);
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(false);
  });

  it("uses strict boolean equality (string 'true' does not match)", () => {
    const plugin = createTestPlugin({
      frontmatter: { terrestrialBrainExclude: "true" },
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(false);
  });
});

// ─── pollAIOutput tests (two-phase fetch) ─────────────────────────────────────

describe("pollAIOutput", () => {
  beforeEach(() => {
    noticeMessages.length = 0;
  });

  it("stores content hash in syncedHashes after writing file", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const outputContent = "# AI Generated Output\n\nSome content here.";

    setupTwoPhaseCallMCP(
      plugin,
      [{ id: "output-1", title: "Test Output", file_path: "projects/Test/output.md", content_size: 42, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: outputContent }],
    );

    await plugin.pollAIOutput();

    expect(plugin.syncedHashes["projects/Test/output.md"]).toBeDefined();
    expect(typeof plugin.syncedHashes["projects/Test/output.md"]).toBe("string");
  });

  it("hash matches what processNote would compute (preventing re-ingestion)", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const outputContent = "---\ntitle: Test\n---\n# AI Output\n\nBody text.";

    setupTwoPhaseCallMCP(
      plugin,
      [{ id: "output-1", title: "Test Output", file_path: "projects/Test/output.md", content_size: 50, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: outputContent }],
    );

    await plugin.pollAIOutput();

    const expectedHash = simpleHash(stripFrontmatter(outputContent).trim());
    expect(plugin.syncedHashes["projects/Test/output.md"]).toBe(expectedHash);
  });

  it("calls saveSettings once after the loop", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    setupTwoPhaseCallMCP(
      plugin,
      [
        { id: "output-1", title: "Output 1", file_path: "test/one.md", content_size: 9, created_at: "2026-03-22T00:00:00Z" },
        { id: "output-2", title: "Output 2", file_path: "test/two.md", content_size: 9, created_at: "2026-03-22T00:00:00Z" },
        { id: "output-3", title: "Output 3", file_path: "test/three.md", content_size: 9, created_at: "2026-03-22T00:00:00Z" },
      ],
      [
        { id: "output-1", content: "Content 1" },
        { id: "output-2", content: "Content 2" },
        { id: "output-3", content: "Content 3" },
      ],
    );

    await plugin.pollAIOutput();

    // saveSettings should be called exactly once (not per file)
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

    // All 3 hashes should be stored
    expect(Object.keys(plugin.syncedHashes)).toHaveLength(3);
  });

  it("stores hashes for each file using file_path", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    setupTwoPhaseCallMCP(
      plugin,
      [
        { id: "output-1", title: "Output 1", file_path: "projects/CarChief/plan.md", content_size: 9, created_at: "2026-03-22T00:00:00Z" },
        { id: "output-2", title: "Output 2", file_path: "projects/TB/design.md", content_size: 9, created_at: "2026-03-22T00:00:00Z" },
      ],
      [
        { id: "output-1", content: "Content A" },
        { id: "output-2", content: "Content B" },
      ],
    );

    await plugin.pollAIOutput();

    expect(plugin.syncedHashes["projects/CarChief/plan.md"]).toBe(simpleHash("Content A"));
    expect(plugin.syncedHashes["projects/TB/design.md"]).toBe(simpleHash("Content B"));
  });

  it("does nothing when no endpoint is configured", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "" });

    await plugin.pollAIOutput();

    expect(plugin.callMCP).not.toHaveBeenCalled();
  });

  it("calls get_pending_ai_output_metadata, fetch_ai_output_content, and mark_ai_output_picked_up", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    setupTwoPhaseCallMCP(
      plugin,
      [{ id: "output-1", title: "Output 1", file_path: "test/file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "Content" }],
    );

    await plugin.pollAIOutput();

    expect(plugin.callMCP).toHaveBeenCalledWith("get_pending_ai_output_metadata", {});
    expect(plugin.callMCP).toHaveBeenCalledWith("fetch_ai_output_content", { ids: ["output-1"] });
    expect(plugin.callMCP).toHaveBeenCalledWith("mark_ai_output_picked_up", { ids: ["output-1"] });
  });

  it("does NOT call fetch_ai_output_content when user rejects", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue(false); // user rejects

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify([
        { id: "output-1", title: "Output 1", file_path: "test/file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" },
      ]))
      .mockResolvedValueOnce("ok"); // reject_ai_output

    await plugin.pollAIOutput();

    expect(plugin.callMCP).toHaveBeenCalledWith("get_pending_ai_output_metadata", {});
    expect(plugin.callMCP).not.toHaveBeenCalledWith("fetch_ai_output_content", expect.anything());
    expect(plugin.callMCP).toHaveBeenCalledWith("reject_ai_output", { ids: ["output-1"] });
  });
});

// ─── Empty-poll notice tests ─────────────────────────────────────────────────

describe("empty-poll notice", () => {
  beforeEach(() => {
    noticeMessages.length = 0;
  });

  it("shows notice when manual poll finds nothing", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.callMCP = vi.fn().mockResolvedValueOnce("[]"); // empty metadata

    await plugin.pollAIOutput({ manual: true });

    expect(noticeMessages).toContain("No pending AI output to pull");
  });

  it("does NOT show notice when automatic poll finds nothing", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.callMCP = vi.fn().mockResolvedValueOnce("[]"); // empty metadata

    await plugin.pollAIOutput();

    expect(noticeMessages).not.toContain("No pending AI output to pull");
  });
});

// ─── formatFileSize tests ────────────────────────────────────────────────────

describe("formatFileSize", () => {
  it("formats zero bytes", () => {
    expect(formatFileSize(0)).toBe("0 bytes");
  });

  it("formats small file in bytes", () => {
    expect(formatFileSize(500)).toBe("500 bytes");
  });

  it("formats exactly 1 KB", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
  });

  it("formats kilobytes with decimal", () => {
    expect(formatFileSize(2560)).toBe("2.5 KB");
  });

  it("formats megabytes", () => {
    expect(formatFileSize(1572864)).toBe("1.5 MB");
  });

  it("formats gigabytes", () => {
    expect(formatFileSize(1610612736)).toBe("1.5 GB");
  });
});

// ─── Utility function tests ─────────────────────────────────────────────────

describe("stripFrontmatter", () => {
  it("removes YAML frontmatter", () => {
    const input = "---\ntitle: Test\ntags: [a, b]\n---\n# Hello";
    expect(stripFrontmatter(input)).toBe("# Hello");
  });

  it("returns content unchanged when no frontmatter", () => {
    const input = "# Hello\nWorld";
    expect(stripFrontmatter(input)).toBe("# Hello\nWorld");
  });
});

describe("simpleHash", () => {
  it("returns consistent hash for same input", () => {
    expect(simpleHash("hello")).toBe(simpleHash("hello"));
  });

  it("returns different hash for different input", () => {
    expect(simpleHash("hello")).not.toBe(simpleHash("world"));
  });
});

// ─── Settings migration tests ────────────────────────────────────────────────

describe("loadSettings — migration from ms to minutes", () => {
  it("migrates debounceMs to syncDelayMinutes", async () => {
    const plugin = createTestPlugin();
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { debounceMs: 300000, pollIntervalMs: 600000, tbEndpointUrl: "", excludeTag: "terrestrialBrainExclude", projectsFolderBase: "projects" },
      syncedHashes: {},
    });

    await plugin.loadSettings();

    expect(plugin.settings.syncDelayMinutes).toBe(5);
    expect(plugin.settings.pollIntervalMinutes).toBe(10);
    expect((plugin.settings as Record<string, unknown>)["debounceMs"]).toBeUndefined();
    expect((plugin.settings as Record<string, unknown>)["pollIntervalMs"]).toBeUndefined();
  });

  it("preserves new minute settings if already present", async () => {
    const plugin = createTestPlugin();
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { syncDelayMinutes: 3, pollIntervalMinutes: 15, tbEndpointUrl: "", excludeTag: "terrestrialBrainExclude", projectsFolderBase: "projects" },
      syncedHashes: {},
    });

    await plugin.loadSettings();

    expect(plugin.settings.syncDelayMinutes).toBe(3);
    expect(plugin.settings.pollIntervalMinutes).toBe(15);
  });

  it("uses defaults when no persisted data exists", async () => {
    const plugin = createTestPlugin();
    plugin.loadData = vi.fn().mockResolvedValue(null);

    await plugin.loadSettings();

    expect(plugin.settings.syncDelayMinutes).toBe(5);
    expect(plugin.settings.pollIntervalMinutes).toBe(10);
  });
});

// ─── Minutes-to-ms conversion tests ──────────────────────────────────────────

describe("timer scheduling uses minutes-to-ms conversion", () => {
  it("scheduleSync uses syncDelayMinutes * 60000", () => {
    const plugin = createTestPlugin();
    plugin.settings.syncDelayMinutes = 3;

    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const file = { path: "test.md", extension: "md" } as any;

    plugin.scheduleSync(file);

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 180000);
    setTimeoutSpy.mockRestore();
  });
});

// ─── Context menu tests ──────────────────────────────────────────────────────

describe("ribbon icon context menu", () => {
  it("addRibbonIcon is called with brain icon and callback", async () => {
    const plugin = createTestPlugin();
    const addRibbonIconSpy = vi.fn();
    plugin.addRibbonIcon = addRibbonIconSpy;
    plugin.addCommand = vi.fn();
    plugin.addSettingTab = vi.fn();
    plugin.registerEvent = vi.fn();
    plugin.registerInterval = vi.fn();
    plugin.loadData = vi.fn().mockResolvedValue(null);
    plugin.app.vault.on = vi.fn().mockReturnValue({ unload: vi.fn() });

    // Obsidian provides window globally — stub it for Node
    const originalWindow = globalThis.window;
    (globalThis as any).window = { setTimeout: vi.fn(), setInterval: vi.fn().mockReturnValue(1) };

    await plugin.onload();

    expect(addRibbonIconSpy).toHaveBeenCalledWith("brain", "Terrestrial Brain", expect.any(Function));

    // Restore
    if (originalWindow !== undefined) {
      (globalThis as any).window = originalWindow;
    } else {
      delete (globalThis as any).window;
    }
  });
});

// ─── AI output nested path tests ──────────────────────────────────────────────

describe("AI output delivery to nested paths", () => {
  it("creates parent directories for deeply nested paths", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    setupTwoPhaseCallMCP(
      plugin,
      [{ id: "output-1", title: "Deep Output", file_path: "deeply/nested/folder/structure/document.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "Content" }],
    );

    await plugin.pollAIOutput();

    expect(plugin.app.vault.adapter.mkdir).toHaveBeenCalledWith("deeply/nested/folder/structure");
    expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith("deeply/nested/folder/structure/document.md", "Content");
  });

  it("creates parent directory for single-level nested path", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    setupTwoPhaseCallMCP(
      plugin,
      [{ id: "output-1", title: "Output", file_path: "projects/file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "Content" }],
    );

    await plugin.pollAIOutput();

    expect(plugin.app.vault.adapter.mkdir).toHaveBeenCalledWith("projects");
  });

  it("handles root-level file (no parent directory needed)", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    setupTwoPhaseCallMCP(
      plugin,
      [{ id: "output-1", title: "Root Output", file_path: "root-file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "Content" }],
    );

    await plugin.pollAIOutput();

    // mkdir should not be called for root-level files (no folder prefix)
    expect(plugin.app.vault.adapter.mkdir).not.toHaveBeenCalled();
    expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith("root-file.md", "Content");
  });
});
