/*
Cross Mode
==========
Toggle a quick-crossing mode. While it is on, the line tool is armed with the
cross-line style (red, dashed, 20% opacity). Draw a cross line; it disappears and:
  - genotype -> genotype: the Cross Genotypes picker opens with those two as
    parents;
  - either end in empty space: the Genotype form opens to create a new
    genotype at that end (sex preset opposite to the other end's), then the
    picker opens to cross the two. Empty -> empty starts a new lineage: the
    form opens for the start, then for the end, then the picker.
Cross Mode is one-shot: it turns off once the offspring is created.
Cancelling the Genotype form cancels it and leaves Cross Mode; cancelling the
cross picker keeps the mode on so the line can be drawn again. Other lines are
left alone.

Leave the mode with Esc, by picking any other tool, or by running this
command again. Suggested hotkey: Shift+9 (Settings -> Hotkeys).
*/

const CROSS_LINE = { strokeColor: "#e03131", strokeStyle: "dashed", opacity: 20 };
const POLL_MS = 250;
const HIT_PAD = 8;

// Toggle off if already running in any view.
if (window._flyCrossMode) {
  window._flyCrossMode.stop("Cross mode off.");
  return;
}

ea.setView();
const view = ea.targetView;
const api = view?.excalidrawAPI;
if (!api) {
  new Notice("Open an Excalidraw drawing first.");
  return;
}

const before = api.getAppState();
const saved = {
  currentItemStrokeColor: before.currentItemStrokeColor,
  currentItemStrokeStyle: before.currentItemStrokeStyle,
  currentItemOpacity: before.currentItemOpacity,
};

const arm = () => {
  api.updateScene({
    appState: {
      currentItemStrokeColor: CROSS_LINE.strokeColor,
      currentItemStrokeStyle: CROSS_LINE.strokeStyle,
      currentItemOpacity: CROSS_LINE.opacity,
    },
  });
  api.setActiveTool({ type: "line", locked: true }); // stay on the line tool between lines
};

const isCrossLine = el =>
  el.type === "line" && !el.isDeleted &&
  el.strokeColor === CROSS_LINE.strokeColor &&
  el.strokeStyle === CROSS_LINE.strokeStyle &&
  el.opacity === CROSS_LINE.opacity;

// Genotype under a scene point: its invisible frame, else the padded bounding
// box of its elements.
function genotypeAt(x, y) {
  const els = api.getSceneElements().filter(el => !el.isDeleted && el.customData?.genotypeId);
  const inside = (b, pad) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
  for (const f of els.filter(el => el.customData.kind === "genotype-frame")) {
    if (inside({ x: f.x, y: f.y, w: f.width, h: f.height }, 0)) return f.customData.genotypeId;
  }
  const byGid = new Map();
  for (const el of els) (byGid.get(el.customData.genotypeId) ?? byGid.set(el.customData.genotypeId, []).get(el.customData.genotypeId)).push(el);
  for (const [gid, members] of byGid) {
    const b = ea.getBoundingBox(members);
    if (inside({ x: b.topX, y: b.topY, w: b.width, h: b.height }, HIT_PAD)) return gid;
  }
  return null;
}

const alleleOf = gid => api.getSceneElements().find(el =>
  !el.isDeleted && el.customData?.genotypeId === gid && el.customData.kind === "genotype-allele");

const glyphOf = gid => {
  const g = api.getSceneElements().find(el =>
    !el.isDeleted && el.customData?.genotypeId === gid && el.customData.kind === "genotype-glyph");
  return g ? (g.originalText ?? g.text) : null;
};

async function deleteElement(el) {
  ea.clear();
  ea.copyViewElementsToEAforEditing([el]);
  ea.getElement(el.id).isDeleted = true;
  await ea.addElementsToView(false, false, true);
}

// Run another script by command and wait for the window result it sets.
async function runAndWait(command, resultKey) {
  window[resultKey] = undefined;
  app.commands.executeCommandById(`obsidian-excalidraw-plugin:${command}`);
  while (window[resultKey] === undefined && window._flyCrossMode) {
    await new Promise(r => setTimeout(r, POLL_MS));
  }
  return window[resultKey];
}

async function cross(gidA, gidB) {
  // Selected for the user to see; passed explicitly, since the selection
  // lands only on Excalidraw's next render.
  ea.selectElementsInView([alleleOf(gidA), alleleOf(gidB)]);
  window._crossGenotypesParents = { genotypeIds: [gidA, gidB], at: Date.now() };
  return runAndWait("Cross Genotypes", "_crossGenotypesLastResult");
}

let busy = false;
// Lines already in the drawing when the mode starts are not cross requests.
const handled = new Set(api.getSceneElements().filter(isCrossLine).map(el => el.id));
const finishing = new Set();
const notice = new Notice("Cross mode: draw a line between genotypes (or into empty space for a new one). Esc to exit.", 0);

async function handle(line) {
  const pts = line.points;
  const start = { x: line.x + pts[0][0], y: line.y + pts[0][1] };
  const end = { x: line.x + pts[pts.length - 1][0], y: line.y + pts[pts.length - 1][1] };
  const from = genotypeAt(start.x, start.y);
  const to = genotypeAt(end.x, end.y);
  await deleteElement(line);

  if (from && to === from) return; // a line within one genotype: ignore
  // An end in empty space gets a new genotype there (sex preset opposite to the
  // other end's, when known). Start first, then end. Cancelling a form stops.
  // Cancelling the Genotype form cancels the whole operation and leaves the mode.
  const a = from ?? await createAt(start, to ? glyphOf(to) : null);
  if (!a) return stop("Cross mode off (cancelled).");
  const b = to ?? await createAt(end, glyphOf(a));
  if (!b) return stop("Cross mode off (cancelled).");
  // One-shot: once the offspring exists, leave the mode. A cancelled picker
  // returns nothing, so the mode stays on to try again.
  if (await cross(a, b)) stop("Cross mode off (offspring created).");
}

const opposite = g => g === "♂" ? "♀" : (g === "♀" || g === "☿") ? "♂" : null;

// Open the Genotype form to create a genotype near `point`; resolves to its
// genotypeId, or null if the form was cancelled.
async function createAt(point, mateGlyph) {
  window._genotypeDefaultGlyph = opposite(mateGlyph);
  window._genotypeCreateAt = point;
  // Deselected for the user; Genotype creates regardless (_genotypeCreateAt).
  api.updateScene({ appState: { selectedElementIds: {}, selectedGroupIds: {} } });
  return runAndWait("Genotype", "_genotypeLastResult");
}

const timer = setInterval(async () => {
  if (busy || !window._flyCrossMode) return;
  if (!view.file || !view.containerEl?.isConnected) return stop("Cross mode off (drawing closed).");
  const st = api.getAppState();
  // Click-click drawing: the line tool keeps adding points until Esc. A cross
  // line only needs two, so once the second click lands (points = two fixed
  // points plus the one following the cursor), finish the line like Esc does.
  const multi = st.multiElement;
  if (multi && isCrossLine(multi) && multi.points.length >= 3 && !finishing.has(multi.id)) {
    finishing.add(multi.id);
    const target = view.contentEl.querySelector(".excalidraw canvas.interactive") ?? view.contentEl.querySelector(".excalidraw");
    target?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
    return;
  }
  if (st.multiElement || st.newElement || st.draggingElement) return; // still drawing
  // Handle a finished cross line before checking the tool: finishing a line
  // can itself switch tools.
  const line = api.getSceneElements().find(el => isCrossLine(el) && !handled.has(el.id));
  if (!line) {
    if (st.activeTool?.type !== "line") stop("Cross mode off.");
    return;
  }
  handled.add(line.id);
  busy = true;
  try {
    await handle(line);
  } catch (e) {
    console.error("Cross mode:", e);
    new Notice(`Cross mode error: ${e.message}`);
  } finally {
    busy = false;
    if (window._flyCrossMode) arm();
  }
}, POLL_MS);

function stop(message) {
  clearInterval(timer);
  window._flyCrossMode = undefined;
  notice.hide();
  api.updateScene({ appState: saved });
  // Back to the selection tool, with the tool lock as it was before the mode.
  api.setActiveTool({ type: "selection", locked: !!before.activeTool?.locked });
  if (message) new Notice(message, 2000);
}

window._flyCrossMode = { stop, view };
arm();
