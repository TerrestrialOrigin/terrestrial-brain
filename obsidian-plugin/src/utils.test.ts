import { describe, it, expect } from "vitest";
import {
  buildEndpointUrl,
  extractKeyFromUrl,
  formatFileSize,
  generateCopyPath,
  isExcludedByCache,
  isInsecureEndpoint,
  simpleHash,
  stripFrontmatter,
  truncateForNotice,
} from "./utils";

describe("formatFileSize", () => {
  it("formats zero bytes", () => expect(formatFileSize(0)).toBe("0 bytes"));
  it("formats small file in bytes", () => expect(formatFileSize(500)).toBe("500 bytes"));
  it("formats exactly 1 KB", () => expect(formatFileSize(1024)).toBe("1.0 KB"));
  it("formats kilobytes with decimal", () => expect(formatFileSize(2560)).toBe("2.5 KB"));
  it("formats megabytes", () => expect(formatFileSize(1572864)).toBe("1.5 MB"));
  it("formats gigabytes", () => expect(formatFileSize(1610612736)).toBe("1.5 GB"));
});

describe("stripFrontmatter", () => {
  it("removes YAML frontmatter", () => {
    expect(stripFrontmatter("---\ntitle: Test\ntags: [a, b]\n---\n# Hello")).toBe("# Hello");
  });
  it("returns content unchanged when no frontmatter", () => {
    expect(stripFrontmatter("# Hello\nWorld")).toBe("# Hello\nWorld");
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

describe("truncateForNotice", () => {
  it("returns short text unchanged", () => {
    expect(truncateForNotice("content is required")).toBe("content is required");
  });
  it("collapses runs of whitespace", () => {
    expect(truncateForNotice("a\n\n  b\tc")).toBe("a b c");
  });
  it("truncates long text with an ellipsis", () => {
    const result = truncateForNotice("x".repeat(500), 300);
    expect(result.length).toBe(301);
    expect(result.endsWith("…")).toBe(true);
  });
});

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
    expect(extractKeyFromUrl("https://host/fn?key=a%2Bb").key).toBe("a+b");
  });
});

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
  it("returns false for an empty URL", () => expect(isInsecureEndpoint("")).toBe(false));
  it("is case-insensitive about the scheme and host", () => {
    expect(isInsecureEndpoint("HTTP://Example.com/fn")).toBe(true);
    expect(isInsecureEndpoint("http://LOCALHOST:54321/fn")).toBe(false);
  });
});

describe("generateCopyPath", () => {
  it("returns Filename(2).md for a basic conflict", async () => {
    const exists = async () => false;
    expect(await generateCopyPath("projects/Plan.md", exists)).toBe("projects/Plan(2).md");
  });
  it("increments suffix when (2) already exists", async () => {
    const taken = new Set(["projects/Plan(2).md"]);
    expect(await generateCopyPath("projects/Plan.md", async (path) => taken.has(path))).toBe("projects/Plan(3).md");
  });
  it("increments through multiple existing copies", async () => {
    const taken = new Set(["notes/Todo(2).md", "notes/Todo(3).md", "notes/Todo(4).md"]);
    expect(await generateCopyPath("notes/Todo.md", async (path) => taken.has(path))).toBe("notes/Todo(5).md");
  });
  it("handles root-level file (no parent directory)", async () => {
    expect(await generateCopyPath("README.md", async () => false)).toBe("README(2).md");
  });
  it("throws after exhausting 100 attempts", async () => {
    let calls = 0;
    await expect(generateCopyPath("file.md", async () => { calls++; return true; }))
      .rejects.toThrow("Could not find available copy name");
    expect(calls).toBe(100);
  });
  it("preserves directory in copy path", async () => {
    expect(await generateCopyPath("deeply/nested/folder/doc.md", async () => false))
      .toBe("deeply/nested/folder/doc(2).md");
  });
});

describe("isExcludedByCache", () => {
  it("returns true for frontmatter boolean tbExclude: true", () => {
    expect(isExcludedByCache({ frontmatter: { tbExclude: true } }, "tbExclude")).toBe(true);
  });
  it("returns false for frontmatter boolean tbExclude: false", () => {
    expect(isExcludedByCache({ frontmatter: { tbExclude: false } }, "tbExclude")).toBe(false);
  });
  it("returns true for tag-array exclusion", () => {
    expect(isExcludedByCache({ frontmatter: { tags: ["tbExclude"] } }, "tbExclude")).toBe(true);
  });
  it("returns true for inline tag exclusion", () => {
    expect(isExcludedByCache({ frontmatter: {}, tags: [{ tag: "#tbExclude" }] }, "tbExclude")).toBe(true);
  });
  it("returns false when no exclusion markers are present", () => {
    expect(isExcludedByCache({ frontmatter: {} }, "tbExclude")).toBe(false);
  });
  it("returns false when no metadata cache exists", () => {
    expect(isExcludedByCache(null, "tbExclude")).toBe(false);
  });
  it("uses strict boolean equality (string 'true' does not match)", () => {
    expect(isExcludedByCache({ frontmatter: { tbExclude: "true" } }, "tbExclude")).toBe(false);
  });
  it("normalizes a #-prefixed configured tag", () => {
    expect(isExcludedByCache({ frontmatter: { tbExclude: true } }, "#tbExclude")).toBe(true);
  });
});
