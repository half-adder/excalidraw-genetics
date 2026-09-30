/*
Select Lineage
==============
Selects the whole lineage of the selected genotype: its ancestors,
descendants and mates, with every x, arrow, criterion and label between
them. Drag the selection to move the lineage together.
*/

const MODE = "lineage";

if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.9.0")) {
  new Notice("Requires Excalidraw plugin 1.9.0+.");
  return;
}

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
// Everything below is one undoable operation (see "Undo-safe operations"
// above); its body is not indented.
return await flyOperation("Select Lineage", async () => {

// ---- Duplicated genotypes (same in every script; keep in sync) -------------
// A genotype copied in Excalidraw (Cmd+D, copy/paste, alt-drag) keeps the
// original's customData, genotypeId and `parents` included, in a new group;
// a copied x glyph keeps its `parents`. Of the drawings of one genotypeId,
// the original is the one the lineage arrow into the genotype is bound to,
// else the one nearest the x glyphs of its crosses, else the first in scene
// order; every other drawing is a copy and gets a fresh genotypeId. Of the x
// glyphs of one parent pair, the original is the one with a lineage arrow
// into an original drawing, else the one nearest the parents, else the first.
//
// Copied together: Excalidraw moves a copied selection as one block, so the
// copies of one Cmd+D, paste or alt-drag all lie at the same offset from
// their originals (frame top-left of a drawing, top-left of an x glyph;
// equal within DUPLICATE_SHIFT_PX). Before offsets are compared, the
// originals of each copied family (both parents and their x) are re-picked
// to lie to the original child as the copies lie to the copied child, the
// child's arrow being the surest sign of its original (the rules above can
// split a family, e.g. alt-drag moves the originals and leaves copies).
// Separate copies that happen to share an offset (two Cmd+D, not moved)
// count as copied together.
//
// A copied family stays a family: a copy whose two parents were copied at
// its offset keeps `parents`, pointing at those copies; an x glyph copied
// with both of its parents points at their copies; a lineage arrow copied
// into such a copy (and its criterion) is kept, re-pointed at the copy and
// bound from the copied x (unbound if the x was not copied). Every other
// copy is a new founder (no `parents`); lineage arrows copied into it (and
// their criteria) are removed, and so is an x glyph copied without both of
// its parents. Changes the scene (one update, part of the running
// operation) only if a duplicate was found; returns whether it did.
const DUPLICATE_TIE_PX = 25;   // nearer by less than this: a tie (Cmd+D offsets a copy by 10 px)
const DUPLICATE_SHIFT_PX = 2;  // offsets closer than this: copied together
async function splitDuplicateGenotypes() {
  const all = ea.getViewElements().filter(el => !el.isDeleted);
  const byId = new Map(all.map(el => [el.id, el]));
  const order = new Map(all.map((el, i) => [el.id, i]));
  const first = els => Math.min(...els.map(e => order.get(e.id)));
  const alleles = els => els.filter(e => e.customData.kind === "genotype-allele");
  const center = els => { const b = ea.getBoundingBox(els); return [b.topX + b.width / 2, b.topY + b.height / 2]; };
  const topLeft = els => {
    const f = els.find(e => e.customData.kind === "genotype-frame");
    if (f) return [f.x, f.y];
    const b = ea.getBoundingBox(els);
    return [b.topX, b.topY];
  };
  // Drawings of each genotypeId, told apart by their innermost group; x
  // glyphs of each parent pair.
  const drawingsOf = new Map(), parentsOf = new Map(), xsOf = new Map();
  for (const el of all) {
    const cd = el.customData;
    if (cd?.genotypeId) {
      const groups = drawingsOf.get(cd.genotypeId) ?? drawingsOf.set(cd.genotypeId, new Map()).get(cd.genotypeId);
      const key = el.groupIds?.[0] ?? "";
      (groups.get(key) ?? groups.set(key, []).get(key)).push(el);
      if (cd.parents && !parentsOf.has(cd.genotypeId)) parentsOf.set(cd.genotypeId, cd.parents);
    } else if (cd?.kind === "cross-glyph" && cd.parents?.maternal && cd.parents?.paternal) {
      const key = cd.parents.maternal + "|" + cd.parents.paternal;
      (xsOf.get(key) ?? xsOf.set(key, []).get(key)).push(el);
    }
  }
  // Duplicated genotypes (by genotypeId) and x glyphs (by "x:" + parent
  // pair): { units: element lists, at: their top-left, keep: the original }.
  const dup = new Map();
  for (const [gid, groups] of drawingsOf) {
    const drawings = [...groups.values()].filter(els => els.some(e => e.customData.kind === "genotype-allele"));
    if (drawings.length < 2) continue;
    const members = drawings.map(els => new Set(els.map(e => e.id)));
    const arrowsIn = all.filter(e => e.customData?.kind === "cross-lineage" && e.customData.childGenotypeId === gid);
    const bound = drawings.map((_, i) => i).filter(i => arrowsIn.some(a => members[i].has(a.endBinding?.elementId)));
    let keep = bound.length === 1 ? bound[0] : null;
    if (keep === null) {
      const pool = bound.length ? bound : drawings.map((_, i) => i);
      const parents = parentsOf.get(gid);
      const glyphs = all.filter(e => {
        const p = e.customData?.kind === "cross-glyph" ? e.customData.parents : null;
        return p && (p.maternal === gid || p.paternal === gid
          || (parents && p.maternal === parents.maternal && p.paternal === parents.paternal));
      });
      const dist = i => {
        if (!glyphs.length) return 0;
        const [cx, cy] = center(alleles(drawings[i]));
        return Math.min(...glyphs.map(g => Math.hypot(g.x + g.width / 2 - cx, g.y + g.height / 2 - cy)));
      };
      const best = Math.min(...pool.map(dist));
      keep = pool.filter(i => dist(i) - best < DUPLICATE_TIE_PX).sort((a, b) => first(drawings[a]) - first(drawings[b]))[0];
    }
    dup.set(gid, { units: drawings, at: drawings.map(topLeft), keep });
  }
  const original = el => {
    const d = el && dup.get(el.customData?.genotypeId);
    return !!el && (!d || d.units[d.keep].includes(el));
  };
  for (const [key, xs] of xsOf) {
    if (xs.length < 2) continue;
    const [m, p] = key.split("|");
    const arrowed = xs.map((_, i) => i).filter(i => all.some(a => a.customData?.kind === "cross-lineage"
      && a.startBinding?.elementId === xs[i].id && original(byId.get(a.endBinding?.elementId))));
    let keep = arrowed.length === 1 ? arrowed[0] : null;
    if (keep === null) {
      const pool = arrowed.length ? arrowed : xs.map((_, i) => i);
      const ends = [m, p].map(g => {
        const d = dup.get(g);
        return alleles(d ? d.units[d.keep] : [...(drawingsOf.get(g)?.values() ?? [])].flat());
      }).filter(els => els.length).map(center);
      const mid = ends.length ? [0, 1].map(k => ends.reduce((s, c) => s + c[k], 0) / ends.length) : null;
      const dist = i => {
        if (!mid) return 0;
        const [cx, cy] = center(xs.slice(i, i + 1));
        return Math.hypot(cx - mid[0], cy - mid[1]);
      };
      const best = Math.min(...pool.map(dist));
      keep = pool.filter(i => dist(i) - best < DUPLICATE_TIE_PX).sort((a, b) => first([xs[a]]) - first([xs[b]]))[0];
    }
    dup.set("x:" + key, { units: xs.map(x => [x]), at: xs.map(x => [x.x, x.y]), keep, parents: { maternal: m, paternal: p } });
  }
  if (!dup.size) return false;

  // Offset of unit i from the original; whether two offsets are one.
  const offset = (d, i) => [d.at[i][0] - d.at[d.keep][0], d.at[i][1] - d.at[d.keep][1]];
  const same = (a, b) => Math.abs(a[0] - b[0]) < DUPLICATE_SHIFT_PX && Math.abs(a[1] - b[1]) < DUPLICATE_SHIFT_PX;
  // Re-picks the original of d as the unit from which the most of ref's copy
  // offsets lead to another unit of d (the current original wins ties).
  const align = (d, ref) => {
    const shifts = ref.units.map((_, r) => r).filter(r => r !== ref.keep).map(r => offset(ref, r));
    const score = i => shifts.filter(s => d.at.some((a, j) => j !== i && same([a[0] - d.at[i][0], a[1] - d.at[i][1]], s))).length;
    const scores = d.units.map((_, i) => score(i));
    const best = Math.max(...scores);
    if (best > 0 && scores[d.keep] < best) d.keep = scores.indexOf(best);
  };
  // Generations below the founders, so a family is lined up with its child
  // before it serves as the child of the family above.
  const depth = new Map();
  const depthOf = (g, seen = new Set()) => {
    if (depth.has(g)) return depth.get(g);
    const p = parentsOf.get(g);
    if (!p || seen.has(g)) return 0;
    seen.add(g);
    const d = 1 + Math.max(depthOf(p.maternal, seen), depthOf(p.paternal, seen));
    depth.set(g, d);
    return d;
  };
  const copiedPair = p => !!p && dup.has(p.maternal) && dup.has(p.paternal);
  const lined = new Set();
  const children = [...dup.keys()].filter(g => copiedPair(parentsOf.get(g))).sort((a, b) => depthOf(b) - depthOf(a));
  for (const c of children) {
    const p = parentsOf.get(c);
    for (const g of [p.maternal, p.paternal]) { align(dup.get(g), dup.get(c)); lined.add(g); }
  }
  for (const d of dup.values()) {
    if (!copiedPair(d.parents)) continue;
    const m = dup.get(d.parents.maternal), p = dup.get(d.parents.paternal);
    if (!lined.has(d.parents.maternal) && !lined.has(d.parents.paternal)) align(p, m);
    align(d, m);
  }

  // Every copy: a fresh genotypeId, and the copies of its parents if both
  // were copied at its offset.
  for (const d of dup.values()) if (!d.parents) d.fresh = d.units.map((_, i) => i === d.keep ? null : crypto.randomUUID());
  const copyAt = (key, s) => {
    const d = dup.get(key);
    const i = d ? d.units.findIndex((_, j) => j !== d.keep && same(offset(d, j), s)) : -1;
    return i < 0 ? null : i;
  };
  const copiedParents = (p, s) => {
    const m = p && copyAt(p.maternal, s), f = p && copyAt(p.paternal, s);
    return m === null || f === null || !p ? null
      : { maternal: dup.get(p.maternal).fresh[m], paternal: dup.get(p.paternal).fresh[f] };
  };
  const renamed = new Map();   // element id -> { genotypeId, parents (null: a founder), of, shift }
  const xCopies = new Map();   // x glyph id -> parents of its copy (null: removed)
  for (const [key, d] of dup) d.units.forEach((els, i) => {
    if (i === d.keep) return;
    const s = offset(d, i);
    if (d.parents) { xCopies.set(els[0].id, copiedParents(d.parents, s)); return; }
    const info = { genotypeId: d.fresh[i], parents: copiedParents(parentsOf.get(key), s), of: key, shift: s };
    for (const el of els) renamed.set(el.id, info);
  });

  // Lineage arrows into a copy, with their criteria: kept into a copied
  // family (re-pointed, bound from its x), else removed.
  const doomed = new Set();
  const startOf = new Map();   // re-bound arrow id -> its new start (null: none)
  const childOf = new Map();   // kept arrow or criterion id -> the copy's genotypeId
  for (const [id, parents] of xCopies) if (!parents) doomed.add(id);
  for (const a of all) {
    const info = a.customData?.kind === "cross-lineage" ? renamed.get(a.endBinding?.elementId) : null;
    if (!info) continue;
    const texts = (a.boundElements ?? []).filter(b => b.type === "text").map(b => b.id);
    if (!info.parents) {
      doomed.add(a.id);
      for (const t of texts) doomed.add(t);
      continue;
    }
    for (const id of [a.id, ...texts]) childOf.set(id, info.genotypeId);
    const p = parentsOf.get(info.of), key = "x:" + p.maternal + "|" + p.paternal;
    const i = copyAt(key, info.shift);
    const x = i === null ? null : dup.get(key).units[i][0].id;
    if (a.startBinding?.elementId !== x) startOf.set(a.id, x);
  }
  for (const a of all) {
    if (a.customData?.kind === "cross-lineage" && !doomed.has(a.id) && !startOf.has(a.id)
        && doomed.has(a.startBinding?.elementId)) startOf.set(a.id, null);
  }
  // A binding is kept only if the other end still points back at `el`.
  const startId = o => startOf.has(o.id) ? startOf.get(o.id) : o.startBinding?.elementId;
  const bindsTo = (b, el) => {
    const o = byId.get(b.id);
    if (!o || doomed.has(o.id)) return false;
    return b.type === "text" ? o.containerId === el.id
      : startId(o) === el.id || o.endBinding?.elementId === el.id;
  };
  const newlyBound = new Map();   // element id -> arrows now starting on it
  for (const [a, x] of startOf) if (x) (newlyBound.get(x) ?? newlyBound.set(x, []).get(x)).push(a);
  ea.clear();
  const edit = el => ea.getElement(el.id) ?? (ea.copyViewElementsToEAforEditing([el]), ea.getElement(el.id));
  for (const el of all) {
    if (doomed.has(el.id)) { edit(el).isDeleted = true; continue; }
    const info = renamed.get(el.id);
    if (info) {
      const { parents, ...rest } = el.customData;
      edit(el).customData = { ...rest, genotypeId: info.genotypeId, ...(info.parents ? { parents: info.parents } : {}) };
    }
    if (xCopies.has(el.id)) edit(el).customData = { ...el.customData, parents: xCopies.get(el.id) };
    if (childOf.has(el.id) && el.customData?.childGenotypeId) edit(el).customData = { ...el.customData, childGenotypeId: childOf.get(el.id) };
    if (startOf.has(el.id)) {
      const x = startOf.get(el.id);
      edit(el).startBinding = x ? { ...(el.startBinding ?? { mode: "orbit", fixedPoint: [0.5, 1] }), elementId: x } : null;
    }
    const touched = info || xCopies.has(el.id) || newlyBound.has(el.id)
      || el.boundElements?.some(b => doomed.has(b.id) || startOf.has(b.id));
    if (touched && (el.boundElements?.length || newlyBound.has(el.id))) {
      const kept = (el.boundElements ?? []).filter(b => bindsTo(b, el));
      for (const id of newlyBound.get(el.id) ?? []) if (!kept.some(b => b.id === id)) kept.push({ type: "arrow", id });
      edit(el).boundElements = kept;
    }
  }
  await flyAddElementsToView();
  ea.clear();
  return true;
}

// Copies of a genotype made in Excalidraw become their own genotypes first.
await splitDuplicateGenotypes();

const all = ea.getViewElements().filter(el => !el.isDeleted);
const seed = ea.getViewSelectedElements().find(el => el.customData?.genotypeId)?.customData.genotypeId;
if (!seed) {
  new Notice("Select a genotype first.");
  return;
}

// Crosses as [maternal, paternal, child] from offspring `parents`, plus
// crosses that have an x but no offspring yet.
const parentsOf = new Map();
for (const el of all) {
  const cd = el.customData;
  if (cd?.genotypeId && cd.parents?.maternal && cd.parents?.paternal) parentsOf.set(cd.genotypeId, cd.parents);
}
const pairs = [...parentsOf.values()];
for (const el of all) {
  const p = el.customData?.kind === "cross-glyph" ? el.customData.parents : null;
  if (p?.maternal && p?.paternal) pairs.push(p);
}

const set = new Set([seed]);
if (MODE === "lineage") {
  // Everything connected through parent/child and mate links.
  let grew = true;
  while (grew) {
    grew = false;
    const add = g => { if (g && !set.has(g)) { set.add(g); grew = true; } };
    for (const [child, p] of parentsOf) {
      if (set.has(child) || set.has(p.maternal) || set.has(p.paternal)) { add(child); add(p.maternal); add(p.paternal); }
    }
    for (const p of pairs) if (set.has(p.maternal) || set.has(p.paternal)) { add(p.maternal); add(p.paternal); }
  }
} else {
  // The seed, its descendants, and the mates in every cross they parent.
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pairs) {
      if (!set.has(p.maternal) && !set.has(p.paternal)) continue;
      for (const g of [p.maternal, p.paternal]) if (!set.has(g)) { set.add(g); grew = true; }
    }
    for (const [child, p] of parentsOf) {
      if (!set.has(child) && (set.has(p.maternal) || set.has(p.paternal))) { set.add(child); grew = true; }
    }
  }
}

// Genotype elements, plus cross furniture whose cross lies inside the set.
// An arrow is included only if both of its child's parents are in the set, so
// in "below" mode the arrow into the seed stays behind (it is bound and
// re-routes when the selection is dragged).
const crossInside = p => p && set.has(p.maternal) && set.has(p.paternal);
const pick = all.filter(el => {
  const cd = el.customData;
  if (!cd) return false;
  if (cd.genotypeId) return set.has(cd.genotypeId);
  if (cd.kind === "cross-glyph") return crossInside(cd.parents);
  if (cd.kind === "cross-lineage" || cd.kind === "cross-criterion") return crossInside(parentsOf.get(cd.childGenotypeId));
  return false;
});
flySelect(pick);
window._flySelectResult = { mode: MODE, genotypes: set.size, genotypeIds: [...set], elements: pick.length };
}); // end of the operation
