import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SceneElement } from "../../src/schema";

// The orchestration of src/operation/index.ts against a fake view, API and
// EA: the registry, stale drawings, started children and the final commit.

type Update = { elements?: SceneElement[]; appState?: Record<string, unknown>; captureUpdate?: string };

function fakeView(file: object) {
  let scene: SceneElement[] = [];
  let appState: Record<string, unknown> = { selectedElementIds: {}, selectedGroupIds: {} };
  const updates: Update[] = [];
  const api = {
    getSceneElements: () => scene.filter((e) => !e.isDeleted),
    getSceneElementsIncludingDeleted: () => scene,
    getAppState: () => appState,
    updateScene(u: Update) {
      updates.push(u);
      if (u.elements) {
        const given = new Set(u.elements.map((e) => e.id));
        // Excalidraw marks elements left out as deleted, one version up;
        // new elements without an index get one.
        const left = scene.filter((e) => !given.has(e.id)).map((e) => ({ ...e, isDeleted: true, version: (e.version ?? 0) + 1 }));
        scene = [...u.elements.map((e, i) => ({ ...e, index: e.index === null ? `n${i}` : e.index })), ...left];
      }
      if (u.appState) appState = { ...appState, ...u.appState };
    },
  };
  const win = { setTimeout, clearTimeout, requestAnimationFrame: (f: () => void) => setTimeout(f, 0) };
  const view = { file, excalidrawAPI: api, updateScene: (u: Update) => api.updateScene(u), contentEl: {}, containerEl: { win }, getViewType: () => "excalidraw" };
  return { view, api, updates, set: (els: SceneElement[]) => { scene = els; } };
}

function fakeEA(view: ReturnType<typeof fakeView>["view"]) {
  const ea = {
    elementsDict: {} as Record<string, SceneElement>,
    clear() { ea.elementsDict = {}; },
    verifyMinimumPluginVersion: () => true,
    getElement: (id: string) => ea.elementsDict[id],
    copyViewElementsToEAforEditing(els: SceneElement[]) { for (const e of els) ea.elementsDict[e.id] = structuredClone(e); },
    add(id: string, patch: Partial<SceneElement> = {}) { ea.elementsDict[id] = { id, type: "text", x: 0, y: 0, width: 1, height: 1, version: 1, index: null, ...patch }; },
    async addElementsToView(_r: boolean, _s: boolean, _top: boolean, _restore: boolean, captureUpdate: string) {
      const cur = view.excalidrawAPI.getSceneElementsIncludingDeleted();
      const byId = new Map(cur.map((e) => [e.id, e]));
      const mine = Object.values(ea.elementsDict).map((e) => ({ ...e, version: Math.max(e.version ?? 0, byId.get(e.id)?.version ?? 0) + 1 }));
      const ids = new Set(mine.map((e) => e.id));
      view.excalidrawAPI.updateScene({ elements: [...cur.filter((e) => !ids.has(e.id)), ...mine], captureUpdate });
      return true;
    },
  };
  return ea;
}

type Op = typeof import("../../src/operation");
let op: Op;
beforeAll(async () => {
  (globalThis as unknown as { window: unknown }).window = globalThis;
  op = await import("../../src/operation");
});

const el = (id: string, patch: Partial<SceneElement> = {}): SceneElement =>
  ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, version: 1, index: `a${id}`, ...patch });

function setup(track: (name: string, work: () => Promise<unknown>) => Promise<void> = async (_n, work) => { await work(); }) {
  const fv = fakeView({ path: "A" });
  fv.set([el("1"), el("2")]);
  const errors: string[] = [];
  const env = {
    newEA: () => fakeEA(fv.view) as never,
    reportError: (name: string, e: unknown) => { errors.push(`${name}: ${(e as Error).message}`); },
    track,
  };
  const view = fv.view as never;
  const run = <T>(name: string, body: (ctx: import("../../src/operation").OperationContext) => Promise<T>) => op.runOperation({} as never, env, view, name, body);
  const recorded = () => fv.updates.filter((u) => u.captureUpdate === "IMMEDIATELY");
  const unlabeled = () => fv.updates.filter((u) => u.captureUpdate !== "NEVER" && u.captureUpdate !== "IMMEDIATELY" && u.elements);
  return { fv, view, run, errors, recorded, unlabeled };
}
const addText = async (ctx: import("../../src/operation").OperationContext, id: string) => {
  const ea = ctx.ea as unknown as ReturnType<typeof fakeEA>;
  ea.clear(); ea.add(id); await ctx.commit(); ea.clear();
};
const live = (fv: ReturnType<typeof fakeView>) => fv.api.getSceneElements().map((e) => e.id).sort();

describe("runOperation", () => {
  it("records nested writes (a patch, a joined and a started child) as exactly one step", async () => {
    const s = setup();
    let child: Promise<unknown> | undefined;
    await s.run("Parent", async (ctx) => {
      await ctx.commitPatches(new Map([["1", { x: 5 }]]));
      await addText(ctx, "p");
      await ctx.join("Joined", async (c) => { await addText(c, "j"); });
      child = ctx.start("Started", async (c) => { await addText(c, "s"); await c.deleteElements([s.fv.api.getSceneElements().find((e) => e.id === "2") as SceneElement]); return "done"; });
    });
    expect(await child).toBe("done");
    await vi.waitFor(() => expect(op.openOperation(s.view)).toBeUndefined());
    expect(s.recorded()).toHaveLength(1);
    expect(s.unlabeled()).toHaveLength(0);
    const step = s.recorded()[0].elements ?? [];
    expect(step.filter((e) => !e.isDeleted).map((e) => e.id).sort()).toEqual(["1", "j", "p", "s"]);
    expect(step.find((e) => e.id === "2")?.isDeleted).toBe(true);
    expect(step.find((e) => e.id === "1")?.x).toBe(5);
    expect(live(s.fv)).toEqual(["1", "j", "p", "s"]);
    expect(s.errors).toEqual([]);
    // The registry is the plugin's own, never the scripts' window global.
    expect((globalThis as Record<string, unknown>)._flyOperations).toBeUndefined();
  });

  it("records nothing for an operation that changes no element", async () => {
    const s = setup();
    await s.run("Select", async (ctx) => { ctx.selectElements(["1"]); });
    await vi.waitFor(() => expect(op.openOperation(s.view)).toBeUndefined());
    expect(s.recorded()).toHaveLength(0);
  });

  it("goes stale when the view shows another drawing: no write, nothing recorded", async () => {
    const s = setup();
    const r = await s.run("Stale", async (ctx) => {
      await addText(ctx, "p");
      s.fv.view.file = { path: "B" };
      const before = s.fv.updates.length;
      await expect(addText(ctx, "q")).rejects.toThrow("scene change outside an open operation");
      expect(s.fv.updates.length).toBe(before);
      expect(op.openOperation(s.view)).toBeUndefined();
      return "ok";
    });
    expect(r).toBe("ok");
    await new Promise((res) => setTimeout(res, 150));
    expect(s.recorded()).toHaveLength(0);
    expect(live(s.fv)).toEqual(["1", "2", "p"]);
  });

  it("keeps the operation open until a started child ends, and resolves with its result", async () => {
    const s = setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    let started: Promise<unknown> | undefined;
    await s.run("Parent", async (ctx) => {
      await addText(ctx, "p");
      started = ctx.start("Child", async (c) => { await gate; await addText(c, "c"); return 42; });
    });
    await new Promise((res) => setTimeout(res, 150));
    expect(op.openOperation(s.view)).toBeDefined();
    expect(s.recorded()).toHaveLength(0);
    release();
    expect(await started).toBe(42);
    await vi.waitFor(() => expect(op.openOperation(s.view)).toBeUndefined());
    expect(s.recorded()).toHaveLength(1);
  });

  it("a started child is tracked as in flight before its body starts running", async () => {
    const tracking = new Set<string>();
    const s = setup(async (name, work) => {
      tracking.add(name);
      try { await work(); } finally { tracking.delete(name); }
    });
    let trackedAtStart: boolean | undefined;
    let started: Promise<unknown> | undefined;
    await s.run("Parent", async (ctx) => {
      await addText(ctx, "p");
      started = ctx.start("Child", async (c) => { trackedAtStart = tracking.has("Child"); await addText(c, "c"); return 7; });
    });
    expect(await started).toBe(7);
    expect(trackedAtStart).toBe(true);
    await vi.waitFor(() => expect(tracking.size).toBe(0));
  });

  it("start returns skipped and runs nothing when the drawing left the view", async () => {
    const s = setup();
    let ran = false;
    let started: (Promise<unknown> & { skipped?: true }) | undefined;
    await s.run("Parent", async (ctx) => {
      await addText(ctx, "p");
      s.fv.view.file = { path: "B" };
      started = ctx.start("Child", async () => { ran = true; });
    });
    expect(started?.skipped).toBe(true);
    expect(await started).toBeUndefined();
    expect(ran).toBe(false);
  });

  it("a started child's failure puts back its own change, is reported under its name and not thrown to the parent", async () => {
    const s = setup();
    const r = await s.run("Parent", async (ctx) => {
      await addText(ctx, "p");
      const res = await ctx.start("Child", async (c) => { await addText(c, "c"); throw new Error("boom"); });
      return res === undefined ? "parent-ok" : "unexpected";
    });
    await vi.waitFor(() => expect(op.openOperation(s.view)).toBeUndefined());
    expect(r).toBe("parent-ok");
    expect(s.errors).toEqual(["Child: boom"]);
    expect(live(s.fv)).toEqual(["1", "2", "p"]);
    expect(s.recorded()).toHaveLength(1);
  });

  it("a failing command is rolled back, reported once and resolves to undefined", async () => {
    const s = setup();
    const r = await s.run("Fails", async (ctx) => { await addText(ctx, "p"); throw new Error("nope"); });
    await vi.waitFor(() => expect(op.openOperation(s.view)).toBeUndefined());
    expect(r).toBeUndefined();
    expect(s.errors).toEqual(["Fails: nope"]);
    expect(live(s.fv)).toEqual(["1", "2"]);
    expect(s.recorded()).toHaveLength(0);
  });
});
