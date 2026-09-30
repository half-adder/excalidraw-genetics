import { Modal, Setting, normalizePath, type App } from "obsidian";
import type FlyGeneticsPlugin from "./main";
import { take, put } from "./hooks";
import { EXCALIDRAW_ID } from "./excalidraw/version";
import type { AppInternals } from "./excalidraw/ea";

// File names the scripts installer (installer/build.py) wrote into the
// Excalidraw script folder, plus the installer itself and its manifest.
export const INSTALLED_SCRIPTS = ["Genotype", "Cross Genotypes", "Cross Mode", "Tidy", "Tidy Below", "Select Lineage", "Select Below", "Break Cross", "Update Fly Genetics", "Install Fly Genetics"] as const;
export const INSTALLER_MANIFEST = ".fly-genetics.json";

export const trimFolder = (folder: string): string => folder.trim().replace(/\/+$/, "");
export const installedScriptPaths = (folder: string): string[] => INSTALLED_SCRIPTS.map((n) => normalizePath(`${trimFolder(folder)}/${n}.md`));

function scriptFolder(app: App): string {
  const excalidraw = (app as AppInternals).plugins.plugins[EXCALIDRAW_ID] as unknown as { settings?: { scriptFolderPath?: string } } | undefined;
  return excalidraw?.settings?.scriptFolderPath || "Excalidraw/Scripts";
}

// SHA-256 hex digest, matching the installer's own hashing
// (~/code/excalidraw-genetics/installer/installer.template.md: `sha256`).
// Used only to tell an installed script that still has the content the
// installer wrote (safe to preselect) from a same-named file whose content
// does not match (edited, or simply not ours: never preselected).
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

type ManifestHashes = Partial<Record<(typeof INSTALLED_SCRIPTS)[number], string>>;

// Reads and parses the manifest's `hashes` map; null on any read/parse
// failure (missing file, corrupt JSON, wrong shape: not an object, or an
// array, which is also `typeof "object"`), so callers preselect nothing
// rather than guess.
async function readManifestHashes(app: App, manifestPath: string): Promise<ManifestHashes | null> {
  try {
    const parsed = JSON.parse(await app.vault.adapter.read(manifestPath)) as { hashes?: unknown };
    return parsed.hashes && typeof parsed.hashes === "object" && !Array.isArray(parsed.hashes) ? (parsed.hashes as ManifestHashes) : null;
  } catch {
    return null;
  }
}

// The desktop adapter's own, already-constructed Node fs handle: present at
// runtime (verified against a live Obsidian instance) but not part of the
// public obsidian API, so it is never `import`ed or `require`d here (the
// repo bans Node-only APIs in src/). On mobile there is no such property,
// and no symlinks either, so `isLinkedPath` below is simply false there.
interface DesktopAdapterLike {
  getFullPath(path: string): string;
  fsPromises?: { lstat(path: string): Promise<{ isSymbolicLink(): boolean }> };
}

// True if `path`, or any folder between the vault root and it, is a
// symlink: a development copy, the same as the real dev vault's whole
// Excalidraw/Scripts (or even Excalidraw itself) can be, not only an
// individual script file. Checked by lstat-ing every path segment from the
// top down (Obsidian's own getFullRealPath does not resolve through a
// symlink in practice, verified against a live instance, so it cannot be
// used for this). Fails closed: an lstat error partway through the walk
// (not just "found a link") is treated as linked, never preselected, rather
// than assumed safe. On an adapter with no such capability at all (mobile),
// there is nothing to check and no symlinks either, so this is false.
async function isLinkedPath(app: App, relPath: string): Promise<boolean> {
  const adapter = app.vault.adapter as unknown as DesktopAdapterLike;
  if (typeof adapter.getFullPath !== "function" || typeof adapter.fsPromises?.lstat !== "function") return false;
  let prefix = "";
  for (const segment of relPath.split("/").filter(Boolean)) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    try {
      if ((await adapter.fsPromises.lstat(adapter.getFullPath(prefix))).isSymbolicLink()) return true;
    } catch {
      return true; // fail closed: could not verify this segment is not a link
    }
  }
  return false;
}

export interface Candidate {
  name: (typeof INSTALLED_SCRIPTS)[number];
  path: string;
  // Content hash matches what the manifest recorded as installed: safe to
  // preselect. Never true for a symlink (its content is never read), a file
  // the manifest has no entry for, a mismatch, or when there is no manifest.
  matches: boolean;
  linked: boolean;
  // Why an unmatched candidate is unmatched, for the prompt's list; unset
  // when `matches` is true.
  note?: string;
}

// The modal's checkbox -> selection logic, pulled out so it is directly
// unit-testable without driving the modal's DOM.
export function checkedPaths(boxes: ReadonlyMap<string, { checked: boolean }>): string[] {
  return [...boxes].filter(([, box]) => box.checked).map(([path]) => path);
}

// Moves `path` to the trash without ever permanently deleting it: the
// system trash if available, else the vault's own .trash. Never
// Vault.trashFile/FileManager.trashFile, which honor the user's "Deleted
// files" preference and can permanently delete.
async function trashPath(app: App, path: string): Promise<void> {
  if (!(await app.vault.adapter.trashSystem(path))) await app.vault.adapter.trashLocal(path);
}

class MigrationModal extends Modal {
  private answered = false;
  constructor(
    app: App,
    private readonly candidates: readonly Candidate[],
    private readonly manifestPath: string | null,
    private readonly manifestChecked: boolean,
    private readonly manifestNote: string | undefined,
    private readonly modals: Set<Modal>,
    private readonly resolve: (selected: string[] | null) => void,
  ) { super(app); }

  onOpen(): void {
    this.titleEl.setText("Fly Genetics is now a plugin");
    this.contentEl.createEl("p", { text: "These Fly Genetics scripts are still in your Excalidraw script folder, so each command would appear twice. Move the checked files to the trash? Your drawings are not changed. You won't be asked again." });
    const list = this.contentEl.createEl("ul");
    const boxes = new Map<string, HTMLInputElement>();
    const row = (path: string, checked: boolean, note?: string): void => {
      const li = list.createEl("li");
      const label = li.createEl("label");
      const box = label.createEl("input", { type: "checkbox" });
      box.checked = checked;
      boxes.set(path, box);
      label.appendText(` ${path}${note ? ` (${note})` : ""}`);
    };
    for (const c of this.candidates) row(c.path, c.matches, c.note);
    if (this.manifestPath) row(this.manifestPath, this.manifestChecked, this.manifestNote);
    new Setting(this.contentEl)
      .addButton((b) => b.setButtonText("Keep them").onClick(() => this.answer(null)))
      .addButton((b) => b.setButtonText("Move to trash").setCta().onClick(() => this.answer(checkedPaths(boxes))));
  }
  private answer(selected: string[] | null): void { this.answered = true; this.resolve(selected); this.close(); }
  // Esc, the titlebar's close button and the harness's closeModals() all end
  // up here without going through answer(): that must decline (resolve
  // null), the same as clicking "Keep them", never trash anything.
  onClose(): void { this.contentEl.empty(); this.modals.delete(this); if (!this.answered) this.resolve(null); }
}

// First load: offers to move the installer's Fly Genetics scripts (and its
// own manifest) to the trash. Only a file whose content still matches what
// the manifest recorded as installed is preselected; a symlinked script (a
// development copy), a same-named file that does not match, a file the
// manifest has no entry for, or any file at all when there is no manifest,
// is listed but left unchecked. The manifest itself is only preselected
// when every listed candidate is preselected. Never trashes without
// confirmation (a decision made only by an explicit click of "Move to
// trash", never by opening or closing the prompt); asks once (the answer is
// saved). `folder` overrides the Excalidraw script-folder lookup, so a test
// never has to touch Excalidraw's own settings to point this at a throwaway
// folder.
export async function offerMigration(plugin: FlyGeneticsPlugin, folder?: string): Promise<void> {
  // The test hooks are honored only with _flyMigrationTestMode set in this
  // same call (as the font offer's): a leftover _flyMigrationAuto or
  // _flyMigrationTrash on its own is cleared and ignored, so it can never
  // re-ask a remembered answer, answer the prompt, or redirect the trash.
  // All three are consumed here, whatever happens next.
  const autoHook = take("_flyMigrationAuto");
  const trashHook = take("_flyMigrationTrash");
  const testMode = !!take("_flyMigrationTestMode");
  const auto = testMode ? autoHook : undefined;
  if (!auto && plugin.settings.migration !== "pending") return;
  const { app } = plugin;
  // Saves the answer; in test mode it is kept in memory only, never written
  // to the plugin's data.json.
  const save = async (migration: "done" | "declined"): Promise<void> => {
    plugin.settings.migration = migration;
    if (!testMode) await plugin.saveSettings();
  };
  const dir = trimFolder(folder ?? auto?.scriptFolder ?? scriptFolder(app));
  const manifestPath = normalizePath(`${dir}/${INSTALLER_MANIFEST}`);
  const hasManifest = await app.vault.adapter.exists(manifestPath);
  const hashes = hasManifest ? await readManifestHashes(app, manifestPath) : null;
  const candidates: Candidate[] = [];
  for (const name of INSTALLED_SCRIPTS) {
    const path = normalizePath(`${dir}/${name}.md`);
    if (!(await app.vault.adapter.exists(path))) continue;
    const linked = await isLinkedPath(app, path);
    let matches = false;
    if (!linked && hashes) {
      try {
        matches = hashes[name] === (await sha256Hex(await app.vault.adapter.read(path)));
      } catch {
        // A file that exists but cannot be read (removed mid-scan, a
        // permission error, ...) is simply not preselected, never a reason
        // to fail the whole offer.
        matches = false;
      }
    }
    const note = matches ? undefined : linked ? "link, not preselected" : hasManifest ? "differs from what the installer wrote" : "no installer record";
    candidates.push({ name, path, matches, linked, note });
  }
  if (!candidates.length && !hasManifest) {
    await save("done");
    return;
  }
  const allMatch = candidates.every((c) => c.matches);
  const manifestChecked = hasManifest && allMatch;
  const manifestNote = hasManifest && !manifestChecked ? "some scripts above were not preselected" : undefined;
  const preselected = [...candidates.filter((c) => c.matches).map((c) => c.path), ...(manifestChecked ? [manifestPath] : [])];
  // A test's explicit selection can only name what the prompt lists (the
  // candidates and the manifest); any other path is dropped.
  const listed = new Set([...candidates.map((c) => c.path), ...(hasManifest ? [manifestPath] : [])]);
  const selected = auto
    ? (auto.confirm === false ? null : (auto.select?.filter((p) => listed.has(p)) ?? preselected))
    : await new Promise<string[] | null>((resolve) => {
        const m = new MigrationModal(app, candidates, hasManifest ? manifestPath : null, manifestChecked, manifestNote, plugin.testing.modals, resolve);
        plugin.testing.modals.add(m);
        m.open();
      });
  // The trash override is used only in test mode (see above): a stray
  // _flyMigrationTrash left behind by a crashed test run falls back to the
  // real trash, so it can never silently turn a real user's confirmed trash
  // into something else (e.g. a leftover test hook that permanently deletes).
  const trash = testMode && trashHook ? trashHook : (path: string) => trashPath(app, path);
  // Closed by the plugin unloading: not an answer. Nothing is trashed or
  // saved.
  if (plugin.unloaded) return;
  const trashed: string[] = [];
  if (selected) {
    for (const p of selected) { await trash(p); trashed.push(p); }
  }
  await save(selected ? "done" : "declined");
  put("_flyMigrationResult", { trashed, declined: selected === null });
}
