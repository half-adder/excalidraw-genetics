import { afterEach, describe, expect, it, vi } from "vitest";
import { type FakeEl, Modal, queryAll, settingInstances } from "obsidian";
import { checkedPaths, installedScriptPaths, offerMigration, sha256Hex, trimFolder, INSTALLER_MANIFEST } from "../../src/migration";
import type { FlyGeneticsSettings } from "../../src/settings";

describe("installedScriptPaths", () => {
  it("lists the installer's files in the script folder", () => {
    expect(trimFolder("Excalidraw/Scripts//")).toBe("Excalidraw/Scripts");
    const p = installedScriptPaths("Excalidraw/Scripts/");
    expect(p).toContain("Excalidraw/Scripts/Cross Genotypes.md");
    expect(p).toContain("Excalidraw/Scripts/Update Fly Genetics.md");
    expect(p).toContain("Excalidraw/Scripts/Install Fly Genetics.md");
    expect(p).toHaveLength(10);
  });
});

describe("sha256Hex", () => {
  it("matches a known SHA-256 digest (the installer hashes the same way, see installer.template.md's `sha256`)", async () => {
    expect(await sha256Hex("// test")).toBe("fa78e4ef262e95abc8de06709aae76ca019d9534bb0253ade36145021237ab2b");
    expect(await sha256Hex("// edited")).toBe("979fab1f8a9bc00fc8965d1f5364c930229f5f190e907567a6164d0e39cd92fb");
  });
});

describe("checkedPaths (the modal's checkbox -> selection logic)", () => {
  it("returns exactly the paths whose box is checked", () => {
    const boxes = new Map([["a", { checked: true }], ["b", { checked: false }], ["c", { checked: true }]]);
    expect(checkedPaths(boxes)).toEqual(["a", "c"]);
  });
  it("returns nothing when every box is unchecked", () => {
    const boxes = new Map([["a", { checked: false }]]);
    expect(checkedPaths(boxes)).toEqual([]);
  });
});

// offerMigration's decision logic against a fake vault.adapter (no
// fileManager at all: a regression back to Vault/FileManager.trashFile,
// which honors the user's "Deleted files" preference and can permanently
// delete, would throw here rather than silently pass). The hooks live on
// window; in Node it is globalThis.
const hooks = globalThis as unknown as Record<string, unknown>;
hooks.window ??= globalThis;
afterEach(() => {
  hooks._flyMigrationAuto = undefined;
  hooks._flyMigrationResult = undefined;
  hooks._flyMigrationTrash = undefined;
  hooks._flyMigrationTestMode = undefined;
  settingInstances.length = 0;
});

const DIR = "Excalidraw/Scripts";
// The auto hook is honored only with _flyMigrationTestMode set in the same
// call, so every test that drives the offer through it sets both.
const armAuto = (auto: { confirm: boolean; select?: string[] }): void => {
  hooks._flyMigrationAuto = auto;
  hooks._flyMigrationTestMode = true;
};
const TIDY_TEXT = "// test";
const TIDY_HASH = "fa78e4ef262e95abc8de06709aae76ca019d9534bb0253ade36145021237ab2b"; // sha256Hex(TIDY_TEXT)

function fakePlugin(opts: {
  present?: Record<string, string>;
  manifest?: Record<string, string>;
  manifestRaw?: string;
  migration?: FlyGeneticsSettings["migration"];
  trashSystemOk?: boolean;
  linkedPaths?: string[]; // exact path segments that are symlinks (desktop-only): a file (`${DIR}/Tidy.md`) or a folder (DIR, "Excalidraw")
  lstatFail?: string[]; // exact path segments whose lstat call throws (fail-closed proof)
  noFsPromises?: boolean; // simulate a mobile adapter: no link detection possible
  readFail?: string[]; // names whose adapter.read rejects
}) {
  const manifestPath = `${DIR}/${INSTALLER_MANIFEST}`;
  const files = new Map<string, string>();
  for (const [name, text] of Object.entries(opts.present ?? {})) files.set(`${DIR}/${name}.md`, text);
  if (opts.manifestRaw !== undefined) files.set(manifestPath, opts.manifestRaw);
  else if (opts.manifest) files.set(manifestPath, JSON.stringify({ hashes: opts.manifest }));

  const trashed: string[] = [];
  const readFail = new Set((opts.readFail ?? []).map((n) => `${DIR}/${n}.md`));
  const linkedPaths = new Set(opts.linkedPaths ?? []);
  const lstatFail = new Set(opts.lstatFail ?? []);

  const exists = vi.fn(async (p: string) => files.has(p));
  const read = vi.fn(async (p: string) => {
    if (readFail.has(p)) throw new Error(`simulated read failure: ${p}`);
    const v = files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  });
  const trashSystem = vi.fn(async (p: string) => {
    if (opts.trashSystemOk ?? true) { trashed.push(p); files.delete(p); return true; }
    return false;
  });
  const trashLocal = vi.fn(async (p: string) => { trashed.push(p); files.delete(p); });
  const adapter: Record<string, unknown> = { exists, read, trashSystem, trashLocal };
  if (!opts.noFsPromises) {
    adapter.getFullPath = (p: string) => p;
    adapter.fsPromises = {
      lstat: async (p: string) => {
        if (lstatFail.has(p)) throw new Error(`simulated lstat failure: ${p}`);
        return { isSymbolicLink: () => linkedPaths.has(p) };
      },
    };
  }
  const settings: FlyGeneticsSettings = { migration: opts.migration ?? "pending", font: "declined" };
  const saveSettings = vi.fn(async () => undefined);
  const modals = new Set<Modal>();
  const plugin = { app: { vault: { adapter } }, settings, testing: { modals }, saveSettings, unloaded: false };
  return { plugin: plugin as unknown as Parameters<typeof offerMigration>[0], exists, read, trashSystem, trashLocal, trashed, settings, saveSettings, modals };
}

describe("offerMigration: a file's content hash must match the manifest to be preselected", () => {
  it("preselects (and trashes, on confirm) a file whose content hash matches the manifest, and the manifest itself", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toEqual([`${DIR}/Tidy.md`, `${DIR}/${INSTALLER_MANIFEST}`]);
    expect(f.settings.migration).toBe("done");
  });

  it("does NOT preselect a same-named file whose content hash does not match the manifest, even though a sibling file does match", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, Genotype: "// I edited this" }, manifest: { Tidy: TIDY_HASH, Genotype: "0".repeat(64) } });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toContain(`${DIR}/Tidy.md`);
    expect(f.trashed).not.toContain(`${DIR}/Genotype.md`);
  });

  it("a file the manifest has no entry for at all is not preselected, even though it is present (the real manifest has no 'Install Fly Genetics' entry)", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, "Install Fly Genetics": TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toContain(`${DIR}/Tidy.md`);
    expect(f.trashed).not.toContain(`${DIR}/Install Fly Genetics.md`);
  });

  it("preselects nothing when there is no manifest at all, even though the named files are present", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, Genotype: TIDY_TEXT } });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toEqual([]);
    // The offer still resolved (the user confirmed, even though nothing was
    // preselected to confirm): remembered so it is not asked again.
    expect(f.settings.migration).toBe("done");
  });

  it("an explicit selection (what the modal's checked boxes send) overrides the default preselection", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, Genotype: "// I edited this" }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: true, select: [`${DIR}/Genotype.md`] });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toEqual([`${DIR}/Genotype.md`]);
  });
});

describe("offerMigration: only the checked boxes are trashed, proven at the button", () => {
  it("clicking 'Move to trash' sends exactly the checked paths; unchecking a preselected box excludes it", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, "Cross Genotypes": TIDY_TEXT }, manifest: { Tidy: TIDY_HASH, "Cross Genotypes": TIDY_HASH } });
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    const modal = [...f.modals][0] as unknown as { contentEl: FakeEl };
    const tidyRow = queryAll(modal.contentEl, "li").find((li) => li.textContent.includes(`${DIR}/Tidy.md`));
    const crossRow = queryAll(modal.contentEl, "li").find((li) => li.textContent.includes(`${DIR}/Cross Genotypes.md`));
    const tidyBox = queryAll(tidyRow!, "input")[0];
    const crossBox = queryAll(crossRow!, "input")[0];
    expect(tidyBox.checked).toBe(true); // both preselected: both match the manifest
    expect(crossBox.checked).toBe(true);
    tidyBox.checked = false; // the user unchecks Tidy by hand
    settingInstances[settingInstances.length - 1].button("Move to trash").click();
    await done;
    expect(f.trashed).not.toContain(`${DIR}/Tidy.md`);
    expect(f.trashed).toContain(`${DIR}/Cross Genotypes.md`);
    expect(f.trashed).toContain(`${DIR}/${INSTALLER_MANIFEST}`);
  });
});

describe("offerMigration: a symlinked script (or a symlinked ancestor folder) is a development copy, never preselected or read for hashing", () => {
  it("a symlinked file is listed unchecked with a note, its content never read, never trashed on confirm", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH }, linkedPaths: [`${DIR}/Tidy.md`] });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).not.toContain(`${DIR}/Tidy.md`);
    expect(f.read.mock.calls.map((c) => c[0])).not.toContain(`${DIR}/Tidy.md`);
  });

  it("a symlinked PARENT FOLDER also makes the file inside it linked, even though the file itself is not a symlink", async () => {
    // DIR ("Excalidraw/Scripts") itself is the link, matching a real vault
    // whose whole Scripts folder (or Excalidraw folder) is one.
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH }, linkedPaths: [DIR] });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).not.toContain(`${DIR}/Tidy.md`);
    expect(f.read.mock.calls.map((c) => c[0])).not.toContain(`${DIR}/Tidy.md`);
  });

  it("fails closed: an lstat error partway through the walk is treated as linked, never preselected", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH }, lstatFail: [DIR] });
    armAuto({ confirm: true });
    await expect(offerMigration(f.plugin, DIR)).resolves.toBeUndefined();
    expect(f.trashed).not.toContain(`${DIR}/Tidy.md`);
  });

  it("without a desktop fs handle (a mobile-like adapter), nothing is ever treated as linked", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH }, noFsPromises: true });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toContain(`${DIR}/Tidy.md`); // matches by hash, and there is no way to tell it is linked
  });
});

describe("offerMigration: a malformed manifest preselects nothing", () => {
  it("corrupt JSON", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifestRaw: "{ not json" });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toEqual([]);
  });
  it("`hashes` is a string, not an object", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifestRaw: JSON.stringify({ hashes: TIDY_HASH }) });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toEqual([]);
  });
  it("`hashes` is an array, not an object (also `typeof === \"object\"` in JS)", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifestRaw: JSON.stringify({ hashes: [TIDY_HASH] }) });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toEqual([]);
  });
});

describe("offerMigration: a per-file read failure never crashes the offer", () => {
  it("treats an unreadable file as not matching, and still processes the rest", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, "Cross Genotypes": TIDY_TEXT }, manifest: { Tidy: TIDY_HASH, "Cross Genotypes": TIDY_HASH }, readFail: ["Tidy"] });
    armAuto({ confirm: true });
    await expect(offerMigration(f.plugin, DIR)).resolves.toBeUndefined();
    expect(f.trashed).not.toContain(`${DIR}/Tidy.md`);
    expect(f.trashed).toContain(`${DIR}/Cross Genotypes.md`);
  });
});

describe("offerMigration: the manifest is only preselected when every listed script is preselected", () => {
  it("preselects the manifest when everything present matches", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toContain(`${DIR}/${INSTALLER_MANIFEST}`);
  });
  it("does not preselect the manifest when one listed script does not match", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, Genotype: "// edited" }, manifest: { Tidy: TIDY_HASH, Genotype: "0".repeat(64) } });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).not.toContain(`${DIR}/${INSTALLER_MANIFEST}`);
  });
});

describe("offerMigration: an injected trash function overrides the real trashSystem/trashLocal, only when explicitly armed for this call", () => {
  it("routes every confirmed path through it when both _flyMigrationTrash and _flyMigrationTestMode are set", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    const seen: string[] = [];
    hooks._flyMigrationTrash = async (p: string) => { seen.push(p); };
    hooks._flyMigrationTestMode = true;
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(seen.sort()).toEqual([`${DIR}/${INSTALLER_MANIFEST}`, `${DIR}/Tidy.md`].sort());
    expect(f.trashSystem).not.toHaveBeenCalled();
    expect(f.trashLocal).not.toHaveBeenCalled();
  });

  // A crashed or buggy test run could leave _flyMigrationTrash set without
  // ever clearing it. That alone must never be enough to redirect a real
  // user's confirmed trash: _flyMigrationTestMode has to be set fresh in
  // THIS call too (offerMigration take()s both, so a leftover from a prior
  // call is already gone regardless, but this proves the gate itself, not
  // just the consume-on-read behavior).
  it("ignores a leftover _flyMigrationTrash when _flyMigrationTestMode is not set in this call, and uses the real trash instead", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    const seen: string[] = [];
    hooks._flyMigrationTrash = async (p: string) => { seen.push(p); };
    // hooks._flyMigrationTestMode deliberately NOT set: the real prompt
    // opens and the user clicks "Move to trash".
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    settingInstances[settingInstances.length - 1].button("Move to trash").click();
    await done;
    expect(seen).toEqual([]);
    expect(f.trashSystem).toHaveBeenCalledWith(`${DIR}/Tidy.md`);
    expect(hooks._flyMigrationTrash).toBeUndefined(); // consumed all the same
  });
});

describe("offerMigration: trash path never permanently deletes", () => {
  it("trashes through the system trash", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashSystem).toHaveBeenCalledWith(`${DIR}/Tidy.md`);
    expect(f.trashLocal).not.toHaveBeenCalled();
  });

  it("falls back to the vault's own .trash when the system trash is unavailable, still never a permanent delete", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH }, trashSystemOk: false });
    armAuto({ confirm: true });
    await offerMigration(f.plugin, DIR);
    expect(f.trashSystem).toHaveBeenCalledWith(`${DIR}/Tidy.md`);
    expect(f.trashLocal).toHaveBeenCalledWith(`${DIR}/Tidy.md`);
  });

  it("never reaches for Vault/FileManager.trashFile (no fileManager exists on this fake app at all)", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: true });
    await expect(offerMigration(f.plugin, DIR)).resolves.toBeUndefined();
    expect(f.trashed).toEqual([`${DIR}/Tidy.md`, `${DIR}/${INSTALLER_MANIFEST}`]);
  });
});

describe("offerMigration: declined remembered", () => {
  it("does nothing (no vault read, no save) once the answer is 'declined' and no test override forces a re-ask", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, migration: "declined" });
    await offerMigration(f.plugin, DIR);
    expect(f.exists).not.toHaveBeenCalled();
    expect(f.saveSettings).not.toHaveBeenCalled();
    expect(f.trashed).toEqual([]);
  });

  it("does ask again while the answer is still 'pending'", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH }, migration: "pending" });
    armAuto({ confirm: false });
    await offerMigration(f.plugin, DIR);
    expect(f.exists).toHaveBeenCalled();
    expect(f.settings.migration).toBe("declined");
  });
});

describe("offerMigration: nothing without confirmation", () => {
  it("trashes nothing when the answer is 'no', and records the decline", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: false });
    await offerMigration(f.plugin, DIR);
    expect(f.trashed).toEqual([]);
    expect(f.settings.migration).toBe("declined");
    expect(hooks._flyMigrationResult).toEqual({ trashed: [], declined: true });
  });

  // Nothing (no auto override at all) drives offerMigration through the real
  // confirmation modal. A mutant that resolves without waiting for it (e.g.
  // "auto ? auto.confirm : true", skipping the await) would trash before the
  // modal is ever closed; a mutant in MigrationModal.onClose that resolves
  // "confirmed" instead of "declined" when closed without a button (Esc, the
  // titlebar X, or the harness's closeModals()) would trash after close. This
  // test catches either: it waits for the modal, asserts nothing has been
  // trashed yet, closes it without clicking anything, then asserts nothing
  // was trashed afterward either.
  it("closing the prompt without clicking a button (Esc / X / closeModals) declines: nothing is trashed", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    expect(f.trashed).toEqual([]); // not trashed just by opening the prompt
    const modal = [...f.modals][0];
    modal.close(); // Esc / titlebar X / TestingHooks.closeModals() all call this
    await done;
    expect(f.trashed).toEqual([]);
    expect(f.settings.migration).toBe("declined");
    expect(hooks._flyMigrationResult).toEqual({ trashed: [], declined: true });
    expect(f.modals.size).toBe(0); // the modal removes itself from testing.modals on close
  });

  it("a prompt closed by the plugin unloading is not an answer: nothing trashed or saved, still pending", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    (f.plugin as unknown as { unloaded: boolean }).unloaded = true; // as onunload does, before closeModals
    [...f.modals][0].close();
    await done;
    expect(f.trashed).toEqual([]);
    expect(f.settings.migration).toBe("pending");
    expect(f.saveSettings).not.toHaveBeenCalled();
  });

  it("clicking 'Keep them' trashes nothing and is remembered as declined", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    settingInstances[settingInstances.length - 1].button("Keep them").click();
    await done;
    expect(f.trashed).toEqual([]);
    expect(f.settings.migration).toBe("declined");
    expect(hooks._flyMigrationResult).toEqual({ trashed: [], declined: true });
  });
});

describe("offerMigration: the prompt's per-row note text", () => {
  it("matched: no note; mismatched: 'differs from what the installer wrote'; linked: 'link, not preselected'", async () => {
    const f = fakePlugin({
      present: { Tidy: TIDY_TEXT, Genotype: "// edited", "Cross Mode": TIDY_TEXT },
      manifest: { Tidy: TIDY_HASH, Genotype: "0".repeat(64), "Cross Mode": TIDY_HASH },
      linkedPaths: [`${DIR}/Cross Mode.md`],
    });
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    const modal = [...f.modals][0] as unknown as { contentEl: FakeEl };
    const rows = queryAll(modal.contentEl, "li");
    const row = (path: string) => rows.find((li) => li.textContent.includes(path))!.textContent;
    expect(row(`${DIR}/Tidy.md`)).toBe(` ${DIR}/Tidy.md`); // matched: bare path, no note
    expect(row(`${DIR}/Genotype.md`)).toContain("differs from what the installer wrote");
    expect(row(`${DIR}/Cross Mode.md`)).toContain("link, not preselected");
    settingInstances[settingInstances.length - 1].button("Keep them").click();
    await done;
  });

  it("no manifest at all: 'no installer record'", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT } });
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    const modal = [...f.modals][0] as unknown as { contentEl: FakeEl };
    const row = queryAll(modal.contentEl, "li").find((li) => li.textContent.includes(`${DIR}/Tidy.md`))!;
    expect(row.textContent).toContain("no installer record");
    settingInstances[settingInstances.length - 1].button("Keep them").click();
    await done;
  });

  it("the manifest row itself: 'some scripts above were not preselected' when not everything matched", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, Genotype: "// edited" }, manifest: { Tidy: TIDY_HASH, Genotype: "0".repeat(64) } });
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    const modal = [...f.modals][0] as unknown as { contentEl: FakeEl };
    const row = queryAll(modal.contentEl, "li").find((li) => li.textContent.includes(INSTALLER_MANIFEST))!;
    expect(row.textContent).toContain("some scripts above were not preselected");
    settingInstances[settingInstances.length - 1].button("Keep them").click();
    await done;
  });
});

describe("offerMigration: the auto hook is a test hook, honored only with _flyMigrationTestMode set in the same call", () => {
  it("a leftover _flyMigrationAuto without test mode is ignored: the prompt opens, nothing is trashed until a click", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    hooks._flyMigrationAuto = { confirm: true };
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    expect(f.trashed).toEqual([]);
    expect(hooks._flyMigrationAuto).toBeUndefined(); // consumed, not left for a later call
    settingInstances[settingInstances.length - 1].button("Keep them").click();
    await done;
    expect(f.trashed).toEqual([]);
    expect(f.settings.migration).toBe("declined");
  });

  it("a leftover _flyMigrationAuto without test mode does not re-ask a remembered answer", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH }, migration: "declined" });
    hooks._flyMigrationAuto = { confirm: true };
    await offerMigration(f.plugin, DIR);
    expect(f.exists).not.toHaveBeenCalled();
    expect(f.modals.size).toBe(0);
    expect(f.trashed).toEqual([]);
    expect(f.settings.migration).toBe("declined");
    expect(hooks._flyMigrationAuto).toBeUndefined();
  });

  it("a selection is limited to the listed candidates and the manifest: any other vault path is dropped", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT, "My own script": "// mine" }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: true, select: [`${DIR}/Tidy.md`, "Notes/Important.md", `${DIR}/My own script.md`, `${DIR}/Genotype.md`, `${DIR}/${INSTALLER_MANIFEST}`] });
    await offerMigration(f.plugin, DIR);
    // Genotype.md is an installer name but not present, so not listed.
    expect(f.trashed).toEqual([`${DIR}/Tidy.md`, `${DIR}/${INSTALLER_MANIFEST}`]);
    expect(hooks._flyMigrationResult).toEqual({ trashed: [`${DIR}/Tidy.md`, `${DIR}/${INSTALLER_MANIFEST}`], declined: false });
  });

  it("in test mode the answer is kept in memory only, never saved (a crashed test cannot overwrite the real saved answer)", async () => {
    const confirmed = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: true });
    await offerMigration(confirmed.plugin, DIR);
    expect(confirmed.settings.migration).toBe("done");
    expect(confirmed.saveSettings).not.toHaveBeenCalled();

    const declined = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    armAuto({ confirm: false });
    await offerMigration(declined.plugin, DIR);
    expect(declined.settings.migration).toBe("declined");
    expect(declined.saveSettings).not.toHaveBeenCalled();

    const nothing = fakePlugin({});
    armAuto({ confirm: true });
    await offerMigration(nothing.plugin, DIR);
    expect(nothing.settings.migration).toBe("done");
    expect(nothing.saveSettings).not.toHaveBeenCalled();

    // The prompt itself, answered by a click, in test mode.
    const clicked = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    hooks._flyMigrationTestMode = true;
    const done = offerMigration(clicked.plugin, DIR);
    await vi.waitFor(() => expect(clicked.modals.size).toBe(1));
    settingInstances[settingInstances.length - 1].button("Keep them").click();
    await done;
    expect(clicked.settings.migration).toBe("declined");
    expect(clicked.saveSettings).not.toHaveBeenCalled();
  });

  it("outside test mode the answer is saved", async () => {
    const f = fakePlugin({ present: { Tidy: TIDY_TEXT }, manifest: { Tidy: TIDY_HASH } });
    const done = offerMigration(f.plugin, DIR);
    await vi.waitFor(() => expect(f.modals.size).toBe(1));
    settingInstances[settingInstances.length - 1].button("Keep them").click();
    await done;
    expect(f.saveSettings).toHaveBeenCalledTimes(1);
  });
});
