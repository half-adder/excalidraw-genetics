import { afterEach, describe, expect, it, vi } from "vitest";
import { settingInstances } from "obsidian";
import { FONT_NAME, LICENSE_NAME, fontActions, needsFontSetup, planFontSetup } from "../../src/font/plan";
import { runFirstLoadOffers } from "../../src/first-load";
import type { FlyGeneticsSettings } from "../../src/settings";

// The real assets are bundled by esbuild's binary/text loaders, which vitest
// does not have; the offer only needs some bytes and a license text.
vi.mock("../../src/font/assets", () => ({ FONT_BYTES: new Uint8Array([1, 2, 3, 4]), LICENSE_TEXT: "OFL text" }));
const { offerFontSetup } = await import("../../src/font/index");

const ours = "Excalidraw/Fonts/cmu-serif-500-roman.ttf";
const st = (patch = {}) => ({ fontSize: 639132, expectedSize: 639132, enabled: true, currentFont: ours, fontPath: ours, ...patch });

describe("planFontSetup (the installer's rules)", () => {
  it("nothing to do when the font is there and set", () => {
    const p = planFontSetup(st());
    expect(p).toEqual({ writeFont: false, settings: "ours" });
    expect(needsFontSetup(p)).toBe(false);
  });
  it("writes a missing or different-size font, not a same-size one", () => {
    expect(planFontSetup(st({ fontSize: null })).writeFont).toBe(true);
    expect(planFontSetup(st({ fontSize: 12 })).writeFont).toBe(true);
    expect(planFontSetup(st({ fontSize: 639132 })).writeFont).toBe(false);
    expect(needsFontSetup(planFontSetup(st({ fontSize: null })))).toBe(true);
  });
  it("sets the local font when it is off, asks when it is another font", () => {
    expect(planFontSetup(st({ enabled: false })).settings).toBe("set");
    expect(planFontSetup(st({ enabled: false, currentFont: null })).settings).toBe("set");
    expect(planFontSetup(st({ currentFont: "Excalidraw/Fonts/other.ttf" })).settings).toBe("ask-replace");
    expect(planFontSetup(st({ currentFont: null })).settings).toBe("ask-replace");
    expect(needsFontSetup(planFontSetup(st({ enabled: false })))).toBe(true);
    expect(needsFontSetup(planFontSetup(st({ currentFont: "x.ttf" })))).toBe(true);
  });
});

describe("fontActions (what a confirmed or declined offer does)", () => {
  const set = { writeFont: true, settings: "set" } as const;
  it("does nothing at all without confirmation", () => {
    expect(fontActions(set, false, { skipSettings: false, replaceOther: true })).toEqual({ writeFont: false, writeLicense: false, setLocalFont: false, note: "" });
    expect(fontActions({ writeFont: true, settings: "ask-replace" }, false, { skipSettings: false, replaceOther: true }).setLocalFont).toBe(false);
  });
  it("always writes the license once confirmed, the font only when the plan says so", () => {
    expect(fontActions({ writeFont: false, settings: "ours" }, true, { skipSettings: false, replaceOther: false })).toMatchObject({ writeFont: false, writeLicense: true });
    expect(fontActions(set, true, { skipSettings: false, replaceOther: false })).toMatchObject({ writeFont: true, writeLicense: true });
  });
  it("sets the local font as the installer does (ours: leave; set: set; ask-replace: the answer)", () => {
    expect(fontActions({ writeFont: false, settings: "ours" }, true, { skipSettings: false, replaceOther: true })).toMatchObject({ setLocalFont: false, note: "Local font was already set to Computer Modern." });
    expect(fontActions(set, true, { skipSettings: false, replaceOther: false })).toMatchObject({ setLocalFont: true, note: "Local font set to Computer Modern. Reopen open drawings to see it." });
    expect(fontActions({ writeFont: false, settings: "ask-replace" }, true, { skipSettings: false, replaceOther: true }).setLocalFont).toBe(true);
    expect(fontActions({ writeFont: false, settings: "ask-replace" }, true, { skipSettings: false, replaceOther: false })).toMatchObject({ setLocalFont: false, note: "Kept your local font; genotypes will be drawn in it." });
  });
  it("skipSettings leaves the local font alone", () => {
    expect(fontActions(set, true, { skipSettings: true, replaceOther: true })).toMatchObject({ setLocalFont: false, note: "" });
  });
});

describe("runFirstLoadOffers", () => {
  it("offers the font setup before the migration, and a font failure does not stop the migration offer", async () => {
    const order: string[] = [];
    const errors: string[] = [];
    await runFirstLoadOffers({
      font: async () => { order.push("font"); throw new Error("boom"); },
      migration: async () => { order.push("migration"); },
      record: (name) => errors.push(name),
      unloaded: () => false,
    });
    expect(order).toEqual(["font", "migration"]);
    expect(errors).toEqual(["Font setup"]);
  });
  it("waits for the font offer to finish before starting the migration offer", async () => {
    const order: string[] = [];
    await runFirstLoadOffers({
      font: async () => { await new Promise((r) => setTimeout(r, 5)); order.push("font done"); },
      migration: async () => { order.push("migration"); },
      record: () => {},
      unloaded: () => false,
    });
    expect(order).toEqual(["font done", "migration"]);
  });
  it("does not start the migration offer once the plugin is unloaded (e.g. during the font prompt)", async () => {
    const order: string[] = [];
    let unloaded = false;
    await runFirstLoadOffers({
      font: async () => { order.push("font"); unloaded = true; },
      migration: async () => { order.push("migration"); },
      record: () => {},
      unloaded: () => unloaded,
    });
    expect(order).toEqual(["font"]);
  });
});

// offerFontSetup against a fake vault and a fake Excalidraw plugin. The
// hooks live on window; in Node it is globalThis.
const hooks = globalThis as unknown as Record<string, unknown>;
hooks.window ??= globalThis;
afterEach(() => {
  for (const k of ["_flyFontAuto", "_flyFontTestMode", "_flyFontResult"]) hooks[k] = undefined;
  settingInstances.length = 0;
});

const DIR = "Excalidraw/Fonts";
const FONT = `${DIR}/${FONT_NAME}`;
const LICENSE = `${DIR}/${LICENSE_NAME}`;

function fakePlugin(opts: { font?: FlyGeneticsSettings["font"]; fontSize?: number; enabled?: boolean; current?: string; licensePresent?: boolean; noExcalidrawSettings?: boolean }) {
  const files = new Map<string, { stat: { size: number } }>();
  const folders = new Set<string>();
  if (opts.fontSize !== undefined) { folders.add("Excalidraw"); folders.add(DIR); files.set(FONT, { stat: { size: opts.fontSize } }); }
  if (opts.licensePresent) files.set(LICENSE, { stat: { size: 8 } });
  const writes: string[] = [];
  const vault = {
    getAbstractFileByPath: (p: string) => files.get(p) ?? (folders.has(p) ? { children: [] } : null),
    createFolder: vi.fn(async (p: string) => { folders.add(p); writes.push(`folder ${p}`); }),
    createBinary: vi.fn(async (p: string, b: ArrayBuffer) => { files.set(p, { stat: { size: b.byteLength } }); writes.push(`create ${p}`); }),
    modifyBinary: vi.fn(async (f: { stat: { size: number } }, b: ArrayBuffer) => { f.stat.size = b.byteLength; writes.push("modify font"); }),
    create: vi.fn(async (p: string) => { files.set(p, { stat: { size: 8 } }); writes.push(`create ${p}`); }),
    modify: vi.fn(async () => { writes.push("modify license"); }),
  };
  const xsettings: { experimentalEnableFourthFont?: boolean; experimantalFourthFont?: string } = {
    experimentalEnableFourthFont: opts.enabled ?? false,
    experimantalFourthFont: opts.current ?? "",
  };
  const excalidraw = { settings: opts.noExcalidrawSettings ? undefined : xsettings, saveSettings: vi.fn(async () => {}), initializeFonts: vi.fn(async () => {}) };
  const modals = new Set<{ close(): void }>();
  const settings: FlyGeneticsSettings = { migration: "declined", font: opts.font ?? "pending" };
  const plugin = {
    app: { vault, plugins: { plugins: { "obsidian-excalidraw-plugin": excalidraw } } },
    settings,
    saveSettings: vi.fn(async () => {}),
    testing: { modals },
    unloaded: false,
  };
  return { plugin, writes, xsettings, excalidraw, modals, settings };
}

type Fake = ReturnType<typeof fakePlugin>;
const run = (f: Fake) => offerFontSetup(f.plugin as never);
// The prompt a run opened: its Setting, most recent last.
const buttons = () => settingInstances[settingInstances.length - 1];
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("offerFontSetup", () => {
  it("does nothing once answered (done or declined is remembered)", async () => {
    for (const font of ["done", "declined"] as const) {
      const f = fakePlugin({ font });
      await run(f);
      expect(f.writes).toEqual([]);
      expect(f.modals.size).toBe(0);
      expect(f.plugin.saveSettings).not.toHaveBeenCalled();
    }
  });

  it("marks done without asking when the font is there and set", async () => {
    const f = fakePlugin({ fontSize: 4, enabled: true, current: FONT });
    await run(f);
    expect(f.writes).toEqual([]);
    expect(f.modals.size).toBe(0);
    expect(f.settings.font).toBe("done");
  });

  it("asks first: Not now writes nothing, closes the prompt and is remembered as declined", async () => {
    const f = fakePlugin({});
    const p = run(f);
    await tick();
    expect(f.modals.size).toBe(1);
    expect(f.writes).toEqual([]);
    buttons().button("Not now").click();
    await p;
    expect(f.writes).toEqual([]);
    expect(f.modals.size).toBe(0);
    expect(f.settings.font).toBe("declined");
    expect(f.plugin.saveSettings).toHaveBeenCalled();
    expect(f.excalidraw.saveSettings).not.toHaveBeenCalled();
  });

  it("closing the prompt without a button declines", async () => {
    const f = fakePlugin({});
    const p = run(f);
    await tick();
    for (const m of [...f.modals]) m.close();
    await p;
    expect(f.writes).toEqual([]);
    expect(f.settings.font).toBe("declined");
    expect(f.xsettings.experimentalEnableFourthFont).toBe(false);
  });

  it("Set up: writes folder, font and license, sets and saves the local font", async () => {
    const f = fakePlugin({});
    const p = run(f);
    await tick();
    buttons().button("Set up").click();
    await p;
    expect(f.writes).toEqual(["folder Excalidraw", `folder ${DIR}`, `create ${FONT}`, `create ${LICENSE}`]);
    expect(f.xsettings).toEqual({ experimentalEnableFourthFont: true, experimantalFourthFont: FONT });
    expect(f.excalidraw.saveSettings).toHaveBeenCalledOnce();
    expect(f.excalidraw.initializeFonts).toHaveBeenCalledOnce();
    expect(f.settings.font).toBe("done");
    expect(f.modals.size).toBe(0);
  });

  it("Set up keeps a same-size font, replaces a different-size one, and always rewrites the license", async () => {
    const same = fakePlugin({ fontSize: 4, licensePresent: true });
    const p1 = run(same);
    await tick();
    buttons().button("Set up").click();
    await p1;
    expect(same.writes).toEqual(["modify license"]);
    const other = fakePlugin({ fontSize: 99, licensePresent: true, enabled: true, current: FONT });
    const p2 = run(other);
    await tick();
    buttons().button("Set up").click();
    await p2;
    expect(other.writes).toEqual(["modify font", "modify license"]);
    expect(other.excalidraw.saveSettings).not.toHaveBeenCalled();
  });

  it("asks before replacing another local font: Keep my font leaves it, Use Computer Modern replaces it", async () => {
    for (const [answer, expected] of [["Keep my font", "Excalidraw/Fonts/mine.ttf"], ["Use Computer Modern", FONT]] as const) {
      const f = fakePlugin({ fontSize: 4, enabled: true, current: "Excalidraw/Fonts/mine.ttf" });
      const p = run(f);
      await tick();
      buttons().button("Set up").click();
      for (let i = 0; i < 20 && f.modals.size === 0; i++) await tick();
      expect(f.modals.size).toBe(1);
      buttons().button(answer).click();
      await p;
      expect(f.xsettings.experimantalFourthFont).toBe(expected);
      expect(f.excalidraw.saveSettings).toHaveBeenCalledTimes(answer === "Keep my font" ? 0 : 1);
      expect(f.settings.font).toBe("done");
      expect(f.modals.size).toBe(0);
    }
  });

  it("test hooks: answer without a prompt, into an injected folder and settings object, never Excalidraw's own", async () => {
    const f = fakePlugin({});
    const fake = { experimentalEnableFourthFont: false, experimantalFourthFont: "" };
    const saveExcalidraw = vi.fn(async () => {});
    hooks._flyFontAuto = { fontFolder: "_flygen-test/Fonts", confirm: true, settings: fake, saveExcalidraw };
    hooks._flyFontTestMode = true;
    await run(f);
    expect(f.writes).toContain(`create _flygen-test/Fonts/${FONT_NAME}`);
    expect(fake).toEqual({ experimentalEnableFourthFont: true, experimantalFourthFont: `_flygen-test/Fonts/${FONT_NAME}` });
    expect(saveExcalidraw).toHaveBeenCalledOnce();
    expect(f.xsettings.experimentalEnableFourthFont).toBe(false);
    expect(f.excalidraw.saveSettings).not.toHaveBeenCalled();
    expect(f.excalidraw.initializeFonts).not.toHaveBeenCalled();
    expect(hooks._flyFontResult).toMatchObject({ wroteFont: true, declined: false });
  });

  it("test hooks: confirm false declines", async () => {
    const f = fakePlugin({});
    hooks._flyFontAuto = { fontFolder: "_flygen-test/Fonts", confirm: false, skipSettings: true };
    hooks._flyFontTestMode = true;
    await run(f);
    expect(f.writes).toEqual([]);
    expect(hooks._flyFontResult).toMatchObject({ declined: true });
  });

  it("a stray _flyFontAuto without the test-mode flag is ignored (and cleared): it never writes without asking", async () => {
    const f = fakePlugin({ font: "declined" });
    hooks._flyFontAuto = { fontFolder: "_flygen-test/Fonts", confirm: true, skipSettings: true };
    await run(f);
    expect(f.writes).toEqual([]);
    expect(hooks._flyFontAuto).toBeUndefined();
    const g = fakePlugin({});
    hooks._flyFontAuto = { fontFolder: "_flygen-test/Fonts", confirm: true, skipSettings: true };
    const p = run(g);
    await tick();
    expect(g.modals.size).toBe(1); // asks as on any first load
    expect(g.writes).toEqual([]);
    buttons().button("Not now").click();
    await p;
    expect(g.writes).toEqual([]);
  });

  it("unloading during the first prompt is not an answer: nothing is written or saved, the offer stays pending", async () => {
    const f = fakePlugin({});
    const p = run(f);
    await tick();
    f.plugin.unloaded = true; // as onunload does, before closeModals
    for (const m of [...f.modals]) m.close();
    await p;
    expect(f.writes).toEqual([]);
    expect(f.settings.font).toBe("pending");
    expect(f.plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("unloading during the replace question leaves the local font alone and saves nothing", async () => {
    const f = fakePlugin({ fontSize: 4, enabled: true, current: "Excalidraw/Fonts/mine.ttf" });
    const p = run(f);
    await tick();
    buttons().button("Set up").click();
    for (let i = 0; i < 20 && f.modals.size === 0; i++) await tick();
    f.plugin.unloaded = true;
    for (const m of [...f.modals]) m.close();
    await p;
    expect(f.xsettings.experimantalFourthFont).toBe("Excalidraw/Fonts/mine.ttf");
    expect(f.excalidraw.saveSettings).not.toHaveBeenCalled();
    expect(f.settings.font).toBe("pending");
    expect(f.plugin.saveSettings).not.toHaveBeenCalled();
  });

  it("without an Excalidraw settings object: files only, no local-font step, no success Notice", async () => {
    const f = fakePlugin({ noExcalidrawSettings: true });
    const p = run(f);
    await tick();
    buttons().button("Set up").click();
    await p;
    expect(f.writes).toContain(`create ${FONT}`);
    expect(f.excalidraw.saveSettings).not.toHaveBeenCalled();
    expect(f.excalidraw.initializeFonts).not.toHaveBeenCalled();
    expect(hooks._flyFontResult).toMatchObject({ note: "", declined: false });
    expect(f.settings.font).toBe("done");
  });

  it("test mode keeps the answer in memory and never writes the plugin's data.json", async () => {
    for (const confirm of [true, false]) {
      const f = fakePlugin({});
      hooks._flyFontAuto = { fontFolder: "_flygen-test/Fonts", confirm, skipSettings: true };
      hooks._flyFontTestMode = true;
      await run(f);
      expect(f.settings.font).toBe(confirm ? "done" : "declined");
      expect(f.plugin.saveSettings).not.toHaveBeenCalled();
    }
  });

  it("test mode refuses to run against Excalidraw's own settings or the default folder", async () => {
    const f = fakePlugin({});
    hooks._flyFontAuto = { fontFolder: "_flygen-test/Fonts", confirm: true };
    hooks._flyFontTestMode = true;
    await expect(run(f)).rejects.toThrow(/settings/);
    hooks._flyFontAuto = { confirm: true, skipSettings: true };
    hooks._flyFontTestMode = true;
    await expect(run(f)).rejects.toThrow(/fontFolder/);
    expect(f.writes).toEqual([]);
  });
});
