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
  items: MenuItemStub[] = [];
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

/** Options accepted by the element stub's createEl/createDiv. */
export interface ElementStubOptions {
  cls?: string;
  text?: string;
  value?: string;
  type?: string;
}

/**
 * A chainable element stub. `style` is a plain object; `createEl`/`createDiv`
 * record the tag, `cls`, and `text` from their options and append the new child
 * to `children`, so tests can traverse the rendered tree and assert on classes,
 * text, and the absence of inline styles. `addEventListener` records listeners
 * so behavior tests can invoke click/change handlers directly.
 */
export interface ElementStub {
  tagName: string;
  cls: string;
  className: string;
  textContent: string;
  value: string;
  type: string;
  inputEl: { type: string };
  children: ElementStub[];
  style: Record<string, string>;
  listeners: Record<string, Array<() => void>>;
  empty(): void;
  addEventListener(eventType: string, listener: () => void): void;
  /** Invoke every recorded listener for the event type (throws if none). */
  dispatch(eventType: string): void;
  createEl(tag: string, options?: ElementStubOptions): ElementStub;
  createDiv(options?: ElementStubOptions): ElementStub;
}

export function makeElementStub(tagName = "div", options: ElementStubOptions = {}): ElementStub {
  const element: ElementStub = {
    tagName,
    cls: options.cls ?? "",
    className: options.cls ?? "",
    textContent: options.text ?? "",
    value: options.value ?? "",
    type: options.type ?? "",
    inputEl: { type: "" },
    children: [],
    style: {},
    listeners: {},
    empty() { this.children.length = 0; },
    addEventListener(eventType: string, listener: () => void) {
      (this.listeners[eventType] ??= []).push(listener);
    },
    dispatch(eventType: string) {
      const registered = this.listeners[eventType];
      if (!registered || registered.length === 0) {
        throw new Error(`ElementStub: no "${eventType}" listener registered on <${this.tagName}>`);
      }
      for (const listener of registered) listener();
    },
    createEl(tag: string, childOptions: ElementStubOptions = {}) {
      const child = makeElementStub(tag, childOptions);
      this.children.push(child);
      return child;
    },
    createDiv(childOptions: ElementStubOptions = {}) {
      const child = makeElementStub("div", childOptions);
      this.children.push(child);
      return child;
    },
  };
  return element;
}

/** Recursively collect every descendant element of a stub tree (excluding the root). */
export function collectDescendants(element: ElementStub): ElementStub[] {
  const all: ElementStub[] = [];
  for (const child of element.children ?? []) {
    all.push(child, ...collectDescendants(child));
  }
  return all;
}

export class Modal {
  app: App;
  contentEl: ElementStub = makeElementStub();
  constructor(app: App) { this.app = app; }
  open(): void {}
  close(): void {}
}

export class PluginSettingTab {
  app: App;
  containerEl: ElementStub = makeElementStub();
  constructor(app: App, _plugin: unknown) { this.app = app; }
}

/** Settings rendered since the last clearRenderedSettings() call. */
export const renderedSettings: Setting[] = [];

export function clearRenderedSettings(): void {
  renderedSettings.length = 0;
}

export class Setting {
  name = "";
  desc = "";
  texts: TextStub[] = [];
  constructor(_containerEl: unknown) { renderedSettings.push(this); }
  setName(name: string): this { this.name = name; return this; }
  setDesc(desc: string): this { this.desc = desc; return this; }
  addText(callback: (text: TextStub) => void): this {
    const text = new TextStub();
    this.texts.push(text);
    callback(text);
    return this;
  }
}

export class TextStub {
  inputEl = { type: "" };
  placeholder = "";
  value = "";
  changeCallback: ((value: string) => unknown) | null = null;
  setPlaceholder(placeholder: string): this { this.placeholder = placeholder; return this; }
  setValue(value: string): this { this.value = value; return this; }
  onChange(callback: (value: string) => unknown): this { this.changeCallback = callback; return this; }
  /** Simulate the user typing a value (throws if no onChange registered). */
  async simulateInput(value: string): Promise<void> {
    if (!this.changeCallback) throw new Error("TextStub: no onChange callback registered");
    this.value = value;
    await this.changeCallback(value);
  }
}

export class Plugin {
  app: unknown = {};
  constructor(app?: unknown) { if (app) this.app = app; }
  async loadData(): Promise<unknown> { return null; }
  async saveData(_data: unknown): Promise<void> {}
  registerEvent(): void {}
  registerInterval(id: number): number { return id; }
  addCommand(): void {}
  addRibbonIcon(): void {}
  addSettingTab(): void {}
}
