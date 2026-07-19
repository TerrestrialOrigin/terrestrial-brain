import { describe, it, expect, vi } from "vitest";
import { MAX_RETRY_ATTEMPTS, SyncEngine, SyncEngineDeps, SyncOutcome } from "./syncEngine";
import {
  CollectingNotifier,
  fakeFile,
  FakeClassifier,
  FakeNoteReader,
  FakeScheduler,
  MapHashStore,
} from "./testSupport";
import { TerrestrialBrainApiClient } from "./apiClient";

interface EngineHarness {
  engine: SyncEngine;
  notifier: CollectingNotifier;
  hashes: MapHashStore;
  scheduler: FakeScheduler;
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
  const scheduler = new FakeScheduler();
  const ingest = vi.fn(
    overrides.ingest ?? (async () => "Captured 1 thought"),
  );
  const forget = vi.fn(
    overrides.forget ?? (async () => "Forgot note"),
  );
  const client: TerrestrialBrainApiClient = {
    call: async () => ({ success: true }),
    ingestNote: (content, title, noteId) => ingest(content, title, noteId),
    forgetNote: (noteId) => forget(noteId),
    fetchPendingMetadata: async () => [],
    fetchContent: async () => [],
  };
  const deps: SyncEngineDeps = {
    client,
    reader: new FakeNoteReader((file) => (overrides.read ?? (async () => "# body"))(file.path)),
    classifier: new FakeClassifier(() => overrides.excluded ?? false),
    notifier,
    hashes,
    scheduler,
    config: {
      getEndpointUrl: () => overrides.endpointUrl ?? "https://example.com/mcp",
      getSyncDelayMs: () => overrides.syncDelayMs ?? 5 * 60000,
    },
  };
  return { engine: new SyncEngine(deps), notifier, hashes, scheduler, ingest, forget };
}

/** A promise whose resolution the test controls. */
function deferred<Value>(): { promise: Promise<Value>; resolve: (value: Value) => void } {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((promiseResolve) => { resolve = promiseResolve; });
  return { promise, resolve };
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
    expect(notifier.some((message) => /network down/.test(message))).toBe(true);
  });
});

describe("SyncEngine.syncEntireVault — C1 honest failure reporting", () => {
  it("does NOT show a success notice when every note fails", async () => {
    const { engine, notifier } = makeEngine({ ingest: async () => { throw new Error("boom"); } });
    const result = await engine.syncEntireVault([fakeFile("a.md"), fakeFile("b.md")]);

    expect(result).toEqual({ synced: 0, failed: 2, skipped: 0 });
    expect(notifier.some((message) => message.includes("Vault sync complete"))).toBe(false);
    expect(notifier.some((message) => /fail/.test(message))).toBe(true);
  });

  it("reports accurate counts on mixed success/failure", async () => {
    const { engine, notifier } = makeEngine({
      ingest: async (_content, title) => { if (title === "bad") throw new Error("boom"); return "ok"; },
    });
    const result = await engine.syncEntireVault([fakeFile("ok.md"), fakeFile("bad.md")]);

    expect(result).toEqual({ synced: 1, failed: 1, skipped: 0 });
    expect(notifier.some((message) => /1 failed/.test(message))).toBe(true);
    expect(notifier.some((message) => message.includes("Vault sync complete"))).toBe(false);
  });

  it("PLUG-11: a read failure during a forced vault sync counts as failed, not skipped", async () => {
    const { engine, notifier } = makeEngine({
      read: async (path) => {
        if (path === "broken.md") throw new Error("EACCES: permission denied");
        return "# readable";
      },
    });
    const result = await engine.syncEntireVault([fakeFile("ok.md"), fakeFile("broken.md")]);

    expect(result).toEqual({ synced: 1, failed: 1, skipped: 0 });
    expect(notifier.some((message) => message.includes("Vault sync complete"))).toBe(false);
    expect(notifier.some((message) => /1 failed/.test(message))).toBe(true);
  });

  it("notifies and no-ops on an empty eligible list", async () => {
    const { engine, notifier } = makeEngine();
    const result = await engine.syncEntireVault([]);
    expect(result).toEqual({ synced: 0, failed: 0, skipped: 0 });
    expect(notifier.some((message) => /No notes to sync/.test(message))).toBe(true);
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
  it("schedules the base delay (syncDelayMinutes * 60000)", () => {
    const { engine, scheduler } = makeEngine({ syncDelayMs: 180000 });
    engine.scheduleSync(fakeFile("test.md"));
    expect(scheduler.delayAt(0)).toBe(180000);
  });

  it("retries a failed scheduled sync with a larger delay", async () => {
    const { engine, scheduler } = makeEngine({ syncDelayMs: 300000, ingest: async () => { throw new Error("x"); } });
    // Force a failed outcome via processNote (unreadable would skip; ingest-throw → failed).
    engine.scheduleSync(fakeFile("x.md"));
    expect(scheduler.delayAt(0)).toBe(300000);
    await scheduler.fire(0);
    expect(scheduler.scheduled.length).toBe(2);
    expect(scheduler.delayAt(1)).toBeGreaterThan(scheduler.delayAt(0));
  });

  it("stops retrying after MAX_RETRY_ATTEMPTS", async () => {
    const { engine, scheduler } = makeEngine({ ingest: async () => { throw new Error("x"); } });
    engine.scheduleSync(fakeFile("x.md"), MAX_RETRY_ATTEMPTS);
    await scheduler.fire(0);
    expect(scheduler.scheduled.length).toBe(1);
  });

  it("does not retry a successful scheduled sync", async () => {
    const { engine, scheduler } = makeEngine({ ingest: async () => "ok" });
    engine.scheduleSync(fakeFile("x.md"));
    await scheduler.fire(0);
    expect(scheduler.scheduled.length).toBe(1);
  });

  it("manual (forced) sync failure does not schedule any retry", async () => {
    const { engine, scheduler } = makeEngine({ ingest: async () => { throw new Error("boom"); } });
    const outcome = await engine.processNote(fakeFile("m.md"), { force: true });
    expect(outcome).toBe("failed");
    expect(engine.pendingTimerCount).toBe(0);
    expect(scheduler.scheduled.length).toBe(0);
  });
});

describe("SyncEngine — PLUG-1 single-flight & unload discipline", () => {
  it("coalesces a concurrent processNote for the same path into one ingest", async () => {
    const gate = deferred<string>();
    const { engine, ingest } = makeEngine({ ingest: () => gate.promise });

    const firstRun = engine.processNote(fakeFile("note.md"), { force: true, silent: true });
    const secondRun = engine.processNote(fakeFile("note.md"), { force: true, silent: true });
    gate.resolve("Captured 1 thought");

    const [firstOutcome, secondOutcome] = await Promise.all([firstRun, secondRun]);
    expect(ingest).toHaveBeenCalledTimes(1);
    expect(firstOutcome).toBe<SyncOutcome>("synced");
    expect(secondOutcome).toBe<SyncOutcome>("synced");
  });

  it("different paths still sync independently", async () => {
    const { engine, ingest } = makeEngine();
    await Promise.all([
      engine.processNote(fakeFile("a.md"), { force: true, silent: true }),
      engine.processNote(fakeFile("b.md"), { force: true, silent: true }),
    ]);
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("a completed sync clears the in-flight entry so the next run is fresh", async () => {
    const { engine, ingest } = makeEngine();
    await engine.processNote(fakeFile("note.md"), { force: true, silent: true });
    await engine.processNote(fakeFile("note.md"), { force: true, silent: true });
    expect(ingest).toHaveBeenCalledTimes(2);
  });

  it("a failing in-flight sync does not reschedule after clearAllTimers()", async () => {
    const gate = deferred<string>();
    const { engine, scheduler } = makeEngine({
      syncDelayMs: 60000,
      ingest: () => gate.promise.then(() => { throw new Error("network down"); }),
    });

    engine.scheduleSync(fakeFile("x.md"));
    const firing = scheduler.fire(0); // processNote now awaiting the gated ingest
    engine.clearAllTimers(); // unload while the sync is in flight
    gate.resolve("ignored");
    await firing;

    // Only the original debounce timer exists — no retry was scheduled post-unload.
    expect(scheduler.scheduled.length).toBe(1);
  });
});
