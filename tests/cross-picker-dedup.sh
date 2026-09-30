#!/usr/bin/env bash
# Regression test: the Cross Genotypes picker lists each offspring chromosome
# once. A homozygous parent used to give identical cards (mother +/+ x father
# CyO/Gla listed +/CyO and +/Gla twice), and pairs that differ only in which
# parent gave which homolog (CyO/+ and +/CyO) are one genotype, shown once
# (the first in maternal-first order). On X, cards of different sex (daughter,
# son, both) are never merged with each other. Reads the options the picker
# builds (window._crossGenotypesOptions, set when the form is skipped).
# Prints PASS/FAIL per check; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const cards = list => list.map(o => o.top + '/' + o.bottom + (o.sex ? ' ' + o.sex : ''));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
async function options(mother, father) {
  T.empty();
  await T.genotype('M', mother);
  await T.genotype('F', father);
  await T.cross('O', 'M', 'F', { offspringGlyph: null, pick: { X: 0, II: 0, III: 0 }, labelText: 'O' });
  const o = window._crossGenotypesOptions;
  if (!o) throw new Error('picker options not recorded');
  return { X: cards(o.X), II: cards(o.II), III: cards(o.III) };
}
function expect(what, got, want) {
  T.pass(same(got, want), what + ': ' + want.join(', '), what + ': got ' + got.join(', ') + '; want ' + want.join(', '));
}

// 1. Homozygous mother: +/+ x CyO/Gla on II; w/w x w/Y on X.
let o = await options(
  { glyph: '♀', X: { top: 'w', bottom: 'w' }, II: { top: '+', bottom: '+' }, III: { top: '+', bottom: '+' } },
  { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'CyO', bottom: 'Gla' }, III: { top: 'MKRS', bottom: 'TM6B' } });
expect('homozygous mother, II', o.II, ['+/CyO', '+/Gla']);
expect('homozygous mother, III', o.III, ['+/MKRS', '+/TM6B']);
expect('homozygous mother, X', o.X, ['w/w female', 'w/Y male', 'w/w or Y both']);

// 2. Homozygous father: Sp/CyO x Gla/Gla on II.
o = await options(
  { glyph: '♀', X: { top: 'w', bottom: '+' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: '+', bottom: '+' } },
  { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'Gla', bottom: 'Gla' }, III: { top: '+', bottom: '+' } });
expect('homozygous father, II', o.II, ['Sp/Gla', 'CyO/Gla']);
expect('homozygous father, III', o.III, ['+/+']);
expect('homozygous father, X', o.X, ['w/w female', '+/w female', 'w/Y male', '+/Y male', 'w/w or Y both', '+/w or Y both']);

// 3. Flipped pairs: CyO/+ x CyO/+ on II gives CyO/CyO, CyO/+, +/+ (not +/CyO).
o = await options(
  { glyph: '♀', X: { top: 'w', bottom: 'w' }, II: { top: 'CyO', bottom: '+' }, III: { top: 'TM3', bottom: '+' } },
  { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'CyO', bottom: '+' }, III: { top: '+', bottom: 'TM3' } });
expect('flipped pairs, II', o.II, ['CyO/CyO', 'CyO/+', '+/+']);
expect('flipped pairs, III', o.III, ['TM3/+', 'TM3/TM3', '+/+']);

// 4. Nothing to merge: every card kept, in maternal-first order.
o = await options(
  { glyph: '♀', X: { top: 'w', bottom: 'y' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: '+', bottom: '+' } },
  { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'Gla', bottom: 'Bc' }, III: { top: '+', bottom: '+' } });
expect('distinct, II', o.II, ['Sp/Gla', 'Sp/Bc', 'CyO/Gla', 'CyO/Bc']);
JS
