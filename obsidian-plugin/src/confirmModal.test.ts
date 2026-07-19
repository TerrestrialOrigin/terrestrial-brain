// ─── Tests for the AI-output confirmation modal rendering ─────────────────────
// These guard the Step 27 styles-move: the modal must style itself via
// tb-ai-output-* CSS classes (in styles.css), NOT via inline element.style.*
// assignments, and must render the same structure and controls as before.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { App, collectDescendants, ElementStub } from "../test/obsidian-stub";
import { AIOutputMetadata } from "./apiClient";
import { AIOutputConfirmModal, ConfirmationResult } from "./confirmModal";

function makeMetadata(overrides: Partial<AIOutputMetadata> = {}): AIOutputMetadata {
  return {
    id: overrides.id ?? "id-1",
    title: overrides.title ?? "A title",
    file_path: overrides.file_path ?? "notes/a.md",
    content_size: overrides.content_size ?? 1234,
    ...overrides,
  } as AIOutputMetadata;
}

/** Open the modal against the stub DOM and return its rendered contentEl tree. */
function renderModal(metadataList: AIOutputMetadata[], conflicts: Record<string, boolean>) {
  const received: ConfirmationResult[] = [];
  const modal = new AIOutputConfirmModal(new App() as never, {
    metadataList,
    conflicts,
    onResult: (result) => { received.push(result); },
  });
  modal.onOpen();
  return {
    modal,
    contentEl: (modal as unknown as { contentEl: ElementStub }).contentEl,
    getResult: () => received[received.length - 1],
    resultCount: () => received.length,
  };
}

/** Locate a rendered button by its label (throws when absent). */
function findButton(contentEl: ElementStub, label: string): ElementStub {
  const button = collectDescendants(contentEl).find(
    (element) => element.tagName === "button" && element.textContent === label,
  );
  if (!button) throw new Error(`button "${label}" not rendered`);
  return button;
}

describe("AIOutputConfirmModal rendering", () => {
  const oneConflict = makeMetadata({ id: "conflict", file_path: "notes/x.md" });
  const noConflict = makeMetadata({ id: "fresh", file_path: "notes/y.md" });

  it("styles elements via tb-ai-output-* classes, not inline styles", () => {
    const { contentEl } = renderModal([oneConflict, noConflict], { conflict: true, fresh: false });
    const descendants = collectDescendants(contentEl);

    // Every element that used to be inline-styled now carries its class.
    const classes = descendants.map((element) => element.cls);
    expect(classes).toContain("tb-ai-output-list");
    expect(classes).toContain("tb-ai-output-item");
    expect(classes).toContain("tb-ai-output-title-row");
    expect(classes).toContain("tb-ai-output-title");
    expect(classes).toContain("tb-ai-output-details");
    expect(classes).toContain("tb-ai-output-buttons");
    expect(classes.some((cls) => cls.includes("tb-ai-output-badge"))).toBe(true);

    // No element sets any inline presentational style.
    for (const element of descendants) {
      expect(Object.keys(element.style)).toHaveLength(0);
    }
  });

  it("marks conflicts and fresh files with the right badge modifier", () => {
    const { contentEl } = renderModal([oneConflict, noConflict], { conflict: true, fresh: false });
    const badges = collectDescendants(contentEl).filter((element) =>
      String(element.cls).includes("tb-ai-output-badge")
    );
    expect(badges).toHaveLength(2);
    expect(badges.some((badge) => badge.cls.includes("tb-ai-output-conflict"))).toBe(true);
    expect(badges.some((badge) => badge.cls.includes("tb-ai-output-new"))).toBe(true);
  });

  it("renders a conflict resolver select with two options for conflicting files only", () => {
    const { contentEl } = renderModal([oneConflict, noConflict], { conflict: true, fresh: false });
    const selects = collectDescendants(contentEl).filter((element) => element.tagName === "select");
    expect(selects).toHaveLength(1);
    const options = selects[0]?.children ?? [];
    expect(options.map((option) => option.value)).toEqual(["overwrite", "rename"]);
    expect(selects[0]?.value).toBe("overwrite");
  });

  it("renders reject / postpone / accept buttons", () => {
    const { contentEl } = renderModal([oneConflict], { conflict: true });
    const buttonTexts = collectDescendants(contentEl)
      .filter((element) => element.tagName === "button")
      .map((element) => element.textContent);
    expect(buttonTexts).toEqual(["Reject All", "Postpone", "Accept All"]);
  });

  it("PLUG-7: Accept All resolves accepted with the chosen resolutions", () => {
    const { contentEl, getResult } = renderModal([oneConflict], { conflict: true });
    const select = collectDescendants(contentEl).find((element) => element.tagName === "select");
    if (!select) throw new Error("conflict select not rendered");
    select.value = "rename";
    select.dispatch("change");

    findButton(contentEl, "Accept All").dispatch("click");

    expect(getResult()?.decision).toBe("accepted");
    expect(getResult()?.resolutions.get("conflict")).toBe("rename");
  });

  it("PLUG-7: an unexpected select value falls back to overwrite (allowlist parse)", () => {
    const { contentEl, getResult } = renderModal([oneConflict], { conflict: true });
    const select = collectDescendants(contentEl).find((element) => element.tagName === "select");
    if (!select) throw new Error("conflict select not rendered");
    select.value = "definitely-not-an-option";
    select.dispatch("change");

    findButton(contentEl, "Accept All").dispatch("click");

    expect(getResult()?.resolutions.get("conflict")).toBe("overwrite");
  });

  it("PLUG-7: Reject All resolves rejected", () => {
    const { contentEl, getResult } = renderModal([oneConflict], { conflict: true });
    findButton(contentEl, "Reject All").dispatch("click");
    expect(getResult()?.decision).toBe("rejected");
  });

  it("PLUG-7: Postpone resolves postponed", () => {
    const { contentEl, getResult } = renderModal([oneConflict], { conflict: true });
    findButton(contentEl, "Postpone").dispatch("click");
    expect(getResult()?.decision).toBe("postponed");
  });

  it("PLUG-7: closing without a choice (Escape / X) resolves postponed — never rejected", () => {
    const { modal, getResult } = renderModal([oneConflict], { conflict: true });
    modal.onClose();
    expect(getResult()?.decision).toBe("postponed");
  });

  it("PLUG-7: a button choice followed by onClose fires onResult exactly once", () => {
    const { modal, contentEl, getResult, resultCount } = renderModal([oneConflict], { conflict: true });
    findButton(contentEl, "Accept All").dispatch("click");
    modal.onClose();
    expect(resultCount()).toBe(1);
    expect(getResult()?.decision).toBe("accepted");
  });

  it("styles.css defines rules for every tb-ai-output-* class the modal uses", () => {
    const css = readFileSync(resolve(__dirname, "../styles.css"), "utf8");
    for (const cls of [
      "tb-ai-output-list",
      "tb-ai-output-item",
      "tb-ai-output-title-row",
      "tb-ai-output-title",
      "tb-ai-output-details",
      "tb-ai-output-badge",
      "tb-ai-output-conflict",
      "tb-ai-output-new",
      "tb-ai-output-conflict-control",
      "tb-ai-output-buttons",
    ]) {
      expect(css).toContain(`.${cls}`);
    }
  });
});

describe("plugin packaging metadata consistency", () => {
  const pluginRoot = resolve(__dirname, "..");
  const manifest = JSON.parse(readFileSync(resolve(pluginRoot, "manifest.json"), "utf8"));
  const pkg = JSON.parse(readFileSync(resolve(pluginRoot, "package.json"), "utf8"));
  const versions = JSON.parse(readFileSync(resolve(pluginRoot, "versions.json"), "utf8"));

  it("manifest and package versions match", () => {
    expect(pkg.version).toBe(manifest.version);
  });

  it("versions.json maps the current version to the manifest minAppVersion", () => {
    expect(versions[manifest.version]).toBe(manifest.minAppVersion);
  });

  it("obsidian devDependency is pinned, not floating on latest", () => {
    expect(pkg.devDependencies.obsidian).not.toBe("latest");
  });

  it("manifest description is concise", () => {
    expect(manifest.description.length).toBeLessThan(300);
  });
});
