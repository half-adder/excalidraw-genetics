#!/usr/bin/env bash
# Genotypes always show X, II and III: an empty chromosome is drawn as +/+.
# 1. Genotype form with II left empty -> II drawn as a +/+ fraction.
# 2. An older genotype missing chromosome III (simulated by deleting its III
#    elements and separator) -> after Tidy, III is drawn as +/+.
# Prints PASS or FAIL; exit 0 on PASS.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
T.empty();
const api = F.view().targetView.excalidrawAPI;
const live = () => api.getSceneElements().filter(e => !e.isDeleted);
const shape = gid => {
  const al = {};
  for (const e of live().filter(e => e.customData?.genotypeId === gid && e.customData.kind === 'genotype-allele'))
    (al[e.customData.chromosome] ??= {})[e.customData.side] = e.originalText ?? e.text;
  const fr = new Set(live().filter(e => e.customData?.genotypeId === gid && e.customData.kind === 'genotype-fraction').map(e => e.customData.chromosome));
  return ['X', 'II', 'III'].map(c => {
    const a = al[c];
    if (!a) return c + ':missing';
    if (a.single !== undefined) return c + ':' + a.single;
    return c + ':' + a.top + '/' + a.bottom + (fr.has(c) ? '' : '(no bar)');
  }).join(' ');
};

// 1. Form with II empty.
F.deselect();
window._genotypeCreateAt = { x: 0, y: 0 };
window._genotypeAuto = { glyph: '♀', X: { top: 'w', bottom: '' }, II: { top: '', bottom: '' }, III: { top: 'MKRS', bottom: 'TM6B' } };
await T.run('Genotype');
const g1 = window._genotypeLastResult;
const s1 = shape(g1);
T.pass(s1 === 'X:w II:+/+ III:MKRS/TM6B', 'form, II empty: ' + s1, 'form, II empty: ' + s1 + ' (want X:w II:+/+ III:MKRS/TM6B)');

// 2. Older genotype without III, then Tidy.
F.deselect();
window._genotypeCreateAt = { x: 0, y: 300 };
window._genotypeAuto = { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: 'Sb', bottom: 'TM3' } };
await T.run('Genotype');
const g2 = window._genotypeLastResult;
const ea = F.view();
ea.clear();
const drop = live().filter(e => e.customData?.genotypeId === g2 &&
  ((e.customData.chromosome === 'III') || (e.customData.kind === 'genotype-separator' && e.customData.after === 'II')));
ea.copyViewElementsToEAforEditing(drop);
for (const e of drop) ea.getElement(e.id).isDeleted = true;
await ea.addElementsToView(false, false, false);
T.out('simulated older genotype: ' + shape(g2));
F.deselect();
await T.run('Tidy');
const s2 = shape(g2);
T.pass(s2 === 'X:w/Y II:Sp/CyO III:+/+', 'Tidy fills a missing III: ' + s2, 'after Tidy: ' + s2 + ' (want X:w/Y II:Sp/CyO III:+/+)');
const seps = live().filter(e => e.customData?.genotypeId === g2 && e.customData.kind === 'genotype-separator').length;
T.pass(seps === 2, 'two ; separators', seps + ' separators');
JS
