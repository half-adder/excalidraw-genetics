#!/usr/bin/env bash
# F flips a card in the Cross Genotypes picker (swaps top/bottom), acting on
# the card under the mouse, or (no hover) the focused column's selected
# card. Flipping also selects the card. X cards that carry a Y (sons, "X or
# Y" both-sex) never flip. F typed into the label/criterion inputs types
# normally. Drives the REAL form (not window._crossGenotypesAuto): starts
# Cross Genotypes without awaiting it, waits for window._crossGenotypesModal,
# dispatches real DOM events, then confirms and checks the drawn offspring's
# allele texts. See docs/plans/2026-09-28-cross-picker-design.md.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
T.empty();
await T.genotype('M', { glyph: '♀', X: { top: 'w', bottom: 'y' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: 'TM3', bottom: '+' } });
await T.genotype('F', { glyph: '♂', X: { top: 'w', bottom: 'Y' }, II: { top: 'Gla', bottom: 'Gla' }, III: { top: '+', bottom: 'TM6B' } });

F.select(['M', 'F']);
window._crossGenotypesLastResult = undefined;
window._crossGenotypesAuto = undefined; // force the real form, not the auto hook
const p = T.run('Cross Genotypes', { tolerate: true }); // in flight: modal is open while this awaits

let waited = 0;
while (!window._crossGenotypesModal && waited < 5000) { await new Promise(r => setTimeout(r, 20)); waited += 20; }
if (!window._crossGenotypesModal) throw new Error('modal did not open');
const { modal, state, columns, labelInput, critInput } = window._crossGenotypesModal;

const snap = () => JSON.stringify({ pick: state.pick, flip: state.flip, sex: state.sex });
const hover = el => ['mouseenter', 'mouseover', 'pointerover'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: t !== 'mouseenter' })));
const unhover = el => ['mouseleave', 'mouseout'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: t !== 'mouseleave' })));
const pressF = () => modal.contentEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true }));

// 1. Hover a daughter X card (index 1: y/w, flippable) and press f: selects
// and flips it.
let xDaughter = columns.X.children[1];
hover(xDaughter);
pressF();
T.pass(state.pick.X === 1 && state.flip.X[1] === true && state.sex === '♀',
  'hover-flip selects and flips a daughter X card',
  'hover-flip on X[1]: ' + snap());

// 2. Hover the son X card (index 2: w/Y, carries a Y) and press f: no-op.
const before2 = snap();
const xSon = columns.X.children[2];
hover(xSon);
pressF();
T.pass(snap() === before2, 'F does nothing on a Y-bearing X card', 'X[2] (son) changed state: ' + before2 + ' -> ' + snap());

// 3. No-hover path: unhover, focus the III column (nothing selected there
// yet but index 0), press f: flips the focused column's selected card.
unhover(xSon);
columns.III.focus();
pressF();
T.pass(state.pick.III === 0 && state.flip.III[0] === true,
  'no-hover f flips the focused column\'s selected card',
  'III after no-hover f: ' + snap());

// 4. Hover the II card (index 0: Sp/Gla) and press f: flips it too.
hover(columns.II.children[0]);
pressF();
T.pass(state.pick.II === 0 && state.flip.II[0] === true, 'hover-flip on II', 'II after hover f: ' + snap());

// 5. f typed into the label input types normally (no flip).
const before5 = snap();
labelInput.focus();
pressF();
T.pass(snap() === before5, 'f in the label input does not flip', 'state changed while typing in label: ' + before5 + ' -> ' + snap());

// Confirm.
const ok = [...modal.contentEl.querySelectorAll('button')].find(b => b.textContent === 'OK');
if (!ok) throw new Error('OK button not found');
ok.click();
const errs = await p;
if (errs.length) throw new Error('Cross Genotypes errored: ' + errs.join('; '));

const g = window._crossGenotypesLastResult;
if (!g) throw new Error('no offspring created');
window.__t.O = g;
const v = F.live();
const of = (chr, side) => {
  const el = v.find(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-allele' && e.customData.chromosome === chr && e.customData.side === side);
  return el ? (el.originalText ?? el.text) : undefined;
};
const glyph = v.find(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-glyph');

// X was flipped (y/w -> w/y); II was flipped (Sp/Gla -> Gla/Sp); III was
// flipped (TM3/+ -> +/TM3).
T.pass(of('X', 'top') === 'w' && of('X', 'bottom') === 'y', 'offspring X drawn flipped', 'X drawn ' + of('X', 'top') + '/' + of('X', 'bottom'));
T.pass(of('II', 'top') === 'Gla' && of('II', 'bottom') === 'Sp', 'offspring II drawn flipped', 'II drawn ' + of('II', 'top') + '/' + of('II', 'bottom'));
T.pass(of('III', 'top') === '+' && of('III', 'bottom') === 'TM3', 'offspring III drawn flipped', 'III drawn ' + of('III', 'top') + '/' + of('III', 'bottom'));
T.pass((glyph?.originalText ?? glyph?.text) === '♀', 'offspring sex female (untouched by the Y-card no-op)', 'glyph ' + (glyph?.originalText ?? glyph?.text));
JS
