#!/usr/bin/env bash
# Genotype editor edits an offspring's label and selection criterion:
# change both, clear both, add both back. Fixture label-criterion: P1 x P2 ->
# F, made with label F1-a and criterion non-Cy. After each step checks the
# label box (one, with the right text, covered by the frame, grouped), the
# criterion (one, bound to the lineage arrow) and that the arrow ends at the
# frame top middle. Prints PASS/FAIL; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
await T.fixture('label-criterion');
T.setup(['P1', 'P2', 'F']);
const edit = async (label, criterion) => {
  F.select(['F']);
  window._genotypeLastResult = undefined;
  window._genotypeAuto = { glyph: '♀', X: { top: 'w', bottom: 'w' }, II: { top: 'Sp', bottom: 'Gla' }, III: { top: '', bottom: '' }, label, criterion };
  await T.run('Genotype');
  if (window._genotypeLastResult !== window.__t.F) throw new Error('Genotype edit returned ' + window._genotypeLastResult);
};
const check = (step, L, C) => {
  const v = F.live(), g = window.__t.F;
  const lt = v.filter(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-label');
  const lb = v.filter(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-label-box');
  const cr = v.filter(e => e.customData?.kind === 'cross-criterion' && e.customData.childGenotypeId === g);
  const ar = v.find(e => e.customData?.kind === 'cross-lineage' && e.customData.childGenotypeId === g);
  const fr = v.find(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-frame');
  const txt = e => e.originalText ?? e.text;
  const bad = [];
  if (L) {
    if (lt.length !== 1 || lb.length !== 1) bad.push('label count ' + lt.length + '/' + lb.length);
    else {
      if (txt(lt[0]) !== L) bad.push('label text ' + txt(lt[0]));
      if (lt[0].containerId !== lb[0].id) bad.push('label not in box');
      const b = lb[0];
      if (!(b.x >= fr.x - 0.5 && b.y >= fr.y - 0.5 && b.x + b.width <= fr.x + fr.width + 0.5 && b.y + b.height <= fr.y + fr.height + 0.5)) bad.push('frame does not cover label');
      if (JSON.stringify(b.groupIds) !== JSON.stringify(fr.groupIds)) bad.push('label not grouped');
    }
  } else if (lt.length || lb.length) bad.push('label not removed');
  if (C) {
    if (cr.length !== 1) bad.push('criterion count ' + cr.length);
    else {
      if (txt(cr[0]) !== C) bad.push('criterion text ' + JSON.stringify(txt(cr[0])));
      if (cr[0].containerId !== ar?.id) bad.push('criterion not bound to arrow');
      if (!(ar.boundElements || []).some(b => b.id === cr[0].id)) bad.push('arrow does not list criterion');
    }
  } else {
    if (cr.length) bad.push('criterion not removed');
    if ((ar.boundElements || []).some(b => b.type === 'text')) bad.push('arrow still lists a text label');
  }
  const end = [ar.x + ar.points.at(-1)[0], ar.y + ar.points.at(-1)[1]];
  if (Math.abs(end[0] - (fr.x + fr.width / 2)) > 1 || Math.abs(end[1] - fr.y) > 1) bad.push('arrow end off frame top middle');
  if (ar.endBinding?.elementId !== fr.id) bad.push('arrow not bound to frame');
  T.pass(!bad.length, step, step + ' (' + bad.join('; ') + ')');
};
check('cross made with label and criterion', 'F1-a', 'non-Cy');
await edit('F1-b, a longer label', 'non-Cy\nSb/+'); check('label and criterion changed', 'F1-b, a longer label', 'non-Cy\nSb/+');
await edit('', ''); check('label and criterion cleared', '', '');
await edit('F1-c', 'Cy'); check('label and criterion added back', 'F1-c', 'Cy');
JS
