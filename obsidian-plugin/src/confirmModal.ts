// ─── AI-output confirmation modal ────────────────────────────────────────────
// Presents pending AI outputs for accept / reject / postpone, with a per-file
// overwrite/rename choice for conflicting paths.

import { App, Modal } from "obsidian";
import { AIOutputMetadata } from "./apiClient";
import { formatFileSize } from "./utils";

export type AIOutputDecision = "accepted" | "rejected" | "postponed";

/** Maps output ID → true if its file_path conflicts with an existing vault file. */
export type ConflictInfo = Record<string, boolean>;

/** Maps conflicting output ID → user's chosen resolution. */
export type ConflictResolution = Map<string, "overwrite" | "rename">;

/** Result returned by the confirmation dialog — decision plus per-file conflict choices. */
export interface ConfirmationResult {
  decision: AIOutputDecision;
  resolutions: ConflictResolution;
}

export class AIOutputConfirmModal extends Modal {
  private metadataList: AIOutputMetadata[];
  private conflicts: ConflictInfo;
  private onResult: (result: ConfirmationResult) => void;
  private resolved = false;
  private resolutions: ConflictResolution = new Map();

  constructor(
    app: App,
    metadataList: AIOutputMetadata[],
    conflicts: ConflictInfo,
    onResult: (result: ConfirmationResult) => void,
  ) {
    super(app);
    this.metadataList = metadataList;
    this.conflicts = conflicts;
    this.onResult = onResult;

    // Initialize resolutions: conflicting files default to "overwrite"
    for (const metadata of metadataList) {
      if (conflicts[metadata.id]) {
        this.resolutions.set(metadata.id, "overwrite");
      }
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    this.renderHeader(contentEl);
    this.renderList(contentEl);
    this.renderButtons(contentEl);
  }

  private renderHeader(contentEl: HTMLElement): void {
    contentEl.createEl("h2", {
      text: `${this.metadataList.length} pending AI output${this.metadataList.length > 1 ? "s" : ""}`,
    });
  }

  private renderList(contentEl: HTMLElement): void {
    const listContainer = contentEl.createDiv({ cls: "tb-ai-output-list" });
    listContainer.style.maxHeight = "300px";
    listContainer.style.overflowY = "auto";
    listContainer.style.marginBottom = "16px";

    for (const metadata of this.metadataList) {
      this.renderItem(listContainer, metadata);
    }
  }

  private renderItem(listContainer: HTMLElement, metadata: AIOutputMetadata): void {
    const sizeDisplay = formatFileSize(metadata.content_size);
    const hasConflict = this.conflicts[metadata.id] === true;

    const item = listContainer.createDiv({ cls: "tb-ai-output-item" });
    item.style.padding = "6px 0";
    item.style.borderBottom = "1px solid var(--background-modifier-border)";

    const titleRow = item.createDiv({ cls: "tb-ai-output-title-row" });
    titleRow.style.display = "flex";
    titleRow.style.alignItems = "center";
    titleRow.style.gap = "8px";

    titleRow.createEl("span", {
      text: metadata.title || metadata.file_path,
      cls: "tb-ai-output-title",
    }).style.fontWeight = "600";

    this.renderBadge(titleRow, hasConflict);

    const detailParts = [metadata.file_path, sizeDisplay];
    item.createEl("div", {
      text: detailParts.join(" · "),
      cls: "tb-ai-output-details",
    }).style.color = "var(--text-muted)";

    if (hasConflict) {
      this.renderConflictControl(item, metadata.id);
    }
  }

  private renderBadge(titleRow: HTMLElement, hasConflict: boolean): void {
    const badge = titleRow.createEl("span", {
      text: hasConflict ? "overwrites existing" : "new file",
      cls: hasConflict ? "tb-ai-output-conflict" : "tb-ai-output-new",
    });
    badge.style.fontSize = "0.8em";
    badge.style.padding = "1px 6px";
    badge.style.borderRadius = "4px";
    if (hasConflict) {
      badge.style.backgroundColor = "var(--background-modifier-error)";
      badge.style.color = "var(--text-on-accent)";
    } else {
      badge.style.backgroundColor = "var(--background-modifier-success)";
      badge.style.color = "var(--text-on-accent)";
    }
  }

  private renderConflictControl(item: HTMLElement, outputId: string): void {
    const controlRow = item.createDiv({ cls: "tb-ai-output-conflict-control" });
    controlRow.style.marginTop = "4px";

    const select = controlRow.createEl("select", { cls: "dropdown" });
    const overwriteOption = select.createEl("option", { text: "Overwrite", value: "overwrite" });
    overwriteOption.value = "overwrite";
    const renameOption = select.createEl("option", { text: "Save as copy", value: "rename" });
    renameOption.value = "rename";
    select.value = "overwrite";

    select.addEventListener("change", () => {
      this.resolutions.set(outputId, select.value as "overwrite" | "rename");
    });
  }

  private renderButtons(contentEl: HTMLElement): void {
    const buttonContainer = contentEl.createDiv({ cls: "tb-ai-output-buttons" });
    buttonContainer.style.display = "flex";
    buttonContainer.style.justifyContent = "flex-end";
    buttonContainer.style.gap = "8px";
    buttonContainer.style.marginTop = "16px";

    const rejectButton = buttonContainer.createEl("button", { text: "Reject All" });
    rejectButton.addEventListener("click", () => this.resolve("rejected"));

    const postponeButton = buttonContainer.createEl("button", { text: "Postpone" });
    postponeButton.addEventListener("click", () => this.resolve("postponed"));

    const acceptButton = buttonContainer.createEl("button", {
      text: "Accept All",
      cls: "mod-cta",
    });
    acceptButton.addEventListener("click", () => this.resolve("accepted"));
  }

  onClose(): void {
    // If the user closed the modal without clicking a button, treat as postpone (not rejection)
    if (!this.resolved) {
      this.onResult({ decision: "postponed", resolutions: this.resolutions });
    }
    this.contentEl.empty();
  }

  private resolve(decision: AIOutputDecision): void {
    this.resolved = true;
    this.onResult({ decision, resolutions: this.resolutions });
    this.close();
  }
}
