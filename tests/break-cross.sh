#!/usr/bin/env bash
# Break Cross. Fixture below: P1 x P2 -> A (criterion CyO), B; A x P3 -> C, D;
# C x P4 -> E, tidied. Each case starts from the fixture. Checks
#   1. offspring A selected: A's lineage arrow and criterion are gone,
#      `parents` is removed from all of A's elements, B keeps its own, the
#      P1 x P2 x stays (B remains), and nothing else changed;
#   2. the P1 x P2 x selected: the x, the arrows into A and B and A's
#      criterion are removed, A and B are standalone, nothing else changed;
#   3. E (the only offspring of C x P4) selected: E is detached and the
#      C x P4 x is removed too, nothing else changed;
#   4. after case 2, one undo (Cmd+Z on the drawing) restores the drawing.
# In every case no genotype element is deleted. "Nothing else changed"
# compares every element by id, ignoring version, versionNonce and updated,
# numbers within 0.5 px.
# Prints PASS/FAIL; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const N = () => window.__t;
const IGNORE = ['version', 'versionNonce', 'updated'];
const strip = e => Object.fromEntries(Object.entries(e).filter(([k]) => !IGNORE.includes(k)));
// Deep equality; numbers within 0.5 px (Excalidraw re-centers bound text by
// a hundredth of a pixel when it restores it).
const same = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 0.5
  : a && b && typeof a === 'object' && typeof b === 'object'
    ? Array.isArray(a) === Array.isArray(b) && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => k in b && same(a[k], b[k]))
    : a === b;
const eqEl = (a, b) => same(strip(a), strip(b));
const scene = () => new Map(F.live().map(e => [e.id, structuredClone(e)]));
const kind = k => e => e.customData?.kind === k;
const glyphOf = (m, f) => F.live().find(e => kind('cross-glyph')(e) && e.customData.parents.maternal === N()[m] && e.customData.parents.paternal === N()[f]);
const into = c => F.live().filter(e => (kind('cross-lineage')(e) || kind('cross-criterion')(e)) && e.customData.childGenotypeId === N()[c]);
const api = () => F.view().targetView.excalidrawAPI;

// The expected scene: `before` without the `gone` ids, bound-element lists
// without them, and `parents` dropped from the elements of the `detached`
// genotypes. Compared with the live scene, element by element.
const expect = (what, before, gone, detached) => {
  const gids = new Set(detached.map(n => N()[n]));
  const want = new Map();
  for (const [id, e0] of before) {
    if (gone.has(id)) continue;
    const e = structuredClone(e0);
    if (e.boundElements) e.boundElements = e.boundElements.filter(b => !gone.has(b.id));
    if (gids.has(e.customData?.genotypeId)) delete e.customData.parents;
    want.set(id, e);
  }
  const now = scene(), bad = [];
  for (const [id, e] of want) {
    if (!now.has(id)) bad.push('missing ' + (e.customData?.kind ?? e.type) + ' ' + id);
    else if (!eqEl(now.get(id), e)) bad.push('changed ' + (e.customData?.kind ?? e.type) + ' ' + F.name(e.customData?.genotypeId ?? e.customData?.childGenotypeId) + ': ' + diff(e, now.get(id)));
  }
  for (const id of now.keys()) if (!want.has(id)) bad.push('extra ' + (now.get(id).customData?.kind ?? now.get(id).type) + ' ' + id);
  T.pass(!bad.length, what + ': exactly the expected elements removed or changed', what + ': ' + bad.slice(0, 6).join('; '));
  const genoBefore = [...before.values()].filter(e => e.customData?.genotypeId).length;
  const genoNow = [...now.values()].filter(e => e.customData?.genotypeId).length;
  T.pass(genoBefore === genoNow, what + ': no genotype element deleted (' + genoNow + ')', what + ': genotype elements ' + genoBefore + ' -> ' + genoNow);
};
const diff = (a, b) => Object.keys({ ...a, ...b }).filter(k => !IGNORE.includes(k) && !same(a[k], b[k]))
  .map(k => k + ' ' + JSON.stringify(a[k]) + ' -> ' + JSON.stringify(b[k])).join(', ');
const parentsLeft = n => F.els(n).filter(e => e.customData.parents).length;
const selectEls = els => { window.__flyWant = els.map(e => e.id); F.view().selectElementsInView(els); };

// 1. Detach one offspring (A); its sibling B remains.
await T.fixture('below');
T.setup(['P1', 'P2', 'A', 'B', 'P3', 'C', 'D', 'P4', 'E']);
let before = scene();
let gone = new Set(into('A').map(e => e.id));
const x12 = glyphOf('P1', 'P2').id;
T.pass(gone.size === 2, 'A has an arrow and a criterion', 'A has ' + gone.size + ' lineage elements');
F.select(['A']);
await T.run('Break Cross');
T.pass(!into('A').length && parentsLeft('A') === 0, 'A: arrow and criterion gone, no parents left', 'A: ' + into('A').length + ' lineage elements, ' + parentsLeft('A') + ' elements with parents');
T.pass(into('B').length === 1 && parentsLeft('B') === F.els('B').length && !!F.live().find(e => e.id === x12),
  'B keeps its arrow and parents; the P1 x P2 x stays', 'B or the P1 x P2 x changed');
expect('detach A', before, gone, ['A']);

// 2. Break a whole cross by selecting its x.
await T.fixture('below');
before = scene();
gone = new Set([x12, ...into('A'), ...into('B')].map(e => e.id ?? e));
selectEls([glyphOf('P1', 'P2')]);
await T.run('Break Cross');
T.pass(!glyphOf('P1', 'P2') && !into('A').length && !into('B').length && !parentsLeft('A') && !parentsLeft('B'),
  'x of P1 x P2 selected: x, arrows and criterion gone, A and B standalone', 'x of P1 x P2 selected: cross not fully broken');
expect('break P1 x P2', before, gone, ['A', 'B']);

// 4. One undo restores the drawing from case 2.
const c = F.view().targetView.contentEl.querySelector('.excalidraw');
c.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true }));
let restored = false, nowS;
for (let i = 0; i < 100 && !restored; i++) {
  await new Promise(r => setTimeout(r, 20));
  nowS = scene();
  restored = nowS.size === before.size && [...before].every(([id, e]) => nowS.has(id) && eqEl(nowS.get(id), e));
}
const miss = [...before].filter(([id, e]) => !nowS.has(id) || !eqEl(nowS.get(id), e)).map(([id, e]) => (e.customData?.kind ?? e.type) + ' ' + (nowS.has(id) ? diff(e, nowS.get(id)) : 'missing'));
T.pass(restored, 'one undo restored the drawing (' + before.size + ' elements)', 'after one undo ' + nowS.size + '/' + before.size + ' elements; ' + miss.slice(0, 4).join('; '));

// 3. Detach the last offspring (E) of C x P4: the x goes too.
await T.fixture('below');
before = scene();
gone = new Set([glyphOf('C', 'P4'), ...into('E')].map(e => e.id));
F.select(['E']);
await T.run('Break Cross');
T.pass(!glyphOf('C', 'P4') && !into('E').length && !parentsLeft('E'), 'last offspring E detached; the C x P4 x removed', 'E: C x P4 x ' + (glyphOf('C', 'P4') ? 'still there' : 'gone') + ', ' + into('E').length + ' lineage elements');
expect('detach E', before, gone, ['E']);
JS
