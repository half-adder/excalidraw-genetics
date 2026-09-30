/*
Genotype
========
Create or edit a Drosophila genotype through a small form: a sex-symbol row
and one text field per homolog (X, II, III x top/bottom). The genotype is
drawn as native Excalidraw elements (allele text, fraction lines, `;`
separators, optional sex glyph), grouped and tagged with a stable
`genotypeId` in customData.

Mode:
  - Selection contains a genotype element  -> edit that genotype in place.
  - Otherwise                              -> create a new genotype at the
                                              free spot nearest the view
                                              center (never overlapping
                                              existing elements).

Form keys:
  Tab / Shift+Tab  next / previous field (X top, X bottom, II top, ...)
  Up / Down        top / bottom homolog of the same chromosome
  Left / Right     move the caret; at the field edge, jump chromosome
  Enter            redraw and close
  Esc              close without changes

Per chromosome: top+bottom -> fraction; one filled -> bare allele;
both empty -> not drawn. Chromosome IV is not in the form; an existing IV
is carried through unchanged.

Edit mode replaces only the genotype's own elements (alleles, fractions,
separators, glyph). Other elements sharing the genotypeId (Cross Builder
labels, lineage) are untouched. customData keys this script does not own
(e.g. `parents`) and outer group memberships are carried onto the new
elements.

customData schema (v2):
  glyph     : { schemaVersion, kind: "genotype-glyph", genotypeId }
  allele    : { schemaVersion, kind: "genotype-allele", genotypeId,
                chromosome: "X"|"II"|"III"|"IV", side: "single"|"top"|"bottom" }
  fraction  : { schemaVersion, kind: "genotype-fraction", genotypeId,
                chromosome: "X"|"II"|"III"|"IV" }
  separator : { schemaVersion, kind: "genotype-separator", genotypeId,
                after: "X"|"II"|"III" }

Test / Cross Mode hooks (consumed on read unless noted):
  window._genotypeCreateAt = { x, y }   place a new genotype near this point
  window._genotypeLastResult            set on exit: genotypeId, or null
Test hooks (consumed on read):
  window._genotypeAuto = { glyph, X:{top,bottom}, II:{...}, III:{...} }
    skips the form and commits these values (mode chosen from selection).
  window._genotypeFormProbe = true
    opens nothing; stores the form's initial state in
    window._genotypeFormState and exits.
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
return await flyOperation("Genotype", async () => {

const SCHEMA = 2;
const FONT_SIZE = 20;
// Alleles use Excalidraw's Local Font (family 4), set in plugin settings to
// Computer Modern (Excalidraw/Fonts/cmu-serif-500-roman.ttf) to match LaTeX.
// Falls back to Helvetica (2) when the local font is not enabled.
const LOCAL_FONT_FAMILY = 4;
const FALLBACK_FONT_FAMILY = 2;
const GLYPH_FONT_FAMILY = 2;    // Computer Modern lacks the male/mercury/hermaphrodite symbols
const GLYPH_SIZE = 24;
const CHROMOSOME_GAP = 14;
const FRACTION_PADDING = 4;
const FRACTION_GAP = 5;
const GLYPH_GAP = 12;
const STROKE_WIDTH = 1.5;
const FIELD_MIN_WIDTH = 120;     // form field width floor, px
const FIELD_PADDING = 28;       // input padding + caret room, px
const FRAME_PAD = 4;            // invisible genotype-frame padding, px
const PLACE_MARGIN = 20;        // clearance from existing elements in create mode
const PLACE_SEARCH_RINGS = 12;  // grid radius searched for a free spot
const CHROMOSOME_ORDER = ["X", "II", "III", "IV"];
const FORM_CHROMOSOMES = ["X", "II", "III"];
const MANAGED_KINDS = new Set([
  "genotype-allele", "genotype-fraction", "genotype-separator", "genotype-glyph",
]);
const OWNED_KEYS = new Set(["schemaVersion", "genotypeId", "kind", "chromosome", "side", "after"]);
const GLYPHS = [
  { label: "♂", title: "Male",          value: "♂" },
  { label: "♀", title: "Female",        value: "♀" },
  { label: "☿", title: "Virgin female", value: "☿" },
  { label: "⚥", title: "Both sexes",    value: "⚥" },
  { label: "none", title: "No glyph",   value: null },
];
const LABEL_GAP = 8;             // gap between an offspring's label box and the genotype

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

ea.clear();

const localFontEnabled = !!ea.plugin?.settings?.experimentalEnableFourthFont;
const FONT_FAMILY = localFontEnabled ? LOCAL_FONT_FAMILY : FALLBACK_FONT_FAMILY;
if (!localFontEnabled) new Notice("Excalidraw local font is off; using Helvetica instead of Computer Modern.");

// ---- Hooks ---------------------------------------------------------------

const _auto = window._genotypeAuto ?? null;
window._genotypeAuto = undefined;
const _probe = !!window._genotypeFormProbe;
window._genotypeFormProbe = undefined;
// Cross Mode hooks: `_genotypeCreateAt = {x, y}` places a new genotype at the
// free spot nearest that point (consumed on read); `_genotypeLastResult` is
// set to the created or edited genotypeId, or null if the form was cancelled.
const _createAt = window._genotypeCreateAt ?? null;
window._genotypeCreateAt = undefined;
const _defaultGlyph = window._genotypeDefaultGlyph; // preset sex for a new genotype
window._genotypeDefaultGlyph = undefined;
window._genotypeLastResult = undefined;

// ---- Mode + read back ----------------------------------------------------

const emptyState = () => ({
  glyph: null,
  X: { top: "", bottom: "" }, II: { top: "", bottom: "" },
  III: { top: "", bottom: "" }, IV: { top: "", bottom: "" },
});

// Copies of a genotype made in Excalidraw become their own genotypes before
// the selected one is read.
if (!_createAt) await splitDuplicateGenotypes();

// With _genotypeCreateAt set (Cross Mode), always create: the deselect Cross
// Mode does just before lands only on Excalidraw's next render.
const selected = _createAt ? [] : ea.getViewSelectedElements();
const selectedGenotypeIds = [...new Set(
  selected.map(el => el.customData?.genotypeId).filter(Boolean)
)];
const genotypeId = selectedGenotypeIds[0] ?? null;
const editMode = genotypeId !== null;
if (selectedGenotypeIds.length > 1) {
  new Notice(`Selection spans ${selectedGenotypeIds.length} genotypes; editing the first.`);
}

const elementText = el => el.originalText ?? el.rawText ?? el.text ?? "";

let oldElements = [];
let initial = emptyState();
if (_defaultGlyph !== undefined) initial.glyph = _defaultGlyph; // create mode; edit mode reads the real glyph below
let focusKey = "X.top";
const offspring = { is: false, label: null, criterion: null, arrow: null };

if (editMode) {
  oldElements = ea.getViewElements().filter(el =>
    el.customData?.genotypeId === genotypeId && MANAGED_KINDS.has(el.customData?.kind)
  );
  const skipped = [];
  for (const el of oldElements) {
    const cd = el.customData;
    if (cd.kind === "genotype-glyph") {
      initial.glyph = elementText(el);
    } else if (cd.kind === "genotype-allele") {
      const slot = initial[cd.chromosome];
      if (!slot || !["top", "bottom", "single"].includes(cd.side)) {
        skipped.push(elementText(el));
        continue;
      }
      if (cd.side === "bottom") slot.bottom = elementText(el);
      else slot.top = elementText(el);
    }
  }
  if (skipped.length) new Notice(`Skipped untagged allele text: ${skipped.join(", ")}`);

  // Offspring: current label and selection criterion, editable in the form.
  const view = ea.getViewElements().filter(el => !el.isDeleted);
  offspring.is = oldElements.some(el => el.customData.parents);
  offspring.label = view.find(el => el.customData?.genotypeId === genotypeId && el.customData.kind === "genotype-label");
  offspring.criterion = view.find(el => el.customData?.kind === "cross-criterion" && el.customData.childGenotypeId === genotypeId);
  offspring.arrow = view.find(el => el.customData?.kind === "cross-lineage" && el.customData.childGenotypeId === genotypeId);
  initial.label = offspring.label ? elementText(offspring.label) : "";
  initial.criterion = offspring.criterion ? elementText(offspring.criterion) : "";

  const selAlleles = selected.filter(el =>
    el.customData?.genotypeId === genotypeId && el.customData?.kind === "genotype-allele"
  );
  if (selAlleles.length === 1) {
    const cd = selAlleles[0].customData;
    if (FORM_CHROMOSOMES.includes(cd.chromosome)) {
      focusKey = `${cd.chromosome}.${cd.side === "bottom" ? "bottom" : "top"}`;
    }
  }
}

if (_probe) {
  window._genotypeFormState = { editMode, genotypeId, focusKey, ...initial };
  return;
}

// ---- Form ----------------------------------------------------------------

function openForm(init) {
  return new Promise(resolve => {
    const modal = new ea.obsidian.Modal(app);
    let result = null;
    let glyph = init.glyph;
    let confirmDelete = false;

    modal.onOpen = () => {
      const { contentEl, titleEl } = modal;
      titleEl.setText(editMode ? "Edit genotype" : "New genotype");

      // Sex-symbol buttons stacked in a column to the left of the allele grid.
      const body = contentEl.createDiv();
      body.style.cssText = "display:flex;align-items:center;gap:16px;justify-content:center;";
      const glyphRow = body.createDiv();
      // margin-top offsets the grid's header row so the column centers on the fraction line.
      glyphRow.style.cssText = "display:flex;flex-direction:column;gap:2px;margin-top:28px;";
      const glyphButtons = GLYPHS.map(g => {
        const b = glyphRow.createEl("button", { text: g.label, attr: { title: g.title, tabindex: "-1" } });
        b.style.cssText = "height:24px;padding:0 10px;";
        if (g.value) b.style.fontSize = "16px";
        b.onclick = () => { glyph = g.value; refreshGlyphs(); };
        return { b, g };
      });
      const refreshGlyphs = () => glyphButtons.forEach(({ b, g }) =>
        b.toggleClass("mod-cta", g.value === glyph));
      refreshGlyphs();

      const grid = body.createDiv();
      // Columns: X ; II ; III, with a `;` column between chromosomes. Each
      // chromosome is its own wrapper (a small grid: header+flip button, top
      // allele, fraction bar, bottom allele) so the flip button sits beside
      // the header without disturbing the outer column layout.
      grid.style.cssText = "display:grid;grid-template-columns:auto auto auto auto auto;" +
        "column-gap:8px;row-gap:6px;justify-content:center;align-items:center;";
      const col = ci => 2 * ci + 1;
      const inputs = {};
      const chrWraps = {}, flipButtons = {};
      // Chromosome under the mouse, for Option+F and the flip button's
      // faint/bright state. Tracked explicitly (not the :hover pseudo-class)
      // so keyboard-driven tests can set it via a synthetic mouseenter.
      let hoveredChr = null;

      // A chromosome flips only when both homologs are filled and neither is
      // "Y": a hemizygous/bare chromosome, or one carrying Y, never flips.
      const canFlipChr = chr => {
        const top = inputs[`${chr}.top`].value.trim(), bottom = inputs[`${chr}.bottom`].value.trim();
        return !!top && !!bottom && top !== "Y" && bottom !== "Y";
      };
      const updateFlipButton = chr => {
        const ok = canFlipChr(chr);
        const btn = flipButtons[chr];
        btn.disabled = !ok;
        btn.style.visibility = ok ? "visible" : "hidden";
        btn.style.opacity = !ok ? "0" : hoveredChr === chr ? "0.85" : "0.35";
      };
      const doFlip = chr => {
        if (!canFlipChr(chr)) return;
        const top = inputs[`${chr}.top`], bottom = inputs[`${chr}.bottom`];
        [top.value, bottom.value] = [bottom.value, top.value];
        resizeColumn(chr);
        updateFlipButton(chr);
        if (confirmDelete) { confirmDelete = false; warn.setText(""); }
      };

      FORM_CHROMOSOMES.forEach((chr, ci) => {
        const wrap = grid.createDiv();
        wrap.style.cssText = `grid-column:${col(ci)};grid-row:1 / span 4;display:grid;` +
          "grid-template-rows:auto auto 2px auto;row-gap:6px;justify-items:center;position:relative;";
        wrap.addEventListener("mouseenter", () => { hoveredChr = chr; updateFlipButton(chr); });
        wrap.addEventListener("mouseleave", () => {
          if (hoveredChr === chr) { hoveredChr = null; updateFlipButton(chr); }
        });
        chrWraps[chr] = wrap;

        const h = wrap.createDiv();
        h.style.cssText = "grid-row:1;width:100%;display:flex;align-items:center;justify-content:center;position:relative;";
        h.createSpan({ text: chr }).style.fontWeight = "600";
        const flipBtn = h.createEl("button", { text: "⇅", attr: { title: "Flip (Option+F)", tabindex: "-1" } });
        flipBtn.style.cssText = "position:absolute;right:-2px;font-size:10px;line-height:1;" +
          "padding:0 3px;border:none;background:transparent;cursor:pointer;";
        flipBtn.onclick = e => { e.preventDefault(); e.stopPropagation(); doFlip(chr); };
        flipButtons[chr] = flipBtn;

        if (ci < FORM_CHROMOSOMES.length - 1) {
          const sep = grid.createDiv({ text: ";" });
          sep.style.cssText = `grid-column:${col(ci) + 1};grid-row:1 / span 4;font-size:1.6em;font-weight:600;` +
            "display:flex;align-items:center;";
        }
        const bar = wrap.createDiv();
        bar.style.cssText = "grid-row:3;width:100%;height:2px;background:var(--text-normal);";
      });
      for (const side of ["top", "bottom"]) {
        FORM_CHROMOSOMES.forEach((chr, ci) => {
          const input = chrWraps[chr].createEl("input", { type: "text", attr: { spellcheck: "false" } });
          input.style.gridRow = side === "top" ? "2" : "4";
          input.value = init[chr][side];
          input.style.textAlign = "center";
          inputs[`${chr}.${side}`] = input;
        });
      }

      // Size each chromosome column to its longest allele; the modal grows with it.
      modal.modalEl.style.width = "auto";
      modal.modalEl.style.maxWidth = "95vw";
      const measureCtx = document.createElement("canvas").getContext("2d");
      const textWidth = input => {
        measureCtx.font = getComputedStyle(input).font;
        return measureCtx.measureText(input.value).width;
      };
      const resizeColumn = chr => {
        const pair = [inputs[`${chr}.top`], inputs[`${chr}.bottom`]];
        const w = Math.max(FIELD_MIN_WIDTH, ...pair.map(textWidth)) + FIELD_PADDING;
        for (const input of pair) input.style.width = `${Math.ceil(w)}px`;
      };
      FORM_CHROMOSOMES.forEach(chr => { resizeColumn(chr); updateFlipButton(chr); });

      // Offspring only: label and (multi-line) selection criterion.
      const extras = [];
      let labelInput = null, critInput = null;
      if (offspring.is) {
        const row = contentEl.createDiv();
        row.style.cssText = "display:flex;gap:12px;justify-content:center;align-items:flex-start;margin-top:14px;";
        labelInput = row.createEl("input", { type: "text", attr: { placeholder: "Label (optional)", spellcheck: "false" } });
        labelInput.value = init.label ?? "";
        labelInput.style.width = "200px";
        critInput = row.createEl("textarea", { attr: {
          placeholder: "Selection criterion (optional)\nEnter: new line, Cmd+Enter: OK", spellcheck: "false", rows: "3" } });
        critInput.value = init.criterion ?? "";
        critInput.style.cssText = "width:240px;resize:vertical;";
        extras.push(labelInput, critInput);
      }

      const warn = contentEl.createDiv();
      warn.style.cssText = "color:var(--text-error);margin-top:8px;min-height:1.2em;";

      const buttons = contentEl.createDiv();
      buttons.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-top:8px;";
      const ok = buttons.createEl("button", { text: "OK", cls: "mod-cta" });
      const cancel = buttons.createEl("button", { text: "Cancel" });

      const order = FORM_CHROMOSOMES.flatMap(c => [`${c}.top`, `${c}.bottom`]);
      const focus = (key, caret) => {
        const el = inputs[key];
        el.focus();
        const pos = caret === "start" ? 0 : el.value.length;
        el.setSelectionRange(pos, pos);
      };

      const commit = () => {
        const state = { glyph, IV: { ...init.IV },
          label: labelInput ? labelInput.value : undefined,
          criterion: critInput ? critInput.value : undefined };
        for (const chr of FORM_CHROMOSOMES) {
          state[chr] = { top: inputs[`${chr}.top`].value, bottom: inputs[`${chr}.bottom`].value };
        }
        const empty = CHROMOSOME_ORDER.every(c => !state[c].top.trim() && !state[c].bottom.trim());
        if (empty && editMode && !confirmDelete) {
          confirmDelete = true;
          warn.setText("All fields are empty. Press Enter again to delete this genotype.");
          return;
        }
        result = empty && !editMode ? null : state;
        modal.close();
      };
      ok.onclick = commit;
      cancel.onclick = () => modal.close();

      for (const [key, input] of Object.entries(inputs)) {
        const [chr, side] = key.split(".");
        const ci = FORM_CHROMOSOMES.indexOf(chr);
        input.addEventListener("input", () => {
          resizeColumn(chr);
          updateFlipButton(chr);
          if (confirmDelete) { confirmDelete = false; warn.setText(""); }
        });
        input.addEventListener("keydown", e => {
          const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
          const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
          let target = null;
          let caret = "end";
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            return;
          } else if (e.key === "Tab") {
            e.preventDefault();
            tabFrom(input, e.shiftKey);
            return;
          } else if (e.key === "ArrowUp") {
            target = `${chr}.top`;
          } else if (e.key === "ArrowDown") {
            target = `${chr}.bottom`;
          } else if (e.key === "ArrowLeft" && atStart && ci > 0) {
            target = `${FORM_CHROMOSOMES[ci - 1]}.${side}`;
          } else if (e.key === "ArrowRight" && atEnd && ci < FORM_CHROMOSOMES.length - 1) {
            target = `${FORM_CHROMOSOMES[ci + 1]}.${side}`;
            caret = "start";
          } else {
            return;
          }
          e.preventDefault();
          if (target !== key) focus(target, caret);
        });
      }

      // Tab cycles through the allele fields, then the label and criterion.
      function tabFrom(el, back) {
        const ring = [...order.map(k => inputs[k]), ...extras];
        const next = ring[(ring.indexOf(el) + (back ? -1 : 1) + ring.length) % ring.length];
        next.focus();
        next.setSelectionRange?.(next.value.length, next.value.length);
      }
      for (const el of extras) {
        el.addEventListener("keydown", e => {
          if (e.key === "Tab") { e.preventDefault(); tabFrom(el, e.shiftKey); }
          else if (e.key === "Enter" && (el === labelInput || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        });
      }

      // Option+F flips a chromosome: swap its top and bottom text. On macOS
      // this key produces e.key "ƒ", so match on the physical key
      // (e.code) and altKey, not e.key, and always preventDefault so no
      // stray character is typed. Acts on the chromosome under the mouse; if
      // the mouse is not over a chromosome, acts on the chromosome of the
      // focused field, and focus follows the flipped text (same field
      // position, same cursor offset) so typing continues uninterrupted.
      contentEl.addEventListener("keydown", e => {
        if (e.code !== "KeyF" || !e.altKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        if (hoveredChr) { doFlip(hoveredChr); return; }
        const active = document.activeElement;
        const activeKey = Object.keys(inputs).find(k => inputs[k] === active);
        if (!activeKey) return;
        const [chr, side] = activeKey.split(".");
        if (!canFlipChr(chr)) return;
        const caret = active.selectionStart ?? 0;
        doFlip(chr);
        const other = inputs[`${chr}.${side === "top" ? "bottom" : "top"}`];
        other.focus();
        const pos = Math.min(caret, other.value.length);
        other.setSelectionRange(pos, pos);
      });

      window._genotypeFormModal = { modal, inputs, focusKey, labelInput, critInput, chromosomes: chrWraps, flipButtons };
      // Modal.open() focuses the first input after onOpen; take focus back next tick.
      setTimeout(() => focus(focusKey, "end"), 0);
    };
    modal.onClose = () => {
      window._genotypeFormModal = undefined;
      modal.contentEl.empty();
      resolve(result);
    };
    modal.open();
  });
}

const state = _auto
  ? { ...emptyState(), IV: { ...initial.IV }, ...structuredClone(_auto) }
  : await openForm(initial);
if (!state) { window._genotypeLastResult = null; return; }

// ---- Build elements ------------------------------------------------------

// X, II and III are always drawn: an empty one is +/+ (so "w ; +/+ ; MKRS/TM6B"
// never reads as a second chromosome). An entirely empty form stays empty (the
// delete case). IV is drawn only when it has alleles.
const ALWAYS_DRAWN = ["X", "II", "III"];
const anyAllele = CHROMOSOME_ORDER.some(c => (state[c]?.top ?? "").trim() || (state[c]?.bottom ?? "").trim());
const chromosomes = [];
for (const label of CHROMOSOME_ORDER) {
  const top = (state[label]?.top ?? "").trim();
  const bottom = (state[label]?.bottom ?? "").trim();
  if (top && bottom) chromosomes.push({ label, kind: "het", alleles: { top, bottom } });
  else if (top || bottom) chromosomes.push({ label, kind: "single", alleles: { single: top || bottom } });
  else if (anyAllele && ALWAYS_DRAWN.includes(label)) chromosomes.push({ label, kind: "het", alleles: { top: "+", bottom: "+" } });
}

// Anchor: edit mode keeps the old left edge and midline; create uses view center.
let anchor = null;
if (editMode && oldElements.length) {
  const left = Math.min(...oldElements.map(el => el.x));
  const line = oldElements.find(el => el.customData.kind === "genotype-fraction");
  const single = oldElements.find(el => el.customData.kind === "genotype-allele");
  const midlineY = line ? line.y : single ? single.y + single.height / 2 : oldElements[0].y;
  anchor = { left, midlineY };
}

// Carry-through: customData keys we don't own, and outer group memberships.
const carriedData = {};
for (const el of oldElements) {
  for (const [k, v] of Object.entries(el.customData ?? {})) {
    if (!OWNED_KEYS.has(k) && !(k in carriedData)) carriedData[k] = v;
  }
}
const oldGroupIds = oldElements[0]?.groupIds ?? [];

// The invisible frame is kept (same id) across edits so lineage arrows bound
// to it stay bound; it is resized after the redraw.
const oldFrame = editMode
  ? ea.getViewElements().find(el =>
      el.customData?.genotypeId === genotypeId && el.customData?.kind === "genotype-frame")
  : null;
const labelElements = editMode
  ? ea.getViewElements().filter(el =>
      el.customData?.genotypeId === genotypeId &&
      (el.customData?.kind === "genotype-label" || el.customData?.kind === "genotype-label-box"))
  : [];

const finalGenotypeId = genotypeId ?? crypto.randomUUID();

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
ea.style.roughness = 0;           // straight fraction lines, LaTeX-style

function tag(id, data) {
  ea.addAppendUpdateCustomData(id, {
    ...carriedData, schemaVersion: SCHEMA, genotypeId: finalGenotypeId, ...data,
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
if (state.glyph && chromosomeLayouts.length) {
  ea.style.fontSize = GLYPH_SIZE;
  ea.style.fontFamily = GLYPH_FONT_FAMILY;
  glyphId = ea.addText(0, 0, state.glyph);
  tag(glyphId, { kind: "genotype-glyph" });
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = FONT_FAMILY;
}

// ---- Layout pass ---------------------------------------------------------

let totalWidth = 0;
if (glyphId) totalWidth += ea.getElement(glyphId).width + GLYPH_GAP;
for (let i = 0; i < chromosomeLayouts.length; i++) {
  totalWidth += chromosomeLayouts[i].slotWidth;
  if (i < chromosomeLayouts.length - 1) {
    totalWidth += CHROMOSOME_GAP + ea.getElement(separatorIds[i]).width + CHROMOSOME_GAP;
  }
}

// Vertical extent above/below the midline, for collision checks.
let halfHeight = 0;
if (glyphId) halfHeight = ea.getElement(glyphId).height / 2;
for (const c of chromosomeLayouts) {
  if (c.kind === "single") {
    halfHeight = Math.max(halfHeight, ea.getElement(c.elements.single).height / 2);
  } else {
    const h = Math.max(ea.getElement(c.elements.top).height, ea.getElement(c.elements.bottom).height);
    halfHeight = Math.max(halfHeight, FRACTION_GAP + h);
  }
}

// Create mode: nearest spot to the view center that clears every existing
// element by PLACE_MARGIN. Candidates form a grid around the center, tried
// in order of distance.
function findFreeSpot(cx, cy, w, halfH) {
  const boxes = ea.getViewElements()
    .filter(el => !el.isDeleted)
    .map(el => ea.getBoundingBox([el]));
  const h = 2 * halfH;
  const hits = (left, top) => boxes.some(b =>
    left < b.topX + b.width + PLACE_MARGIN && left + w + PLACE_MARGIN > b.topX &&
    top < b.topY + b.height + PLACE_MARGIN && top + h + PLACE_MARGIN > b.topY
  );
  const sx = (w + PLACE_MARGIN) / 2;
  const sy = h + PLACE_MARGIN;
  const candidates = [];
  for (let i = -PLACE_SEARCH_RINGS; i <= PLACE_SEARCH_RINGS; i++) {
    for (let j = -PLACE_SEARCH_RINGS; j <= PLACE_SEARCH_RINGS; j++) {
      candidates.push([i * sx, j * sy]);
    }
  }
  candidates.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
  for (const [dx, dy] of candidates) {
    if (!hits(cx - w / 2 + dx, cy - halfH + dy)) return { left: cx - w / 2 + dx, midlineY: cy + dy };
  }
  return { left: cx - w / 2, midlineY: cy };
}

// Same routing as Cross Genotypes / Tidy lineage arrows.
function lineagePoints(x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 0.5) return [[x1, y1], [x1, y2]];
  const midY = (y1 + y2) / 2;
  return [[x1, y1], [x1, midY], [x2, midY], [x2, y2]];
}

const center = ea.getViewCenterPosition() ?? { x: 0, y: 0 };
const placement = anchor ?? (_createAt
  ? findFreeSpot(_createAt.x, _createAt.y, totalWidth, halfHeight)
  : findFreeSpot(center.x, center.y, totalWidth, halfHeight));
let cursorX = placement.left;
const midlineY = placement.midlineY;

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

// ---- Group + commit ------------------------------------------------------

const allIds = [];
if (glyphId) allIds.push(glyphId);
for (const c of chromosomeLayouts) {
  if (c.kind === "single") allIds.push(c.elements.single);
  else allIds.push(c.elements.top, c.elements.bottom, c.elements.line);
}
allIds.push(...separatorIds);

// Offspring label: rebuilt from the form (centered over the redrawn
// genotype); an empty field removes it. Non-offspring keep any label as is.
const doomed = [];
let frameCover = labelElements;
const newLabelIds = [];
if (offspring.is && allIds.length) {
  const text = (state.label ?? (offspring.label ? elementText(offspring.label) : "")).trim();
  doomed.push(...labelElements);
  frameCover = [];
  if (text) {
    const b = ea.getBoundingBox(allIds.map(id => ea.getElement(id)));
    const { boxId, textId } = addLabelBox(text, b.topX + b.width / 2, b.topY - LABEL_GAP, {
      schemaVersion: SCHEMA, genotypeId: finalGenotypeId, parents: carriedData.parents, text,
    });
    newLabelIds.push(boxId, textId);
  }
}

// Invisible frame around the genotype (and its label, if any): the binding
// target for lineage arrows, whose ends sit at its top middle.
let frameId = null;
if (allIds.length) {
  const box = ea.getBoundingBox([...allIds, ...newLabelIds].map(id => ea.getElement(id)).concat(frameCover));
  const fx = box.topX - FRAME_PAD, fy = box.topY - FRAME_PAD;
  const fw = box.width + 2 * FRAME_PAD, fh = box.height + 2 * FRAME_PAD;
  if (oldFrame) {
    ea.copyViewElementsToEAforEditing([oldFrame]);
    frameId = oldFrame.id;
    Object.assign(ea.getElement(frameId), { x: fx, y: fy, width: fw, height: fh });
  } else {
    ea.style.strokeColor = "transparent";
    ea.style.backgroundColor = "transparent";
    frameId = ea.addRect(fx, fy, fw, fh);
    tag(frameId, { kind: "genotype-frame" });
    ea.style.strokeColor = "#000000";
  }
}
const groupedIds = [...allIds, ...newLabelIds, ...(frameId ? [frameId] : [])];

if (oldGroupIds.length) {
  for (const id of groupedIds) ea.getElement(id).groupIds = [...oldGroupIds];
} else if (groupedIds.length) {
  ea.addToGroup(groupedIds);
}

// Re-aim lineage arrows bound to the frame at its new top middle.
if (oldFrame && frameId) {
  const frame = ea.getElement(frameId);
  const endX = frame.x + frame.width / 2, endY = frame.y;
  const arrows = ea.getViewElements().filter(el =>
    el.type === "arrow" && !el.isDeleted && el.endBinding?.elementId === frameId);
  ea.copyViewElementsToEAforEditing(arrows);
  for (const a of arrows.map(a => ea.getElement(a.id))) {
    const sx = a.x + a.points[0][0], sy = a.y + a.points[0][1];
    const pts = lineagePoints(sx, sy, endX, endY);
    a.x = sx; a.y = sy;
    a.points = pts.map(([x, y]) => [x - sx, y - sy]);
    a.width = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
    a.height = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
  }
}

// Offspring selection criterion: rebuilt as the lineage arrow's label (after
// the arrow was re-routed above); an empty field removes it.
if (offspring.is && allIds.length) {
  const text = (state.criterion ?? (offspring.criterion ? elementText(offspring.criterion) : "")).trim();
  const arrow = offspring.arrow;
  if (offspring.criterion) doomed.push(offspring.criterion);
  if (arrow) {
    if (!ea.getElement(arrow.id)) ea.copyViewElementsToEAforEditing([arrow]);
    const a = ea.getElement(arrow.id);
    if (offspring.criterion) a.boundElements = (a.boundElements ?? []).filter(b => b.id !== offspring.criterion.id);
    if (text) addArrowLabel(arrow.id, text, { schemaVersion: SCHEMA, childGenotypeId: finalGenotypeId, text });
  } else if (text) {
    new Notice("This offspring has no lineage arrow to put the selection criterion on.");
  }
}

// Old elements are marked deleted in the same batch as the new ones are added,
// so the edit lands as a single scene update.
const toDelete = [...oldElements, ...doomed];
if (toDelete.length) {
  ea.copyViewElementsToEAforEditing(toDelete.filter(el => !ea.getElement(el.id)));
  for (const el of toDelete) ea.getElement(el.id).isDeleted = true;
}

ea.style.fontSize = prev.fontSize;
ea.style.fontFamily = prev.fontFamily;
ea.style.strokeColor = prev.strokeColor;
ea.style.strokeWidth = prev.strokeWidth;
ea.style.roughness = prev.roughness;
ea.style.backgroundColor = prev.backgroundColor;

await flyAddElementsToView();
if (allIds.length) flySelect(allIds);
window._genotypeLastResult = allIds.length ? finalGenotypeId : null;
}); // end of the operation
