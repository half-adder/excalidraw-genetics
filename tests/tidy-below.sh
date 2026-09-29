#!/usr/bin/env bash
# Tidy Below (Select Below + Tidy of exactly the selected genotypes). Fixture
# below: P1 x P2 -> A, B (siblings); A x P3 -> C, D; C x P4 -> E, tidied.
# Scrambles C, D, E and P4, nudges B away from A, selects A and runs Tidy
# Below. Checks
#   1. P1, P2, B, the P1 x P2 x glyph and the arrows into A and B did not move,
#   2. A did not move,
#   3. the subtree was tidied (C, D, E, P4 all left their scrambled spots),
#   4. no overlapping genotypes, genotype on a foreign x, or overlapping
#      x glyphs, counting the elements outside the subtree,
#   5. the arrow into A is the same element, with its criterion, elbowed,
#      from the bottom middle of the P1 x P2 x to the top middle of A's frame
#      (within 1 px),
#   6. every arrow is bound at both ends to existing elements,
#   7. a second Tidy Below moves nothing,
#   8. Tidy Below with nothing selected does nothing.
# Then a hand-picked subset: pulls C and D apart, selects just C and D and
# runs plain Tidy. Checks that only C, D and the arrows into them moved, that
# C and D are back in formation, that those arrows are the same elements,
# bound and routed from the A x P3 x to their new frames, and no overlaps.
# Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
await T.fixture('below');
T.setup(['P1', 'P2', 'A', 'B', 'P3', 'C', 'D', 'P4', 'E']);
const N = window.__t;
const eq = (x, y) => JSON.stringify(x) === JSON.stringify(y);

// Problems with the arrow into `c` (exactly one, elbowed, bound from the
// bottom middle of the m x f glyph to the top middle of c's frame, within
// 1 px, and listed by both), plus its id and criterion text.
const arrowIn = (c, m, f) => {
  const v = F.live(), bad = [];
  const into = v.filter(e => e.type === 'arrow' && e.customData?.kind === 'cross-lineage' && e.customData.childGenotypeId === N[c]);
  const glyph = v.find(e => e.customData?.kind === 'cross-glyph' && e.customData.parents.maternal === N[m] && e.customData.parents.paternal === N[f]);
  const frame = v.find(e => e.customData?.kind === 'genotype-frame' && e.customData.genotypeId === N[c]);
  if (into.length !== 1) return { bad: [into.length + ' arrows into ' + c] };
  const a = into[0];
  const p0 = [a.x + a.points[0][0], a.y + a.points[0][1]], pn = [a.x + a.points.at(-1)[0], a.y + a.points.at(-1)[1]];
  const fpOk = (fp, t) => fp && Math.abs(fp[0] - t[0]) < 0.01 && Math.abs(fp[1] - t[1]) < 0.01;
  if (!a.elbowed) bad.push('not elbowed');
  if (!glyph || a.startBinding?.elementId !== glyph.id) bad.push('start not bound to the ' + m + ' x ' + f + ' x');
  if (!frame || a.endBinding?.elementId !== frame.id) bad.push('end not bound to ' + c + ' frame');
  if (bad.length) return { bad, id: a.id };
  if (!fpOk(a.startBinding.fixedPoint, [0.5, 1])) bad.push('start fixedPoint ' + JSON.stringify(a.startBinding.fixedPoint));
  if (!fpOk(a.endBinding.fixedPoint, [0.5, 0])) bad.push('end fixedPoint ' + JSON.stringify(a.endBinding.fixedPoint));
  const gx = glyph.x + glyph.width / 2, gy = glyph.y + glyph.height, fx = frame.x + frame.width / 2, fy = frame.y;
  if (Math.abs(p0[0] - gx) > 1 || Math.abs(p0[1] - gy) > 1) bad.push('start ' + p0.map(Math.round) + ' vs x bottom middle ' + [gx, gy].map(Math.round));
  if (Math.abs(pn[0] - fx) > 1 || Math.abs(pn[1] - fy) > 1) bad.push('end ' + pn.map(Math.round) + ' vs frame top middle ' + [fx, fy].map(Math.round));
  if (!(glyph.boundElements ?? []).some(b => b.id === a.id)) bad.push('x glyph does not list the arrow');
  if (!(frame.boundElements ?? []).some(b => b.id === a.id)) bad.push('frame does not list the arrow');
  const crit = v.find(e => e.customData?.kind === 'cross-criterion' && e.containerId === a.id);
  return { bad, id: a.id, crit: crit?.originalText ?? null };
};
const arrowIds = () => Object.fromEntries(['A', 'C', 'D'].map(c => [c, arrowIn(c, c === 'A' ? 'P1' : 'A', c === 'A' ? 'P2' : 'P3').id]));

// Frames ([x,y,w,h]), x glyphs ([x,y]) and lineage arrows ([x,y,points])
// keyed by scenario name, rounded to the pixel.
const pos = () => {
  const r = Math.round, o = {}, name = g => F.name(g);
  for (const e of F.live()) {
    const cd = e.customData;
    if (!cd) continue;
    if (cd.kind === 'genotype-frame') o[name(cd.genotypeId)] = [r(e.x), r(e.y), r(e.width), r(e.height)];
    else if (cd.kind === 'cross-glyph') o['x:' + name(cd.parents.maternal) + 'x' + name(cd.parents.paternal)] = [r(e.x), r(e.y)];
    else if (cd.kind === 'cross-lineage' && e.type === 'arrow') o['->' + name(cd.childGenotypeId)] = [r(e.x), r(e.y), e.points.map(p => p.map(r))];
  }
  return Object.fromEntries(Object.entries(o).sort());
};
const overlaps = prefix => [F.overlaps(), F.foreignX(), F.xOverlap()].forEach(l => T.check(prefix + l));
const tidyBelowA = async () => { F.deselect(); F.select(['A']); await T.run('Tidy Below'); };

// Scramble C, D, E, P4 (with their labels) to fixed spots; nudge B away from A.
const box = n => F.view().getBoundingBox(F.els(n, 'genotype-allele'));
const a = box('A'), b = box('B');
const ax = a.topX + a.width / 2, ay = a.topY + a.height / 2;
const side = Math.sign((b.topX + b.width / 2) - ax) || 1;
await F.move({ C: [ax + 700, ay - 500], D: [ax - 600, ay + 900], E: [ax + 1200, ay + 200], P4: [ax - 900, ay - 300] });
await F.move({ B: [side * 40, 20] }, false);
const scrambled = pos();
let before = arrowIds();

await tidyBelowA();
const after = pos();

// 1-3: what moved.
const fixed = ['P1', 'P2', 'B', 'x:P1xP2', '->A', '->B'].filter(k => !eq(scrambled[k], after[k]));
T.pass(!fixed.length, 'P1, P2, B, the P1 x P2 x and the arrows into A and B did not move',
  'moved outside the subtree: ' + fixed.map(k => k + ' ' + JSON.stringify(scrambled[k]) + ' -> ' + JSON.stringify(after[k])).join('; '));
T.pass(eq(scrambled.A, after.A), 'A did not move', 'A moved ' + JSON.stringify(scrambled.A) + ' -> ' + JSON.stringify(after.A));
const stuck = ['C', 'D', 'E', 'P4'].filter(k => eq(scrambled[k], after[k]));
T.pass(!stuck.length, 'subtree tidied (C, D, E, P4 moved)', 'not tidied (still at scrambled spot): ' + stuck.join(','));

// 4: overlaps, over the whole drawing.
overlaps('');

// 5-6: the boundary arrow into A, and bindings of every arrow.
const r = arrowIn('A', 'P1', 'P2');
const bad = [...r.bad];
if (r.id !== before.A) bad.push('arrow into A was replaced (' + before.A + ' -> ' + r.id + ')');
if (r.crit !== 'CyO') bad.push('criterion ' + JSON.stringify(r.crit));
const v = F.live(), byId = new Map(v.map(e => [e.id, e]));
if (!v.some(e => e.customData?.kind === 'genotype-label' && e.customData.genotypeId === N.A)) bad.push('A label missing');
T.pass(!bad.length, 'arrow into A kept (same element, criterion), elbowed, bound from the P1 x P2 x (bottom middle) to A (top middle)', 'arrow into A: ' + bad.join('; '));
const arrows = v.filter(e => e.type === 'arrow');
const unb = arrows.filter(x => !byId.has(x.startBinding?.elementId) || !byId.has(x.endBinding?.elementId)).map(x => x.id.slice(0, 6) + ' -> ' + F.name(x.customData?.childGenotypeId));
T.pass(!unb.length, 'all ' + arrows.length + ' arrows bound at both ends', 'arrows not bound at both ends: ' + unb.join('; '));
T.out(F.layout());

// 7: idempotence.
await tidyBelowA();
const again = pos();
T.pass(eq(after, again), 'second Tidy Below moved nothing', 'second Tidy Below moved something (' + JSON.stringify(after) + ' -> ' + JSON.stringify(again) + ')');

// 8: nothing selected.
F.deselect();
await T.run('Tidy Below');
T.pass(eq(again, pos()), 'Tidy Below with nothing selected did nothing', 'Tidy Below with nothing selected changed the drawing');

// Hand-picked subset: pull C and D apart, select only C and D, plain Tidy.
const formed = pos();
await F.move({ C: [150, 30], D: [-150, -30] }, false);
const pulled = pos();
before = arrowIds();
F.deselect();
F.select(['C', 'D'], true);
await T.tidy();
const subset = pos();
const mine = ['C', 'D', '->C', '->D'];
const moved = Object.keys(subset).filter(k => !mine.includes(k) && !eq(pulled[k], subset[k]));
T.pass(!moved.length, 'subset Tidy moved only C, D and the arrows into them',
  'subset Tidy moved genotypes outside {C, D}: ' + moved.map(k => k + ' ' + JSON.stringify(pulled[k]) + ' -> ' + JSON.stringify(subset[k])).join('; '));
const back = ['C', 'D'].filter(k => !eq(formed[k], subset[k]));
T.pass(!back.length, 'C and D back in formation', 'C, D not back in formation: ' + back.map(k => k + ' ' + JSON.stringify(formed[k]) + ' vs ' + JSON.stringify(subset[k])).join('; '));
for (const c of ['C', 'D']) {
  const rc = arrowIn(c, 'A', 'P3');
  const bc = [...rc.bad];
  if (rc.id !== before[c]) bc.push('replaced');
  T.pass(!bc.length, 'arrow into ' + c + ' kept, elbowed, bound from the A x P3 x (bottom middle) to ' + c + ' (top middle)', 'arrow into ' + c + ': ' + bc.join('; '));
}
overlaps('subset: ');
JS
