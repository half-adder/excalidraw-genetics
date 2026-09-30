#!/usr/bin/env bash
# Regression test: every operation is undone by one undo and redone by one
# redo. For each operation, starting from a fixture, takes the scene before
# it, runs it, then presses Cmd+Z on the drawing until the scene is back (at
# most 8 times) and checks:
#   1. one undo restores the scene exactly (every element by id, ignoring
#      version, versionNonce and updated; numbers within 0.5 px;
#      boundElements compared as a set of {id, type} references, order
#      ignored, since Excalidraw's undo merges it by id and appends a
#      reference it brings back, e.g. Break Cross's arrow on its x),
#   2. no undo step on the way leaves a genotype that existed before the
#      operation missing (no drawing that "deletes a bunch of stuff"),
#   3. a second undo changes nothing (no step hides under the operation's;
#      the undo history is cleared after each case's setup),
#   4. then one redo (Cmd+Shift+Z) gives back the scene the operation made,
#      exactly, and a second redo changes nothing.
# Operations: Genotype (create, edit), Cross Genotypes (plain and a
# backcross, both with the Tidy it starts), Cross Mode (a line drawn between
# two genotypes: the line, the cross and its Tidy; undo goes back to before
# the line), Tidy (everything; several genotypes selected; a drawing whose
# backcross parent needs a copy; a genotype duplicated with Cmd+D), Tidy
# Below, Break Cross.
# Cancelled operations (the Cross Genotypes picker cancelled, directly and
# from Cross Mode): the drawing is unchanged, and a user edit made next is
# undone by one undo, alone, with nothing before it to undo.
# Failures (test hooks make a script throw): Tidy failing right after its
# delete, inside a cross, leaves the drawing as the cross made it and one
# undo restores the drawing before the cross; Cross Genotypes failing inside
# Cross Mode (after Cross Mode created a genotype) ends the operation, one
# undo removes that genotype, and the next command is its own step; Tidy
# Below failing after its Select Below split a Cmd+D copy keeps the split,
# one undo step.
# Rollback: a parent that throws after its child changed an element the
# parent had changed keeps the child's change (only the parent's own, not
# changed since, are put back).
# Another drawing (the harness tab switches to a second throwaway drawing,
# reusing the view): with a Cross Mode operation still open (picker open, a
# genotype already created), cancelling or confirming the picker there
# writes and records nothing in it; Tidy Below whose tab switches before it
# starts Tidy starts nothing and leaves no seed.
# Prints what differs from the scene before the operation after each undo,
# PASS/FAIL per check, and the number of undo steps each operation
# took; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The view's open operation: the plugin keeps its own registry (read through
// plugin.testing), the scripts theirs in window._flyOperations.
const opOf = v => T.engine === 'plugin' ? app.plugins.plugins['fly-genetics'].testing.openOperation(v) : window._flyOperations?.get(v);
const IGNORE = ['version', 'versionNonce', 'updated'];
// boundElements is compared as a set of {id, type} references: Excalidraw's
// undo merges it by id and appends a reference it brings back.
const refs = b => Array.isArray(b) ? [...b].sort((x, y) => x.id < y.id ? -1 : x.id > y.id ? 1 : 0) : b;
const strip = e => Object.fromEntries(Object.entries(e).filter(([k]) => !IGNORE.includes(k)).map(([k, v]) => [k, k === 'boundElements' ? refs(v) : v]));
const same = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.5
  : a && b && typeof a === 'object' && typeof b === 'object'
    ? Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => k in b && same(a[k], b[k]))
    : a === b;
const scene = () => new Map(F.live().map(e => [e.id, structuredClone(e)]));
const sig = m => [...m.values()].map(e => e.id + ':' + e.version).sort().join('|');
const equal = (a, b) => a.size === b.size && [...a].every(([id, e]) => b.has(id) && same(strip(e), strip(b.get(id))));
const gidsOf = m => new Set([...m.values()].filter(e => e.customData?.kind === 'genotype-allele').map(e => e.customData.genotypeId));
const press = (shift = false) => {
  const c = F.view().targetView.contentEl.querySelector('.excalidraw');
  c.dispatchEvent(new KeyboardEvent('keydown', { key: shift ? 'Z' : 'z', code: 'KeyZ', metaKey: true, shiftKey: shift, bubbles: true, cancelable: true }));
};
const undo = () => press();
// Presses Cmd+Z (or Cmd+Shift+Z) and waits up to 1 s for the scene to change.
const step = async (shift = false) => {
  const s0 = sig(scene());
  press(shift);
  for (let i = 0; i < 50 && sig(scene()) === s0; i++) await sleep(20);
};
// Names the elements that differ between two scenes.
const differ = (a, b) => {
  const out = [];
  for (const [id, e] of a) {
    if (!b.has(id)) { out.push('missing ' + (e.customData?.kind ?? e.type)); continue; }
    const f = Object.keys({ ...strip(e), ...strip(b.get(id)) }).filter(k => !same(strip(e)[k], strip(b.get(id))[k]));
    if (f.length) out.push((e.customData?.kind ?? e.type) + ':' + f.join(','));
  }
  for (const [id, e] of b) if (!a.has(id)) out.push('extra ' + (e.customData?.kind ?? e.type));
  return out.slice(0, 4).join('; ');
};

// Runs `op` after `setup`, then undoes until the scene matches the one
// before `op`; reports steps and any undo step with genotypes missing.
async function check(what, fixture, op, setup = async () => {}) {
  await T.fixture(fixture);
  await setup();
  await sleep(100);
  F.deselect();
  await sleep(50);
  // Setup steps are not the operation's: settle what they left pending
  // (arrows Excalidraw re-routes after a move) and forget them.
  settle();
  const before = scene(), gids = gidsOf(before);
  await op();
  await sleep(100);
  const after = scene();
  let steps = 0, restored = equal(after, before);
  const holes = [];
  { const now = scene(); T.out('  after op: ' + now.size + ' elements (before ' + before.size + ')'); }
  while (!restored && steps < 8) {
    const s0 = sig(scene());
    undo();
    steps++;
    for (let i = 0; i < 50 && sig(scene()) === s0; i++) await sleep(20);
    const now = scene();
    restored = equal(now, before);
    { const miss = [...before.keys()].filter(id => !now.has(id)), extra = [...now.keys()].filter(id => !before.has(id)), chg = [...before].filter(([id, e]) => now.has(id) && !same(strip(e), strip(now.get(id))));
      const k = ids => { const c = {}; for (const id of ids) { const e = before.get(id) ?? now.get(id); const kk = e.customData?.kind ?? e.type; c[kk] = (c[kk] ?? 0) + 1; } return JSON.stringify(c); };
      const fields = chg.slice(0, 2).map(([id, e]) => (e.customData?.kind ?? e.type) + ':' + Object.keys(strip(e)).filter(f => !same(strip(e)[f], strip(now.get(id))[f])).join(','));
      T.out('  undo ' + steps + ': missing ' + k(miss) + ' extra ' + k(extra) + ' changed ' + chg.length + ' ' + fields.join(' ')); }
    const missing = [...gids].filter(g => !gidsOf(now).has(g));
    if (missing.length) holes.push('after undo ' + steps + ': ' + missing.map(g => F.name(g)).join(', ') + ' missing');
  }
  T.out(what + ': ' + (restored ? steps + ' undo step(s)' : 'not restored after ' + steps + ' undos'));
  T.pass(restored && steps === 1, what + ': one undo restores the drawing', what + ': ' + (restored ? steps + ' undos needed' : 'never restored'));
  T.pass(!holes.length, what + ': no undo step loses a genotype', what + ': ' + holes.join('; '));
  if (restored && steps === 1) {
    await step();
    const again = scene();
    T.pass(equal(again, before), what + ': nothing more to undo', what + ': a second undo changed: ' + differ(before, again));
    await step(true);
    const now = scene();
    await step(true);
    const more = scene();
    T.pass(equal(now, after) && equal(more, after), what + ': one redo re-applies the operation, nothing more to redo',
      what + ': after one redo: ' + (differ(after, now) || 'same') + '; after two: ' + (differ(after, more) || 'same'));
  } else T.check('FAIL: ' + what + ': redo not checked (undo did not restore in one step)');
}

// Takes what is pending into Excalidraw's store unrecorded and clears the
// undo history: what came before is not the operation's.
function settle() {
  const api = F.view().targetView.excalidrawAPI;
  api.updateScene({ elements: api.getSceneElementsIncludingDeleted(), captureUpdate: 'NEVER' });
  api.history.clear();
}
// Selects the named genotypes as the user would before running a command;
// that selection is the user's own step, not the command's, so it is
// settled out of the history.
async function pick(names) {
  const api = F.view().targetView.excalidrawAPI;
  const n = F.select(names);
  await until(() => Object.values(api.getAppState().selectedElementIds).filter(Boolean).length >= n, 1500);
  settle();
}

// Presses undo twice (as `step` does) and checks the first gives `want` and
// the second changes nothing more.
async function oneUndoTo(what, want) {
  await step();
  const first = scene();
  await step();
  const second = scene();
  T.pass(equal(first, want) && equal(second, want), what + ': one undo restores it, nothing more to undo',
    what + ': after one undo: ' + (differ(want, first) || 'same') + '; after two: ' + (differ(want, second) || 'same'));
}

// Runs `op`, which cancels an operation, and checks that the drawing is
// unchanged and that a user edit made next (an allele moved) is undone by one
// undo, alone, with nothing left to undo after it: the cancelled operation
// recorded no step and left nothing to merge into the edit.
async function checkCancel(what, fixture, op) {
  await T.fixture(fixture);
  await sleep(100);
  F.deselect();
  await sleep(50);
  const before = scene();
  await op();
  await sleep(200);
  T.pass(equal(scene(), before), what + ': the drawing is unchanged', what + ': changed: ' + differ(before, scene()));
  const ea = F.view(), el = F.live().find(e => e.customData?.kind === 'genotype-allele');
  ea.clear();
  ea.copyViewElementsToEAforEditing([el]);
  ea.getElement(el.id).x += 40;
  await ea.addElementsToView(false, false, true);
  ea.clear();
  await sleep(100);
  const edited = scene();
  await step();
  const first = scene();
  await step();
  const second = scene();
  T.pass(!equal(edited, before) && equal(first, before) && equal(second, before),
    what + ': the next edit is undone alone, nothing else to undo',
    what + ': after one undo: ' + (differ(before, first) || 'same') + '; after two: ' + (differ(before, second) || 'same'));
}

const auto = (name) => ({ offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: name });
const has = (p, gid) => !!p && (p.maternal === gid || p.paternal === gid);
const until = async (f, ms = 8000) => { for (let t = 0; t < ms; t += 50) { if (f()) return true; await sleep(50); } return false; };

// Turns Cross Mode on and draws a cross line from genotype m to genotype f
// (as the user would: one recorded scene change), then waits until the
// picker has run (`auto` answers it; without it, the picker is cancelled
// with its Cancel button) and the operation has ended.
async function crossModeLine(m, f, auto) {
  const ea = F.view(), view = ea.targetView, api = view.excalidrawAPI;
  await T.run('Cross Mode');
  if (!window._flyCrossMode) throw new Error('Cross Mode did not turn on');
  await until(() => api.getAppState().activeTool.type === 'line', 3000);
  window._crossGenotypesAuto = auto;
  window._crossGenotypesLastResult = undefined;
  const mid = n => { const r = F.els(n, 'genotype-frame')[0]; return [r.x + r.width / 2, r.y + r.height / 2]; };
  ea.clear();
  ea.style.strokeColor = '#e03131'; ea.style.strokeStyle = 'dashed'; ea.style.opacity = 20; ea.style.roughness = 0;
  ea.addLine([mid(m), mid(f)]);
  await ea.addElementsToView(false, false, false);
  ea.clear();
  ea.style.strokeStyle = 'solid'; ea.style.opacity = 100; ea.style.strokeColor = '#000000';
  if (!auto) {
    let cancel = null;
    await until(() => (cancel = [...document.querySelectorAll('.modal-container .modal button')].find(b => b.textContent === 'Cancel')));
    if (!cancel) throw new Error('Cross Mode: the cross picker did not open');
    cancel.click();
  }
  if (!await until(() => window._crossGenotypesLastResult !== undefined)) throw new Error('Cross Mode: no cross');
  await until(() => !opOf(view), 10000);
  await sleep(200);
  if (auto) await until(() => !window._flyCrossMode, 4000);
  window._flyCrossMode?.stop();
}

// Deletes genotype copyGid and points every `parents` that names it at into
// (a drawing made before Tidy copied a parent crossed on two rows).
async function foldCopy(copyGid, into) {
  const ea = F.view();
  const els = F.live().filter(e => e.customData?.genotypeId === copyGid);
  const refs = F.live().filter(e => has(e.customData?.parents, copyGid));
  ea.clear();
  ea.copyViewElementsToEAforEditing([...els, ...refs]);
  for (const e of els) ea.getElement(e.id).isDeleted = true;
  for (const e of refs) {
    const p = { ...e.customData.parents };
    for (const k of ['maternal', 'paternal']) if (p[k] === copyGid) p[k] = into;
    ea.getElement(e.id).customData = { ...e.customData, parents: p };
  }
  await ea.addElementsToView(false, false, true);
  ea.clear();
}

// Duplicates genotype n with Excalidraw's own Cmd+D and moves the copy by
// (dx, dy).
async function duplicate(n, dx, dy) {
  const ea = F.view(), api = ea.targetView.excalidrawAPI;
  const els = F.els(n), seen = new Set(api.getSceneElements().map(e => e.id));
  window.__flyWant = els.map(e => e.id);
  ea.selectElementsInView(els);
  await until(() => els.every(e => api.getAppState().selectedElementIds[e.id]), 1000);
  const c = ea.targetView.contentEl.querySelector('.excalidraw');
  const key = t => (c.querySelector('canvas.interactive') || c).dispatchEvent(new KeyboardEvent(t, { key: 'd', code: 'KeyD', metaKey: t === 'keydown', ctrlKey: t === 'keydown', bubbles: true, cancelable: true }));
  key('keydown');
  key('keyup');
  let fresh = [];
  await until(() => (fresh = F.live().filter(e => !seen.has(e.id))).length >= els.length, 2000);
  if (fresh.length !== els.length) throw new Error('Cmd+D made ' + fresh.length + ' elements, expected ' + els.length);
  ea.clear();
  ea.copyViewElementsToEAforEditing(fresh);
  for (const e of fresh) { const w = ea.getElement(e.id); w.x += dx; w.y += dy; }
  await ea.addElementsToView(false, false, true);
  ea.clear();
}

await check('Genotype (create)', 'backcross', () => T.genotype('N', { glyph: '♂', X: { top: 'y', bottom: 'Y' }, II: { top: '+', bottom: '+' }, III: { top: 'Sb', bottom: 'TM3' } }));
await check('Genotype (edit)', 'backcross', async () => {
  await pick(['A']);
  window._genotypeAuto = { glyph: '♀', X: { top: 'w', bottom: 'w' }, II: { top: 'Sp', bottom: 'Gla' }, III: { top: '+', bottom: 'TM3' } };
  await T.run('Genotype');
});
await check('Cross Genotypes', 'backcross', () => T.cross('B', 'P1', 'P2', auto('B')));
await check('Cross Genotypes (backcross)', 'backcross', () => T.cross('B', 'A', 'P2', auto('B')));
await check('Cross Mode', 'backcross', () => crossModeLine('P1', 'P2', auto('B')));
await check('Tidy', 'joined-families', () => T.tidyAll(),
  () => F.move({ Q2: [-900, 300], D: [600, 0], P1: [500, -200], C: [-300, 700] }));
await check('Tidy (several selected)', 'below', async () => { await pick(['C', 'D', 'E', 'P4']); await T.run('Tidy'); },
  () => F.move({ C: [400, 900], E: [-500, 1200] }));
await check('Tidy (backcross split)', 'backcross', () => T.tidyAll(), async () => {
  await T.cross('B', 'A', 'P2', auto('B'));
  const p2 = F.els('P2', 'genotype-allele').map(e => e.originalText).sort().join();
  const copies = [...new Set(F.live().filter(e => e.customData?.kind === 'genotype-frame' && e.customData.genotypeId !== window.__t.P2
    && F.live().filter(a => a.customData?.genotypeId === e.customData.genotypeId && a.customData.kind === 'genotype-allele').map(a => a.originalText).sort().join() === p2)
    .map(e => e.customData.genotypeId))];
  if (!copies.length) throw new Error('backcross made no copy of P2');
  for (const c of copies) await foldCopy(c, window.__t.P2);
});
await check('Tidy (duplicate split)', 'backcross', () => T.tidyAll(), () => duplicate('P2', 0, 400));
await check('Tidy Below', 'below', async () => { await pick(['C']); await T.run('Tidy Below'); },
  () => F.move({ C: [400, 900], E: [-500, 1200] }));
await check('Break Cross', 'below', async () => { await pick(['A']); await T.run('Break Cross'); });
await checkCancel('Cross Genotypes (cancelled)', 'backcross', async () => {
  F.select(['P1', 'P2']);
  window._crossGenotypesLastResult = undefined;
  const run = T.run('Cross Genotypes');
  let cancel = null;
  await until(() => (cancel = [...document.querySelectorAll('.modal-container .modal button')].find(b => b.textContent === 'Cancel')));
  if (!cancel) throw new Error('the cross picker did not open');
  cancel.click();
  await run;
});
await checkCancel('Cross Mode (cancelled)', 'backcross', () => crossModeLine('P1', 'P2', null));

// ---- Failures: a script throws; what it changed is put back -------------------
// Snapshots the scene when `name` starts (through the Script Engine, or on
// the plugin engine through plugin.testing.run, where ctx.start registers a
// started command).
function sceneWhenStarts(name) {
  const box = {};
  if (T.engine === 'plugin') {
    const testing = app.plugins.plugins['fly-genetics'].testing, inner = testing.run;
    testing.run = function (n, ...r) { if (n === name && !box.scene) box.scene = scene(); return inner.call(this, n, ...r); };
    box.restore = () => { delete testing.run; };
    return box;
  }
  const se = app.plugins.plugins['obsidian-excalidraw-plugin'].scriptEngine, inner = se.executeScriptFile;
  se.executeScriptFile = function (v, f, n, ...r) { if ((n ?? f?.basename) === name && !box.scene) box.scene = scene(); return inner.call(this, v, f, n, ...r); };
  box.restore = () => { se.executeScriptFile = inner; };
  return box;
}
const opOpen = () => !!opOf(F.view().targetView);

{
  const what = 'Tidy fails after its delete (in a cross)';
  await T.fixture('backcross');
  await sleep(100); F.deselect(); await sleep(50);
  settle();
  const before = scene();
  const box = sceneWhenStarts('Tidy');
  window._tidyFailAfterDelete = true;
  try {
    await pick(['P1', 'P2']);
    window._crossGenotypesAuto = auto('B');
    const errs = await T.run('Cross Genotypes', { tolerate: true });
    T.out('  ' + what + ': errors ' + JSON.stringify(errs));
  } finally { box.restore(); window._tidyFailAfterDelete = undefined; }
  await sleep(200);
  const now = scene();
  T.pass(!!box.scene && !equal(box.scene, before) && equal(now, box.scene), what + ': the drawing is as the cross left it',
    what + ': ' + (!box.scene ? 'Tidy did not run' : differ(box.scene, now)));
  T.pass(!opOpen(), what + ': the operation ended', what + ': the operation is still open');
  await oneUndoTo(what, before);
}
{
  const what = 'Cross Genotypes fails in Cross Mode';
  await T.fixture('backcross');
  await sleep(100); F.deselect(); await sleep(50);
  const ea = F.view(), view = ea.targetView, api = view.excalidrawAPI;
  settle();
  const before = scene(), gids = gidsOf(before);
  await T.run('Cross Mode');
  await until(() => api.getAppState().activeTool.type === 'line', 3000);
  window._genotypeAuto = { glyph: '♂', X: { top: 'y', bottom: 'Y' }, II: { top: '+', bottom: '+' }, III: { top: 'Sb', bottom: 'TM3' } };
  window._crossGenotypesAuto = auto('B');
  window._crossGenotypesFail = true;
  try {
    const r = F.els('P1', 'genotype-frame')[0];
    ea.clear();
    ea.style.strokeColor = '#e03131'; ea.style.strokeStyle = 'dashed'; ea.style.opacity = 20; ea.style.roughness = 0;
    ea.addLine([[r.x + r.width / 2, r.y + r.height / 2], [r.x + r.width / 2, r.y + r.height + 900]]);
    await ea.addElementsToView(false, false, false);
    ea.clear();
    ea.style.strokeStyle = 'solid'; ea.style.opacity = 100; ea.style.strokeColor = '#000000';
    await until(() => window._crossGenotypesFail === undefined, 10000);
    await until(() => !opOpen(), 10000);
    await sleep(300);
  } finally {
    window._crossGenotypesFail = undefined; window._crossGenotypesAuto = undefined; window._genotypeAuto = undefined;
    window._flyCrossMode?.stop();
  }
  const mid = scene(), made = [...gidsOf(mid)].filter(g => !gids.has(g));
  T.pass(!opOpen() && made.length === 1, what + ': the operation ended with the new genotype only',
    what + ': operation ' + (opOpen() ? 'still open' : 'ended') + ', ' + made.length + ' new genotype(s)');
  // The next command is its own step.
  await T.genotype('N2', { glyph: '♀', X: { top: 'w', bottom: 'w' }, II: { top: '+', bottom: '+' }, III: { top: '+', bottom: '+' } });
  await step();
  T.pass(equal(scene(), mid), what + ': the next command is its own undo step', what + ': one undo after it: ' + differ(mid, scene()));
  await oneUndoTo(what, before);
}
{
  const what = 'Tidy Below fails after its Select Below split';
  await T.fixture('below');
  await sleep(100); F.deselect(); await sleep(50);
  await duplicate('E', 0, 400);
  await sleep(100); F.deselect(); await sleep(50);
  settle();
  const before = scene(), gids = gidsOf(before);
  window._tidyBelowFail = true;
  try {
    await pick(['E']);
    const errs = await T.run('Tidy Below', { tolerate: true });
    T.out('  ' + what + ': errors ' + JSON.stringify(errs));
  } finally { window._tidyBelowFail = undefined; }
  await sleep(200);
  const split = [...gidsOf(scene())].filter(g => !gids.has(g)).length;
  T.pass(split === 1 && !opOpen(), what + ': the split stands (one new genotype id), the operation ended',
    what + ': ' + split + ' new genotype id(s), operation ' + (opOpen() ? 'open' : 'ended'));
  await oneUndoTo(what, before);
}

// ---- Rollback keeps what others changed since ----------------------------------
// The shared block, run by hand with two EA instances: a parent operation
// moves an allele and adds a text; a child joins, moves the same allele
// again and adds its own text; the parent then throws. The parent's text is
// removed, the allele keeps the child's move (not reverted under it), the
// child's text stays; one undo restores the drawing.
{
  const what = 'Rollback skips elements changed since by another script';
  await T.fixture('backcross');
  await sleep(100); F.deselect(); await sleep(50);
  settle();
  const view = F.view().targetView;
  const src = require('fs').readFileSync(T.repo + '/scripts/Tidy.md', 'utf8');
  const block = src.slice(src.indexOf('// ---- Undo-safe operations'), src.indexOf('// ---- End of undo-safe operations'));
  const helpers = e => new Function('ea', 'app', 'Notice', block + '; return { flyOperation, flyAddElementsToView };')(e, app, Notice);
  const pe = ExcalidrawAutomate.getAPI(view), ce = ExcalidrawAutomate.getAPI(view);
  const P = helpers(pe), C = helpers(ce);
  const before = scene();
  const al = F.live().find(e => e.customData?.kind === 'genotype-allele');
  let threw = null;
  try {
    await P.flyOperation('Parent', async () => {
      pe.copyViewElementsToEAforEditing([al]); pe.getElement(al.id).x += 100; pe.addText(0, -400, 'parent'); await P.flyAddElementsToView(); pe.clear();
      await C.flyOperation('Child', async () => {
        const cur = F.live().find(e => e.id === al.id);
        ce.copyViewElementsToEAforEditing([cur]); ce.getElement(al.id).y += 50; ce.addText(0, -500, 'child'); await C.flyAddElementsToView(); ce.clear();
      });
      throw new Error('parent fails');
    });
  } catch (e) { threw = e.message; }
  await sleep(200);
  const now = scene(), a = now.get(al.id), texts = [...now.values()].filter(e => e.type === 'text' && ['parent', 'child'].includes(e.originalText)).map(e => e.originalText);
  T.pass(threw === 'parent fails' && a && Math.abs(a.x - (al.x + 100)) < 0.5 && Math.abs(a.y - (al.y + 50)) < 0.5 && texts.join() === 'child',
    what + ': the child\'s move and text stay, the parent\'s text is gone',
    what + ': threw ' + threw + ', allele moved ' + (a ? [a.x - al.x, a.y - al.y] : 'missing') + ', texts ' + texts.join());
  await oneUndoTo(what, before);
}

// ---- Another drawing: an open operation writes and records nothing there ------
// Opens throwaway drawing B in the harness tab (Obsidian reuses the view),
// with the `below` fixture as its content, then runs `during` there and
// checks B is unchanged and one undo in B changes nothing; switches back to
// the harness drawing and trashes B.
async function inOtherDrawing(what, during) {
  const view = F.view().targetView, A = view.file;
  const leaf = app.workspace.getLeavesOfType('excalidraw').find(l => l.view === view);
  const B = 'Excalidraw/_test-undo-other.excalidraw.md';
  const api = () => leaf.view.excalidrawAPI;
  const liveOf = () => new Map(api().getSceneElements().map(e => [e.id, structuredClone(e)]));
  let sceneB = null, afterB = null, afterUndoB = null, sameView = false;
  const open = async () => {
    const f = app.vault.getAbstractFileByPath(B) ?? await app.vault.create(B, await app.vault.adapter.read(A.path));
    await leaf.setViewState({ type: 'excalidraw', state: { file: f.path }, active: true });
    await until(() => leaf.view.file?.path === B && !!leaf.view.excalidrawAPI, 5000);
    sameView = leaf.view === view;
    if (leaf.view.file?.path !== B) throw new Error('the other drawing did not open');
    await sleep(500);
    const fx = JSON.parse(require('fs').readFileSync(T.repo + '/tests/fixtures/below.json', 'utf8'));
    api().updateScene({ elements: fx.elements, captureUpdate: 'NEVER' });
    api().history.clear();
    await sleep(100);
    sceneB = liveOf();
  };
  try {
    await during(open);
    await until(() => !opOf(leaf.view), 5000);
    await sleep(300);
    if (sceneB) {
      afterB = liveOf();
      leaf.view.contentEl.querySelector('.excalidraw').dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true }));
      await sleep(400);
      afterUndoB = liveOf();
    }
  } finally {
    document.querySelectorAll('.modal-container .modal button').forEach(b => { if (b.textContent === 'Cancel') b.click(); });
    window._genotypeAuto = undefined;
    window._flyCrossMode?.stop();
    if (leaf.view.file?.path !== A.path) {
      await leaf.setViewState({ type: 'excalidraw', state: { file: A.path }, active: true });
      await until(() => leaf.view.file?.path === A.path && !!leaf.view.excalidrawAPI, 5000);
      await sleep(300);
    }
    for (const p of [B, B.replace(/\.md$/, '.svg'), 'Excalidraw/_test-undo-other.svg']) {
      const f = app.vault.getAbstractFileByPath(p);
      if (f) try { await app.vault.delete(f); } catch (e) {}
    }
  }
  T.pass(sameView, what + ': the tab reused the view for the other drawing', what + ': the view was not reused');
  T.pass(!!sceneB && equal(afterB, sceneB), what + ': nothing written to the other drawing',
    what + ': ' + (sceneB ? differ(sceneB, afterB) : 'not reached'));
  T.pass(!!sceneB && equal(afterUndoB, sceneB), what + ': nothing recorded there (undo changes nothing)',
    what + ': ' + (sceneB ? differ(sceneB, afterUndoB) : 'not reached'));
}

// A Cross Mode operation still open (a genotype created, the picker open)
// when the tab switches drawing; the picker is then cancelled or confirmed.
async function crossModeThenSwitch(what, button) {
  await T.fixture('backcross');
  await sleep(100); F.deselect(); await sleep(50);
  const ea = F.view(), view = ea.targetView;
  await T.run('Cross Mode');
  await until(() => view.excalidrawAPI.getAppState().activeTool.type === 'line', 3000);
  window._genotypeAuto = { glyph: '♂', X: { top: 'y', bottom: 'Y' }, II: { top: '+', bottom: '+' }, III: { top: 'Sb', bottom: 'TM3' } };
  window._crossGenotypesAuto = undefined;
  window._crossGenotypesLastResult = undefined;
  await inOtherDrawing(what, async open => {
    const r = F.els('P1', 'genotype-frame')[0];
    ea.clear();
    ea.style.strokeColor = '#e03131'; ea.style.strokeStyle = 'dashed'; ea.style.opacity = 20; ea.style.roughness = 0;
    ea.addLine([[r.x + r.width / 2, r.y + r.height / 2], [r.x + r.width / 2, r.y + r.height + 900]]);
    await ea.addElementsToView(false, false, false);
    ea.clear();
    ea.style.strokeStyle = 'solid'; ea.style.opacity = 100; ea.style.strokeColor = '#000000';
    const find = t => [...document.querySelectorAll('.modal-container .modal button')].find(b => b.textContent === t);
    await until(() => find(button));
    if (!find(button)) throw new Error('the cross picker did not open');
    T.pass(opOpen(), what + ': an operation is open (a genotype created, picker open)', what + ': no open operation');
    await open();
    find(button).click();
    await until(() => window._crossGenotypesLastResult !== undefined || !opOf(view), 5000);
  });
}
await crossModeThenSwitch('Tab switched, picker then cancelled', 'Cancel');
await crossModeThenSwitch('Tab switched, picker then confirmed', 'OK');

// Tidy Below: the tab switches while it waits to start Tidy; Tidy is not
// started (in either drawing) and its seed is dropped.
{
  const what = 'Tab switched before Tidy Below starts Tidy';
  await T.fixture('below');
  await sleep(100); F.deselect(); await sleep(50);
  const tidied = window._tidyLastResult;
  await inOtherDrawing(what, async open => {
    window._tidyBelowPause = open;
    F.select(['C']);
    await T.run('Tidy Below', { tolerate: true });
  });
  T.pass(window._tidyLastResult === tidied && !window._tidySeed, what + ': Tidy not started, no seed left',
    what + ': Tidy ran ' + ((window._tidyLastResult ?? 0) - (tidied ?? 0)) + ' time(s), seed ' + JSON.stringify(window._tidySeed));
  window._tidyBelowPause = undefined;
}
JS
