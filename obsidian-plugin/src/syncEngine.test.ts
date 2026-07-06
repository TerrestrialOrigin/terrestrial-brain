import { describe, it, expect, vi } from "vitest";
import { MAX_RETRY_ATTEMPTS, SyncEngine, SyncEngineDeps, SyncOutcome } from "./syncEngine";
import {
  CollectingNotifier,
  fakeFile,
  FakeClassifier,
  FakeNoteReader,
  MapHashStore,
} from "./testSupport";
import { TerrestrialBrainApiClient } from "./apiClient";

interface EngineHarness {
  engine: SyncEngine;
  notifier: CollectingNotifier;
  hashes: MapHashStore;
  ingest: ReturnType<typeof vi.fn>;
  forget: ReturnType<typeof vi.fn>;
}

function makeEngine(overrides: {
  endpointUrl?: string;
  syncDelayMs?: number;
  excluded?: boolean;
  read?: (path: string) => Promise<string>;
  ingest?: (content: string, title: string, noteId: string) => Promise<string>;
  forget?: (noteId: string) => Promise<string>;
  hashes?: Record<string, string>;
} = {}): EngineHarness {
  const notifier = new CollectingNotifier();
  const hashes = new MapHashStore(overrides.hashes ?? {});
  const ingest = vi.fn(
    overrides.ingest ?? (async () => "Captured 1 thought"),
  );
  const forget = vi.fn(
    overrides.forget ?? (async () => "Forgot note"),
  );
  const client: TerrestrialBrainApiClient = {
    call: async () => ({ success: true }),
    ingestNote: (c, t, n) => ingest(c, t, n),
    forgetNote: (n) => forget(n),
    fetchPendingMetadata: async () => [],
    fetchContent: async () => [],
  };
  const deps: SyncEngineDeps = {
    client,
    reader: new FakeNoteReader((file) => (overrides.read ?? (async () => "# body"))(file.path)),
    classifier: new FakeClassifier(() => overrides.excluded ?? false),
    notifier,
    hashes,
    config: {
      getEndpointUrl: () => overrides.endpointUrl ?? "https://example.com/mcp",
      getSyncDelayMs: () => overrides.syncDelayMs ?? 5 * 60000,
    },
  };
  return { engine: new SyncEngine(deps), notifier, hashes, ingest, forget };
}

describe("SyncEngine.processNote", () => {
  it("ingests, stores the hash, and persists on success", async () => {
    const { engine, hashes, ingest } = makeEngine({ read: async () => "# Test Note\n\nSome content." });
    const outcome = await engine.processNote(fakeFile("folder/test.md"), { force: true, silent: true });

    expect(outcome).toBe<SyncOutcome>("synced");
    expect(ingest).toHaveBeenCalledWith("# Test Note\n\nSome content.", "test", "folder/test.md");
    expect(hashes.get("folder/test.md")).toBeDefined();
    expect(hashes.persistCount).toBe(1);
  });

  it("returns 'skipped' for an excluded file", async () => {
    const { engine } = makeEngine({ excluded: true });
    expect(await engine.processNote(fakeFile("x.md"))).toBe("skipped");
  });

  it("returns 'skipped' when no endpoint is configured", async () => {
    const { engine } = makeEngine({ endpointUrl: "" });
    expect(await engine.processNote(fakeFile("x.md"))).toBe("skipped");
  });

  it("returns 'skipped' (not throw) when the file is unreadable", async () => {
    const { engine } = makeEngine({ read: async () => { throw new Error("ENOENT"); } });
    expect(await engine.processNote(fakeFile("gone.md"))).toBe("skipped");
  });

  it("skips a file whose hash is unchanged unless forced", async () => {
    const { engine, hashes, ingest } = makeEngine({ read: async () => "# body" });
    await engine.processNote(fakeFile("a.md"), { force: true, silent: true });
    ingest.mockClear();
    // Second, unforced pass with the same content should skip.
    expect(await engine.processNote(fakeFile("a.md"), { silent: true })).toBe("skipped");
    expect(ingest).not.toHaveBeenCalled();
    expect(hashes.get("a.md")).toBeDefined();
  });

  it("returns 'failed' and does not throw when ingest rejects", async () => {
    const { engine, notifier } = makeEngine({ ingest: async () => { throw new Error("network down"); } });
    const outcome = await engine.processNote(fakeFile("m.md"), { force: true });
    expect(outcome).toBe("failed");
    expect(notifier.some((m) => /network down/.test(m))).toBe(true);
  });
});

describe("SyncEngine.syncEntireVault — C1 honest failure reporting", () => {
  it("does NOT show a success notice when every note fails", async () => {
    const { engine, notifier } = makeEngine({ ingest: async () => { throw new Error("boom"); } });
    const result = await engine.syncEntireVault([fakeFile("a.md"), fakeFile("b.md")]);

    expect(result).toEqual({ synced: 0, failed: 2, skipped: 0 });
    expect(notifier.some((m) => m.includes("Vault sync complete"))).toBe(false);
    expect(notifier.some((m) => /fail/i.test(m))).toBe(true);
  });

  it("reports accurate counts on mixed success/failure", async () => {
    const { engine, notifier } = makeEngine({
      ingest: async (_c, title) => { if (title === "bad") throw new Error("boom"); return "ok"; },
    });
    const result = await engine.syncEntireVault([fakeFile("ok.md"), fakeFile("bad.md")]);

    expect(result).toEqual({ synced: 1, failed: 1, skipped: 0 });
    expect(notifier.some((m) => /1 failed/.test(m))).toBe(true);
    expect(notifier.some((m) => m.includes("Vault sync complete"))).toBe(false);
  });

  it("notifies and no-ops on an empty eligible list", async () => {
    const { engine, notifier } = makeEngine();
    const result = await engine.syncEntireVault([]);
    expect(result).toEqual({ synced: 0, failed: 0, skipped: 0 });
    expect(notifier.some((m) => /No notes to sync/.test(m))).toBe(true);
  });
});

describe("SyncEngine — B3 delete/rename lifecycle", () => {
  it("delete cancels the pending timer and drops the hash", async () => {
    const { engine, hashes } = makeEngine({ hashes: { "a.md": "h1", "b.md": "h2" } });
    engine.scheduleSync(fakeFile("a.md"));
    expect(engine.pendingTimerCount).toBe(1);

    await engine.handleFileDelete(fakeFile("a.md"));

    expect(hashes.get("a.md")).toBeUndefined();
    expect(hashes.get("b.md")).toBe("h2");
    expect(engine.pendingTimerCount).toBe(0);
    expect(hashes.persistCount).toBe(1);
  });

  it("rename re-keys the hash and cancels the old-path timer", async () => {
    const { engine, hashes } = makeEngine({ hashes: { "old.md": "h1" } });
    engine.scheduleSync(fakeFile("old.md"));

    await engine.handleFileRename(fakeFile("new.md"), "old.md");

    expect(hashes.get("new.md")).toBe("h1");
    expect(hashes.get("old.md")).toBeUndefined();
    expect(engine.pendingTimerCount).toBe(0);
    expect(hashes.persistCount).toBe(1);
  });
});

describe("SyncEngine — Step 25 backend erasure on delete", () => {
  it("delete erases backend data for an eligible note", async () => {
    const { engine, forget } = makeEngine({ hashes: { "note.md": "h1" } });

    await engine.handleFileDelete(fakeFile("note.md"));

    expect(forget).toHaveBeenCalledWith("note.md");
  });

  it("delete does NOT erase an excluded note", async () => {
    const { engine, forget } = makeEngine({ excluded: true, hashes: { "x.md": "h1" } });

    await engine.handleFileDelete(fakeFile("x.md"));

    expect(forget).not.toHaveBeenCalled();
  });

  it("delete does not call forget when no endpoint is configured", async () => {
    const { engine, forget } = makeEngine({ endpointUrl: "" });

    await engine.handleFileDelete(fakeFile("x.md"));

    expect(forget).not.toHaveBeenCalled();
  });

  it("a forget failure surfaces a Notice and still drops the hash (no throw)", async () => {
    const { engine, hashes, notifier } = makeEngine({
      hashes: { "note.md": "h1" },
      forget: async () => { throw new Error("network down"); },
    });

    await engine.handleFileDelete(fakeFile("note.md"));

    // Local cleanup still completes despite the backend failure.
    expect(hashes.get("note.md")).toBeUndefined();
    expect(notifier.messages.some((message) => message.includes("network down"))).toBe(true);
  });

  it("forgetNote command erases backend data and drops the hash", async () => {
    const { engine, hashes, forget, notifier } = makeEngine({
      hashes: { "note.md": "h1" },
      forget: async () => "Forgot \"note.md\": erased its note snapshot and 2 derived thought(s).",
    });

    await engine.forgetNote(fakeFile("note.md"));

    expect(forget).toHaveBeenCalledWith("note.md");
    expect(hashes.get("note.md")).toBeUndefined();
    expect(notifier.messages.some((message) => message.includes("erased its note snapshot"))).toBe(true);
  });

  it("forgetNote command surfaces a Notice on failure without throwing", async () => {
    const { engine, notifier } = makeEngine({
      forget: async () => { throw new Error("boom"); },
    });

    await engine.forgetNote(fakeFile("note.md"));

    expect(notifier.messages.some((message) => message.includes("boom"))).toBe(true);
  });
});

describe("SyncEngine — scheduling & B5 retry with capped backoff", () => {
  function captureTimers() {
    const captured: { fn: () => Promise<void>; delay: number }[] = [];
    const spy = vi.spyOn(globalThis, "setTimeout").mockImplementation(((fn: () => Promise<void>, delay: number) => {
      captured.push({ fn, delay });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout);
    return { captured, spy };
  }

  it("schedules the base delay (syncDelayMinutes * 60000)", () => {
    const { engine } = makeEngine({ syncDelayMs: 180000 });
    const { captured, spy } = captureTimers();
    engine.scheduleSync(fakeFile("test.md"));
    expect(captured[0].delay).toBe(180000);
    spy.mockRestore();
  });

  it("retries a failed scheduled sync with a larger delay", async () => {
    const { engine } = makeEngine({ syncDelayMs: 300000, ingest: async () => { throw new Error("x"); } });
    // Force a failed outcome via processNote (unreadable would skip; ingest-throw → failed).
    const { captured, spy } = captureTimers();
    engine.scheduleSync(fakeFile("x.md"));
    expect(captured[0].delay).toBe(300000);
    await captured[0].fn();
    expect(captured.length).toBe(2);
    expect(captured[1].delay).toBeGreaterThan(captured[0].delay);
    spy.mockRestore();
  });

  it("stops retrying after MAX_RETRY_ATTEMPTS", async () => {
    const { engine } = makeEngine({ ingest: async () => { throw new Error("x"); } });
    const { captured, spy } = captureTimers();
    engine.scheduleSync(fakeFile("x.md"), MAX_RETRY_ATTEMPTS);
    await captured[0].fn();
    expect(captured.length).toBe(1);
    spy.mockRestore();
  });

  it("does not retry a successful scheduled sync", async () => {
    const { engine } = makeEngine({ ingest: async () => "ok" });
    const { captured, spy } = captureTimers();
    engine.scheduleSync(fakeFile("x.md"));
    await captured[0].fn();
    expect(captured.length).toBe(1);
    spy.mockRestore();
  });

  it("manual (forced) sync failure does not schedule any retry", async () => {
    const { engine } = makeEngine({ ingest: async () => { throw new Error("boom"); } });
    const outcome = await engine.processNote(fakeFile("m.md"), { force: true });
    expect(outcome).toBe("failed");
    expect(engine.pendingTimerCount).toBe(0);
  });
});
