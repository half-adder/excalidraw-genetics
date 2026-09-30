// ---- Undo-safe operations ----------------------------------------------------
// Every change a command makes to the drawing belongs to an operation, and an
// operation is ONE undo step, however many scene updates it makes and however
// many commands it runs (Cross Genotypes starts Tidy; Tidy Below starts Select
// Below and Tidy; Cross Mode starts Genotype and Cross Genotypes). Ported from
// the "Undo-safe operations" block of the scripts. Design:
// docs/plans/2026-09-29-undo-safe-design.md.
//
// runOperation(app, env, view, name, body) runs body as part of the drawing's
// open operation, or opens one. Scene updates inside it are left out of
// Excalidraw's undo history (ctx.commit, ctx.commitPatches and
// ctx.deleteElements commit with captureUpdate NEVER). When the last command
// of the operation has finished, finish records the whole operation as one
// undo step, from the drawing as it was at the operation's first change (so a
// form open before then is not part of it) to the drawing now: it puts the
// "before" elements back unrecorded, then the "after" elements recorded
// (versions raised so Excalidraw sees both; elements the operation removed
// stay in place as deleted, so undo restores the z-order exactly). Undo
// restores the drawing as it was; redo re-applies the operation in one step.
// An operation that changes no element records nothing and leaves nothing
// pending for the user's next action. A command that throws has the elements
// it changed put back, unless changed since by someone else (the rest of the
// operation stands). An operation whose view has moved on to another drawing
// records and writes nothing more.
//
// Rules (tests/unit/write-guard.test.ts checks the first): no module outside
// src/operation writes the scene or touches the history; change elements
// only with ctx.commit / ctx.commitPatches (delete by setting isDeleted, or
// with ctx.deleteElements); start another command only with ctx.start (or
// ctx.join); select only with ctx.selectElements (or setAppState); take a
// user's own step out of the history only with unrecordLastStep.

import { Notice, type App, type TFile } from "obsidian";
import type { AppStateLike, EA, ExcalidrawViewLike } from "../excalidraw/ea";
import { EXCALIDRAW_MIN_VERSION } from "../excalidraw/version";
import type { SceneElement } from "../schema";
import { writable, writableEA, type WritableView } from "./excalidraw";
import { planFinish, planRollback, raise, recordWrite, type Saved } from "./pure";

export { planFinish, planRollback, raise, recordWrite, sameDrawn, type FinishPlan, type Saved } from "./pure";

export interface OperationEnv {
  newEA(view: ExcalidrawViewLike): EA;
  // A command that failed (its own changes already put back).
  reportError(name: string, error: unknown): void;
  // Runs a command started by ctx.start as an in-flight command (the tests
  // wait for it): `work` starts the command, so tracking begins before it
  // runs.
  track(name: string, work: () => Promise<unknown>): Promise<void>;
}

export type ElementPatch = Partial<SceneElement>;

type Selection = Pick<AppStateLike, "selectedElementIds" | "selectedGroupIds">;

// What ctx.start returns: resolves when the started command has ended, with
// its result (undefined if it failed, or did not start within 15 s).
// `skipped`: the operation's drawing had left the view, nothing was started.
export type Started<T> = Promise<T | undefined> & { skipped?: true };

export interface OperationContext {
  readonly name: string;
  readonly app: App;
  readonly view: ExcalidrawViewLike;
  // This command's own EA instance (its own workbench), bound to the view.
  readonly ea: EA;
  // Commits the EA workbench, new elements on top (as
  // ea.addElementsToView(false, false, true)), unrecorded.
  commit(): Promise<void>;
  // Commits `patches` (by element id, applied to copies of the view's
  // elements) and `added` (new elements, in order), through a cleared
  // workbench, which is cleared again after.
  commitPatches(patches: ReadonlyMap<string, ElementPatch>, added?: readonly SceneElement[]): Promise<void>;
  // Marks view elements deleted in place, unrecorded. Unlike commit it does
  // not refresh arrows, so arrows bound to them can be re-bound afterwards.
  deleteElements(elements: readonly SceneElement[]): Promise<void>;
  // updateScene({ appState }) as the scripts did (no captureUpdate).
  setAppState(appState: Partial<AppStateLike>): void;
  // Selects elements (or ids) with the groups they are in, as a click would,
  // unrecorded (the scripts' flySelect; ea.selectElementsInView records a
  // step of its own).
  selectElements(elements: ReadonlyArray<SceneElement | string | null | undefined>): void;
  // Starts another command as part of this operation, without waiting (the
  // scripts' flyStart): the operation stays open until it has ended. Its
  // failure is put back and reported under its own name, not thrown here.
  start<T>(name: string, body: (ctx: OperationContext) => Promise<T>): Started<T>;
  // Runs another command as part of this operation and waits for it. A
  // failure puts back that command's own changes and is re-thrown here (not
  // reported: whoever catches it reports it). Resolves to undefined, running
  // nothing, if the operation's drawing has left the view.
  join<T>(name: string, body: (ctx: OperationContext) => Promise<T>): Promise<T | undefined>;
}

// ---- The registry ------------------------------------------------------------

interface Expected {
  name: string;
  ended(result: unknown): void;
  timer: number;
}

interface Operation {
  view: WritableView;
  file: TFile | null;
  done: boolean;
  running: number;
  expected: Expected[];
  before: SceneElement[] | null;
  // Per command (its EA): what its writes changed (see Saved).
  parts: Map<EA, Map<string, Saved>>;
  selection: Selection;
}

// The open operation of each view, as the scripts' window._flyOperations,
// but the plugin's own (never published on window, where the scripts keep
// theirs; the tests read it through openOperation, via plugin.testing). An
// operation belongs to the drawing (file) its view showed when it opened:
// see stale().
const operations = new WeakMap<ExcalidrawViewLike, Operation>();

// The view's open operation (for Cross Mode's and the tests' checks).
export function openOperation(view: ExcalidrawViewLike): unknown {
  const op = operations.get(view);
  return op && !op.done ? op : undefined;
}

const START_TIMEOUT_MS = 15000;
const FRAME_TIMEOUT_MS = 100;
const nonce = () => Math.floor(Math.random() * 2 ** 31);

// Whether the plugin can leave scene updates out of the history
// (addElementsToView takes captureUpdate since 2.20.2); says so if not.
export function operationSupported(ea: EA): boolean {
  if (ea.verifyMinimumPluginVersion?.(EXCALIDRAW_MIN_VERSION)) return true;
  new Notice(`Fly Genetics needs Excalidraw plugin ${EXCALIDRAW_MIN_VERSION} or newer.`);
  return false;
}

// Whether the operation's view now shows another drawing (Obsidian reuses a
// view when a tab opens another file). Such an operation is ended: it
// writes and records nothing more.
function stale(op: Operation): boolean {
  if (op.view.file === op.file) return false;
  op.done = true;
  if (operations.get(op.view) === op) operations.delete(op.view);
  return true;
}

// The view's open operation, or a new one.
function current(view: WritableView): Operation {
  let op = operations.get(view);
  if (op && !op.done && stale(op)) op = undefined;
  if (!op || op.done) {
    const st = view.excalidrawAPI.getAppState();
    op = {
      view, file: view.file, done: false, running: 0, expected: [], before: null, parts: new Map(),
      selection: { selectedElementIds: { ...st.selectedElementIds }, selectedGroupIds: { ...st.selectedGroupIds } },
    };
    operations.set(view, op);
  }
  return op;
}

// ---- Running commands in an operation --------------------------------------------

// A top-level command: runs `body` in the view's open operation (or a new
// one). A failure is put back (the command's own changes), reported with
// env.reportError and resolves to undefined.
export function runOperation<T>(app: App, env: OperationEnv, view: ExcalidrawViewLike, name: string, body: (ctx: OperationContext) => Promise<T>): Promise<T | undefined> {
  return operate(app, env, writable(view), name, body, null, null, false);
}

async function operate<T>(app: App, env: OperationEnv, view: WritableView, name: string, body: (ctx: OperationContext) => Promise<T>,
  parent: Operation | null, entry: Expected | null, rethrow: boolean): Promise<T | undefined> {
  const ea = env.newEA(view);
  if (!view.excalidrawAPI) {
    // No scene to change: run without an operation (a write would throw).
    try {
      return await body(new Context(app, env, view, name, ea, null));
    } catch (e) {
      if (rethrow) throw e;
      env.reportError(name, e);
      return undefined;
    }
  }
  if (!operationSupported(ea)) {
    entry?.ended(undefined);
    return undefined;
  }
  const op = parent && !parent.done ? parent : current(view);
  if (entry) {
    const i = op.expected.indexOf(entry);
    if (i >= 0) {
      op.expected.splice(i, 1);
      window.clearTimeout(entry.timer);
    } else entry = null;   // not started in time: already ended
  }
  op.running++;
  let result: T | undefined;
  try {
    result = await body(new Context(app, env, view, name, ea, op));
    return result;
  } catch (e) {
    rollback(op, ea);
    if (rethrow) throw e;
    env.reportError(name, e);
    return undefined;
  } finally {
    op.running--;
    entry?.ended(result);
    await finish(op);
  }
}

// Puts back what the command with this EA changed (as it was before its
// first change), except elements changed since by someone else, unrecorded.
function rollback(op: Operation, ea: EA): void {
  const saved = op.parts.get(ea);
  if (!saved || stale(op)) return;
  const back = planRollback(op.view.excalidrawAPI.getSceneElementsIncludingDeleted(), saved, nonce);
  op.view.updateScene({ elements: back, appState: {}, captureUpdate: "NEVER" });
}

class Context implements OperationContext {
  constructor(
    readonly app: App,
    private readonly env: OperationEnv,
    readonly view: WritableView,
    readonly name: string,
    readonly ea: EA,
    // The operation this command joined; its writes are refused unless it
    // is still the view's open one.
    private readonly op: Operation | null,
  ) {}

  // Runs `write` (a scene update) as part of this command's operation, which
  // must still be the view's open one. The first write takes the scene as
  // the operation's "before"; the command keeps what its writes changed, to
  // put back if it throws.
  private async writing<R>(write: () => R | Promise<R>): Promise<R> {
    const op = this.op;
    if (!op || op.done || stale(op) || operations.get(this.view) !== op) throw new Error("scene change outside an open operation");
    const api = this.view.excalidrawAPI;
    const pre = structuredClone(api.getSceneElementsIncludingDeleted());
    op.before ??= pre;
    const result = await write();
    let saved = op.parts.get(this.ea);
    if (!saved) op.parts.set(this.ea, (saved = new Map()));
    recordWrite(saved, pre, api.getSceneElementsIncludingDeleted());
    return result;
  }

  // The commit ends with Excalidraw re-fitting bound text and arrows
  // (updateContainerSize, refreshAllArrows), which record a step of their
  // own when they change something; quietly keeps them unrecorded.
  async commit(): Promise<void> {
    const api = this.view.excalidrawAPI;
    const { refreshAllArrows, updateContainerSize } = api;
    if (refreshAllArrows) api.refreshAllArrows = (...a) => quietly(this.view, () => refreshAllArrows.apply(api, a));
    if (updateContainerSize) api.updateContainerSize = (...a) => quietly(this.view, () => updateContainerSize.apply(api, a));
    try {
      await this.writing(() => writableEA(this.ea).addElementsToView(false, false, true, false, "NEVER"));
    } finally {
      Object.assign(api, { refreshAllArrows, updateContainerSize });
    }
  }

  async commitPatches(patches: ReadonlyMap<string, ElementPatch>, added: readonly SceneElement[] = []): Promise<void> {
    const ea = this.ea;
    ea.clear();
    for (const el of added) ea.elementsDict[el.id] = structuredClone(el);
    const viewEls = new Map(this.view.excalidrawAPI.getSceneElements().map((el) => [el.id, el]));
    for (const [id, patch] of patches) {
      if (!ea.elementsDict[id]) {
        const viewEl = viewEls.get(id);
        if (!viewEl) throw new Error(`commitPatches: no element ${id} in the drawing`);
        ea.copyViewElementsToEAforEditing([viewEl]);
      }
      const el = ea.getElement(id);
      if (!el) throw new Error(`commitPatches: element ${id} not in the workbench`);
      Object.assign(el, patch);
    }
    await this.commit();
    ea.clear();
  }

  async deleteElements(elements: readonly SceneElement[]): Promise<void> {
    const view = this.view, ids = new Set(elements.map((el) => el.id));
    await this.writing(() => view.updateScene({
      elements: view.excalidrawAPI.getSceneElementsIncludingDeleted().map((el) => !ids.has(el.id) ? el
        : { ...el, isDeleted: true, version: (el.version ?? 0) + 1, versionNonce: nonce() }),
      captureUpdate: "NEVER",
    }));
  }

  setAppState(appState: Partial<AppStateLike>): void {
    setAppState(this.view, appState);
  }

  selectElements(elements: ReadonlyArray<SceneElement | string | null | undefined>): void {
    const view = this.view, all = view.excalidrawAPI.getSceneElements();
    const ids = new Set(elements.filter((el): el is SceneElement | string => !!el).map((el) => typeof el === "string" ? el : el.id));
    const selectedGroupIds: Record<string, boolean> = {}, selectedElementIds: Record<string, boolean> = {};
    for (const el of all) if (ids.has(el.id) && el.groupIds?.length) selectedGroupIds[el.groupIds[el.groupIds.length - 1]] = true;
    for (const el of all) if (ids.has(el.id) || el.groupIds?.some((g) => selectedGroupIds[g])) selectedElementIds[el.id] = true;
    view.updateScene({ appState: { selectedElementIds, selectedGroupIds, editingGroupId: null }, captureUpdate: "NEVER" });
  }

  start<T>(name: string, body: (ctx: OperationContext) => Promise<T>): Started<T> {
    const op = this.op;
    // The operation's drawing is no longer in the view: start nothing.
    if (op && !op.done && stale(op)) return Object.assign(Promise.resolve(undefined), { skipped: true as const });
    let ended: Promise<T | undefined> | null = null;
    let entry: Expected | null = null;
    if (op && !op.done) {
      let resolve: (v: T | undefined) => void = () => undefined;
      ended = new Promise((r) => { resolve = r; });
      const e: Expected = { name, ended: (v) => resolve(v as T | undefined), timer: 0 };
      e.timer = window.setTimeout(() => {
        const i = op.expected.indexOf(e);
        if (i < 0) return;
        op.expected.splice(i, 1);
        e.ended(undefined);
        finish(op).catch((err) => console.error("Fly Genetics: ending the operation failed", err));
      }, START_TIMEOUT_MS);
      op.expected.push(e);
      entry = e;
    }
    // The child runs inside env.track's work, so it is tracked as in flight
    // before its body starts (a test waiting for idle never misses it).
    const parent = op && !op.done ? op : null;
    let settle: (r: T | undefined) => void = () => undefined;
    const child = new Promise<T | undefined>((r) => { settle = r; });
    this.env.track(name, async () => {
      try {
        const r = await operate(this.app, this.env, this.view, name, body, parent, entry, false);
        settle(r);
        return r;
      } catch (e) {
        settle(undefined);
        throw e;
      }
    }).catch((err) => { settle(undefined); console.error(`Fly Genetics: ${name}:`, err); });
    return ended ?? child;
  }

  async join<T>(name: string, body: (ctx: OperationContext) => Promise<T>): Promise<T | undefined> {
    const op = this.op;
    if (op && !op.done && stale(op)) return undefined;
    return operate(this.app, this.env, this.view, name, body, op && !op.done ? op : null, null, true);
  }
}

// updateScene({ appState }) with no elements and no captureUpdate, as the
// scripts did for selections outside a flySelect (e.g. Cross Mode's
// deselect before a Genotype form, outside an operation).
export function setAppState(view: ExcalidrawViewLike, appState: Partial<AppStateLike>): void {
  writable(view).excalidrawAPI.updateScene({ appState });
}

// ---- Excalidraw's own captures --------------------------------------------------

// Runs `change`, an Excalidraw call that changes elements in place and asks
// for its change to be recorded, and keeps it out of the history: the next
// store commit records the change from the scene before `change` to the
// scene then, so that commit is made with the elements and selection as
// they were before (nothing to record), then the changed elements are put
// back, unrecorded.
function quietly<R>(view: WritableView, change: () => R): R {
  const api = view.excalidrawAPI;
  // The selection as the store will see it (live elements only), settled.
  const st = api.getAppState(), live = new Set(api.getSceneElements().map((el) => el.id));
  const selection: Selection = {
    selectedElementIds: Object.fromEntries(Object.entries(st.selectedElementIds).filter(([id, on]) => on && live.has(id))),
    selectedGroupIds: { ...st.selectedGroupIds },
  };
  view.updateScene({ elements: api.getSceneElementsIncludingDeleted(), appState: selection, captureUpdate: "NEVER" });
  // A NEVER update takes into the store only what it changes, so a selection
  // change still pending (made without captureUpdate) would be recorded by
  // that commit: settle it by selecting something else, then it, unrecorded.
  const other: Selection = {
    selectedElementIds: Object.keys(selection.selectedElementIds).length ? {} : Object.fromEntries([...live].slice(0, 1).map((id) => [id, true])),
    selectedGroupIds: Object.keys(selection.selectedGroupIds).length ? {} : { "fly-settle": true },
  };
  view.updateScene({ appState: other, captureUpdate: "NEVER" });
  view.updateScene({ appState: selection, captureUpdate: "NEVER" });
  const pre = new Map(api.getSceneElementsIncludingDeleted().map((el) => [el.id, structuredClone(el)]));
  const result = change();
  const post = api.getSceneElementsIncludingDeleted();
  const moved = new Map(post.filter((el) => pre.get(el.id)?.version !== el.version).map((el) => [el.id, structuredClone(el)]));
  if (!moved.size) return result;
  const top = new Map(post.map((el) => [el.id, el.version ?? 0]));
  const v = (id: string) => top.get(id) ?? 0;
  view.updateScene({
    elements: post.filter((el) => pre.has(el.id) || !moved.has(el.id))
      .map((el) => moved.has(el.id) ? { ...(pre.get(el.id) as SceneElement), version: v(el.id) + 1, versionNonce: nonce() } : el),
    appState: selection, captureUpdate: "NEVER",
  });
  view.updateScene({
    elements: [
      ...api.getSceneElementsIncludingDeleted().map((el) => { const m = moved.get(el.id); return m ? { ...m, version: v(el.id) + 2, versionNonce: nonce() } : el; }),
      ...[...moved.values()].filter((el) => !pre.has(el.id)).map((el) => ({ ...el, version: v(el.id) + 2, versionNonce: nonce() })),
    ],
    appState: selection, captureUpdate: "NEVER",
  });
  return result;
}

// ---- Ending an operation ----------------------------------------------------------

// Waits for the view's next rendered frame (at most 100 ms: a hidden window
// renders no frames). The view's own window, for popouts.
function frame(view: ExcalidrawViewLike | null | undefined): Promise<void> {
  const win = view?.containerEl?.win ?? window;
  return new Promise((r) => {
    const t = win.setTimeout(r, FRAME_TIMEOUT_MS);
    win.requestAnimationFrame(() => { win.clearTimeout(t); win.setTimeout(r, 0); });
  });
}

// Ends the operation once no command is running in it or expected to join:
// records it as one undo step, or, if no element changed, records nothing
// and settles what is pending (a selection change). If a step fails, the
// drawing as the operation left it is put back, unrecorded, and the error
// is re-thrown.
async function finish(op: Operation): Promise<void> {
  if (op.done || op.running || op.expected.length) return;
  await frame(op.view);   // let Excalidraw settle
  if (op.done || op.running || op.expected.length || stale(op)) return;
  op.done = true;
  if (operations.get(op.view) === op) operations.delete(op.view);
  const api = op.view.excalidrawAPI;
  if (!api) return;
  const now = api.getSceneElementsIncludingDeleted(), st = api.getAppState();
  const selection: Selection = { selectedElementIds: st.selectedElementIds, selectedGroupIds: st.selectedGroupIds };
  const plan = planFinish(op.before, now, nonce);
  if (!plan.changed) {
    op.view.updateScene({ elements: now, appState: selection, captureUpdate: "NEVER" });
    return;
  }
  try {
    op.view.updateScene({ elements: plan.first, appState: selection, captureUpdate: "NEVER" });
    const index = new Map(api.getSceneElementsIncludingDeleted().map((el) => [el.id, el.index]));
    op.view.updateScene({ elements: plan.second, appState: op.selection, captureUpdate: "NEVER" });
    op.view.updateScene({ elements: plan.third(index), appState: selection, captureUpdate: "IMMEDIATELY" });
  } catch (e) {
    const cur = new Map(api.getSceneElementsIncludingDeleted().map((el) => [el.id, el]));
    op.view.updateScene({ elements: now.map((el) => raise(el, cur.get(el.id), 4, nonce)), appState: selection, captureUpdate: "NEVER" });
    throw e;
  }
}

// ---- Cross Mode's line ------------------------------------------------------------

// Takes the element `elementId`, which the user has just drawn as their own
// undo step, back out of the drawing and out of the history by undoing that
// step (a redo can bring it back only until the next recorded change).
// Returns false, changing nothing, if that step held more than the element
// or Excalidraw is older than 2.20.2 (checked before any history change).
// Call it before the operation that replaces the element starts.
export async function unrecordLastStep(view: ExcalidrawViewLike, elementId: string): Promise<boolean> {
  const global = (window as unknown as { ExcalidrawAutomate?: EA }).ExcalidrawAutomate;
  if (!global?.verifyMinimumPluginVersion?.(EXCALIDRAW_MIN_VERSION)) return false;
  const api = writable(view).excalidrawAPI, history = api?.history;
  if (!history?.undo) return false;
  const others = (els: readonly SceneElement[]) => els.filter((el) => el.id !== elementId).map((el) => `${el.id}:${el.version}`).join("|");
  const was = others(api.getSceneElementsIncludingDeleted());
  history.undo();
  await frame(view);
  const now = api.getSceneElementsIncludingDeleted();
  const gone = !now.some((el) => el.id === elementId && !el.isDeleted);
  if (gone && others(now) === was) return true;
  if (others(now) !== was || gone) history.redo?.();
  return false;
}
