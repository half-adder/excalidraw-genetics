#!/usr/bin/env bash
# Regression test: a genotype duplicated in Excalidraw (Cmd+D) becomes its own
# genotype. The copy carries the original's customData, genotypeId included;
# Tidy used to redraw both copies as one genotype, deleting one, and pull the
# survivor down to the row it was crossed on. Fixture backcross: P1 x P2 -> A.
#   1. Duplicate P2, move the copy beside A, cross A x copy -> B (a backcross
#      to A's father drawn with a copy, as a user would). Checks that P2 is
#      still drawn once, on P1's row, next to its x with P1; that the copy is a
#      separate founder with P2's alleles on A's row and is B's father; the
#      usual layout invariants; and that a second Tidy moves nothing.
#   2. Same as 1, but copying P2 by alt-dragging it beside A (pointer events on
#      the canvas); A is crossed with the drawing that ends up beside it.
#   3. Duplicate A (an offspring) and Tidy. Checks that A is still drawn once
#      and the copy is a separate genotype without parents (no second arrow
#      from P1 x P2).
#   4. Duplicate the whole family (P1, P2, their x, A and A's arrow) with one
#      Cmd+D, move the copy down and Tidy. Checks that the originals are
#      unchanged, that the copy is its own family (the copy of A is the child
#      of the copies of P1 and P2, both founders, under one x of their own),
#      the usual layout invariants, and that a second Tidy moves nothing.
#   5. Same as 3, but copying with Cmd+C / Cmd+V (Excalidraw's own copy and
#      paste handlers, fed through a DataTransfer). Runs last: about a second
#      after a later fixture load, the pasted copy came back into the scene.
# Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
await T.fixture('backcross');
T.setup(['P1', 'P2', 'A']);
const ea = F.view();
const api = ea.targetView.excalidrawAPI;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const frames = () => F.live().filter(e => e.customData?.kind === 'genotype-frame');
const alleles = gid => F.live().filter(e => e.customData?.genotypeId === gid && e.customData.kind === 'genotype-allele').map(e => e.originalText ?? e.text).sort().join(',');
const bottom = gid => { const f = frames().find(e => e.customData.genotypeId === gid); return f ? Math.round(f.y + f.height) : null; };

// Duplicates every element of genotype n with Excalidraw's own Cmd+D and
// moves the copy so its allele center lands at [x, y]. Returns the copy's
// element ids.
async function duplicate(n, [x, y]) {
  const fresh = await cmdD(F.els(n));
  const b = ea.getBoundingBox(fresh.filter(e => e.customData?.kind === 'genotype-allele'));
  await shift(fresh, x - (b.topX + b.width / 2), y - (b.topY + b.height / 2));
  return fresh.map(e => e.id);
}

// Selects `els` and presses Cmd+D; returns the copies Excalidraw made.
async function cmdD(els) {
  const before = new Set(api.getSceneElements().map(e => e.id));
  window.__flyWant = els.map(e => e.id);
  ea.selectElementsInView(els);
  for (let i = 0; i < 60 && !els.every(e => api.getAppState().selectedElementIds[e.id]); i++) await sleep(16);
  const c = ea.targetView.contentEl.querySelector('.excalidraw');
  const key = t => (c.querySelector('canvas.interactive') || c).dispatchEvent(new KeyboardEvent(t, { key: 'd', code: 'KeyD', metaKey: t === 'keydown', ctrlKey: t === 'keydown', bubbles: true, cancelable: true }));
  key('keydown');
  key('keyup'); // or Excalidraw keeps Cmd held, which breaks a later alt-drag
  let fresh = [];
  for (let i = 0; i < 100 && fresh.length < els.length; i++) { await sleep(20); fresh = F.live().filter(e => !before.has(e.id)); }
  if (fresh.length !== els.length) throw new Error('Cmd+D made ' + fresh.length + ' elements, expected ' + els.length);
  return fresh;
}

// Moves the scene elements `els` by (dx, dy) and deselects.
async function shift(els, dx, dy) {
  ea.clear();
  ea.copyViewElementsToEAforEditing(els);
  for (const e of els) { const w = ea.getElement(e.id); w.x += dx; w.y += dy; }
  await ea.addElementsToView(false, false, true);
  F.deselect();
}

// Copies every element of genotype n with Excalidraw's copy handler and
// pastes it back with its paste handler. Paste only acts when focus is in
// the drawing and the last pointer position is over the canvas (Excalidraw
// checks document.elementFromPoint there), so the pointer is put on a spot
// where the canvas is on top (not under a notice), focus and that spot are
// checked before each paste, and a paste that made nothing is retried.
async function copyPaste(n) {
  const before = new Set(api.getSceneElements().map(e => e.id));
  const els = F.els(n);
  window.__flyWant = els.map(e => e.id);
  ea.selectElementsInView(els);
  for (let i = 0; i < 60 && !els.every(e => api.getAppState().selectedElementIds[e.id]); i++) await sleep(16);
  const c = ea.targetView.contentEl.querySelector('.excalidraw');
  c.focus();
  const dt = new DataTransfer();
  document.dispatchEvent(new ClipboardEvent('copy', { clipboardData: dt, bubbles: true, cancelable: true }));
  if (!dt.types.length) throw new Error('Cmd+C put nothing on the clipboard');
  F.deselect();
  const cv = c.querySelector('canvas.interactive');
  const fresh = () => F.live().filter(e => !before.has(e.id));
  let made = [];
  for (let attempt = 0; attempt < 5 && !made.length; attempt++) {
    const r = cv.getBoundingClientRect();
    const spots = [[0.7, 0.7], [0.6, 0.4], [0.3, 0.6], [0.5, 0.5], [0.8, 0.3], [0.2, 0.2]].map(([u, v]) => [r.left + r.width * u, r.top + r.height * v]);
    const spot = spots.find(([x, y]) => document.elementFromPoint(x, y) === cv);
    if (!spot) { await sleep(200); continue; }
    if (!c.contains(document.activeElement)) c.focus();
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: spot[0], clientY: spot[1], bubbles: true, pointerId: 1, pointerType: 'mouse' }));
    await sleep(50);
    if (!c.contains(document.activeElement)) continue;
    const pdt = new DataTransfer();
    for (const t of dt.types) pdt.setData(t, dt.getData(t));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: pdt, bubbles: true, cancelable: true }));
    for (let i = 0; i < 50 && fresh().length < els.length; i++) await sleep(20);
    made = fresh();
  }
  if (made.length !== els.length) throw new Error('Cmd+V made ' + made.length + ' elements, expected ' + els.length);
  F.deselect();
}

// Alt-drags genotype n so its allele center moves to [x, y] (scene
// coordinates), with pointer events on the canvas as a mouse would send them.
// Returns the element ids of the drawing that ends up at [x, y].
async function altDrag(n, [x, y]) {
  const els = F.els(n);
  // Exactly this genotype's group selected: a group left selected by an
  // earlier step would be dragged (and copied) along.
  const want = Object.fromEntries(els.map(e => [e.id, true]));
  api.updateScene({ appState: { selectedElementIds: want, selectedGroupIds: { [els[0].groupIds[0]]: true } } });
  const exact = () => { const st = api.getAppState(), sel = Object.keys(st.selectedElementIds).filter(k => st.selectedElementIds[k]), g = Object.keys(st.selectedGroupIds).filter(k => st.selectedGroupIds[k]);
    return sel.length === els.length && sel.every(k => want[k]) && g.length === 1 && g[0] === els[0].groupIds[0]; };
  for (let i = 0; i < 60 && !exact(); i++) await sleep(16);
  if (!exact()) throw new Error('could not select exactly ' + n);
  const st = api.getAppState(), z = st.zoom.value;
  const client = (sx, sy) => [(sx + st.scrollX) * z + st.offsetLeft, (sy + st.scrollY) * z + st.offsetTop];
  // Grab an allele (text is hit anywhere in its box; the frame only on its edge).
  const al = els.find(e => e.customData.kind === 'genotype-allele');
  const [gx, gy] = [al.x + al.width / 2, al.y + al.height / 2];
  const b = ea.getBoundingBox(els.filter(e => e.customData.kind === 'genotype-allele'));
  const [tx, ty] = [gx + x - (b.topX + b.width / 2), gy + y - (b.topY + b.height / 2)];
  const cv = ea.targetView.contentEl.querySelector('.excalidraw canvas.interactive');
  const ev = (t, sx, sy, buttons) => { const [cx, cy] = client(sx, sy);
    return new PointerEvent(t, { clientX: cx, clientY: cy, altKey: true, button: 0, buttons, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, cancelable: true }); };
  // Taken only now: the fixture just loaded may not have landed before.
  const before = new Set(api.getSceneElements().map(e => e.id));
  cv.dispatchEvent(ev('pointermove', gx, gy, 0));
  cv.dispatchEvent(ev('pointerdown', gx, gy, 1));
  await sleep(30);
  for (let k = 1; k <= 10; k++) { cv.dispatchEvent(ev('pointermove', gx + (tx - gx) * k / 10, gy + (ty - gy) * k / 10, 1)); await sleep(16); }
  cv.dispatchEvent(ev('pointerup', tx, ty, 0));
  window.dispatchEvent(ev('pointerup', tx, ty, 0));
  let fresh = [];
  for (let i = 0; i < 100 && fresh.length < els.length; i++) { await sleep(20); fresh = F.live().filter(e => !before.has(e.id)); }
  if (fresh.length !== els.length) throw new Error('alt-drag made ' + fresh.length + ' elements, expected ' + els.length);
  F.deselect();
  // Excalidraw may move the originals and leave the copies behind; return
  // whichever drawing is at the target.
  const moved = F.live().filter(e => e.customData?.genotypeId === window.__t[n] && e.customData.kind === 'genotype-allele' && Math.abs(e.x + e.width / 2 - tx) < 200 && Math.abs(e.y + e.height / 2 - ty) < 60);
  const g = moved[0]?.groupIds[0];
  return F.live().filter(e => e.customData?.genotypeId === window.__t[n] && e.groupIds[0] === g).map(e => e.id);
}

// A x the drawing of P2 whose element ids are `drawing` -> B; then checks.
async function backcross(drawing, how, p2Alleles) {
  const copyAllele = F.live().find(e => drawing.includes(e.id) && e.customData?.kind === 'genotype-allele');
  const aAllele = F.els('A', 'genotype-allele')[0];
  window.__flyWant = [aAllele.id, copyAllele.id];
  ea.selectElementsInView([aAllele, copyAllele]);
  window._crossGenotypesLastResult = undefined;
  window._crossGenotypesAuto = { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'B' };
  await T.run('Cross Genotypes');
  window.__t.B = window._crossGenotypesLastResult;
  if (!window.__t.B) throw new Error('Cross Genotypes made no offspring');
  const bPar = F.els('B').find(e => e.customData.parents)?.customData.parents;
  const twins = frames().filter(f => alleles(f.customData.genotypeId) === p2Alleles).map(f => f.customData.genotypeId);
  T.pass(twins.length === 2 && new Set(twins).size === 2,
    how + ': P2 and its copy are two genotypes',
    how + ': P2 and its copy: ' + twins.length + ' frame(s), ' + new Set(twins).size + ' genotype id(s)');
  const copyGid = twins.find(g => g !== window.__t.P2);
  if (copyGid) window.__t.P2copy = copyGid;
  T.pass(F.els('P2', 'genotype-frame').length === 1, how + ': P2 drawn once', how + ': P2 drawn ' + F.els('P2', 'genotype-frame').length + ' times');
  T.pass(!!copyGid && bPar?.maternal === window.__t.A && bPar?.paternal === copyGid,
    how + ': B is A x the copy', how + ': B parents ' + F.name(bPar?.maternal) + ' x ' + F.name(bPar?.paternal));
  T.pass(!!copyGid && !F.live().some(e => e.customData?.genotypeId === copyGid && e.customData.parents),
    how + ': the copy of P2 is a founder', how + ': the copy of P2 has parents');
  T.pass(bottom(window.__t.P2) === bottom(window.__t.P1), how + ': P2 stays on P1\'s row', how + ': P2 moved off P1\'s row');
  T.pass(!!copyGid && bottom(copyGid) === bottom(window.__t.A), how + ': the copy is on A\'s row', how + ': the copy is not on A\'s row');
  T.out(F.layout());
  T.check(F.arrows({ pos: true }));
  T.check(F.overlaps());
  T.check(F.foreignX());
  T.check(F.xOverlap());
  T.check(F.cut({ diag: true }));
  await T.unmoved(how + ': second Tidy', T.tidyAll);
}

// ---- 1. Backcross A x a copy of P2 (Cmd+D) --------------------------------------
const aBox = ea.getBoundingBox(F.els('A', 'genotype-allele'));
const p2Alleles = alleles(window.__t.P2);
await backcross(await duplicate('P2', [aBox.topX + aBox.width + 250, aBox.topY + aBox.height / 2]), 'Cmd+D', p2Alleles);

// ---- 2. Backcross A x a copy of P2 (alt-drag) -------------------------------
await T.fixture('backcross');
const aBox4 = ea.getBoundingBox(F.els('A', 'genotype-allele'));
await backcross(await altDrag('P2', [aBox4.topX + aBox4.width + 250, aBox4.topY + aBox4.height / 2]), 'alt-drag', p2Alleles);

// ---- 3. Duplicate an offspring, then Tidy ---------------------------------------
await T.fixture('backcross');
const aAlleles = alleles(window.__t.A);
const bb = ea.getBoundingBox(F.els('A', 'genotype-allele'));
await duplicate('A', [bb.topX + bb.width / 2, bb.topY + bb.height + 300]);
await T.tidyAll();
const aTwins = frames().filter(f => alleles(f.customData.genotypeId) === aAlleles).map(f => f.customData.genotypeId);
T.pass(aTwins.length === 2 && new Set(aTwins).size === 2,
  'A and its copy survive Tidy as two genotypes',
  'A and its copy after Tidy: ' + aTwins.length + ' frame(s), ' + new Set(aTwins).size + ' genotype id(s)');
const aCopy = aTwins.find(g => g !== window.__t.A);
T.pass(!!aCopy && !F.live().some(e => e.customData?.genotypeId === aCopy && e.customData.parents),
  'the copy of A has no parents', 'the copy of A has parents');
T.check(F.arrows({ pos: true }));
T.check(F.overlaps());

// ---- 4. Duplicate a whole family, then Tidy ---------------------------------
await T.fixture('backcross');
{
  const { P1, P2, A } = window.__t;
  const p1Alleles = alleles(P1);
  const xOf = (m, p) => F.live().filter(e => e.customData?.kind === 'cross-glyph' && e.customData.parents?.maternal === m && e.customData.parents?.paternal === p);
  const arrowsTo = g => F.live().filter(e => e.customData?.kind === 'cross-lineage' && e.customData.childGenotypeId === g);
  const fam = [...F.els('P1'), ...F.els('P2'), ...xOf(P1, P2), ...F.els('A'), ...arrowsTo(A)];
  await shift(await cmdD(fam), 0, 600);
  await T.tidyAll();
  const parentsOf = g => F.live().find(e => e.customData?.genotypeId === g && e.customData.parents)?.customData.parents;
  const aPar = parentsOf(A);
  T.pass(aPar?.maternal === P1 && aPar?.paternal === P2, 'family copy: A is still P1 x P2',
    'family copy: A parents ' + F.name(aPar?.maternal) + ' x ' + F.name(aPar?.paternal));
  T.pass(xOf(P1, P2).length === 1, 'family copy: one x of P1 x P2', 'family copy: ' + xOf(P1, P2).length + ' x glyphs of P1 x P2');
  for (const n of ['P1', 'P2']) {
    const k = F.els(n, 'genotype-frame').length;
    T.pass(k === 1, 'family copy: ' + n + ' drawn once', 'family copy: ' + n + ' drawn ' + k + ' time(s)');
  }
  const aTwins = frames().filter(f => alleles(f.customData.genotypeId) === aAlleles).map(f => f.customData.genotypeId);
  const aCopy = aTwins.find(g => g !== A);
  T.pass(aTwins.length === 2 && !!aCopy, 'family copy: A and its copy are two genotypes',
    'family copy: A and its copy: ' + aTwins.length + ' frame(s), ' + new Set(aTwins).size + ' genotype id(s)');
  const cPar = aCopy && parentsOf(aCopy);
  const m = cPar?.maternal, p = cPar?.paternal;
  T.pass(!!m && !!p && m !== P1 && p !== P2 && m !== p && alleles(m) === p1Alleles && alleles(p) === p2Alleles,
    'family copy: the copy of A is the child of copies of P1 and P2',
    'family copy: the copy of A has parents ' + F.name(m) + ' (' + (m && alleles(m)) + ') x ' + F.name(p) + ' (' + (p && alleles(p)) + ')');
  T.pass(!!m && !!p && frames().filter(f => f.customData.genotypeId === m).length === 1 && frames().filter(f => f.customData.genotypeId === p).length === 1
    && !parentsOf(m) && !parentsOf(p),
    'family copy: the copies of P1 and P2 are founders, drawn once', 'family copy: the copies of P1 and P2 are not single founders');
  T.pass(!!m && !!p && xOf(m, p).length === 1, 'family copy: one x of the copied parents',
    'family copy: ' + (m && p ? xOf(m, p).length : 0) + ' x glyphs of the copied parents');
  T.out(F.layout());
  T.check(F.arrows({ pos: true }));
  T.check(F.overlaps());
  T.check(F.foreignX());
  T.check(F.xOverlap());
  T.check(F.cut({ diag: true }));
  await T.unmoved('family copy: second Tidy', T.tidyAll);
}

// ---- 5. Copy and paste an offspring, then Tidy ------------------------------
await T.fixture('backcross');
await copyPaste('A');
await T.tidyAll();
const pTwins = frames().filter(f => alleles(f.customData.genotypeId) === aAlleles).map(f => f.customData.genotypeId);
T.pass(pTwins.length === 2 && new Set(pTwins).size === 2,
  'A and its pasted copy survive Tidy as two genotypes',
  'A and its pasted copy after Tidy: ' + pTwins.length + ' frame(s), ' + new Set(pTwins).size + ' genotype id(s)');
const pCopy = pTwins.find(g => g !== window.__t.A);
T.pass(!!pCopy && !F.live().some(e => e.customData?.genotypeId === pCopy && e.customData.parents),
  'the pasted copy of A has no parents', 'the pasted copy of A has parents');
T.check(F.arrows({ pos: true }));
T.check(F.overlaps());
JS
