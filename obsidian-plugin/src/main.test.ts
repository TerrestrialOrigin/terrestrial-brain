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
    aiNotesFolderBase: "AI Notes",
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

// ─── pollAINotes tests ───────────────────────────────────────────────────────

describe("pollAINotes", () => {
  it("stores content hash in syncedHashes after writing file", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const noteContent = "# AI Generated Note\n\nSome content here.";
    const aiNotes = [
      { id: "note-1", title: "Test Note", content: noteContent, suggested_path: null, created_at_utc: 0 },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiNotes))  // get_unsynced_ai_notes
      .mockResolvedValueOnce("ok");                     // mark_notes_synced

    await plugin.pollAINotes();

    const expectedPath = "AI Notes/Test Note.md";
    expect(plugin.syncedHashes[expectedPath]).toBeDefined();
    expect(typeof plugin.syncedHashes[expectedPath]).toBe("string");
  });

  it("hash matches what processNote would compute (preventing re-ingestion)", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const noteContent = "---\ntitle: Test\n---\n# AI Note\n\nBody text.";
    const aiNotes = [
      { id: "note-1", title: "Test Note", content: noteContent, suggested_path: "AI Notes/Test Note.md", created_at_utc: 0 },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiNotes))
      .mockResolvedValueOnce("ok");

    await plugin.pollAINotes();

    const expectedHash = simpleHash(stripFrontmatter(noteContent).trim());
    expect(plugin.syncedHashes["AI Notes/Test Note.md"]).toBe(expectedHash);
  });

  it("calls saveSettings once after the loop", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const aiNotes = [
      { id: "note-1", title: "Note 1", content: "Content 1", suggested_path: null, created_at_utc: 0 },
      { id: "note-2", title: "Note 2", content: "Content 2", suggested_path: null, created_at_utc: 0 },
      { id: "note-3", title: "Note 3", content: "Content 3", suggested_path: null, created_at_utc: 0 },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiNotes))
      .mockResolvedValueOnce("ok");

    await plugin.pollAINotes();

    // saveSettings should be called exactly once (not per file)
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);

    // All 3 hashes should be stored
    expect(Object.keys(plugin.syncedHashes)).toHaveLength(3);
  });

  it("stores hashes for each file when using suggested_path", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "https://example.com/mcp" });
    const aiNotes = [
      { id: "note-1", title: "Note 1", content: "Content A", suggested_path: "projects/CarChief/plan.md", created_at_utc: 0 },
      { id: "note-2", title: "Note 2", content: "Content B", suggested_path: "projects/TB/design.md", created_at_utc: 0 },
    ];

    plugin.callMCP = vi.fn()
      .mockResolvedValueOnce(JSON.stringify(aiNotes))
      .mockResolvedValueOnce("ok");

    await plugin.pollAINotes();

    expect(plugin.syncedHashes["projects/CarChief/plan.md"]).toBe(simpleHash("Content A"));
    expect(plugin.syncedHashes["projects/TB/design.md"]).toBe(simpleHash("Content B"));
  });

  it("does nothing when no endpoint is configured", async () => {
    const plugin = createTestPlugin({ tbEndpointUrl: "" });

    await plugin.pollAINotes();

    expect(plugin.callMCP).not.toHaveBeenCalled();
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
