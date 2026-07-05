import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
    registerInterval(id: number) { return id; }
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

import TerrestrialBrainPlugin, { stripFrontmatter, simpleHash, formatFileSize, generateCopyPath, buildEndpointUrl, extractKeyFromUrl, isInsecureEndpoint, truncateForNotice } from "./main";

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
    accessKey: "",
    excludeTag: overrides.excludeTag ?? "tbExclude",
    syncDelayMinutes: 5,
    pollIntervalMinutes: 10,
    projectsFolderBase: "projects",
  };

  plugin.syncedHashes = {};
  plugin.debounceTimers = new Map();
  plugin.pollInProgress = false;

  // Auto-accept confirmation dialog in tests (real modal blocks forever)
  plugin.showConfirmationDialog = vi.fn().mockResolvedValue({
    decision: "accepted",
    resolutions: new Map(),
  });

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
        exists: vi.fn().mockResolvedValue(false),
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
  plugin.callHTTP = vi.fn().mockResolvedValue({ success: true, data: [] });

  return plugin;
}

// ─── Helper: set up two-phase mock for callHTTP ──────────────────────────────

function setupTwoPhaseCallHTTP(
  plugin: TerrestrialBrainPlugin,
  metadata: { id: string; title: string; file_path: string; content_size: number; created_at: string }[],
  contentItems: { id: string; content: string }[],
) {
  plugin.callHTTP = vi.fn()
    .mockResolvedValueOnce({ success: true, data: metadata })       // get-pending-ai-output-metadata
    .mockResolvedValueOnce({ success: true, data: contentItems })   // fetch-ai-output-content
    .mockResolvedValueOnce({ success: true, message: "ok" });       // mark-ai-output-picked-up
}

// ─── isExcluded tests ────────────────────────────────────────────────────────

describe("isExcluded", () => {
  it("returns true for frontmatter boolean tbExclude: true", () => {
    const plugin = createTestPlugin({
      frontmatter: { tbExclude: true },
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(true);
  });

  it("returns false for frontmatter boolean tbExclude: false", () => {
    const plugin = createTestPlugin({
      frontmatter: { tbExclude: false },
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(false);
  });

  it("returns true for tag-array exclusion (existing behavior)", () => {
    const plugin = createTestPlugin({
      frontmatter: { tags: ["tbExclude"] },
    });
    const file = { path: "test.md" } as any;

    expect(plugin.isExcluded(file)).toBe(true);
  });

  it("returns true for inline tag exclusion", () => {
    const plugin = createTestPlugin({
      frontmatter: {},
      inlineTags: [{ tag: "#tbExclude" }],
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
      frontmatter: { tbExclude: "true" },
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

    setupTwoPhaseCallHTTP(
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

    setupTwoPhaseCallHTTP(
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

    setupTwoPhaseCallHTTP(
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

    setupTwoPhaseCallHTTP(
      plugin,
      [
        { id: "output-1", title: "Output 1", file_path: "projects/Test Proj/plan.md", content_size: 9, created_at: "2026-03-22T00:00:00Z" },
        { id: "output-2", title: "Output 2", file_path: "projects/TB/design.md", content_size: 9, created_at: "2026-03-22T00:00:00Z" },
      ],
      [
        { id: "output-1", content: "Content A" },
        { id: "output-2", content: "Content B" },
      ],
    );

    await plugin.pollAIOutput();

    expect(plugin.syncedHashes["projects/Test Proj/plan.md"]).toBe(simpleHash("Content A"));
    expect(plugin.syncedHashes["projects/TB/design.md"]).toBe(simpleHash("Content B"));
  });

  it("does nothing when no endpoint is configured", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "" });

    await plugin.pollAIOutput();

    expect(plugin.callHTTP).not.toHaveBeenCalled();
  });

  it("calls get-pending-ai-output-metadata, fetch-ai-output-content, and mark-ai-output-picked-up", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    setupTwoPhaseCallHTTP(
      plugin,
      [{ id: "output-1", title: "Output 1", file_path: "test/file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "Content" }],
    );

    await plugin.pollAIOutput();

    expect(plugin.callHTTP).toHaveBeenCalledWith("get-pending-ai-output-metadata");
    expect(plugin.callHTTP).toHaveBeenCalledWith("fetch-ai-output-content", { ids: ["output-1"] });
    expect(plugin.callHTTP).toHaveBeenCalledWith("mark-ai-output-picked-up", { ids: ["output-1"] });
  });

  it("does NOT call fetch-ai-output-content when user rejects", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue({ decision: "rejected", resolutions: new Map() });

    plugin.callHTTP = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [
        { id: "output-1", title: "Output 1", file_path: "test/file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" },
      ] })
      .mockResolvedValueOnce({ success: true, message: "ok" }); // reject-ai-output

    await plugin.pollAIOutput();

    expect(plugin.callHTTP).toHaveBeenCalledWith("get-pending-ai-output-metadata");
    expect(plugin.callHTTP).not.toHaveBeenCalledWith("fetch-ai-output-content", expect.anything());
    expect(plugin.callHTTP).toHaveBeenCalledWith("reject-ai-output", { ids: ["output-1"] });
  });

  it("does NOT call fetch-ai-output-content or reject-ai-output when user postpones", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue({ decision: "postponed", resolutions: new Map() });

    plugin.callHTTP = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [
        { id: "output-1", title: "Output 1", file_path: "test/file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" },
      ] });

    await plugin.pollAIOutput();

    expect(plugin.callHTTP).toHaveBeenCalledWith("get-pending-ai-output-metadata");
    expect(plugin.callHTTP).not.toHaveBeenCalledWith("fetch-ai-output-content", expect.anything());
    expect(plugin.callHTTP).not.toHaveBeenCalledWith("reject-ai-output", expect.anything());
  });

  it("does not show any notice when user postpones", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue({ decision: "postponed", resolutions: new Map() });

    plugin.callHTTP = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [
        { id: "output-1", title: "Output 1", file_path: "test/file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" },
      ] });

    noticeMessages.length = 0;
    await plugin.pollAIOutput();

    expect(noticeMessages).toHaveLength(0);
  });
});

// ─── Empty-poll notice tests ─────────────────────────────────────────────────

describe("empty-poll notice", () => {
  beforeEach(() => {
    noticeMessages.length = 0;
  });

  it("shows notice when manual poll finds nothing", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.callHTTP = vi.fn().mockResolvedValueOnce({ success: true, data: [] });

    await plugin.pollAIOutput({ manual: true });

    expect(noticeMessages).toContain("No pending AI output to pull");
  });

  it("does NOT show notice when automatic poll finds nothing", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.callHTTP = vi.fn().mockResolvedValueOnce({ success: true, data: [] });

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
      settings: { debounceMs: 300000, pollIntervalMs: 600000, tbEndpointUrl: "", excludeTag: "tbExclude", projectsFolderBase: "projects" },
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
      settings: { syncDelayMinutes: 3, pollIntervalMinutes: 15, tbEndpointUrl: "", excludeTag: "tbExclude", projectsFolderBase: "projects" },
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
    (globalThis as any).window = { setTimeout: vi.fn(), setInterval: vi.fn().mockReturnValue(1), clearInterval: vi.fn() };

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

    setupTwoPhaseCallHTTP(
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

    setupTwoPhaseCallHTTP(
      plugin,
      [{ id: "output-1", title: "Output", file_path: "projects/file.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "Content" }],
    );

    await plugin.pollAIOutput();

    expect(plugin.app.vault.adapter.mkdir).toHaveBeenCalledWith("projects");
  });

  it("handles root-level file (no parent directory needed)", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    setupTwoPhaseCallHTTP(
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

// ─── generateCopyPath tests ──────────────────────────────────────────────────

describe("generateCopyPath", () => {
  it("returns Filename(2).md for a basic conflict", async () => {
    const exists = vi.fn().mockResolvedValue(false);
    const result = await generateCopyPath("projects/Plan.md", exists);
    expect(result).toBe("projects/Plan(2).md");
    expect(exists).toHaveBeenCalledWith("projects/Plan(2).md");
  });

  it("increments suffix when (2) already exists", async () => {
    const exists = vi.fn()
      .mockResolvedValueOnce(true)   // Plan(2).md exists
      .mockResolvedValueOnce(false); // Plan(3).md available
    const result = await generateCopyPath("projects/Plan.md", exists);
    expect(result).toBe("projects/Plan(3).md");
  });

  it("increments through multiple existing copies", async () => {
    const exists = vi.fn()
      .mockResolvedValueOnce(true)   // Todo(2).md
      .mockResolvedValueOnce(true)   // Todo(3).md
      .mockResolvedValueOnce(true)   // Todo(4).md
      .mockResolvedValueOnce(false); // Todo(5).md available
    const result = await generateCopyPath("notes/Todo.md", exists);
    expect(result).toBe("notes/Todo(5).md");
  });

  it("handles root-level file (no parent directory)", async () => {
    const exists = vi.fn().mockResolvedValue(false);
    const result = await generateCopyPath("README.md", exists);
    expect(result).toBe("README(2).md");
  });

  it("throws after exhausting 100 attempts", async () => {
    const exists = vi.fn().mockResolvedValue(true); // everything exists
    await expect(
      generateCopyPath("file.md", exists),
    ).rejects.toThrow("Could not find available copy name");
    expect(exists).toHaveBeenCalledTimes(100);
  });

  it("preserves directory in copy path", async () => {
    const exists = vi.fn().mockResolvedValue(false);
    const result = await generateCopyPath("deeply/nested/folder/doc.md", exists);
    expect(result).toBe("deeply/nested/folder/doc(2).md");
  });
});

// ─── Conflict detection tests ────────────────────────────────────────────────

describe("conflict detection in pollAIOutput", () => {
  beforeEach(() => {
    noticeMessages.length = 0;
  });

  it("builds correct ConflictInfo from exists checks", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    // file-1 exists, file-2 doesn't
    plugin.app.vault.adapter.exists = vi.fn()
      .mockResolvedValueOnce(true)   // projects/existing.md
      .mockResolvedValueOnce(false); // projects/new.md

    setupTwoPhaseCallHTTP(
      plugin,
      [
        { id: "output-1", title: "Existing", file_path: "projects/existing.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" },
        { id: "output-2", title: "New", file_path: "projects/new.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" },
      ],
      [
        { id: "output-1", content: "Content 1" },
        { id: "output-2", content: "Content 2" },
      ],
    );

    await plugin.pollAIOutput();

    // showConfirmationDialog receives metadataList and conflicts
    expect(plugin.showConfirmationDialog).toHaveBeenCalledWith(
      expect.any(Array),
      { "output-1": true, "output-2": false },
    );
  });

  it("calls exists for each metadata entry's file_path", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.app.vault.adapter.exists = vi.fn().mockResolvedValue(false);

    setupTwoPhaseCallHTTP(
      plugin,
      [
        { id: "o1", title: "A", file_path: "a.md", content_size: 1, created_at: "2026-03-22T00:00:00Z" },
        { id: "o2", title: "B", file_path: "b.md", content_size: 1, created_at: "2026-03-22T00:00:00Z" },
        { id: "o3", title: "C", file_path: "c.md", content_size: 1, created_at: "2026-03-22T00:00:00Z" },
      ],
      [
        { id: "o1", content: "A" },
        { id: "o2", content: "B" },
        { id: "o3", content: "C" },
      ],
    );

    await plugin.pollAIOutput();

    expect(plugin.app.vault.adapter.exists).toHaveBeenCalledWith("a.md");
    expect(plugin.app.vault.adapter.exists).toHaveBeenCalledWith("b.md");
    expect(plugin.app.vault.adapter.exists).toHaveBeenCalledWith("c.md");
  });
});

// ─── Conflict-aware file writing tests ──────────────────────────────────────

describe("conflict-aware file writing", () => {
  beforeEach(() => {
    noticeMessages.length = 0;
  });

  it("overwrites file when resolution is 'overwrite' (default)", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.app.vault.adapter.exists = vi.fn().mockResolvedValue(true); // file exists

    const resolutions = new Map([["output-1", "overwrite" as const]]);
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue({
      decision: "accepted",
      resolutions,
    });

    setupTwoPhaseCallHTTP(
      plugin,
      [{ id: "output-1", title: "Overwrite Me", file_path: "projects/plan.md", content_size: 10, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "New content" }],
    );

    await plugin.pollAIOutput();

    expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith("projects/plan.md", "New content");
    expect(plugin.syncedHashes["projects/plan.md"]).toBe(simpleHash("New content"));
  });

  it("renames file when resolution is 'rename'", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    // exists() calls: first for conflict detection, then for generateCopyPath
    plugin.app.vault.adapter.exists = vi.fn()
      .mockResolvedValueOnce(true)   // conflict detection: projects/plan.md exists
      .mockResolvedValueOnce(false); // generateCopyPath: projects/plan(2).md available

    const resolutions = new Map([["output-1", "rename" as const]]);
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue({
      decision: "accepted",
      resolutions,
    });

    setupTwoPhaseCallHTTP(
      plugin,
      [{ id: "output-1", title: "Save Copy", file_path: "projects/plan.md", content_size: 10, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "New content" }],
    );

    await plugin.pollAIOutput();

    expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith("projects/plan(2).md", "New content");
  });

  it("stores hash under actual written path when renamed", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    plugin.app.vault.adapter.exists = vi.fn()
      .mockResolvedValueOnce(true)   // conflict detection
      .mockResolvedValueOnce(false); // generateCopyPath

    const resolutions = new Map([["output-1", "rename" as const]]);
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue({
      decision: "accepted",
      resolutions,
    });

    setupTwoPhaseCallHTTP(
      plugin,
      [{ id: "output-1", title: "Renamed", file_path: "projects/plan.md", content_size: 10, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "Renamed content" }],
    );

    await plugin.pollAIOutput();

    // Hash stored under the renamed path, not the original
    expect(plugin.syncedHashes["projects/plan(2).md"]).toBe(simpleHash("Renamed content"));
    expect(plugin.syncedHashes["projects/plan.md"]).toBeUndefined();
  });

  it("skips file and continues when generateCopyPath fails", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    // fail.md and all its copies exist; success.md does not
    plugin.app.vault.adapter.exists = vi.fn().mockImplementation(async (path: string) => {
      if (path === "success.md") return false;
      return true; // fail.md and all fail(N).md variants exist
    });

    const resolutions = new Map([["output-1", "rename" as const]]);
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue({
      decision: "accepted",
      resolutions,
    });

    plugin.callHTTP = vi.fn()
      .mockResolvedValueOnce({ success: true, data: [
        { id: "output-1", title: "Fail Rename", file_path: "fail.md", content_size: 5, created_at: "2026-03-22T00:00:00Z" },
        { id: "output-2", title: "Success", file_path: "success.md", content_size: 5, created_at: "2026-03-22T00:00:00Z" },
      ] })
      .mockResolvedValueOnce({ success: true, data: [
        { id: "output-1", content: "Fail" },
        { id: "output-2", content: "Works" },
      ] })
      .mockResolvedValueOnce({ success: true, message: "ok" }); // mark-ai-output-picked-up

    await plugin.pollAIOutput();

    // output-1 was skipped, output-2 was delivered
    expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith("success.md", "Works");
    expect(plugin.app.vault.adapter.write).toHaveBeenCalledTimes(1);

    // Only output-2 was marked as picked up
    expect(plugin.callHTTP).toHaveBeenCalledWith("mark-ai-output-picked-up", { ids: ["output-2"] });

    // Error notice shown for the failed rename
    expect(noticeMessages.some((message) => message.includes("Could not find available copy name"))).toBe(true);
  });

  it("writes non-conflicting files without rename regardless of resolutions", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.app.vault.adapter.exists = vi.fn().mockResolvedValue(false); // nothing exists

    // No resolutions for non-conflicting files
    plugin.showConfirmationDialog = vi.fn().mockResolvedValue({
      decision: "accepted",
      resolutions: new Map(),
    });

    setupTwoPhaseCallHTTP(
      plugin,
      [{ id: "output-1", title: "New File", file_path: "projects/new.md", content_size: 7, created_at: "2026-03-22T00:00:00Z" }],
      [{ id: "output-1", content: "Content" }],
    );

    await plugin.pollAIOutput();

    expect(plugin.app.vault.adapter.write).toHaveBeenCalledWith("projects/new.md", "Content");
    expect(plugin.syncedHashes["projects/new.md"]).toBeDefined();
  });
});

// ─── buildEndpointUrl tests ─────────────────────────────────────────────────

describe("buildEndpointUrl", () => {
  it("inserts endpoint name before query string", () => {
    expect(buildEndpointUrl("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc", "ingest-note"))
      .toBe("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp/ingest-note?key=abc");
  });

  it("appends endpoint name when no query string", () => {
    expect(buildEndpointUrl("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp", "ingest-note"))
      .toBe("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp/ingest-note");
  });

  it("handles URL with multiple query params", () => {
    expect(buildEndpointUrl("https://example.com/mcp?key=abc&debug=true", "mark-ai-output-picked-up"))
      .toBe("https://example.com/mcp/mark-ai-output-picked-up?key=abc&debug=true");
  });
});

// ─── callIngestNote tests ───────────────────────────────────────────────────

describe("callIngestNote", () => {
  it("sends plain JSON POST to /ingest-note URL and returns message", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp?key=abc" });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, message: 'Captured 3 thoughts from "Test"' }),
      headers: new Headers({ "content-type": "application/json" }),
    } as Response);

    const result = await plugin.callIngestNote("note content", "Test", "folder/Test.md");

    expect(result).toBe('Captured 3 thoughts from "Test"');
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.com/mcp/ingest-note?key=abc",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "note content", title: "Test", note_id: "folder/Test.md" }),
      }),
    );

    fetchSpy.mockRestore();
  });

  it("throws on failure response", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp?key=abc" });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: false, error: "content is required" }),
      headers: new Headers({ "content-type": "application/json" }),
    } as Response);

    await expect(plugin.callIngestNote("", "Test", "test.md"))
      .rejects.toThrow("content is required");

    fetchSpy.mockRestore();
  });

  it("throws on HTTP error", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp?key=abc" });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: () => Promise.resolve("Unauthorized"),
    } as Response);

    await expect(plugin.callIngestNote("content", "Test", "test.md"))
      .rejects.toThrow("Ingest 401: Unauthorized");

    fetchSpy.mockRestore();
  });
});

// ─── processNote uses callIngestNote tests ──────────────────────────────────

describe("processNote uses callIngestNote", () => {
  it("calls callIngestNote for note ingestion", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp?key=abc" });
    plugin.callIngestNote = vi.fn().mockResolvedValue('Captured 2 thoughts from "Test"');
    plugin.app.vault.read = vi.fn().mockResolvedValue("# Test Note\n\nSome content here.");

    const file = { path: "folder/test.md", basename: "test", extension: "md" } as any;
    await plugin.processNote(file, { force: true, silent: true });

    expect(plugin.callIngestNote).toHaveBeenCalledWith(
      "# Test Note\n\nSome content here.",
      "test",
      "folder/test.md",
    );
  });
});

// ─── x-brain-key header auth tests ───────────────────────────────────────────
// These exercise the REAL callHTTP / callIngestNote implementations with fetch
// mocked at the boundary (the plugin's own code is on the tested path).

describe("x-brain-key header auth", () => {
  const realFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function mockFetchOk() {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: [], message: "ok" }),
      text: async () => "",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  function createHeaderTestPlugin(accessKey: string): TerrestrialBrainPlugin {
    const plugin = createTestPlugin({
      tbEndpointUrl: "https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp",
    });
    (plugin.settings as unknown as Record<string, unknown>).accessKey = accessKey;
    // Remove the vi.fn() override so the real prototype implementation runs
    delete (plugin as unknown as Record<string, unknown>).callHTTP;
    return plugin;
  }

  it("callHTTP sends the key as x-brain-key header and keeps it out of the URL", async () => {
    const plugin = createHeaderTestPlugin("secret123");
    const fetchMock = mockFetchOk();

    await plugin.callHTTP("get-pending-ai-output-metadata");

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-brain-key"]).toBe("secret123");
    expect(String(requestUrl)).not.toContain("key=");
  });

  it("callIngestNote sends the key as x-brain-key header and keeps it out of the URL", async () => {
    const plugin = createHeaderTestPlugin("secret123");
    const fetchMock = mockFetchOk();

    await plugin.callIngestNote("some content", "title", "folder/note.md");

    const [requestUrl, requestInit] = fetchMock.mock.calls[0];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-brain-key"]).toBe("secret123");
    expect(String(requestUrl)).not.toContain("key=");
  });

  it("callHTTP omits the x-brain-key header when accessKey is empty", async () => {
    const plugin = createHeaderTestPlugin("");
    const fetchMock = mockFetchOk();

    await plugin.callHTTP("get-pending-ai-output-metadata");

    const [, requestInit] = fetchMock.mock.calls[0];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-brain-key"]).toBeUndefined();
  });

  it("callIngestNote omits the x-brain-key header when accessKey is empty", async () => {
    const plugin = createHeaderTestPlugin("");
    const fetchMock = mockFetchOk();

    await plugin.callIngestNote("some content", "title", "folder/note.md");

    const [, requestInit] = fetchMock.mock.calls[0];
    const headers = requestInit.headers as Record<string, string>;
    expect(headers["x-brain-key"]).toBeUndefined();
  });
});

// ─── extractKeyFromUrl tests ─────────────────────────────────────────────────

describe("extractKeyFromUrl", () => {
  it("extracts the key and strips the query string entirely when key is the only param", () => {
    const result = extractKeyFromUrl("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc");
    expect(result.url).toBe("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp");
    expect(result.key).toBe("abc");
  });

  it("preserves other query parameters", () => {
    const result = extractKeyFromUrl("https://host/fn?foo=1&key=abc");
    expect(result.url).toBe("https://host/fn?foo=1");
    expect(result.key).toBe("abc");
  });

  it("returns the URL unchanged when there is no query string", () => {
    const result = extractKeyFromUrl("https://host/fn");
    expect(result.url).toBe("https://host/fn");
    expect(result.key).toBe("");
  });

  it("returns the URL unchanged when the query string has no key param", () => {
    const result = extractKeyFromUrl("https://host/fn?foo=1");
    expect(result.url).toBe("https://host/fn?foo=1");
    expect(result.key).toBe("");
  });

  it("decodes URL-encoded key values", () => {
    const result = extractKeyFromUrl("https://host/fn?key=a%2Bb");
    expect(result.key).toBe("a+b");
  });
});

// ─── loadSettings key-in-URL migration tests ─────────────────────────────────

describe("loadSettings migrates legacy ?key= URLs", () => {
  function createMigrationTestPlugin(storedSettings: Record<string, unknown>): TerrestrialBrainPlugin {
    const plugin = createTestPlugin();
    // Real loadSettings must run — remove nothing (it lives on the prototype),
    // just feed it stored data and let it write through the mocked saveData.
    plugin.loadData = vi.fn().mockResolvedValue({ settings: storedSettings, syncedHashes: {} });
    return plugin;
  }

  it("moves ?key= into accessKey and strips the URL on load", async () => {
    const plugin = createMigrationTestPlugin({
      tbEndpointUrl: "https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp?key=abc",
    });

    await plugin.loadSettings();

    expect(plugin.settings.accessKey).toBe("abc");
    expect(plugin.settings.tbEndpointUrl).toBe("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp");
  });

  it("persists the migrated settings", async () => {
    const plugin = createMigrationTestPlugin({
      tbEndpointUrl: "https://host/fn?key=abc",
    });

    await plugin.loadSettings();

    expect(plugin.saveData).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          accessKey: "abc",
          tbEndpointUrl: "https://host/fn",
        }),
      }),
    );
  });

  it("keeps an already-set accessKey and still strips the URL", async () => {
    const plugin = createMigrationTestPlugin({
      tbEndpointUrl: "https://host/fn?key=urlkey",
      accessKey: "fieldkey",
    });

    await plugin.loadSettings();

    expect(plugin.settings.accessKey).toBe("fieldkey");
    expect(plugin.settings.tbEndpointUrl).toBe("https://host/fn");
  });

  it("preserves unrelated query parameters while stripping the key", async () => {
    const plugin = createMigrationTestPlugin({
      tbEndpointUrl: "https://host/fn?foo=1&key=abc",
    });

    await plugin.loadSettings();

    expect(plugin.settings.tbEndpointUrl).toBe("https://host/fn?foo=1");
    expect(plugin.settings.accessKey).toBe("abc");
  });

  it("does not persist when there is nothing to migrate", async () => {
    const plugin = createMigrationTestPlugin({
      tbEndpointUrl: "https://host/fn",
      accessKey: "already-set",
    });

    await plugin.loadSettings();

    expect(plugin.settings.tbEndpointUrl).toBe("https://host/fn");
    expect(plugin.settings.accessKey).toBe("already-set");
    expect(plugin.saveData).not.toHaveBeenCalled();
  });
});

// ─── C1: vault-sync honest failure reporting ─────────────────────────────────
// Runs the REAL vault-sync command loop through the REAL processNote, with
// callIngestNote rejecting for every file. The bug: current code shows
// "✅ Vault sync complete" even when every note failed.

describe("C1 — vault sync reports real failures", () => {
  const realWindow = (globalThis as any).window;

  afterEach(() => {
    if (realWindow !== undefined) {
      (globalThis as any).window = realWindow;
    } else {
      delete (globalThis as any).window;
    }
    noticeMessages.length = 0;
  });

  async function loadPluginWithFiles(
    files: { path: string; basename: string; extension: string }[],
  ): Promise<{ plugin: TerrestrialBrainPlugin; commands: Record<string, any> }> {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });

    const commands: Record<string, any> = {};
    plugin.addCommand = ((cmd: any) => { commands[cmd.id] = cmd; }) as any;
    plugin.addRibbonIcon = vi.fn() as any;
    plugin.addSettingTab = vi.fn() as any;
    plugin.registerEvent = vi.fn() as any;
    plugin.registerInterval = vi.fn().mockReturnValue(1) as any;
    // Keep the endpoint through loadSettings (which otherwise resets to defaults)
    plugin.loadData = vi.fn().mockResolvedValue({
      settings: { tbEndpointUrl: "https://example.com/mcp" },
      syncedHashes: {},
    });
    plugin.app.vault.on = vi.fn().mockReturnValue({});
    plugin.app.vault.getMarkdownFiles = vi.fn().mockReturnValue(files);
    plugin.app.vault.read = vi.fn().mockResolvedValue("# content body");

    (globalThis as any).window = {
      setTimeout: vi.fn(),
      setInterval: vi.fn().mockReturnValue(1),
      clearInterval: vi.fn(),
    };

    await plugin.onload();
    return { plugin, commands };
  }

  it("does NOT show a success notice when every note fails", async () => {
    const files = [
      { path: "a.md", basename: "a", extension: "md" },
      { path: "b.md", basename: "b", extension: "md" },
    ];
    const { plugin, commands } = await loadPluginWithFiles(files);
    // Every ingest fails — real processNote runs
    plugin.callIngestNote = vi.fn().mockRejectedValue(new Error("network down"));

    noticeMessages.length = 0;
    await commands["sync-vault-to-terrestrial-brain"].callback();

    expect(noticeMessages.some((message) => message.includes("Vault sync complete"))).toBe(false);
    expect(noticeMessages.some((message) => /fail/i.test(message))).toBe(true);
  });

  it("reports accurate counts on mixed success/failure", async () => {
    const files = [
      { path: "ok.md", basename: "ok", extension: "md" },
      { path: "bad.md", basename: "bad", extension: "md" },
    ];
    const { plugin, commands } = await loadPluginWithFiles(files);
    plugin.callIngestNote = vi.fn().mockImplementation(async (_content: string, title: string) => {
      if (title === "bad") throw new Error("boom");
      return "ok";
    });

    noticeMessages.length = 0;
    await commands["sync-vault-to-terrestrial-brain"].callback();

    // Exactly one failure reported; not a clean success notice
    expect(noticeMessages.some((message) => /1 failed/.test(message))).toBe(true);
    expect(noticeMessages.some((message) => message.includes("Vault sync complete"))).toBe(false);
  });
});

// ─── C10: saveSettings must not restart the poll interval ────────────────────
// Exercises the REAL saveSettings (not the vi.fn override the other tests use).

describe("C10 — saveSettings does not starve the poll interval", () => {
  const realWindow = (globalThis as any).window;

  afterEach(() => {
    if (realWindow !== undefined) {
      (globalThis as any).window = realWindow;
    } else {
      delete (globalThis as any).window;
    }
  });

  function stubWindow() {
    const clearIntervalSpy = vi.fn();
    const setIntervalSpy = vi.fn().mockReturnValue(555);
    (globalThis as any).window = {
      setInterval: setIntervalSpy,
      clearInterval: clearIntervalSpy,
    };
    return { clearIntervalSpy, setIntervalSpy };
  }

  it("persisting settings does not tear down a running interval", async () => {
    const plugin = createTestPlugin();
    // Use the REAL saveSettings from the prototype
    delete (plugin as unknown as Record<string, unknown>).saveSettings;
    plugin.saveData = vi.fn().mockResolvedValue(undefined);
    plugin.registerInterval = ((id: number) => id) as any;
    (plugin as any).pollIntervalId = 999; // pretend an interval is already registered

    const { clearIntervalSpy, setIntervalSpy } = stubWindow();

    await plugin.saveSettings();

    expect(clearIntervalSpy).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });
});

// ─── B3: vault delete/rename lifecycle + crash-safe debounce ─────────────────

describe("B3 — vault delete/rename lifecycle", () => {
  it("delete cancels the pending timer and drops the hash", async () => {
    const plugin = createTestPlugin();
    delete (plugin as unknown as Record<string, unknown>).saveSettings;
    plugin.saveData = vi.fn().mockResolvedValue(undefined);
    plugin.syncedHashes = { "a.md": "h1", "b.md": "h2" };
    const timer = setTimeout(() => {}, 100000);
    plugin.debounceTimers.set("a.md", timer);

    await plugin.handleFileDelete({ path: "a.md" } as any);

    expect(plugin.syncedHashes["a.md"]).toBeUndefined();
    expect(plugin.syncedHashes["b.md"]).toBe("h2");
    expect(plugin.debounceTimers.has("a.md")).toBe(false);
    expect(plugin.saveData).toHaveBeenCalled();
  });

  it("rename re-keys the hash and cancels the old-path timer", async () => {
    const plugin = createTestPlugin();
    delete (plugin as unknown as Record<string, unknown>).saveSettings;
    plugin.saveData = vi.fn().mockResolvedValue(undefined);
    plugin.syncedHashes = { "old.md": "h1" };
    const timer = setTimeout(() => {}, 100000);
    plugin.debounceTimers.set("old.md", timer);

    await plugin.handleFileRename({ path: "new.md" } as any, "old.md");

    expect(plugin.syncedHashes["new.md"]).toBe("h1");
    expect(plugin.syncedHashes["old.md"]).toBeUndefined();
    expect(plugin.debounceTimers.has("old.md")).toBe(false);
    expect(plugin.saveData).toHaveBeenCalled();
  });

  it("processNote returns 'skipped' (not throw) when the file is unreadable", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.app.vault.read = vi.fn().mockRejectedValue(new Error("ENOENT"));

    const outcome = await plugin.processNote({ path: "gone.md", basename: "gone", extension: "md" } as any);

    expect(outcome).toBe("skipped");
  });
});

// ─── B5: scheduled-sync retry with capped backoff ────────────────────────────

describe("B5 — scheduled sync retry", () => {
  function captureTimers() {
    const captured: { fn: () => Promise<void>; delay: number }[] = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => Promise<void>, delay: number) => {
      captured.push({ fn, delay });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    return { captured, spy };
  }

  it("retries a failed scheduled sync with a larger delay", async () => {
    const plugin = createTestPlugin();
    plugin.settings.syncDelayMinutes = 5; // base 300000 ms
    plugin.processNote = vi.fn().mockResolvedValue("failed");
    const { captured, spy } = captureTimers();

    plugin.scheduleSync({ path: "x.md", basename: "x", extension: "md" } as any);
    expect(captured[0].delay).toBe(300000);

    await captured[0].fn(); // fire the timer → failure → schedule a retry

    expect(captured.length).toBe(2);
    expect(captured[1].delay).toBeGreaterThan(captured[0].delay);

    spy.mockRestore();
  });

  it("stops retrying after MAX_RETRY_ATTEMPTS", async () => {
    const plugin = createTestPlugin();
    plugin.settings.syncDelayMinutes = 5;
    plugin.processNote = vi.fn().mockResolvedValue("failed");
    const { captured, spy } = captureTimers();

    plugin.scheduleSync({ path: "x.md", basename: "x", extension: "md" } as any, 3); // at the cap
    await captured[0].fn();

    expect(captured.length).toBe(1); // no further retry scheduled

    spy.mockRestore();
  });

  it("does not retry a successful or skipped scheduled sync", async () => {
    const plugin = createTestPlugin();
    plugin.processNote = vi.fn().mockResolvedValue("synced");
    const { captured, spy } = captureTimers();

    plugin.scheduleSync({ path: "x.md", basename: "x", extension: "md" } as any);
    await captured[0].fn();

    expect(captured.length).toBe(1);

    spy.mockRestore();
  });

  it("manual (forced) sync failure does not schedule any retry", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.app.vault.read = vi.fn().mockResolvedValue("# body");
    plugin.callIngestNote = vi.fn().mockRejectedValue(new Error("boom"));

    const outcome = await plugin.processNote(
      { path: "m.md", basename: "m", extension: "md" } as any,
      { force: true },
    );

    expect(outcome).toBe("failed");
    expect(plugin.debounceTimers.size).toBe(0);
  });
});

// ─── B4: manual pull failure surfaces a Notice ───────────────────────────────

describe("B4 — manual pull failure surfaced", () => {
  beforeEach(() => {
    noticeMessages.length = 0;
  });

  it("shows a Notice when a manual pull fails", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.callHTTP = vi.fn().mockRejectedValue(new Error("server exploded"));

    await plugin.pollAIOutput({ manual: true });

    expect(noticeMessages.some((message) => /Pull AI output failed/.test(message))).toBe(true);
  });

  it("stays silent when an automatic poll fails", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    plugin.callHTTP = vi.fn().mockRejectedValue(new Error("server exploded"));

    await plugin.pollAIOutput();

    expect(noticeMessages).toHaveLength(0);
  });
});

// ─── Plugin S4: bounded, sanitized error notices ─────────────────────────────

describe("truncateForNotice", () => {
  it("returns short text unchanged", () => {
    expect(truncateForNotice("content is required")).toBe("content is required");
  });

  it("collapses runs of whitespace", () => {
    expect(truncateForNotice("a\n\n  b\tc")).toBe("a b c");
  });

  it("truncates long text with an ellipsis", () => {
    const result = truncateForNotice("x".repeat(500), 300);
    expect(result.length).toBe(301); // 300 chars + the ellipsis
    expect(result.endsWith("…")).toBe(true);
  });
});

describe("Plugin S4 — error notices are bounded", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function realHttpPlugin(): TerrestrialBrainPlugin {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    delete (plugin as unknown as Record<string, unknown>).callHTTP;
    return plugin;
  }

  it("callHTTP truncates an oversized HTTP error body", async () => {
    const plugin = realHttpPlugin();
    const bigBody = "E".repeat(1000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => bigBody,
    }) as unknown as typeof fetch;

    let message = "";
    try {
      await plugin.callHTTP("get-pending-ai-output-metadata");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("HTTP 500");
    expect(message.endsWith("…")).toBe(true);
    expect(message.length).toBeLessThan(bigBody.length);
  });

  it("callIngestNote truncates an oversized error body", async () => {
    const plugin = realHttpPlugin();
    delete (plugin as unknown as Record<string, unknown>).callIngestNote;
    const bigBody = "Z".repeat(1000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => bigBody,
    }) as unknown as typeof fetch;

    let message = "";
    try {
      await plugin.callIngestNote("body", "title", "note.md");
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain("Ingest 502");
    expect(message.endsWith("…")).toBe(true);
    expect(message.length).toBeLessThan(bigBody.length);
  });
});

// ─── isInsecureEndpoint tests ────────────────────────────────────────────────

describe("isInsecureEndpoint", () => {
  it("returns true for plain http to a non-local host", () => {
    expect(isInsecureEndpoint("http://example.com/functions/v1/terrestrial-brain-mcp")).toBe(true);
  });

  it("returns true for plain http to a LAN address", () => {
    expect(isInsecureEndpoint("http://192.168.1.10:54321/functions/v1/terrestrial-brain-mcp")).toBe(true);
  });

  it("returns false for http://localhost with a port", () => {
    expect(isInsecureEndpoint("http://localhost:54321/functions/v1/terrestrial-brain-mcp")).toBe(false);
  });

  it("returns false for http://127.0.0.1 with a port", () => {
    expect(isInsecureEndpoint("http://127.0.0.1:54321/functions/v1/terrestrial-brain-mcp")).toBe(false);
  });

  it("returns false for https endpoints", () => {
    expect(isInsecureEndpoint("https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp")).toBe(false);
  });

  it("returns false for an empty URL", () => {
    expect(isInsecureEndpoint("")).toBe(false);
  });

  it("is case-insensitive about the scheme and host", () => {
    expect(isInsecureEndpoint("HTTP://Example.com/fn")).toBe(true);
    expect(isInsecureEndpoint("http://LOCALHOST:54321/fn")).toBe(false);
  });
});
