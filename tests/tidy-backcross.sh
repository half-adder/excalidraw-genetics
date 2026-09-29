#!/usr/bin/env bash
# Regression test: a genotype that is a parent in crosses on two rows gets a
# copy for the lower row (docs/plans/2026-09-29-backcross-design.md).
#   1. Backcross (fixture backcross: P1 x P2 -> A): cross A with the original
#      P2 -> B. P2 stays on P1's row, drawn once; one copy of P2, a founder,
#      sits on A's row and is B's father; A is still P1 x P2's.
#   2. Existing drawing: the scene of 1 with the copy folded back into P2 (B's
#      parents and the x rewired to P2, the copy deleted), as scenes were drawn
#      before this fix. One Tidy gives the result of 1.
#   3. Two sisters (fixture backcross-sibs: P1 x P2 -> A, C): A x P2 -> B, then
#      C x P2 -> D. Two copies of P2 on the F1 row, one per cross.
#   4. Reused stock (fixture reused-stock): B x S -> D (row 1), then
#      C x S -> E (row 2). S stays beside B and is D's father; one copy of S
#      sits on C's row and is E's father.
#   5. Shared by choice (fixture backcross-sibs): A x P2 -> B, then C x B's
#      copy of P2 -> D. No new copy: B and D share the one copy.
#   6. Existing drawing, subset modes (fixture backcross): the scene of 2,
#      then Tidy Below on A, and (from scratch) Tidy with A, B and P2
#      selected. P2 stays on P1's row with P1 x P2's x between them; one copy
#      of P2, a founder, on A's row is B's father. With A, B and P2 selected,
#      P1, P2 and that x do not move (they are outside the tidied part).
# Each case also checks the usual layout invariants and that a second Tidy
# moves nothing. Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const ea = F.view();
const frames = () => F.live().filter(e => e.customData?.kind === 'genotype-frame');
const alleles = gid => F.live().filter(e => e.customData?.genotypeId === gid && e.customData.kind === 'genotype-allele').map(e => e.originalText ?? e.text).sort().join(',');
const bottom = gid => { const f = frames().find(e => e.customData.genotypeId === gid); return f ? Math.round(f.y + f.height) : null; };
const parentsOf = n => F.els(n).find(e => e.customData.parents)?.customData.parents;
const has = (p, gid) => !!p && (p.maternal === gid || p.paternal === gid);
// Female offspring of m x f, through Cross Genotypes (which runs Tidy).
const cross = (name, m, f) => T.cross(name, m, f, { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: name });
// Genotype ids, other than n's, drawn with alleles `als`.
const copiesOf = (n, als) => [...new Set(frames().map(f => f.customData.genotypeId).filter(g => g !== window.__t[n] && alleles(g) === als))];

// n is drawn once, on home's row, and is still a parent of every genotype in
// keep. It has one copy per group in `groups` (arrays of offspring names):
// each a founder on row's row, the parent of every offspring in its group,
// and different groups have different copies.
function checkCopies(how, n, als, home, row, groups, keep) {
  const cs = copiesOf(n, als), t = window.__t;
  const drawn = F.els(n, 'genotype-frame').length;
  T.pass(drawn === 1 && cs.length === groups.length, how + ': ' + n + ' drawn once, ' + groups.length + ' copies', how + ': ' + n + ' drawn ' + drawn + ' time(s), ' + cs.length + ' copies');
  T.pass(bottom(t[n]) === bottom(t[home]), how + ': ' + n + ' stays on ' + home + '\'s row', how + ': ' + n + ' is not on ' + home + '\'s row');
  T.pass(cs.length > 0 && cs.every(c => bottom(c) === bottom(t[row])), how + ': the copies are on ' + row + '\'s row', how + ': a copy is missing from ' + row + '\'s row');
  T.pass(cs.length > 0 && !F.live().some(e => cs.includes(e.customData?.genotypeId) && e.customData.parents), how + ': the copies are founders', how + ': a copy has parents');
  const from = k => cs.find(c => has(parentsOf(k), c));
  const split = groups.filter(g => !from(g[0]) || g.some(k => from(k) !== from(g[0])));
  const distinct = new Set(groups.map(g => from(g[0]))).size === groups.length;
  const desc = groups.map(g => g.join('+')).join(', ');
  T.pass(!split.length && distinct, how + ': ' + desc + ' from ' + (groups.length === 1 ? 'the copy' : 'one copy each'), how + ': wrong copies for ' + desc);
  const lost = keep.filter(k => !has(parentsOf(k), t[n]));
  T.pass(!lost.length, how + ': ' + keep.join(', ') + ' still from ' + n, how + ': no longer from ' + n + ': ' + lost.join(', '));
  return cs;
}
async function invariants(how) {
  T.out(how + ' ' + F.layout());
  T.check(F.arrows({ pos: true }));
  T.check(F.overlaps());
  T.check(F.foreignX());
  T.check(F.xOverlap());
  T.check(F.cut({ diag: true }));
  await T.unmoved(how + ': second Tidy', T.tidyAll);
}
// Deletes genotype copyGid and points every `parents` that names it at into.
async function foldCopy(copyGid, into) {
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

// ---- 1. Backcross A x P2 ---------------------------------------------------
await T.fixture('backcross');
T.setup(['P1', 'P2', 'A']);
const p2 = alleles(window.__t.P2);
await cross('B', 'A', 'P2');
checkCopies('backcross', 'P2', p2, 'P1', 'A', [['B']], ['A']);
await invariants('backcross');

// ---- 2. A drawing that already has the conflict -----------------------------
for (const c of copiesOf('P2', p2)) await foldCopy(c, window.__t.P2);
T.pass(!copiesOf('P2', p2).length && has(parentsOf('B'), window.__t.P2),
  'existing: set up (B is A x P2, no copy)', 'existing: setup failed');
await T.tidyAll();
checkCopies('existing', 'P2', p2, 'P1', 'A', [['B']], ['A']);
await invariants('existing');

// ---- 3. Two sisters crossed back to P2: one copy each ------------------------
await T.fixture('backcross-sibs');
T.setup(['P1', 'P2', 'A', 'C']);
await cross('B', 'A', 'P2');
await cross('D', 'C', 'P2');
checkCopies('sisters', 'P2', p2, 'P1', 'A', [['B'], ['D']], ['A', 'C']);
await invariants('sisters');

// ---- 4. A stock crossed on row 1 and on row 2 -------------------------------
await T.fixture('reused-stock');
T.setup(['P1', 'P2', 'A', 'B', 'P3', 'C', 'S']);
const s = alleles(window.__t.S);
await cross('D', 'B', 'S');
await cross('E', 'C', 'S');
checkCopies('reused', 'S', s, 'B', 'C', [['E']], ['D']);
await invariants('reused');

// ---- 5. The second sister crossed with the first one's copy --------------------
await T.fixture('backcross-sibs');
T.setup(['P1', 'P2', 'A', 'C']);
await cross('B', 'A', 'P2');
window.__t.P2copy = copiesOf('P2', p2)[0];
if (!window.__t.P2copy) throw new Error('A x P2 made no copy of P2');
await cross('D', 'C', 'P2copy');
checkCopies('shared', 'P2', p2, 'P1', 'A', [['B', 'D']], ['A', 'C']);
await invariants('shared');

// ---- 6. A drawing that already has the conflict, subset modes ---------------
// Scene of 2 (A x P2 -> B, no copy); `run` tidies part of it. P2 stays on P1's
// row with P1 x P2's x between them; one copy of P2 on A's row is B's father.
const still = () => JSON.stringify(F.live().filter(e => {
  const cd = e.customData, t = window.__t;
  return cd?.kind === 'genotype-frame' && [t.P1, t.P2].includes(cd.genotypeId)
    || cd?.kind === 'cross-glyph' && cd.parents.maternal === t.P1 && cd.parents.paternal === t.P2;
}).map(e => [e.id, Math.round(e.x), Math.round(e.y)]).sort());
async function subsetCase(how, run, unmoved) {
  await T.fixture('backcross');
  T.setup(['P1', 'P2', 'A']);
  await cross('B', 'A', 'P2');
  for (const c of copiesOf('P2', p2)) await foldCopy(c, window.__t.P2);
  T.pass(!copiesOf('P2', p2).length && has(parentsOf('B'), window.__t.P2),
    how + ': set up (B is A x P2, no copy)', how + ': setup failed');
  const before = still();
  await run();
  if (unmoved) T.pass(still() === before, how + ': P1, P2 and P1 x P2\'s x did not move', how + ': P1, P2 or P1 x P2\'s x moved: ' + before + ' -> ' + still());
  checkCopies(how, 'P2', p2, 'P1', 'A', [['B']], ['A']);
  const t = window.__t, fr = frames();
  const mid = gid => { const f = fr.find(e => e.customData.genotypeId === gid); return f ? f.x + f.width / 2 : NaN; };
  const x = F.live().find(e => e.customData?.kind === 'cross-glyph' && e.customData.parents.maternal === t.P1 && e.customData.parents.paternal === t.P2);
  const xc = x ? x.x + x.width / 2 : NaN;
  const [lo, hi] = [mid(t.P1), mid(t.P2)].sort((a, b) => a - b);
  T.pass(xc > lo && xc < hi, how + ': P1 x P2\'s x is between P1 and P2', how + ': P1 x P2\'s x is not between P1 and P2');
  T.out(how + ' ' + F.layout());
  T.check(F.arrows({ pos: true }));
  T.check(F.overlaps());
  T.check(F.foreignX());
  T.check(F.xOverlap());
  T.check(F.cut({ diag: true }));
}
// Tidy Below on A. Select Below follows the mate P2 up to P1 x P2, so P1 and
// P2 are in the subset and may move.
await subsetCase('below', async () => { F.deselect(); F.select(['A']); await T.run('Tidy Below'); }, false);
// Tidy with A, B and P2 selected: P1 x P2 is outside the subset.
await subsetCase('selected', async () => { F.deselect(); F.select(['A', 'B', 'P2']); await T.run('Tidy'); }, true);
JS
