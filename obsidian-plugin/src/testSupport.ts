// ─── Shared test fakes ───────────────────────────────────────────────────────
// Plain (vitest-free) fake implementations of the injected ports, shared across
// the unit test files so each spec constructs real engine/poller/client objects
// with lightweight fakes instead of an Obsidian mock. Not imported by main.ts,
// so it is never bundled into the plugin.

import { TFile } from "obsidian";
import { AIOutputContent, AIOutputMetadata, TerrestrialBrainApiClient } from "./apiClient";
import { ConfirmationResult } from "./confirmModal";
import {
  ConflictPrompt,
  FileClassifier,
  NoteReader,
  SyncedHashStore,
  UserNotifier,
  VaultWriter,
} from "./ports";

/** A minimal file descriptor good enough for the engine's `.path/.basename/.extension`. */
export function fakeFile(path: string, basename?: string): TFile {
  const inferred = basename ?? path.substring(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
  return { path, basename: inferred, extension: "md" } as unknown as TFile;
}

export class CollectingNotifier implements UserNotifier {
  readonly messages: string[] = [];
  notify(message: string): void {
    this.messages.push(message);
  }
  some(predicate: (message: string) => boolean): boolean {
    return this.messages.some(predicate);
  }
}

export class MapHashStore implements SyncedHashStore {
  readonly map: Map<string, string>;
  persistCount = 0;
  constructor(initial: Record<string, string> = {}) {
    this.map = new Map(Object.entries(initial));
  }
  get(path: string): string | undefined {
    return this.map.get(path);
  }
  set(path: string, hash: string): void {
    this.map.set(path, hash);
  }
  delete(path: string): void {
    this.map.delete(path);
  }
  async persist(): Promise<void> {
    this.persistCount++;
  }
}

export class FakeNoteReader implements NoteReader {
  constructor(private readonly impl: (file: TFile) => Promise<string>) {}
  read(file: TFile): Promise<string> {
    return this.impl(file);
  }
}

export class FakeClassifier implements FileClassifier {
  constructor(private readonly excluded: (file: TFile) => boolean = () => false) {}
  isExcluded(file: TFile): boolean {
    return this.excluded(file);
  }
}

export class FakeVaultWriter implements VaultWriter {
  readonly writes: { path: string; content: string }[] = [];
  readonly mkdirs: string[] = [];
  existsImpl: (path: string) => Promise<boolean> = async () => false;
  async write(path: string, content: string): Promise<void> {
    this.writes.push({ path, content });
  }
  async mkdir(folder: string): Promise<void> {
    this.mkdirs.push(folder);
  }
  exists(path: string): Promise<boolean> {
    return this.existsImpl(path);
  }
}

export class FakePrompt implements ConflictPrompt {
  lastConflicts: Record<string, boolean> | null = null;
  constructor(private readonly result: ConfirmationResult) {}
  confirm(
    _metadataList: AIOutputMetadata[],
    conflicts: Record<string, boolean>,
  ): Promise<ConfirmationResult> {
    this.lastConflicts = conflicts;
    return Promise.resolve(this.result);
  }
}

/** A configurable fake API client. Any method left unset throws if called. */
export class FakeApiClient implements TerrestrialBrainApiClient {
  callLog: { endpoint: string; body?: Record<string, unknown> }[] = [];
  ingestImpl?: (content: string, title: string, noteId: string) => Promise<string>;
  metadataImpl?: () => Promise<AIOutputMetadata[]>;
  contentImpl?: (ids: string[]) => Promise<AIOutputContent[]>;
  callImpl?: (endpoint: string, body?: Record<string, unknown>) => Promise<Record<string, unknown>>;

  async call(endpointName: string, body?: Record<string, unknown>): Promise<Record<string, unknown>> {
    this.callLog.push({ endpoint: endpointName, body });
    if (this.callImpl) return this.callImpl(endpointName, body);
    return { success: true };
  }
  ingestNote(content: string, title: string, noteId: string): Promise<string> {
    if (!this.ingestImpl) throw new Error("ingestImpl not set");
    return this.ingestImpl(content, title, noteId);
  }
  fetchPendingMetadata(): Promise<AIOutputMetadata[]> {
    if (!this.metadataImpl) throw new Error("metadataImpl not set");
    return this.metadataImpl();
  }
  fetchContent(ids: string[]): Promise<AIOutputContent[]> {
    if (!this.contentImpl) throw new Error("contentImpl not set");
    return this.contentImpl(ids);
  }
}
