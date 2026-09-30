#!/usr/bin/env bash
# Regression test: Cross Genotypes starts Tidy right after selecting the new
# offspring. Tidy must tidy the offspring's whole lineage, not the two parents
# that were selected a moment before (the selection lands on a later render).
# The harness starts a script started by another as soon as it would run at
# full speed, so the race shows here. In an empty
# drawing: P1, P2; two crosses back to back (A, then B); then a Genotype edit
# of A. Checks
#   1. no script threw,
#   2. after each cross, a Tidy of the lineage moves nothing (the cross's own
#      Tidy already tidied the lineage as a whole),
#   3. every lineage arrow is bound to existing elements, from its x glyph
#      bottom middle to its frame top middle,
# and 3 again after the Genotype edit. Prints PASS/FAIL; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
T.empty();
await T.genotype('P1', window.__flyFounders.P1);
await T.genotype('P2', window.__flyFounders.P2);

// Every arrow bound at both ends to live elements, plus F.arrows with positions.
const bound = when => {
  const v = F.live(), byId = new Map(v.map(e => [e.id, e]));
  const bad = v.filter(e => e.type === 'arrow' && !(byId.has(e.startBinding?.elementId) && byId.has(e.endBinding?.elementId)))
    .map(e => 'arrow to ' + F.name(e.customData?.childGenotypeId));
  T.pass(!bad.length, when + ': every arrow bound to existing elements', when + ': ' + bad.join('; '));
  T.check(when + ': ' + F.arrows({ pos: true }));
};
// A lineage Tidy (seeded from `n`) after the cross's own Tidy moves nothing.
const tidied = async (when, n) => {
  F.snapSave();
  F.deselect();
  F.select([n]);
  await T.tidy();
  T.check(when + ': ' + F.unmoved('lineage Tidy after the cross'));
};

await T.cross('A', 'P1', 'P2', { offspringGlyph: '♀', pick: { X: 0, II: 0, III: 0 }, labelText: 'A' });
bound('after cross A');
await tidied('after cross A', 'A');
await T.cross('B', 'P1', 'P2', { offspringGlyph: '♂', pick: { X: 1, II: 3, III: 0 }, labelText: 'B' });
bound('after cross B');
await tidied('after cross B', 'B');

F.select(['A']);
window._genotypeAuto = { glyph: '♀', X: { top: 'w', bottom: 'w' }, II: { top: 'Sp', bottom: 'Gla' }, III: { top: '', bottom: '' }, label: 'A2' };
const errs = await T.run('Genotype', { tolerate: true });
T.pass(!errs.length, 'Genotype edit of A ran without errors', 'Genotype edit of A threw: ' + errs.join('; '));
bound('after Genotype edit');
T.pass(!T.buildErrors.length, 'no script errors while crossing', 'script errors: ' + T.buildErrors.join('; '));
JS
