import { describe, it, expect, vi, afterEach } from "vitest";
import {
  HttpTerrestrialBrainClient,
  isAIOutputContentArray,
  isAIOutputMetadataArray,
} from "./apiClient";

const ENDPOINT = "https://xxx.supabase.co/functions/v1/terrestrial-brain-mcp";

function client(accessKey = "secret123", endpointUrl = ENDPOINT) {
  return new HttpTerrestrialBrainClient({
    getEndpointUrl: () => endpointUrl,
    getAccessKey: () => accessKey,
  });
}

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown>; text?: () => Promise<string> }) {
  const fetchMock = vi.fn().mockResolvedValue(response);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

describe("HttpTerrestrialBrainClient — header auth", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("sends the key as x-tb-key and keeps it out of the URL", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ success: true, data: [] }) });
    await client("secret123").call("get-pending-ai-output-metadata");

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect((init.headers as Record<string, string>)["x-tb-key"]).toBe("secret123");
    expect(String(url)).not.toContain("key=");
    expect(String(url)).toBe(`${ENDPOINT}/get-pending-ai-output-metadata`);
  });

  it("omits the x-tb-key header when the key is empty", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ success: true, data: [] }) });
    await client("").call("get-pending-ai-output-metadata");
    expect((fetchMock.mock.calls[0]?.[1].headers as Record<string, string>)["x-tb-key"]).toBeUndefined();
  });

  it("ingestNote sends the key as a header and posts the note body", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ success: true, message: "Captured 3 thoughts" }) });
    const message = await client("secret123").ingestNote("note content", "Test", "folder/Test.md");

    expect(message).toBe("Captured 3 thoughts");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${ENDPOINT}/ingest-note`);
    expect((init.headers as Record<string, string>)["x-tb-key"]).toBe("secret123");
    expect(init.body).toBe(JSON.stringify({ content: "note content", title: "Test", note_id: "folder/Test.md" }));
  });

  it("forgetNote posts the note_id to /forget-note with the key header", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ success: true, message: "Forgot note" }) });
    const message = await client("secret123").forgetNote("folder/Test.md");

    expect(message).toBe("Forgot note");
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`${ENDPOINT}/forget-note`);
    expect((init.headers as Record<string, string>)["x-tb-key"]).toBe("secret123");
    expect(init.body).toBe(JSON.stringify({ note_id: "folder/Test.md" }));
  });
});

describe("HttpTerrestrialBrainClient — envelope handling", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("returns the parsed object on success", async () => {
    mockFetch({ ok: true, json: async () => ({ success: true, data: [1, 2] }) });
    const result = await client().call("some-endpoint");
    expect(result).toEqual({ success: true, data: [1, 2] });
  });

  it("throws the sanitized error when success is false", async () => {
    mockFetch({ ok: true, json: async () => ({ success: false, error: "content is required" }) });
    await expect(client().ingestNote("", "T", "t.md")).rejects.toThrow("content is required");
  });

  it("throws with the status on an HTTP error and truncates an oversized body", async () => {
    const bigBody = "E".repeat(1000);
    mockFetch({ ok: false, status: 500, text: async () => bigBody });
    let message = "";
    try { await client().call("get-pending-ai-output-metadata"); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("HTTP 500");
    expect(message.endsWith("…")).toBe(true);
    expect(message.length).toBeLessThan(bigBody.length);
  });

  it("labels ingest HTTP errors as Ingest and truncates the body", async () => {
    const bigBody = "Z".repeat(1000);
    mockFetch({ ok: false, status: 502, text: async () => bigBody });
    let message = "";
    try { await client().ingestNote("b", "t", "n.md"); } catch (error) { message = (error as Error).message; }
    expect(message).toContain("Ingest 502");
    expect(message.endsWith("…")).toBe(true);
  });
});

describe("HttpTerrestrialBrainClient — PLUG-2 envelope validation", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("rejects with a friendly message when the 200 body is not JSON", async () => {
    mockFetch({ ok: true, json: async () => { throw new SyntaxError("Unexpected token <"); } });
    await expect(client().call("some-endpoint")).rejects.toThrow(/non-JSON response/);
  });

  it("rejects a null envelope with a malformed-envelope error, not a TypeError", async () => {
    mockFetch({ ok: true, json: async () => null });
    await expect(client().call("some-endpoint")).rejects.toThrow(/[Mm]alformed response envelope/);
  });

  it("rejects a bare-string envelope with a malformed-envelope error", async () => {
    mockFetch({ ok: true, json: async () => "oops" });
    await expect(client().call("some-endpoint")).rejects.toThrow(/[Mm]alformed response envelope/);
  });

  it("falls back to the generic message when the error field is not a string", async () => {
    mockFetch({ ok: true, json: async () => ({ success: false, error: { code: 1 } }) });
    await expect(client().call("some-endpoint")).rejects.toThrow(/Unknown http error/);
  });
});

describe("HttpTerrestrialBrainClient — PLUG-6 cleartext refusal", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("refuses a non-local http:// endpoint before fetch is ever called", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ success: true }) });
    await expect(
      client("secret123", "http://example.com/mcp").call("get-pending-ai-output-metadata"),
    ).rejects.toThrow(/unencrypted http/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses ingest to a non-local http:// endpoint", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ success: true }) });
    await expect(
      client("secret123", "http://example.com/mcp").ingestNote("body", "T", "t.md"),
    ).rejects.toThrow(/unencrypted http/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still allows a localhost http:// test server", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ success: true, data: [] }) });
    await client("secret123", "http://localhost:54321/functions/v1/terrestrial-brain-mcp").call("get-pending-ai-output-metadata");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("still allows a 127.0.0.1 http:// test server", async () => {
    const fetchMock = mockFetch({ ok: true, json: async () => ({ success: true, data: [] }) });
    await client("secret123", "http://127.0.0.1:54321/functions/v1/terrestrial-brain-mcp").call("get-pending-ai-output-metadata");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("HttpTerrestrialBrainClient — boundary validation", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("returns validated metadata on a well-formed response", async () => {
    mockFetch({
      ok: true,
      json: async () => ({
        success: true,
        data: [{ id: "a", title: "T", file_path: "a.md", content_size: 5, created_at: "2026-01-01" }],
      }),
    });
    const list = await client().fetchPendingMetadata();
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe("a");
  });

  it("throws instead of casting a malformed metadata response", async () => {
    mockFetch({ ok: true, json: async () => ({ success: true, data: "not-an-array" }) });
    await expect(client().fetchPendingMetadata()).rejects.toThrow("Malformed AI-output metadata response");
  });

  it("throws when metadata array items miss required fields", async () => {
    mockFetch({ ok: true, json: async () => ({ success: true, data: [{ id: "a" }] }) });
    await expect(client().fetchPendingMetadata()).rejects.toThrow("Malformed AI-output metadata response");
  });

  it("returns validated content on a well-formed response", async () => {
    mockFetch({ ok: true, json: async () => ({ success: true, data: [{ id: "a", content: "body" }] }) });
    const list = await client().fetchContent(["a"]);
    expect(list[0]?.content).toBe("body");
  });

  it("throws instead of casting a malformed content response", async () => {
    mockFetch({ ok: true, json: async () => ({ success: true, data: [{ id: "a", content: 42 }] }) });
    await expect(client().fetchContent(["a"])).rejects.toThrow("Malformed AI-output content response");
  });
});

describe("boundary guards (pure)", () => {
  it("isAIOutputMetadataArray accepts the exact shape and rejects others", () => {
    expect(isAIOutputMetadataArray([{ id: "a", title: "t", file_path: "p", content_size: 1, created_at: "d" }])).toBe(true);
    expect(isAIOutputMetadataArray([])).toBe(true);
    expect(isAIOutputMetadataArray("x")).toBe(false);
    expect(isAIOutputMetadataArray([{ id: "a" }])).toBe(false);
    expect(isAIOutputMetadataArray([{ id: 1, title: "t", file_path: "p", content_size: 1, created_at: "d" }])).toBe(false);
  });
  it("isAIOutputContentArray accepts the exact shape and rejects others", () => {
    expect(isAIOutputContentArray([{ id: "a", content: "c" }])).toBe(true);
    expect(isAIOutputContentArray([{ id: "a", content: 1 }])).toBe(false);
    expect(isAIOutputContentArray({ id: "a", content: "c" })).toBe(false);
  });
});
