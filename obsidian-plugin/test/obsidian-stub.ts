// ─── Vitest stub for the `obsidian` module ───────────────────────────────────
// The real `obsidian` npm package is types-only (no runtime), so tests alias
// `obsidian` to this stub (see vitest.config.ts). It provides the minimal
// runtime surface the plugin's classes extend or construct. Notices are
// recorded so the few main-level tests that assert on them can inspect them.

export const recordedNotices: string[] = [];

export function clearRecordedNotices(): void {
  recordedNotices.length = 0;
}

export class App {}

export class TFile {
  path = "";
  basename = "";
  extension = "";
}

export class TAbstractFile {
  path = "";
}

export class Notice {
  constructor(message?: string) {
    if (message) recordedNotices.push(message);
  }
  setMessage(): void {}
  hide(): void {}
}

export class Menu {
  items: { title: string; icon: string; callback: () => void }[] = [];
  addItem(callback: (item: MenuItemStub) => void): this {
    const item = new MenuItemStub();
    callback(item);
    this.items.push(item);
    return this;
  }
  showAtMouseEvent(): void {}
}

class MenuItemStub {
  title = "";
  icon = "";
  callback: () => void = () => {};
  setTitle(title: string): this { this.title = title; return this; }
  setIcon(icon: string): this { this.icon = icon; return this; }
  onClick(callback: () => void): this { this.callback = callback; return this; }
}

/**
 * A chainable element stub. `style` is a plain object; `createEl`/`createDiv`
 * record the tag, `cls`, and `text` from their options and append the new child
 * to `children`, so tests can traverse the rendered tree and assert on classes,
 * text, and the absence of inline styles.
 */
function makeElementStub(tagName = "div", options: any = {}): any {
  const element: any = {
    tagName,
    cls: options.cls ?? "",
    className: options.cls ?? "",
    textContent: options.text ?? "",
    value: options.value ?? "",
    type: options.type ?? "",
    inputEl: { type: "" },
    children: [] as any[],
    style: {},
    empty() { this.children.length = 0; },
    addEventListener() {},
    createEl(tag: string, opts: any = {}) {
      const child = makeElementStub(tag, opts);
      this.children.push(child);
      return child;
    },
    createDiv(opts: any = {}) {
      const child = makeElementStub("div", opts);
      this.children.push(child);
      return child;
    },
  };
  return element;
}

/** Recursively collect every descendant element of a stub tree (excluding the root). */
export function collectDescendants(element: any): any[] {
  const all: any[] = [];
  for (const child of element.children ?? []) {
    all.push(child, ...collectDescendants(child));
  }
  return all;
}

export class Modal {
  app: App;
  contentEl: any = makeElementStub();
  constructor(app: App) { this.app = app; }
  open(): void {}
  close(): void {}
}

export class PluginSettingTab {
  app: App;
  containerEl: any = makeElementStub();
  constructor(app: App, _plugin: unknown) { this.app = app; }
}

export class Setting {
  constructor(_containerEl: unknown) {}
  setName(): this { return this; }
  setDesc(): this { return this; }
  addText(callback: (text: TextStub) => void): this { callback(new TextStub()); return this; }
}

class TextStub {
  inputEl = { type: "" };
  setPlaceholder(): this { return this; }
  setValue(): this { return this; }
  onChange(): this { return this; }
}

export class Plugin {
  app: any = {};
  constructor(app?: any) { if (app) this.app = app; }
  async loadData(): Promise<any> { return null; }
  async saveData(_data: unknown): Promise<void> {}
  registerEvent(): void {}
  registerInterval(id: number): number { return id; }
  addCommand(): void {}
  addRibbonIcon(): void {}
  addSettingTab(): void {}
}
