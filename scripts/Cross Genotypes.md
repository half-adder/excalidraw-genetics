/*
Cross Genotypes
===============
Creates an offspring genotype of two selected parental genotypes.

Preconditions:
  Selection must include elements of exactly two distinct genotypes.

Behavior:
  - Infers maternal/paternal assignment from sex glyphs (♀/☿ -> maternal,
    ♂ -> paternal). If glyphs are absent or ambiguous, defaults to
    maternal = leftmost parent by centroid x.
  - Opens a picker: offspring sex, then per chromosome one card from every
    maternal x paternal homolog pair (maternal on top; X lists daughters
    (father's X), sons (father's Y) and both-sex combos ("w or Y"); the X
    card sets the sex (male / female / both) and picking a sex moves X to a
    matching card), plus optional label and
    selection criterion. See docs/plans/2026-09-28-cross-picker-design.md.
  - Stamps `parents: { maternal, paternal }` on every offspring element.
  - Creates (or reuses) a `cross-glyph` element keyed by the parent pair.
  - Creates a `cross-lineage` element keyed by the offspring's genotypeId.
  - Optionally creates `genotype-label` and `cross-criterion` elements.
  - Best-effort initial positioning. Run `Tidy` afterwards for a clean layout.

customData schema (v2): see docs/plans/2026-05-31-schema-v2-design.md
*/

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
return await flyOperation("Cross Genotypes", async () => {

const SCHEMA = 2;
const FONT_SIZE = 20;
// Same style as Genotype: Computer Modern via Excalidraw's Local Font (4),
// Helvetica (2) fallback and for the sex glyph (Computer Modern lacks some).
const LOCAL_FONT_FAMILY = 4;
const FALLBACK_FONT_FAMILY = 2;
const GLYPH_FONT_FAMILY = 2;
const FONT_FAMILY = ea.plugin?.settings?.experimentalEnableFourthFont
  ? LOCAL_FONT_FAMILY : FALLBACK_FONT_FAMILY;
const GLYPH_SIZE = 24;
const CHROMOSOME_GAP = 14;
const FRACTION_PADDING = 4;
const FRACTION_GAP = 5;
const GLYPH_GAP = 12;
const STROKE_WIDTH = 1.5;
const CHROMOSOME_ORDER = ["X", "II", "III", "IV"];
const CROSS_GLYPH_CHAR = "x";
const CROSS_GLYPH_FONT_FAMILY = 1;   // Virgil: hand-drawn "x" between parents
const PARENT_GAP_X = 80;       // gap between left parent and x glyph (and x and right parent)
const LINEAGE_DROP = 60;       // vertical distance from cross-glyph to offspring center

// ---- Helpers (duplicated from Build / Tidy; keep in sync) ---------------

const textOf = el => el.originalText ?? el.rawText ?? el.text ?? "";

function getGenotypeIdFromElement(el) {
  return el?.customData?.genotypeId ?? null;
}

function getGenotypeElements(genotypeId, allElements) {
  return allElements.filter(e => e.customData?.genotypeId === genotypeId);
}

function reconstructShorthand(genotypeId, allElements) {
  const members = getGenotypeElements(genotypeId, allElements);
  const byChrom = {};
  for (const el of members) {
    const cd = el.customData;
    if (cd?.kind !== "genotype-allele") continue;
    if (!byChrom[cd.chromosome]) byChrom[cd.chromosome] = {};
    byChrom[cd.chromosome][cd.side] = textOf(el);
  }
  const parts = [];
  for (const label of CHROMOSOME_ORDER) {
    const a = byChrom[label];
    if (!a) continue;
    if (a.single !== undefined) parts.push(a.single);
    else if (a.top !== undefined && a.bottom !== undefined) parts.push(`${a.top}/${a.bottom}`);
  }
  return parts.join(" ; ");
}

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

// ---- Detect two parental genotypes from selection -----------------------

window._crossGenotypesLastResult = undefined;
// Copies of a genotype made in Excalidraw become their own genotypes before
// the parents are read (the selection may be on a copy).
await splitDuplicateGenotypes();
// Cross Mode passes the two parents explicitly in
// window._crossGenotypesParents = { genotypeIds: [a, b], at: Date.now() }
// (its selection lands only on Excalidraw's next render); used once, if fresh.
const givenParents = window._crossGenotypesParents;
window._crossGenotypesParents = undefined;
const allElements = ea.getViewElements();
const parentIds = [];
if (givenParents && Date.now() - givenParents.at < 10000) {
  for (const gid of givenParents.genotypeIds ?? []) if (gid && !parentIds.includes(gid)) parentIds.push(gid);
} else {
  for (const el of ea.getViewSelectedElements()) {
    const gid = getGenotypeIdFromElement(el);
    if (gid && !parentIds.includes(gid)) parentIds.push(gid);
  }
}
if (parentIds.length !== 2) {
  new Notice(`Select elements from exactly two genotypes (found ${parentIds.length}).`);
  window._crossGenotypesLastResult = null;
  return;
}

const parentA = { id: parentIds[0], elements: getGenotypeElements(parentIds[0], allElements) };
const parentB = { id: parentIds[1], elements: getGenotypeElements(parentIds[1], allElements) };

function centroidX(elements) {
  if (elements.length === 0) return 0;
  const xs = elements.map(e => e.x + (e.width || 0) / 2);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function glyphCharOf(elements) {
  const g = elements.find(e => e.customData?.kind === "genotype-glyph");
  return g ? textOf(g) : null;
}

const FEMALE_GLYPHS = new Set(["♀", "☿"]);
const MALE_GLYPHS = new Set(["♂"]);

const aGlyph = glyphCharOf(parentA.elements);
const bGlyph = glyphCharOf(parentB.elements);

let maternalId, paternalId;
if (FEMALE_GLYPHS.has(aGlyph) && MALE_GLYPHS.has(bGlyph)) {
  maternalId = parentA.id; paternalId = parentB.id;
} else if (FEMALE_GLYPHS.has(bGlyph) && MALE_GLYPHS.has(aGlyph)) {
  maternalId = parentB.id; paternalId = parentA.id;
} else if (FEMALE_GLYPHS.has(aGlyph)) {
  maternalId = parentA.id; paternalId = parentB.id;
} else if (FEMALE_GLYPHS.has(bGlyph)) {
  maternalId = parentB.id; paternalId = parentA.id;
} else if (MALE_GLYPHS.has(aGlyph)) {
  paternalId = parentA.id; maternalId = parentB.id;
} else if (MALE_GLYPHS.has(bGlyph)) {
  paternalId = parentB.id; maternalId = parentA.id;
} else {
  // Default: leftmost is maternal.
  if (centroidX(parentA.elements) <= centroidX(parentB.elements)) {
    maternalId = parentA.id; paternalId = parentB.id;
  } else {
    maternalId = parentB.id; paternalId = parentA.id;
  }
}

// ---- Parent homologs + offspring options --------------------------------

const PICK_CHROMOSOMES = ["X", "II", "III"];

// Two homologs per chromosome per parent. Bare = two copies, except the
// father's X, where bare means that X plus Y. Missing = +/+ (father X: +/Y).
function homologsOf(genotypeId, isFather) {
  const byChrom = {};
  for (const el of getGenotypeElements(genotypeId, allElements)) {
    const cd = el.customData;
    if (cd?.kind !== "genotype-allele") continue;
    (byChrom[cd.chromosome] ??= {})[cd.side] = textOf(el).trim();
  }
  const out = {};
  for (const label of CHROMOSOME_ORDER) {
    const a = byChrom[label];
    const fatherX = isFather && label === "X";
    if (!a) {
      out[label] = fatherX ? ["+", "Y"] : ["+", "+"];
    } else if (a.top !== undefined && a.bottom !== undefined) {
      out[label] = [a.top, a.bottom];
    } else {
      const one = a.single ?? a.top ?? a.bottom;
      out[label] = fatherX ? [one, "Y"] : [one, one];
    }
  }
  out.present = new Set(Object.keys(byChrom));
  return out;
}

const mat = homologsOf(maternalId, false);
const pat = homologsOf(paternalId, true);

// Maternal homolog on top. Pairs that are identical, or that differ only in
// which parent gave which homolog (CyO/+ vs +/CyO), are one card: the first
// occurrence in m1xp1, m1xp2, m2xp1, m2xp2 order is kept and later
// duplicates/flips are dropped.
function pairs(maternal, paternal) {
  const out = [];
  const seen = new Set();
  for (const m of maternal) {
    for (const p of paternal) {
      const key = m + "\u0000" + p;
      const flipped = p + "\u0000" + m;
      if (seen.has(key) || seen.has(flipped)) continue;
      seen.add(key);
      seen.add(flipped);
      out.push({ top: m, bottom: p });
    }
  }
  return out;
}

// Maternal homolog on top; mother x father pairs merged per pairs() above.
// X lists daughters (father's X), sons (father's Y), then both-sex combos
// (maternal X over "father's X or Y"), each tagged with `sex`; merging never
// crosses a sex tag because each tag's cards come from its own pairs() call.
function optionsFor() {
  const patX = pat.X.filter(h => h !== "Y");
  const fatherX = patX.length ? patX : ["+"];
  const hasY = pat.X.includes("Y");
  const tagged = (list, sex) => list.map(o => ({ ...o, sex }));
  const X = [
    ...tagged(pairs(mat.X, fatherX), "female"),
    ...(hasY ? tagged(pairs(mat.X, ["Y"]), "male") : []),
    ...(hasY ? tagged(pairs(mat.X, fatherX.map(p => `${p} or Y`)), "both") : []),
  ];
  return { X, II: pairs(mat.II, pat.II), III: pairs(mat.III, pat.III) };
}

// ---- Picker form ---------------------------------------------------------

const GLYPHS = [
  { label: "♂", title: "Male",          value: "♂" },
  { label: "♀", title: "Female",        value: "♀" },
  { label: "☿", title: "Virgin female", value: "☿" },
  { label: "⚥", title: "Both sexes",    value: "⚥" },
  { label: "none", title: "No glyph",   value: null },
];

// Test hook: window._crossGenotypesAuto =
//   { offspringGlyph, pick: { X, II, III }, labelText?, criterionText? }
// skips the form. Consumed (cleared) on read.
const _auto = window._crossGenotypesAuto ?? null;
window._crossGenotypesAuto = undefined;

function openPicker() {
  return new Promise(resolve => {
    const modal = new ea.obsidian.Modal(app);
    // flip[chr][idx]: card idx of chromosome chr is shown/used top-bottom
    // swapped. Per card, lasts while the picker is open. X cards that carry
    // a Y (sex "male"/"both") never flip; see canFlip below.
    const state = { sex: null, pick: { X: 0, II: 0, III: 0 }, label: "", criterion: "", flip: { X: {}, II: {}, III: {} } };
    // X lists daughters and sons together; sex and the X card stay consistent:
    // a Y card means male, an XX card female (virgin female kept if chosen).
    const options = optionsFor();
    const canFlip = opt => !opt.sex || opt.sex === "female";
    const flippedOpt = (chr, idx) => {
      const opt = options[chr][idx];
      return state.flip[chr][idx] ? { ...opt, top: opt.bottom, bottom: opt.top } : opt;
    };
    const sexFromX = () => {
      const kind = options.X[state.pick.X]?.sex;
      if (kind === "male") state.sex = "♂";
      else if (kind === "both") state.sex = "⚥";
      else if (state.sex !== "☿") state.sex = "♀";
    };
    const xFromSex = () => {
      const want = { "♂": "male", "♀": "female", "☿": "female", "⚥": "both" }[state.sex];
      if (!want || options.X[state.pick.X]?.sex === want) return;
      const i = options.X.findIndex(o => o.sex === want);
      if (i >= 0) state.pick.X = i;
    };
    sexFromX();
    let result = null;

    modal.onOpen = () => {
      const { contentEl, titleEl } = modal;
      titleEl.setText("Cross offspring");
      modal.modalEl.style.width = "auto";
      modal.modalEl.style.maxWidth = "95vw";

      // Small DOM rendering of a genotype: glyph, then per chromosome either
      // top over a bar over bottom, or a bare allele; `;` between chromosomes.
      // `chroms` is [{ top, bottom } | { single }] in chromosome order.
      const drawMini = (container, glyph, chroms) => {
        const g = container.createDiv();
        g.style.cssText = "display:flex;align-items:center;gap:6px;";
        if (glyph) g.createSpan({ text: glyph }).style.fontSize = "1.3em";
        chroms.forEach((a, i) => {
          if (a.single === undefined) {
            const f = g.createDiv();
            f.style.cssText = "display:flex;flex-direction:column;align-items:center;";
            f.createDiv({ text: a.top }).style.whiteSpace = "nowrap";
            f.createDiv().style.cssText = "height:1.5px;align-self:stretch;margin:1px 0;background:currentColor;";
            f.createDiv({ text: a.bottom }).style.whiteSpace = "nowrap";
          } else {
            g.createSpan({ text: a.single }).style.whiteSpace = "nowrap";
          }
          if (i < chroms.length - 1) g.createSpan({ text: ";" }).style.fontWeight = "600";
        });
        return g;
      };

      // Header: both parents drawn as they appear on the canvas.
      const header = contentEl.createDiv();
      header.style.cssText =
        "display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:8px;";
      const drawParent = (gid, fallbackGlyph) => {
        const byChrom = {};
        let glyph = null;
        for (const el of getGenotypeElements(gid, allElements)) {
          const cd = el.customData;
          if (cd?.kind === "genotype-glyph") glyph = textOf(el);
          if (cd?.kind === "genotype-allele") (byChrom[cd.chromosome] ??= {})[cd.side] = textOf(el);
        }
        const chroms = CHROMOSOME_ORDER.filter(c => byChrom[c]).map(c => {
          const a = byChrom[c];
          return (a.top !== undefined && a.bottom !== undefined)
            ? { top: a.top, bottom: a.bottom }
            : { single: a.single ?? a.top ?? a.bottom };
        });
        drawMini(header, glyph ?? fallbackGlyph, chroms);
      };
      drawParent(maternalId, "♀");
      header.createSpan({ text: "×" }).style.cssText = "font-size:1.4em;";
      drawParent(paternalId, "♂");

      // Live preview of the offspring, under the parents (divider above it), above the cards.
      const preview = contentEl.createDiv();
      preview.style.cssText =
        "display:flex;flex-direction:column;align-items:center;margin-bottom:14px;padding-top:8px;" +
        "border-top:1px solid var(--background-modifier-border);";
      preview.createDiv({ text: "Offspring" }).style.cssText =
        "font-size:0.8em;color:var(--text-muted);margin-bottom:4px;";
      const previewBody = preview.createDiv();
      const renderPreview = () => {
        previewBody.empty();
        const chroms = PICK_CHROMOSOMES.map(c => flippedOpt(c, state.pick[c]));
        if (mat.present.has("IV") || pat.present.has("IV")) chroms.push({ top: mat.IV[0], bottom: pat.IV[0] });
        drawMini(previewBody, state.sex, chroms.map(o => ({ top: o.top, bottom: o.bottom })));
      };


      const body = contentEl.createDiv();
      body.style.cssText = "display:flex;align-items:center;gap:16px;justify-content:center;";

      const sexCol = body.createDiv();
      // margin-top = column header height, so the column centers on the cards.
      sexCol.style.cssText = "display:flex;flex-direction:column;gap:2px;margin-top:26px;";
      const sexButtons = GLYPHS.map(g => {
        const b = sexCol.createEl("button", { text: g.label, attr: { title: g.title, tabindex: "-1" } });
        b.style.cssText = "height:24px;padding:0 10px;";
        if (g.value) b.style.fontSize = "16px";
        b.onclick = () => {
          state.sex = g.value;
          xFromSex();
          render();
          focusColumn("X");
        };
        return { b, g };
      });

      const grid = body.createDiv();
      grid.style.cssText = "display:flex;align-items:flex-start;gap:8px;";
      const columns = {};
      PICK_CHROMOSOMES.forEach((chr, ci) => {
        const wrap = grid.createDiv();
        wrap.style.cssText = "display:flex;flex-direction:column;align-items:stretch;gap:4px;";
        const h = wrap.createDiv({ text: chr });
        h.style.cssText = "text-align:center;font-weight:600;height:22px;";
        const col = wrap.createDiv({ attr: { tabindex: "0" } });
        col.style.cssText = "display:flex;flex-direction:column;gap:4px;outline:none;padding:2px;border-radius:6px;";
        col.addEventListener("focus", () => { col.style.boxShadow = "0 0 0 2px var(--interactive-accent)"; });
        col.addEventListener("blur", () => { col.style.boxShadow = "none"; });
        columns[chr] = col;
        if (ci < PICK_CHROMOSOMES.length - 1) {
          const sep = grid.createDiv({ text: ";" });
          sep.style.cssText = "font-size:1.6em;font-weight:600;margin-top:40px;";
        }
      });

      const extras = contentEl.createDiv();
      extras.style.cssText = "display:flex;gap:12px;justify-content:center;margin-top:14px;";
      // Criterion is multi-line: Enter adds a line there; Cmd/Ctrl+Enter commits.
      extras.style.alignItems = "flex-start";
      const mkField = (placeholder, key, multiline) => {
        const input = multiline
          ? extras.createEl("textarea", { attr: { placeholder, spellcheck: "false", rows: "3" } })
          : extras.createEl("input", { type: "text", attr: { placeholder, spellcheck: "false" } });
        input.style.width = "220px";
        if (multiline) input.style.resize = "vertical";
        input.addEventListener("input", () => { state[key] = input.value; });
        return input;
      };
      const labelInput = mkField("Label (optional)", "label", false);
      const critInput = mkField("Selection criterion (optional)\nEnter: new line, Cmd+Enter: OK", "criterion", true);

      const buttons = contentEl.createDiv();
      buttons.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-top:12px;";
      const ok = buttons.createEl("button", { text: "OK", cls: "mod-cta" });
      const cancel = buttons.createEl("button", { text: "Cancel" });

      // Card under the mouse (chr, idx into options[chr]), for F. Not the
      // browser :hover pseudo-class: tracked explicitly so keyboard-driven
      // tests can set it via a synthetic mouseenter.
      let hovered = null;

      function card(chr, idx, opt, selected, onClick) {
        const c = createDiv();
        c.style.cssText =
          "display:flex;flex-direction:column;align-items:center;padding:4px 12px;border-radius:6px;cursor:pointer;" +
          "border:1px solid var(--background-modifier-border);" +
          (selected ? "background:var(--interactive-accent);color:var(--text-on-accent);" : "");
        c.createDiv({ text: opt.top }).style.whiteSpace = "nowrap";
        const bar = c.createDiv();
        bar.style.cssText = "height:2px;align-self:stretch;margin:2px 0;background:currentColor;";
        c.createDiv({ text: opt.bottom }).style.whiteSpace = "nowrap";
        c.onclick = onClick;
        c.addEventListener("mouseenter", () => { hovered = { chr, idx }; });
        c.addEventListener("mouseleave", () => {
          if (hovered && hovered.chr === chr && hovered.idx === idx) hovered = null;
        });
        return c;
      }

      function render() {
        sexButtons.forEach(({ b, g }) => b.toggleClass("mod-cta", g.value === state.sex));
        for (const chr of PICK_CHROMOSOMES) {
          const col = columns[chr];
          col.empty();
          options[chr].forEach((opt, i) => {
            col.appendChild(card(chr, i, flippedOpt(chr, i), i === state.pick[chr], () => {
              state.pick[chr] = i;
              if (chr === "X") sexFromX();
              render();
              focusColumn(chr);
            }));
          });
        }
        renderPreview();
        window._crossGenotypesOptions = options;
      }

      const focusOrder = [...PICK_CHROMOSOMES.map(c => columns[c]), labelInput, critInput];
      function focusColumn(chr) { columns[chr].focus(); }

      const commit = () => {
        result = { ...state, options };
        modal.close();
      };
      ok.onclick = commit;
      cancel.onclick = () => modal.close();

      contentEl.addEventListener("keydown", e => {
        const active = document.activeElement;
        const idx = focusOrder.indexOf(active);
        const chr = PICK_CHROMOSOMES.find(c => columns[c] === active);
        if (e.key === "Enter") {
          if (active === critInput && !(e.metaKey || e.ctrlKey)) return; // newline
          e.preventDefault();
          commit();
        } else if (e.key === "Tab") {
          e.preventDefault();
          const n = focusOrder.length;
          focusOrder[((idx < 0 ? 0 : idx) + (e.shiftKey ? -1 : 1) + n) % n].focus();
        } else if (chr && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          const n = options[chr].length;
          state.pick[chr] = (state.pick[chr] + (e.key === "ArrowUp" ? -1 : 1) + n) % n;
          if (chr === "X") sexFromX();
          render();
          focusColumn(chr);
        } else if (chr && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          const ci = PICK_CHROMOSOMES.indexOf(chr) + (e.key === "ArrowLeft" ? -1 : 1);
          if (ci >= 0 && ci < PICK_CHROMOSOMES.length) focusColumn(PICK_CHROMOSOMES[ci]);
          else if (ci === PICK_CHROMOSOMES.length) labelInput.focus();
        } else if ((e.key === "f" || e.key === "F") && !(e.metaKey || e.ctrlKey || e.altKey)) {
          if (active === labelInput || active === critInput) return; // type normally
          e.preventDefault();
          const target = hovered ?? (chr ? { chr, idx: state.pick[chr] } : null);
          if (!target || !canFlip(options[target.chr][target.idx])) return; // no card, or an X/Y card
          state.pick[target.chr] = target.idx; // flipping a card also selects it
          if (target.chr === "X") sexFromX();
          state.flip[target.chr][target.idx] = !state.flip[target.chr][target.idx];
          render();
          focusColumn(target.chr);
        }
      });

      render();
      window._crossGenotypesModal = { modal, state, columns, labelInput, critInput };
      // Modal.open() focuses the first input after onOpen; take focus back next tick.
      setTimeout(() => focusColumn("X"), 0);
    };
    modal.onClose = () => {
      window._crossGenotypesModal = undefined;
      modal.contentEl.empty();
      resolve(result);
    };
    modal.open();
  });
}

let picked;
if (_auto) {
  const options = optionsFor();
  window._crossGenotypesOptions = options;
  picked = {
    sex: _auto.offspringGlyph ?? null,
    pick: { X: 0, II: 0, III: 0, ...(_auto.pick ?? {}) },
    label: _auto.labelText ?? "",
    criterion: _auto.criterionText ?? "",
    options,
  };
} else {
  picked = await openPicker();
}
if (!picked) { window._crossGenotypesLastResult = null; return; }

const offspringGlyph = picked.sex;
const labelText = picked.label;
const criterionText = picked.criterion;

const chromosomes = [];
for (const label of PICK_CHROMOSOMES) {
  const opt = picked.options[label][picked.pick[label]];
  if (!opt) {
    new Notice(`No option ${picked.pick[label]} for chromosome ${label}.`);
    return;
  }
  const flipped = picked.flip?.[label]?.[picked.pick[label]];
  const alleles = flipped ? { top: opt.bottom, bottom: opt.top } : { top: opt.top, bottom: opt.bottom };
  chromosomes.push({ label, kind: "het", alleles });
}
if (mat.present.has("IV") || pat.present.has("IV")) {
  chromosomes.push({ label: "IV", kind: "het", alleles: { top: mat.IV[0], bottom: pat.IV[0] } });
}

// ---- Create offspring genotype elements --------------------------------

const genotypeId = crypto.randomUUID();

// Crude initial center: midpoint x of parents, below the lower parent.
const parentMaternalElements = getGenotypeElements(maternalId, allElements);
const parentPaternalElements = getGenotypeElements(paternalId, allElements);

function bbox(elements) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of elements) {
    minX = Math.min(minX, e.x);
    maxX = Math.max(maxX, e.x + (e.width || 0));
    minY = Math.min(minY, e.y);
    maxY = Math.max(maxY, e.y + (e.height || 0));
  }
  return { minX, maxX, minY, maxY };
}

const matBox = bbox(parentMaternalElements);
const patBox = bbox(parentPaternalElements);
// "Left" parent = lower maxX; "right" parent = higher maxX.
const leftBox = matBox.maxX <= patBox.maxX ? matBox : patBox;
const rightBox = leftBox === matBox ? patBox : matBox;
// midX is the center of the visual gap between the two parents' bounding boxes.
const midX = (leftBox.maxX + rightBox.minX) / 2;

const lowerParentBottomY = Math.max(matBox.maxY, patBox.maxY);
const centerX = midX;
const centerY = lowerParentBottomY + LINEAGE_DROP * 2;

const prev = {
  fontSize: ea.style.fontSize,
  fontFamily: ea.style.fontFamily,
  strokeColor: ea.style.strokeColor,
  strokeWidth: ea.style.strokeWidth,
  roughness: ea.style.roughness,
  backgroundColor: ea.style.backgroundColor,
};
ea.style.fontSize = FONT_SIZE;
ea.style.fontFamily = FONT_FAMILY;
ea.style.strokeColor = "#000000";
ea.style.strokeWidth = STROKE_WIDTH;
ea.style.roughness = 0;

function tag(id, data) {
  ea.addAppendUpdateCustomData(id, {
    schemaVersion: SCHEMA,
    genotypeId,
    parents: { maternal: maternalId, paternal: paternalId },
    ...data,
  });
}

const chromosomeLayouts = chromosomes.map(c => {
  const slot = { ...c, elements: {} };
  if (c.kind === "single") {
    const id = ea.addText(0, 0, c.alleles.single);
    slot.elements.single = id;
    tag(id, { kind: "genotype-allele", chromosome: c.label, side: "single" });
    const el = ea.getElement(id);
    slot.slotWidth = el.width;
    slot.slotHeight = el.height;
  } else {
    const topId = ea.addText(0, 0, c.alleles.top);
    const botId = ea.addText(0, 0, c.alleles.bottom);
    slot.elements.top = topId;
    slot.elements.bottom = botId;
    tag(topId, { kind: "genotype-allele", chromosome: c.label, side: "top" });
    tag(botId, { kind: "genotype-allele", chromosome: c.label, side: "bottom" });
    const top = ea.getElement(topId);
    const bot = ea.getElement(botId);
    const textW = Math.max(top.width, bot.width);
    slot.slotWidth = textW + 2 * FRACTION_PADDING;
    slot.slotHeight = top.height + 2 * FRACTION_GAP + bot.height;
    const lineId = ea.addLine([[0, 0], [slot.slotWidth, 0]]);
    slot.elements.line = lineId;
    tag(lineId, { kind: "genotype-fraction", chromosome: c.label });
  }
  return slot;
});

const separatorIds = [];
for (let i = 0; i < chromosomeLayouts.length - 1; i++) {
  const sepId = ea.addText(0, 0, ";");
  tag(sepId, { kind: "genotype-separator", after: chromosomeLayouts[i].label });
  separatorIds.push(sepId);
}

let glyphId = null;
if (offspringGlyph) {
  ea.style.fontSize = GLYPH_SIZE;
  ea.style.fontFamily = GLYPH_FONT_FAMILY;
  glyphId = ea.addText(0, 0, offspringGlyph);
  tag(glyphId, { kind: "genotype-glyph" });
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = FONT_FAMILY;
}

// ---- Layout pass (mirrors Build Genotype) ------------------------------

const slotMaxHeight = Math.max(...chromosomeLayouts.map(c => c.slotHeight));

let totalWidth = 0;
if (glyphId) totalWidth += ea.getElement(glyphId).width + GLYPH_GAP;
for (let i = 0; i < chromosomeLayouts.length; i++) {
  totalWidth += chromosomeLayouts[i].slotWidth;
  if (i < chromosomeLayouts.length - 1) {
    totalWidth += CHROMOSOME_GAP + ea.getElement(separatorIds[i]).width + CHROMOSOME_GAP;
  }
}

let cursorX = centerX - totalWidth / 2;
const midlineY = centerY;

if (glyphId) {
  const g = ea.getElement(glyphId);
  g.x = cursorX;
  g.y = midlineY - g.height / 2;
  cursorX += g.width + GLYPH_GAP;
}

for (let i = 0; i < chromosomeLayouts.length; i++) {
  const c = chromosomeLayouts[i];
  const slotX = cursorX;
  if (c.kind === "single") {
    const t = ea.getElement(c.elements.single);
    t.x = slotX + (c.slotWidth - t.width) / 2;
    t.y = midlineY - t.height / 2;
  } else {
    const top = ea.getElement(c.elements.top);
    const bot = ea.getElement(c.elements.bottom);
    const line = ea.getElement(c.elements.line);
    top.x = slotX + (c.slotWidth - top.width) / 2;
    top.y = midlineY - FRACTION_GAP - top.height;
    line.x = slotX;
    line.y = midlineY;
    bot.x = slotX + (c.slotWidth - bot.width) / 2;
    bot.y = midlineY + FRACTION_GAP;
  }
  cursorX += c.slotWidth;
  if (i < chromosomeLayouts.length - 1) {
    cursorX += CHROMOSOME_GAP;
    const sep = ea.getElement(separatorIds[i]);
    sep.x = cursorX;
    sep.y = midlineY - sep.height / 2;
    cursorX += sep.width + CHROMOSOME_GAP;
  }
}

// ---- Group + commit ----------------------------------------------------

const allIds = [];
if (glyphId) allIds.push(glyphId);
for (const c of chromosomeLayouts) {
  if (c.kind === "single") allIds.push(c.elements.single);
  else allIds.push(c.elements.top, c.elements.bottom, c.elements.line);
}
allIds.push(...separatorIds);

// Offspring label: text in a black-outlined, light-blue box, centered on
// `centerX` with its bottom edge at `bottomY`. The text is tagged
// `genotype-label`, the box `genotype-label-box`; both carry `data`.
const LABEL_BOX_BG = "#a5d8ff";
const LABEL_BOX_PAD = 6;
function addLabelBox(text, centerX, bottomY, data) {
  const saved = { bg: ea.style.backgroundColor, fill: ea.style.fillStyle, stroke: ea.style.strokeColor };
  ea.style.backgroundColor = LABEL_BOX_BG;
  ea.style.fillStyle = "solid";
  ea.style.strokeColor = "#000000";
  const boxId = ea.addText(0, 0, text, {
    box: "box", boxPadding: LABEL_BOX_PAD, boxStrokeColor: "#000000",
    textAlign: "center", textVerticalAlign: "middle",
  });
  ea.style.backgroundColor = saved.bg;
  ea.style.fillStyle = saved.fill;
  ea.style.strokeColor = saved.stroke;
  const box = ea.getElement(boxId);
  const textId = box.boundElements.find(b => b.type === "text").id;
  const dx = centerX - box.width / 2 - box.x, dy = bottomY - box.height - box.y;
  for (const el of [box, ea.getElement(textId)]) { el.x += dx; el.y += dy; }
  ea.addAppendUpdateCustomData(textId, { ...data, kind: "genotype-label" });
  ea.addAppendUpdateCustomData(boxId, { ...data, kind: "genotype-label-box" });
  return { boxId, textId };
}

// Selection criterion: a real Excalidraw arrow label (text bound to the
// arrow), centered at the midpoint of the arrow's path. May be multi-line.
function addArrowLabel(arrowId, text, data) {
  const arrow = ea.getElement(arrowId);
  const pts = arrow.points.map(([x, y]) => [arrow.x + x, arrow.y + y]);
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let half = segs.reduce((a, b) => a + b, 0) / 2, mx = pts[0][0], my = pts[0][1];
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      mx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      my = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      break;
    }
    half -= segs[i];
  }
  const textId = ea.addText(0, 0, text, { textAlign: "center", textVerticalAlign: "middle" });
  const t = ea.getElement(textId);
  t.containerId = arrowId;
  t.x = mx - t.width / 2;
  t.y = my - t.height / 2;
  arrow.boundElements = [...(arrow.boundElements ?? []), { type: "text", id: textId }];
  ea.addAppendUpdateCustomData(textId, { ...data, kind: "cross-criterion" });
  return textId;
}

// ---- Optional label (part of offspring group) --------------------------

const LABEL_GAP = 8;
const trimmedLabel = (labelText || "").trim();
if (trimmedLabel) {
  const { boxId, textId } = addLabelBox(trimmedLabel, centerX, midlineY - slotMaxHeight / 2 - LABEL_GAP, {
    schemaVersion: SCHEMA, genotypeId, parents: { maternal: maternalId, paternal: paternalId }, text: trimmedLabel,
  });
  allIds.push(boxId, textId);
}

// Invisible frame around offspring + label: the lineage arrow's binding target.
const FRAME_PAD = 4;
const offBox = ea.getBoundingBox(allIds.map(id => ea.getElement(id)));
ea.style.strokeColor = "transparent";
ea.style.backgroundColor = "transparent";
const frameId = ea.addRect(offBox.topX - FRAME_PAD, offBox.topY - FRAME_PAD,
  offBox.width + 2 * FRAME_PAD, offBox.height + 2 * FRAME_PAD);
tag(frameId, { kind: "genotype-frame" });
ea.style.strokeColor = "#000000";
allIds.push(frameId);

ea.addToGroup(allIds);

// ---- Cross furniture: x glyph + lineage line ---------------------------

// Lineage arrows are elbow arrows: straight down when the child is under the
// cross glyph, otherwise down / across / down through the vertical midpoint.
function lineagePoints(x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 0.5) return [[x1, y1], [x1, y2]];
  const midY = (y1 + y2) / 2;
  return [[x1, y1], [x1, midY], [x2, midY], [x2, y2]];
}

function findCrossGlyph(maternalId, paternalId, allElements) {
  return allElements.find(e =>
    e.customData?.kind === "cross-glyph" &&
    e.customData?.parents?.maternal === maternalId &&
    e.customData?.parents?.paternal === paternalId
  );
}

// Note on view vs workbench: ea.getElement(id) only returns elements added in
// THIS script run (workbench). View elements (already on canvas) expose .x/.y
// /.width/.height directly. So when we reuse an existing cross-glyph we read
// the view element directly; when we create a new one we go through the
// workbench.
let crossGlyphEl;
const existingGlyph = findCrossGlyph(maternalId, paternalId, allElements);
if (existingGlyph) {
  // Bring the existing glyph into the workbench so the arrow can bind to it.
  ea.copyViewElementsToEAforEditing([existingGlyph]);
  crossGlyphEl = ea.getElement(existingGlyph.id);
} else {
  // Position: midpoint between parents in x, midline-aligned with parents in y.
  const maternalMidlineY = parentMaternalElements.reduce(
    (s, e) => s + e.y + (e.height || 0) / 2, 0
  ) / parentMaternalElements.length;
  const paternalMidlineY = parentPaternalElements.reduce(
    (s, e) => s + e.y + (e.height || 0) / 2, 0
  ) / parentPaternalElements.length;
  const glyphMidY = (maternalMidlineY + paternalMidlineY) / 2;

  ea.style.fontSize = GLYPH_SIZE;
  ea.style.fontFamily = CROSS_GLYPH_FONT_FAMILY;
  const newGlyphId = ea.addText(0, 0, CROSS_GLYPH_CHAR);
  ea.addAppendUpdateCustomData(newGlyphId, {
    schemaVersion: SCHEMA,
    kind: "cross-glyph",
    parents: { maternal: maternalId, paternal: paternalId },
  });
  crossGlyphEl = ea.getElement(newGlyphId);
  crossGlyphEl.x = midX - crossGlyphEl.width / 2;
  crossGlyphEl.y = glyphMidY - crossGlyphEl.height / 2;
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = FONT_FAMILY;
}

// Lineage line: from bottom of the cross-glyph down to the top of the offspring.
const glyphBottomX = crossGlyphEl.x + crossGlyphEl.width / 2;
const glyphBottomY = crossGlyphEl.y + crossGlyphEl.height;
const frameEl = ea.getElement(frameId);
const offspringTopX = frameEl.x + frameEl.width / 2;
const offspringTopY = frameEl.y;

// Bound at the x glyph's bottom middle and the offspring frame's top middle.
const lineageId = ea.addArrow(
  lineagePoints(glyphBottomX, glyphBottomY, offspringTopX, offspringTopY),
  {
    startArrowHead: null, endArrowHead: "triangle", elbowed: true,
    startObjectId: crossGlyphEl.id, startFixedPoint: [0.5, 1],
    endObjectId: frameId, endFixedPoint: [0.5, 0],
  }
);
ea.addAppendUpdateCustomData(lineageId, {
  schemaVersion: SCHEMA,
  kind: "cross-lineage",
  childGenotypeId: genotypeId,
});

// ---- Optional selection criterion (label bound to the lineage arrow) ----

const trimmedCriterion = (criterionText || "").trim();
if (trimmedCriterion) {
  addArrowLabel(lineageId, trimmedCriterion, {
    schemaVersion: SCHEMA, childGenotypeId: genotypeId, text: trimmedCriterion,
  });
}

ea.style.fontSize = prev.fontSize;
ea.style.fontFamily = prev.fontFamily;
ea.style.strokeColor = prev.strokeColor;
ea.style.strokeWidth = prev.strokeWidth;
ea.style.roughness = prev.roughness;
ea.style.backgroundColor = prev.backgroundColor;

await flyAddElementsToView();
// Test hook (consumed on read): fail after drawing the offspring, before
// the result is set, to test that the operation puts back what it changed.
if (window._crossGenotypesFail) { window._crossGenotypesFail = undefined; throw new Error("test hook: Cross Genotypes failed"); }

new Notice(`Created offspring genotype ${genotypeId.slice(0, 8)}…`);
// Cross Mode waits for this: the new offspring's genotypeId (null if cancelled).
window._crossGenotypesLastResult = genotypeId;

// ---- Auto-tidy the lineage --------------------------------------------

// Tidy the offspring's lineage. The offspring is passed to Tidy as its seed
// (a selection set with updateScene lands only on the next render, so Tidy
// started now would still see the parents selected); it is also selected so
// the user sees it afterwards. Tidy runs as part of this operation, so the
// cross and its tidy are one undo step.
try {
  const api = ea.targetView?.excalidrawAPI;
  if (api) {
    const sceneEls = api.getSceneElements();
    const anchor = sceneEls.find(
      e => !e.isDeleted && e.customData?.genotypeId === genotypeId
    );
    if (anchor) {
      api.updateScene({ appState: { selectedElementIds: { [anchor.id]: true } } });
      window._tidySeed = { genotypeIds: [genotypeId], at: Date.now() };
      flyStart("Tidy");
    }
  }
} catch (e) {
  // Tidy is best-effort. If something fails, the offspring is still created;
  // the user can run Tidy manually.
  console.warn("Cross: auto-tidy failed:", e);
}
}); // end of the operation
