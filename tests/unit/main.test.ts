import { afterEach, describe, expect, it, vi } from "vitest";

// The plugin's load/unload wiring (src/main.ts) against a fake Plugin base:
// the layout-ready callback and onunload.
const { checkExcalidraw, runFirstLoadOffers, layoutReady } = vi.hoisted(() => ({
  checkExcalidraw: vi.fn(() => ({ ok: true, message: "" })),
  runFirstLoadOffers: vi.fn(async () => undefined),
  layoutReady: [] as (() => void)[],
}));
vi.mock("obsidian", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Plugin: class {
    app = { workspace: { onLayoutReady: (f: () => void) => { layoutReady.push(f); } } };
    async loadData(): Promise<unknown> { return null; }
    async saveData(): Promise<void> { /* not saved in these tests */ }
  },
}));
vi.mock("../../src/commands", () => ({ registerCommands: vi.fn() }));
vi.mock("../../src/excalidraw/version", () => ({ checkExcalidraw }));
vi.mock("../../src/first-load", () => ({ runFirstLoadOffers }));

import FlyGeneticsPlugin from "../../src/main";

const hooks = globalThis as unknown as Record<string, unknown>;
hooks.window ??= globalThis;

const newPlugin = () => new (FlyGeneticsPlugin as unknown as new () => FlyGeneticsPlugin)();

afterEach(() => {
  layoutReady.length = 0;
  checkExcalidraw.mockClear();
  runFirstLoadOffers.mockClear();
  hooks._flyCrossMode = undefined;
  vi.restoreAllMocks();
});

describe("FlyGeneticsPlugin", () => {
  it("runs the first-load offers when the layout is ready", async () => {
    const p = newPlugin();
    await p.onload();
    expect(layoutReady).toHaveLength(1);
    layoutReady[0]();
    expect(checkExcalidraw).toHaveBeenCalledTimes(1);
    expect(runFirstLoadOffers).toHaveBeenCalledTimes(1);
  });

  it("a layout-ready callback that fires after unload does nothing", async () => {
    const p = newPlugin();
    await p.onload();
    p.onunload();
    layoutReady[0]();
    expect(checkExcalidraw).not.toHaveBeenCalled();
    expect(runFirstLoadOffers).not.toHaveBeenCalled();
  });

  it("unload still closes the plugin's prompts when stopping Cross Mode throws", async () => {
    const p = newPlugin();
    await p.onload();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    hooks._flyCrossMode = { stop: () => { throw new Error("stop failed"); }, view: null };
    const modal = { close: vi.fn() };
    p.testing.modals.add(modal as never);
    expect(() => p.onunload()).not.toThrow();
    expect(modal.close).toHaveBeenCalledTimes(1);
    expect(p.testing.modals.size).toBe(0);
    expect(p.testing.errors).toEqual(["Cross Mode: stop failed"]);
  });
});
