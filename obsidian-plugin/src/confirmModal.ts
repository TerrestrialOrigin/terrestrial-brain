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

/** Constructor inputs for the confirmation modal, as a typed options object. */
export interface AIOutputConfirmModalOptions {
  metadataList: AIOutputMetadata[];
  conflicts: ConflictInfo;
  onResult: (result: ConfirmationResult) => void;
}

export class AIOutputConfirmModal extends Modal {
  private metadataList: AIOutputMetadata[];
  private conflicts: ConflictInfo;
  private onResult: (result: ConfirmationResult) => void;
  private resolved = false;
  private resolutions: ConflictResolution = new Map();

  constructor(app: App, options: AIOutputConfirmModalOptions) {
    super(app);
    this.metadataList = options.metadataList;
    this.conflicts = options.conflicts;
    this.onResult = options.onResult;

    // Initialize resolutions: conflicting files default to "overwrite"
    for (const metadata of options.metadataList) {
      if (options.conflicts[metadata.id]) {
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

    for (const metadata of this.metadataList) {
      this.renderItem(listContainer, metadata);
    }
  }

  private renderItem(listContainer: HTMLElement, metadata: AIOutputMetadata): void {
    const sizeDisplay = formatFileSize(metadata.content_size);
    const hasConflict = this.conflicts[metadata.id] === true;

    const item = listContainer.createDiv({ cls: "tb-ai-output-item" });

    const titleRow = item.createDiv({ cls: "tb-ai-output-title-row" });

    titleRow.createEl("span", {
      text: metadata.title || metadata.file_path,
      cls: "tb-ai-output-title",
    });

    this.renderBadge(titleRow, hasConflict);

    const detailParts = [metadata.file_path, sizeDisplay];
    item.createEl("div", {
      text: detailParts.join(" · "),
      cls: "tb-ai-output-details",
    });

    if (hasConflict) {
      this.renderConflictControl(item, metadata.id);
    }
  }

  private renderBadge(titleRow: HTMLElement, hasConflict: boolean): void {
    titleRow.createEl("span", {
      text: hasConflict ? "overwrites existing" : "new file",
      cls: `tb-ai-output-badge ${hasConflict ? "tb-ai-output-conflict" : "tb-ai-output-new"}`,
    });
  }

  private renderConflictControl(item: HTMLElement, outputId: string): void {
    const controlRow = item.createDiv({ cls: "tb-ai-output-conflict-control" });

    const select = controlRow.createEl("select", { cls: "dropdown" });
    select.createEl("option", { text: "Overwrite", value: "overwrite" });
    select.createEl("option", { text: "Save as copy", value: "rename" });
    select.value = "overwrite";

    select.addEventListener("change", () => {
      // Allowlist parse of the DOM value — anything unexpected (a future third
      // option, a browser quirk resetting to "") falls back to "overwrite".
      this.resolutions.set(outputId, select.value === "rename" ? "rename" : "overwrite");
    });
  }

  private renderButtons(contentEl: HTMLElement): void {
    const buttonContainer = contentEl.createDiv({ cls: "tb-ai-output-buttons" });

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
