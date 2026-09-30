// Stand-in for the "obsidian" package in unit tests (it ships types only).
export class Notice {
  constructor(public message?: string) {}
}

// A minimal fake DOM element: just enough of Obsidian's createEl/appendText/
// empty/setText surface for src/migration.ts's MigrationModal to build its
// list and read checkbox state back, so a unit test can drive a real
// open()/close() cycle (Esc, the X button, and the harness's closeModals all
// end up calling Modal.close(), which must resolve "declined" the same way
// clicking "Keep them" does).
export class FakeEl {
  tagName: string;
  children: FakeEl[] = [];
  text = "";
  checked = false;
  type = "";
  constructor(tag: string) { this.tagName = tag; }
  createEl(tag: string, opts?: { text?: string; type?: string }): FakeEl {
    const el = new FakeEl(tag);
    if (opts?.text) el.text = opts.text;
    if (opts?.type) el.type = opts.type;
    this.children.push(el);
    return el;
  }
  appendText(text: string): void { this.text += text; }
  setText(text: string): void { this.text = text; }
  empty(): void { this.children = []; this.text = ""; }
  get textContent(): string {
    return this.text + this.children.map((c) => c.textContent).join("");
  }
}

// Depth-first search for every FakeEl of a given tag, e.g. queryAll(modal.contentEl, "li").
export function queryAll(el: FakeEl, tag: string): FakeEl[] {
  const out: FakeEl[] = el.tagName === tag ? [el] : [];
  for (const c of el.children) out.push(...queryAll(c, tag));
  return out;
}

export class Modal {
  app?: unknown;
  titleEl = new FakeEl("div");
  contentEl = new FakeEl("div");
  constructor(app?: unknown) { this.app = app; }
  onOpen(): void {}
  onClose(): void {}
  open(): void { this.onOpen(); }
  close(): void { this.onClose(); }
}
// Keeps its onClick handler (and the button's label) so a unit test can find
// a button by its text and actually click it, the same way tests/migration.sh
// finds a real <button> by textContent and calls .click() on it. A stub that
// dropped the handler would let a button-wiring bug (e.g. answering with
// every path instead of just the checked ones) pass unit tests silently.
export class SettingButton {
  text = "";
  private handler: () => void = () => {};
  setButtonText(text: string): this { this.text = text; return this; }
  setCta(): this { return this; }
  onClick(fn: () => void): this { this.handler = fn; return this; }
  click(): void { this.handler(); }
}
// Every Setting constructed, most-recent last, so a test can reach the one a
// modal just built without the modal exposing it itself.
export const settingInstances: Setting[] = [];
export class Setting {
  readonly buttons: SettingButton[] = [];
  constructor(public containerEl?: unknown) { settingInstances.push(this); }
  addButton(cb: (b: SettingButton) => void): this {
    const b = new SettingButton();
    cb(b);
    this.buttons.push(b);
    return this;
  }
  button(text: string): SettingButton {
    const b = this.buttons.find((x) => x.text === text);
    if (!b) throw new Error(`no button labeled "${text}"`);
    return b;
  }
}
// TFile is unused by src/migration.ts now (it works entirely through
// app.vault.adapter, by path, so trashing never goes through Vault.trashFile
// and the user's "Deleted files" preference); kept as a stand-in for other
// modules' `type TFile` imports.
export class TFile {
  path = "";
}
// The real normalizePath collapses slashes, drops a leading "./" and any
// trailing slash. Good enough for the folder/name.md paths this repo builds.
export function normalizePath(path: string): string {
  const p = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\.\//, "").replace(/\/+$/, "").trim();
  return p.length ? p : "/";
}
