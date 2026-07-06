// ─── AI-output poller ────────────────────────────────────────────────────────
// Polls for pending AI output, runs conflict detection, prompts the user, and
// delivers or rejects the outputs. Depends only on the injected ports + API
// client (which validates responses at the boundary), so its logic is
// unit-testable with fakes.

import { AIOutputMetadata, TerrestrialBrainApiClient } from "./apiClient";
import { ConflictInfo, ConflictResolution } from "./confirmModal";
import { ConflictPrompt, SyncedHashStore, UserNotifier, VaultWriter } from "./ports";
import { generateCopyPath, simpleHash, stripFrontmatter, truncateForNotice } from "./utils";

export interface PollerConfig {
  getEndpointUrl(): string;
}

export interface AiOutputPollerDeps {
  client: TerrestrialBrainApiClient;
  writer: VaultWriter;
  notifier: UserNotifier;
  hashes: SyncedHashStore;
  prompt: ConflictPrompt;
  config: PollerConfig;
}

export class AiOutputPoller {
  // Guard to prevent overlapping poll cycles while a confirmation dialog is open.
  private pollInProgress = false;

  constructor(private readonly deps: AiOutputPollerDeps) {}

  async pollAIOutput(options: { manual?: boolean } = {}): Promise<void> {
    if (!this.deps.config.getEndpointUrl()) return;
    if (this.pollInProgress) return;

    this.pollInProgress = true;
    try {
      // Phase 1: fetch metadata only (no content body), validated at the boundary.
      const metadataList = await this.deps.client.fetchPendingMetadata();

      if (!metadataList.length) {
        if (options.manual) {
          this.deps.notifier.notify("No pending AI output to pull");
        }
        return;
      }

      const conflicts = await this.detectConflicts(metadataList);
      const result = await this.deps.prompt.confirm(metadataList, conflicts);

      if (result.decision === "accepted") {
        await this.fetchAndDeliverOutputs(metadataList, result.resolutions);
      } else if (result.decision === "rejected") {
        await this.rejectOutputs(metadataList);
      }
      // "postponed" — do nothing; outputs remain pending in DB.
    } catch (error) {
      console.error("TB Poll error:", error);
      // A manual pull that fails must tell the user; background polls stay quiet.
      if (options.manual) {
        this.deps.notifier.notify(`❌ Pull AI output failed: ${truncateForNotice((error as Error).message)}`);
      }
    } finally {
      this.pollInProgress = false;
    }
  }

  /** Check which pending outputs target existing vault files (conflict detection). */
  private async detectConflicts(metadataList: AIOutputMetadata[]): Promise<ConflictInfo> {
    const conflicts: ConflictInfo = {};
    for (const metadata of metadataList) {
      conflicts[metadata.id] = await this.deps.writer.exists(metadata.file_path);
    }
    return conflicts;
  }

  private async fetchAndDeliverOutputs(
    metadataList: AIOutputMetadata[],
    resolutions: ConflictResolution,
  ): Promise<void> {
    const ids = metadataList.map((metadata) => metadata.id);

    // Phase 2: fetch full content only after user accepted, validated at the boundary.
    const contentList = await this.deps.client.fetchContent(ids);

    const contentById = new Map<string, string>();
    for (const item of contentList) {
      contentById.set(item.id, item.content);
    }

    const deliveredIds: string[] = [];
    for (const metadata of metadataList) {
      const content = contentById.get(metadata.id);
      if (content === undefined) continue; // content not returned (already processed)

      const writePath = await this.resolveWritePath(metadata, resolutions);
      if (writePath === null) continue; // copy-path generation failed; skip this file

      await this.writeOutput(writePath, content);
      deliveredIds.push(metadata.id);
    }

    if (deliveredIds.length > 0) {
      await this.deps.client.call("mark-ai-output-picked-up", { ids: deliveredIds });
      await this.deps.hashes.persist();
      this.deps.notifier.notify(`🧠 ${deliveredIds.length} AI output${deliveredIds.length > 1 ? "s" : ""} delivered to vault`);
    }
  }

  /**
   * Determine the write path — the original path, or a fresh copy path when the
   * user chose "Save as copy". Returns null (and notifies) if a copy path can't
   * be generated, signalling the caller to skip this file.
   */
  private async resolveWritePath(
    metadata: AIOutputMetadata,
    resolutions: ConflictResolution,
  ): Promise<string | null> {
    if (resolutions.get(metadata.id) !== "rename") {
      return metadata.file_path;
    }
    try {
      return await generateCopyPath(metadata.file_path, (path) => this.deps.writer.exists(path));
    } catch (error) {
      this.deps.notifier.notify(`⚠️ ${(error as Error).message}`);
      return null;
    }
  }

  private async writeOutput(writePath: string, content: string): Promise<void> {
    const folder = writePath.substring(0, writePath.lastIndexOf("/"));
    if (folder) await this.deps.writer.mkdir(folder);

    await this.deps.writer.write(writePath, content);

    // Store hash under the actual written path so the modify event doesn't re-ingest.
    this.deps.hashes.set(writePath, simpleHash(stripFrontmatter(content).trim()));
  }

  private async rejectOutputs(metadataList: AIOutputMetadata[]): Promise<void> {
    const ids = metadataList.map((metadata) => metadata.id);
    await this.deps.client.call("reject-ai-output", { ids });
    this.deps.notifier.notify(`🧠 ${ids.length} AI output${ids.length > 1 ? "s" : ""} rejected`);
  }
}
