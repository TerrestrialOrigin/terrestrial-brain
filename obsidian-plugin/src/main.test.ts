import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the obsidian module before importing main
vi.mock("obsidian", () => ({
  App: class {},
  Notice: class {
    constructor() {}
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

import TerrestrialBrainPlugin, { stripFrontmatter, simpleHash } from "./main";

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
    debounceMs: 300000,
    pollIntervalMs: 600000,
    projectsFolderBase: "projects",
  };

  plugin.syncedHashes = {};

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

// ─── pollAIOutput tests ─────────────────────────────────────────────────────

describe("pollAIOutput", () => {
  it("stores content hash in syncedHashes after writing file", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const outputContent = "# AI Generated Output\n\nSome content here.";
    const aiOutputs = [
      { id: "output-1", title: "Test Output", content: outputContent, file_path: "projects/Test/output.md", created_at: "2026-03-22T00:00:00Z" },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiOutputs))  // get_pending_ai_output
      .mockResolvedValueOnce("ok");                       // mark_ai_output_picked_up

    await plugin.pollAIOutput();

    expect(plugin.syncedHashes["projects/Test/output.md"]).toBeDefined();
    expect(typeof plugin.syncedHashes["projects/Test/output.md"]).toBe("string");
  });

  it("hash matches what processNote would compute (preventing re-ingestion)", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const outputContent = "---\ntitle: Test\n---\n# AI Output\n\nBody text.";
    const aiOutputs = [
      { id: "output-1", title: "Test Output", content: outputContent, file_path: "projects/Test/output.md", created_at: "2026-03-22T00:00:00Z" },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiOutputs))
      .mockResolvedValueOnce("ok");

    await plugin.pollAIOutput();

    const expectedHash = simpleHash(stripFrontmatter(outputContent).trim());
    expect(plugin.syncedHashes["projects/Test/output.md"]).toBe(expectedHash);
  });

  it("calls saveSettings once after the loop", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const aiOutputs = [
      { id: "output-1", title: "Output 1", content: "Content 1", file_path: "test/one.md", created_at: "2026-03-22T00:00:00Z" },
      { id: "output-2", title: "Output 2", content: "Content 2", file_path: "test/two.md", created_at: "2026-03-22T00:00:00Z" },
      { id: "output-3", title: "Output 3", content: "Content 3", file_path: "test/three.md", created_at: "2026-03-22T00:00:00Z" },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiOutputs))
      .mockResolvedValueOnce("ok");

    await plugin.pollAIOutput();

    // saveSettings should be called exactly once (not per file)
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

    // All 3 hashes should be stored
    expect(Object.keys(plugin.syncedHashes)).toHaveLength(3);
  });

  it("stores hashes for each file using file_path", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const aiOutputs = [
      { id: "output-1", title: "Output 1", content: "Content A", file_path: "projects/CarChief/plan.md", created_at: "2026-03-22T00:00:00Z" },
      { id: "output-2", title: "Output 2", content: "Content B", file_path: "projects/TB/design.md", created_at: "2026-03-22T00:00:00Z" },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiOutputs))
      .mockResolvedValueOnce("ok");

    await plugin.pollAIOutput();

    expect(plugin.syncedHashes["projects/CarChief/plan.md"]).toBe(simpleHash("Content A"));
    expect(plugin.syncedHashes["projects/TB/design.md"]).toBe(simpleHash("Content B"));
  });

  it("does nothing when no endpoint is configured", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "" });

    await plugin.pollAIOutput();

    expect(plugin.callMCP).not.toHaveBeenCalled();
  });

  it("calls correct MCP tools (get_pending_ai_output and mark_ai_output_picked_up)", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const aiOutputs = [
      { id: "output-1", title: "Output 1", content: "Content", file_path: "test/file.md", created_at: "2026-03-22T00:00:00Z" },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiOutputs))
      .mockResolvedValueOnce("ok");

    await plugin.pollAIOutput();

    expect(plugin.callMCP).toHaveBeenCalledWith("get_pending_ai_output", {});
    expect(plugin.callMCP).toHaveBeenCalledWith("mark_ai_output_picked_up", { ids: ["output-1"] });
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
