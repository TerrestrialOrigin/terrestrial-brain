import { describe, it, expect } from "vitest";
import { AiOutputPoller, AiOutputPollerDeps } from "./aiOutputPoller";
import { AIOutputContent, AIOutputMetadata } from "./apiClient";
import { ConfirmationResult, ConflictResolution } from "./confirmModal";
import {
  CollectingNotifier,
  FakeApiClient,
  FakePrompt,
  FakeVaultWriter,
  MapHashStore,
} from "./testSupport";
import { simpleHash, stripFrontmatter } from "./utils";

function meta(id: string, file_path: string, extra: Partial<AIOutputMetadata> = {}): AIOutputMetadata {
  return { id, title: id, file_path, content_size: 7, created_at: "2026-03-22T00:00:00Z", ...extra };
}

interface PollerHarness {
  poller: AiOutputPoller;
  client: FakeApiClient;
  writer: FakeVaultWriter;
  notifier: CollectingNotifier;
  hashes: MapHashStore;
  prompt: FakePrompt;
}

function makePoller(options: {
  endpointUrl?: string;
  metadata?: AIOutputMetadata[];
  content?: AIOutputContent[];
  decision?: ConfirmationResult["decision"];
  resolutions?: ConflictResolution;
  metadataImpl?: () => Promise<AIOutputMetadata[]>;
} = {}): PollerHarness {
  const client = new FakeApiClient();
  client.metadataImpl = options.metadataImpl ?? (async () => options.metadata ?? []);
  client.contentImpl = async () => options.content ?? [];
  const notifier = new CollectingNotifier();
  const writer = new FakeVaultWriter();
  const hashes = new MapHashStore();
  const prompt = new FakePrompt({
    decision: options.decision ?? "accepted",
    resolutions: options.resolutions ?? new Map(),
  });
  const deps: AiOutputPollerDeps = {
    client, writer, notifier, hashes, prompt,
    config: { getEndpointUrl: () => options.endpointUrl ?? "https://example.com/mcp" },
  };
  return { poller: new AiOutputPoller(deps), client, writer, notifier, hashes, prompt };
}

describe("AiOutputPoller — PLUG-7 re-entrancy guard", () => {
  it("overlapping pollAIOutput calls run exactly one poll cycle", async () => {
    const { poller, client } = makePoller();
    let metadataCallCount = 0;
    let releaseGate!: (value: AIOutputMetadata[]) => void;
    const gate = new Promise<AIOutputMetadata[]>((resolve) => { releaseGate = resolve; });
    client.metadataImpl = () => { metadataCallCount++; return gate; };

    const firstPoll = poller.pollAIOutput();
    const secondPoll = poller.pollAIOutput(); // must bail on the guard
    releaseGate([]);
    await Promise.all([firstPoll, secondPoll]);

    expect(metadataCallCount).toBe(1);
  });

  it("a completed poll releases the guard for the next cycle", async () => {
    const { poller, client } = makePoller();
    let metadataCallCount = 0;
    client.metadataImpl = async () => { metadataCallCount++; return []; };

    await poller.pollAIOutput();
    await poller.pollAIOutput();

    expect(metadataCallCount).toBe(2);
  });
});

describe("AiOutputPoller — two-phase fetch & delivery", () => {
  it("stores a content hash under the written path after delivery", async () => {
    const { poller, hashes } = makePoller({
      metadata: [meta("output-1", "projects/Test/output.md")],
      content: [{ id: "output-1", content: "---\ntitle: T\n---\n# AI Output\n\nBody." }],
    });
    await poller.pollAIOutput();
    const expected = simpleHash(stripFrontmatter("---\ntitle: T\n---\n# AI Output\n\nBody.").trim());
    expect(hashes.get("projects/Test/output.md")).toBe(expected);
  });

  it("persists exactly once after the delivery loop", async () => {
    const { poller, hashes } = makePoller({
      metadata: [meta("o1", "a.md"), meta("o2", "b.md"), meta("o3", "c.md")],
      content: [
        { id: "o1", content: "A" }, { id: "o2", content: "B" }, { id: "o3", content: "C" },
      ],
    });
    await poller.pollAIOutput();
    expect(hashes.persistCount).toBe(1);
    expect(hashes.map.size).toBe(3);
  });

  it("calls metadata, content, and mark-picked-up endpoints in order", async () => {
    const { poller, client } = makePoller({
      metadata: [meta("output-1", "test/file.md")],
      content: [{ id: "output-1", content: "Content" }],
    });
    await poller.pollAIOutput();
    expect(client.callLog.map((callEntry) => callEntry.endpoint)).toContain("mark-ai-output-picked-up");
    expect(client.callLog.find((callEntry) => callEntry.endpoint === "mark-ai-output-picked-up")?.body).toEqual({ ids: ["output-1"] });
  });

  it("does nothing when no endpoint is configured", async () => {
    const { poller, client } = makePoller({ endpointUrl: "" });
    let metadataCalled = false;
    client.metadataImpl = async () => { metadataCalled = true; return []; };
    await poller.pollAIOutput();
    expect(metadataCalled).toBe(false);
  });

  it("creates parent directories for nested paths", async () => {
    const { poller, writer } = makePoller({
      metadata: [meta("o1", "deeply/nested/folder/doc.md")],
      content: [{ id: "o1", content: "Content" }],
    });
    await poller.pollAIOutput();
    expect(writer.mkdirs).toContain("deeply/nested/folder");
    expect(writer.writes).toContainEqual({ path: "deeply/nested/folder/doc.md", content: "Content" });
  });

  it("does not mkdir for a root-level file", async () => {
    const { poller, writer } = makePoller({
      metadata: [meta("o1", "root.md")], content: [{ id: "o1", content: "Content" }],
    });
    await poller.pollAIOutput();
    expect(writer.mkdirs).toHaveLength(0);
    expect(writer.writes).toContainEqual({ path: "root.md", content: "Content" });
  });
});

describe("AiOutputPoller — decision handling", () => {
  it("rejects without fetching content when the user rejects", async () => {
    const { poller, client } = makePoller({
      metadata: [meta("output-1", "test/file.md")], decision: "rejected",
    });
    let contentCalled = false;
    client.contentImpl = async () => { contentCalled = true; return []; };
    await poller.pollAIOutput();
    expect(contentCalled).toBe(false);
    expect(client.callLog.map((callEntry) => callEntry.endpoint)).toContain("reject-ai-output");
  });

  it("does nothing and stays silent when the user postpones", async () => {
    const { poller, client, notifier } = makePoller({
      metadata: [meta("output-1", "test/file.md")], decision: "postponed",
    });
    let contentCalled = false;
    client.contentImpl = async () => { contentCalled = true; return []; };
    await poller.pollAIOutput();
    expect(contentCalled).toBe(false);
    expect(client.callLog.some((callEntry) => callEntry.endpoint === "reject-ai-output")).toBe(false);
    expect(notifier.messages).toHaveLength(0);
  });
});

describe("AiOutputPoller — empty poll notices", () => {
  it("shows a notice when a manual poll finds nothing", async () => {
    const { poller, notifier } = makePoller({ metadata: [] });
    await poller.pollAIOutput({ manual: true });
    expect(notifier.messages).toContain("No pending AI output to pull");
  });
  it("stays silent when an automatic poll finds nothing", async () => {
    const { poller, notifier } = makePoller({ metadata: [] });
    await poller.pollAIOutput();
    expect(notifier.messages).not.toContain("No pending AI output to pull");
  });
});

describe("AiOutputPoller — conflict detection", () => {
  it("builds ConflictInfo from exists checks and passes it to the prompt", async () => {
    const { poller, writer, prompt } = makePoller({
      metadata: [meta("output-1", "projects/existing.md"), meta("output-2", "projects/new.md")],
      content: [{ id: "output-1", content: "1" }, { id: "output-2", content: "2" }],
    });
    writer.existsImpl = async (path) => path === "projects/existing.md";
    await poller.pollAIOutput();
    expect(prompt.lastConflicts).toEqual({ "output-1": true, "output-2": false });
  });
});

describe("AiOutputPoller — conflict-aware writing", () => {
  it("overwrites when resolution is 'overwrite'", async () => {
    const { poller, writer, hashes } = makePoller({
      metadata: [meta("output-1", "projects/plan.md")],
      content: [{ id: "output-1", content: "New content" }],
      resolutions: new Map([["output-1", "overwrite"]]),
    });
    writer.existsImpl = async () => true;
    await poller.pollAIOutput();
    expect(writer.writes).toContainEqual({ path: "projects/plan.md", content: "New content" });
    expect(hashes.get("projects/plan.md")).toBe(simpleHash("New content"));
  });

  it("writes to a copy path and stores the hash there when resolution is 'rename'", async () => {
    const { poller, writer, hashes } = makePoller({
      metadata: [meta("output-1", "projects/plan.md")],
      content: [{ id: "output-1", content: "Renamed content" }],
      resolutions: new Map([["output-1", "rename"]]),
    });
    writer.existsImpl = async (path) => path === "projects/plan.md"; // original exists, copy does not
    await poller.pollAIOutput();
    expect(writer.writes).toContainEqual({ path: "projects/plan(2).md", content: "Renamed content" });
    expect(hashes.get("projects/plan(2).md")).toBe(simpleHash("Renamed content"));
    expect(hashes.get("projects/plan.md")).toBeUndefined();
  });

  it("skips a file whose copy path cannot be generated, delivering the rest", async () => {
    const { poller, writer, client, notifier } = makePoller({
      metadata: [meta("output-1", "fail.md"), meta("output-2", "success.md")],
      content: [{ id: "output-1", content: "Fail" }, { id: "output-2", content: "Works" }],
      resolutions: new Map([["output-1", "rename"]]),
    });
    writer.existsImpl = async (path) => path !== "success.md"; // every fail(N).md exists
    await poller.pollAIOutput();
    expect(writer.writes).toEqual([{ path: "success.md", content: "Works" }]);
    expect(client.callLog.find((callEntry) => callEntry.endpoint === "mark-ai-output-picked-up")?.body).toEqual({ ids: ["output-2"] });
    expect(notifier.some((message) => message.includes("Could not find available copy name"))).toBe(true);
  });
});

describe("AiOutputPoller — B4 manual pull failure & malformed response", () => {
  it("surfaces a Notice when a manual pull fails", async () => {
    const { poller, notifier } = makePoller({ metadataImpl: async () => { throw new Error("server exploded"); } });
    await poller.pollAIOutput({ manual: true });
    expect(notifier.some((message) => /Pull AI output failed/.test(message))).toBe(true);
  });

  it("stays silent when an automatic poll fails", async () => {
    const { poller, notifier } = makePoller({ metadataImpl: async () => { throw new Error("server exploded"); } });
    await poller.pollAIOutput();
    expect(notifier.messages).toHaveLength(0);
  });

  it("PLUG-3: a manual pull rejecting with a plain string shows a Notice, not a crash", async () => {
    const { poller, notifier } = makePoller({
      metadataImpl: async () => { throw "string failure"; },
    });
    await poller.pollAIOutput({ manual: true });
    expect(notifier.some((message) => message.includes("string failure"))).toBe(true);
  });

  it("surfaces a malformed-response error on a manual pull and writes nothing", async () => {
    const { poller, notifier, writer } = makePoller({
      metadataImpl: async () => { throw new Error("Malformed AI-output metadata response from server"); },
    });
    await poller.pollAIOutput({ manual: true });
    expect(notifier.some((message) => /Malformed AI-output metadata response/.test(message))).toBe(true);
    expect(writer.writes).toHaveLength(0);
  });
});
