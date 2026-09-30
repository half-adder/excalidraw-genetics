/*
Tidy Below
==========
Tidies only at or below the selected genotype: runs Select Below (the
genotype, its descendants and the mates in every cross they parent), then
Tidy, which tidies exactly the selected genotypes. The selected genotype
stays where it is; its parents, siblings, the x glyph above it and the arrow
into it are kept (the arrow is re-bound to it). Everything else in the
drawing is an obstacle the tidied part keeps clear of.

Usage:
  Select any element of a genotype, then run Tidy Below.
*/

// ---- Undo-safe operations (same in every script; keep in sync) -------------
// Every change a script makes to the drawing belongs to an operation, and an
// operation is ONE undo step, however many scene updates it makes and however
// many scripts it runs (Cross Genotypes starts Tidy; Tidy Below starts Select
// Below and Tidy; Cross Mode starts Genotype and Cross Genotypes). Design:
// docs/plans/2026-09-29-undo-safe-design.md.
//
// flyOperation(name, body) runs body as part of the drawing's open operation,
// or opens one. Scene updates inside it are left out of Excalidraw's undo
// history (flyAddElementsToView and flyDeleteViewElements commit with
// captureUpdate NEVER). When the last script of the operation has finished,
// flyFinish records the whole operation as one undo step, from the drawing
// as it was at the operation's first change (so a form open before then is
// not part of it) to the drawing now: it puts the "before" elements back
// unrecorded, then the "after" elements recorded (versions raised so
// Excalidraw sees both; elements the operation removed stay in place as
// deleted, so undo restores the z-order exactly). Undo restores the drawing
// as it was; redo re-applies the operation in one step. An operation that
// changes no element records nothing and leaves nothing pending for the
// user's next action. A script that throws has the elements it changed put
// back, unless changed since by someone else (the rest of the operation
// stands); the error is re-thrown. An
// operation whose view has moved on to another drawing records and writes
// nothing more.
//
// Rules (tests/run-all.sh checks them): do the script's work inside
// flyOperation; change elements only with flyAddElementsToView (delete by
// setting isDeleted, or with flyDeleteViewElements), never with
// ea.addElementsToView, ea.deleteViewElements or updateScene; start another
// script only with flyStart; select only with flySelect (or updateScene with
// appState alone); take a user's own step out of the history only with
// flyUnrecordDrawn.
async function flyOperation(name, body) {
  const view = ea.targetView, api = view?.excalidrawAPI;
  if (!api) return body();
  if (!flySupported()) return;
  const ops = (window._flyOperations ??= new WeakMap());
  let op = ops.get(view);
  if (op && !op.done && flyStale(op)) op = null;
  if (!op || op.done) {
    const st = api.getAppState();
    op = {
      view, file: view.file, done: false, running: 0, expected: [], before: null, parts: new Map(),
      selection: { selectedElementIds: { ...st.selectedElementIds }, selectedGroupIds: { ...st.selectedGroupIds } },
    };
    ops.set(view, op);
  }
  (window._flyScriptOps ??= new WeakMap()).set(ea, op);   // this script's operation
  const started = op.expected.findIndex(e => e.name === name);
  const entry = started >= 0 ? op.expected.splice(started, 1)[0] : null;
  if (entry) clearTimeout(entry.timer);
  op.running++;
  try {
    return await body();
  } catch (e) {
    // Put back what this script changed (as it was before its first
    // change), except elements changed since by someone else.
    const saved = op.parts.get(ea);
    if (saved && !flyStale(op)) {
      const now = api.getSceneElementsIncludingDeleted(), byId = new Map(now.map(el => [el.id, el]));
      const mine = id => saved.has(id) && byId.get(id)?.version === saved.get(id).last;
      const back = now.filter(el => !mine(el.id) || saved.get(el.id).was)
        .map(el => mine(el.id) ? flyRaise(saved.get(el.id).was, el, 1) : el);
      for (const [id, s] of saved) if (s.was && !byId.has(id) && s.last === undefined) back.push(flyRaise(s.was, null, 1));
      view.updateScene({ elements: back, appState: {}, captureUpdate: "NEVER" });
    }
    throw e;
  } finally {
    op.running--;
    entry?.ended();
    await flyFinish(op);
  }
}

// Whether the plugin can leave scene updates out of the history
// (addElementsToView takes captureUpdate since 2.20.2); says so if not.
function flySupported() {
  if (ea.verifyMinimumPluginVersion?.("2.20.2")) return true;
  new Notice("Fly Genetics needs Excalidraw plugin 2.20.2 or newer.");
  return false;
}

// Whether the operation's view now shows another drawing (Obsidian reuses a
// view when a tab opens another file). Such an operation is ended: it
// writes and records nothing more.
function flyStale(op) {
  if (op.view.file === op.file) return false;
  op.done = true;
  if (window._flyOperations?.get(op.view) === op) window._flyOperations.delete(op.view);
  return true;
}

// Starts the script `name` (by its command) as part of this operation; the
// operation stays open until it has run (or has not started in 15 s).
// Resolves when that script has ended (or did not start).
function flyStart(name) {
  const op = window._flyScriptOps?.get(ea) ?? window._flyOperations?.get(ea.targetView);
  // The operation's drawing is no longer in the view: start nothing (the
  // promise says so with `skipped`).
  if (op && !op.done && flyStale(op)) return Object.assign(Promise.resolve(), { skipped: true });
  let ended = Promise.resolve();
  if (op && !op.done) {
    const entry = { name };
    ended = new Promise(r => { entry.ended = r; });
    entry.timer = setTimeout(() => {
      const i = op.expected.indexOf(entry);
      if (i < 0) return;
      op.expected.splice(i, 1);
      entry.ended();
      flyFinish(op).catch(e => console.error("Fly Genetics: ending the operation failed", e));
    }, 15000);
    op.expected.push(entry);
  }
  app.commands.executeCommandById(`obsidian-excalidraw-plugin:${name}`);
  return ended;
}

// Runs `write` (a scene update) as part of this script's operation, which
// must still be the view's open one. The first write takes the scene as
// the operation's "before"; each script keeps, for every element a write
// of its own changed, added or removed, how it was before the script's
// first change to it (null: it did not exist) and the version its last
// write left, to put back if the script throws.
async function flyWriting(write) {
  const view = ea.targetView, op = window._flyScriptOps?.get(ea);
  if (!op || op.done || flyStale(op) || window._flyOperations?.get(view) !== op) throw new Error("scene change outside an open flyOperation");
  const pre = structuredClone(view.excalidrawAPI.getSceneElementsIncludingDeleted());
  op.before ??= pre;
  const result = await write();
  const was = new Map(pre.map(el => [el.id, el]));
  const now = view.excalidrawAPI.getSceneElementsIncludingDeleted();
  const saved = op.parts.get(ea) ?? op.parts.set(ea, new Map()).get(ea);
  const keep = (id, el, last) => {
    if (!saved.has(id)) saved.set(id, { was: el ?? null });
    saved.get(id).last = last;
  };
  for (const el of now) if (was.get(el.id)?.version !== el.version) keep(el.id, was.get(el.id), el.version);
  const ids = new Set(now.map(el => el.id));
  for (const [id, el] of was) if (!ids.has(id)) keep(id, el, undefined);
  return result;
}

// Commits the EA workbench to the scene, new elements on top (as
// ea.addElementsToView(false, false, true)), unrecorded: the operation
// records it. The commit ends with Excalidraw re-fitting bound text and
// arrows (updateContainerSize, refreshAllArrows), which record a step of
// their own when they change something; flyQuietly keeps them unrecorded.
async function flyAddElementsToView() {
  const api = ea.targetView.excalidrawAPI;
  const { refreshAllArrows, updateContainerSize } = api;
  api.refreshAllArrows = (...a) => flyQuietly(() => refreshAllArrows.apply(api, a));
  api.updateContainerSize = (...a) => flyQuietly(() => updateContainerSize.apply(api, a));
  try {
    return await flyWriting(() => ea.addElementsToView(false, false, true, false, "NEVER"));
  } finally {
    Object.assign(api, { refreshAllArrows, updateContainerSize });
  }
}

// Runs `change`, an Excalidraw call that changes elements in place and asks
// for its change to be recorded, and keeps it out of the history: the next
// store commit records the change from the scene before `change` to the
// scene then, so that commit is made with the elements and selection as
// they were before (nothing to record), then the changed elements are put
// back, unrecorded.
function flyQuietly(change) {
  const view = ea.targetView, api = view.excalidrawAPI;
  const nonce = () => Math.floor(Math.random() * 2 ** 31);
  // The selection as the store will see it (live elements only), settled.
  const st = api.getAppState(), live = new Set(api.getSceneElements().map(el => el.id));
  const selection = {
    selectedElementIds: Object.fromEntries(Object.entries(st.selectedElementIds).filter(([id, on]) => on && live.has(id))),
    selectedGroupIds: { ...st.selectedGroupIds },
  };
  view.updateScene({ elements: api.getSceneElementsIncludingDeleted(), appState: selection, captureUpdate: "NEVER" });
  // A NEVER update takes into the store only what it changes, so a selection
  // change still pending (made without captureUpdate) would be recorded by
  // that commit: settle it by selecting something else, then it, unrecorded.
  const other = {
    selectedElementIds: Object.keys(selection.selectedElementIds).length ? {} : Object.fromEntries([...live].slice(0, 1).map(id => [id, true])),
    selectedGroupIds: Object.keys(selection.selectedGroupIds).length ? {} : { "fly-settle": true },
  };
  view.updateScene({ appState: other, captureUpdate: "NEVER" });
  view.updateScene({ appState: selection, captureUpdate: "NEVER" });
  const pre = new Map(api.getSceneElementsIncludingDeleted().map(el => [el.id, structuredClone(el)]));
  const result = change();
  const post = api.getSceneElementsIncludingDeleted();
  const moved = new Map(post.filter(el => pre.get(el.id)?.version !== el.version).map(el => [el.id, structuredClone(el)]));
  if (!moved.size) return result;
  const top = new Map(post.map(el => [el.id, el.version]));
  view.updateScene({ elements: post.filter(el => pre.has(el.id) || !moved.has(el.id))
    .map(el => moved.has(el.id) ? { ...pre.get(el.id), version: top.get(el.id) + 1, versionNonce: nonce() } : el), appState: selection, captureUpdate: "NEVER" });
  view.updateScene({ elements: [...api.getSceneElementsIncludingDeleted().map(el => moved.has(el.id) ? { ...moved.get(el.id), version: top.get(el.id) + 2, versionNonce: nonce() } : el),
    ...[...moved.values()].filter(el => !pre.has(el.id)).map(el => ({ ...el, version: top.get(el.id) + 2, versionNonce: nonce() }))], appState: selection, captureUpdate: "NEVER" });
  return result;
}

// Deletes view elements (sets isDeleted, in place), unrecorded. Unlike a
// workbench commit it does not refresh arrows, so arrows bound to the
// deleted elements can be re-bound afterwards.
async function flyDeleteViewElements(elements) {
  const view = ea.targetView, ids = new Set(elements.map(el => el.id));
  return flyWriting(() => view.updateScene({
    elements: view.excalidrawAPI.getSceneElementsIncludingDeleted().map(el => !ids.has(el.id) ? el
      : { ...el, isDeleted: true, version: el.version + 1, versionNonce: Math.floor(Math.random() * 2 ** 31) }),
    captureUpdate: "NEVER",
  }));
}

// Selects `elements` (elements or ids) with the groups they are in, as a
// click would, unrecorded: ea.selectElementsInView records a step of its own
// (and takes with it whatever the scene has pending).
function flySelect(elements) {
  const view = ea.targetView, all = view.excalidrawAPI.getSceneElements();
  const ids = new Set(elements.filter(Boolean).map(el => typeof el === "string" ? el : el.id));
  const selectedGroupIds = {}, selectedElementIds = {};
  for (const el of all) if (ids.has(el.id) && el.groupIds?.length) selectedGroupIds[el.groupIds[el.groupIds.length - 1]] = true;
  for (const el of all) if (ids.has(el.id) || el.groupIds?.some(g => selectedGroupIds[g])) selectedElementIds[el.id] = true;
  view.updateScene({ appState: { selectedElementIds, selectedGroupIds, editingGroupId: null }, captureUpdate: "NEVER" });
}

// Takes `element`, which the user has just drawn as their own undo step,
// back out of the drawing and out of the history by undoing that step (a
// redo can bring it back only until the next recorded change). Returns
// false, changing nothing, if that step held more than the element. Call it
// before the operation that replaces the element starts.
async function flyUnrecordDrawn(element) {
  const api = ea.targetView?.excalidrawAPI;
  if (!api?.history) return false;
  const others = els => els.filter(el => el.id !== element.id).map(el => el.id + ":" + el.version).join("|");
  const was = others(api.getSceneElementsIncludingDeleted());
  api.history.undo();
  await flyFrame(ea.targetView);
  const now = api.getSceneElementsIncludingDeleted();
  const gone = !now.some(el => el.id === element.id && !el.isDeleted);
  if (gone && others(now) === was) return true;
  if (others(now) !== was || gone) api.history.redo();
  return false;
}

// Waits for the view's next rendered frame (at most 100 ms: a hidden window
// renders no frames).
function flyFrame(view) {
  const win = view?.containerEl?.win ?? window;
  return new Promise(r => {
    const t = setTimeout(r, 100);
    win.requestAnimationFrame(() => { clearTimeout(t); setTimeout(r, 0); });
  });
}

// `el` with its version raised past `current` (the scene's copy) by `by`, so
// Excalidraw's store sees it; unchanged if it is the scene's version.
function flyRaise(el, current, by) {
  if (current && current.version === el.version) return current;
  return { ...el, version: Math.max(el.version ?? 0, current?.version ?? 0) + by, versionNonce: Math.floor(Math.random() * 2 ** 31) };
}

// Whether two copies of an element draw the same (both absent or deleted,
// or equal but for version, versionNonce and updated).
function flySame(a, b) {
  const drawn = e => !!e && !e.isDeleted;
  if (!drawn(a) || !drawn(b)) return drawn(a) === drawn(b);
  const skip = new Set(["version", "versionNonce", "updated"]);
  const eq = (x, y) => {
    if (x === y) return true;
    if (!x || !y || typeof x !== "object" || typeof y !== "object" || Array.isArray(x) !== Array.isArray(y)) return false;
    const kx = Object.keys(x).filter(k => x[k] !== undefined && !skip.has(k));
    const ky = Object.keys(y).filter(k => y[k] !== undefined && !skip.has(k));
    return kx.length === ky.length && kx.every(k => eq(x[k], y[k]));
  };
  return eq(a, b);
}

// Ends the operation once no script is running in it or expected to join:
// records it as one undo step, or, if no element changed, records nothing
// and settles what is pending (a selection change).
async function flyFinish(op) {
  if (op.done || op.running || op.expected.length) return;
  await flyFrame(op.view);   // let Excalidraw settle
  if (op.done || op.running || op.expected.length || flyStale(op)) return;
  op.done = true;
  if (window._flyOperations?.get(op.view) === op) window._flyOperations.delete(op.view);
  const api = op.view.excalidrawAPI;
  if (!api) return;
  const now = api.getSceneElementsIncludingDeleted(), st = api.getAppState();
  const selection = { selectedElementIds: st.selectedElementIds, selectedGroupIds: st.selectedGroupIds };
  const was = new Map((op.before ?? []).map(el => [el.id, el])), is = new Map(now.map(el => [el.id, el]));
  const changed = !!op.before && [...new Set([...was.keys(), ...is.keys()])].some(id => !flySame(was.get(id), is.get(id)));
  if (!changed) {
    op.view.updateScene({ elements: now, appState: selection, captureUpdate: "NEVER" });
    return;
  }
  // Recorded as the change from "before" (the old elements as they were) to
  // "after" (the old elements as they are now, in their order and with their
  // fractional index, those the operation removed back in place as deleted;
  // then the new elements on top). First the new elements get their indices
  // from Excalidraw, so its store holds them at those indices when "before"
  // leaves them out: undo and redo then move nothing in the z-order. Each
  // scene update raises the versions of what it changes, so the store sees
  // it (an element left out is marked deleted one version up). If a step
  // fails, the drawing as the operation left it is put back, unrecorded.
  const nonce = () => Math.floor(Math.random() * 2 ** 31);
  const base = id => Math.max(was.get(id)?.version ?? 0, is.get(id)?.version ?? 0);
  const untouched = id => was.get(id)?.version === is.get(id)?.version && was.get(id)?.index === is.get(id)?.index;
  const at = (el, step, patch = {}) => untouched(el.id) ? is.get(el.id)
    : { ...el, ...patch, version: base(el.id) + step, versionNonce: nonce() };
  const kept = op.before.filter(el => is.has(el.id) || !el.isDeleted);
  const added = now.filter(el => !was.has(el.id));
  const final = el => is.has(el.id) ? { ...is.get(el.id), index: el.index } : { ...el, isDeleted: true };
  try {
    op.view.updateScene({ elements: [...kept.map(el => at(final(el), 1)), ...added.map(el => at(el, 1, { index: null }))], appState: selection, captureUpdate: "NEVER" });
    const index = new Map(api.getSceneElementsIncludingDeleted().map(el => [el.id, el.index]));
    op.view.updateScene({ elements: kept.map(el => at(el, 2)), appState: op.selection, captureUpdate: "NEVER" });
    op.view.updateScene({ elements: [...kept.map(el => at(final(el), 3)), ...added.map(el => at(el, 3, { index: index.get(el.id) }))], appState: selection, captureUpdate: "IMMEDIATELY" });
  } catch (e) {
    const current = new Map(api.getSceneElementsIncludingDeleted().map(el => [el.id, el]));
    op.view.updateScene({ elements: now.map(el => flyRaise(el, current.get(el.id), 4)), appState: selection, captureUpdate: "NEVER" });
    throw e;
  }
}
// ---- End of undo-safe operations -------------------------------------------

// ---- The operation ---------------------------------------------------------
// Tidy Below, the Select Below and the Tidy it starts are one undoable
// operation (see "Undo-safe operations" above).
return await flyOperation("Tidy Below", async () => {
if (!ea.getViewSelectedElements().some(el => el.customData?.genotypeId)) {
  new Notice("Tidy Below: select a genotype first.");
  return;
}

window._flySelectResult = undefined;
// Wait for Select Below's result, or for Select Below to end without one.
let ended = false;
flyStart("Select Below").then(() => { ended = true; });
let result;
while (!(result = window._flySelectResult) && !ended) await new Promise(r => setTimeout(r, 50));
result ??= window._flySelectResult;
window._flySelectResult = undefined;
// Test hook (consumed on read): fail after Select Below has run, to test
// that what Select Below changed stands.
if (window._tidyBelowFail) { window._tidyBelowFail = undefined; throw new Error("test hook: Tidy Below failed"); }
if (!result) {
  new Notice("Tidy Below: Select Below did not finish.");
  return;
}
// Tidy with a single genotype selected would tidy its whole lineage.
if (result.genotypes < 2) {
  new Notice("Tidy Below: nothing below this genotype to tidy.");
  return;
}
// Pass the genotypes to Tidy explicitly: the selection Select Below set lands
// only on Excalidraw's next render.
window._tidySeed = { genotypeIds: result.genotypeIds, at: Date.now() };
// Test hook (consumed on read): an async function awaited here, e.g. to
// switch the tab to another drawing before Tidy starts.
const pause = window._tidyBelowPause;
window._tidyBelowPause = undefined;
if (pause) await pause();
// Not started if the tab has moved to another drawing: drop the seed then.
if (flyStart("Tidy").skipped) window._tidySeed = undefined;
}); // end of the operation
