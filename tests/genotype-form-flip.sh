#!/usr/bin/env bash
# Option+F flips a chromosome in the Genotype form (swaps its top and bottom
# text), acting on the chromosome under the mouse, or (no hover) the
# chromosome of the focused field, with focus following the flipped text. A
# small flip button per chromosome does the same on click. A chromosome
# carrying "Y" never flips (button hidden/disabled, Option+F a no-op). Plain
# "f" types normally. Drives the REAL form (not window._genotypeAuto): starts
# Genotype without awaiting it, waits for window._genotypeFormModal,
# dispatches real DOM events, then confirms and checks the drawn genotype's
# allele texts. See docs/plans/2026-09-28-genotype-form-editor-design.md.
#
# Genotype's real (Modal-driven) commit does not settle harness.js's tracked
# executeScriptFile promise (a pre-existing gap: no other test drives this
# script's real modal to a commit, only its window._genotypeAuto bypass), so
# this test starts Genotype with T.launch (not awaited) and polls
# window._genotypeLastResult for completion instead of awaiting a T.run
# promise. Every wait below is bounded and throws a clear error on
# timeout, and a try/finally always cancels the form (closes the modal)
# before the harness trashes its drawing, on every exit path (pass, thrown
# error, or timeout) -- so a stuck run can never leave a live Genotype form
# pointed at whatever drawing is active afterward.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
let modalHandle = null;
try {
  T.empty();
  await T.genotype('G', { glyph: '♀', X: { top: 'w', bottom: 'Y' }, II: { top: 'Sp', bottom: 'CyO' }, III: { top: 'TM3', bottom: '+' } });

  F.select(['G']);
  window._genotypeLastResult = undefined;
  window._genotypeAuto = undefined; // force the real form, not the auto hook

  await T.launch('Genotype');

  let waited = 0;
  while (!window._genotypeFormModal && waited < 5000) { await new Promise(r => setTimeout(r, 50)); waited += 50; }
  if (!window._genotypeFormModal) throw new Error('modal did not open within 5s');
  modalHandle = window._genotypeFormModal;
  const { modal, inputs, chromosomes, flipButtons } = modalHandle;
  if (!chromosomes || !flipButtons) throw new Error('modal does not expose chromosomes/flipButtons for testing');

  const val = key => inputs[key].value;
  const snap = () => ['X', 'II', 'III'].map(c => val(c + '.top') + '/' + val(c + '.bottom')).join(' ; ');
  const hover = el => ['mouseenter', 'mouseover'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: false })));
  const unhover = el => ['mouseleave', 'mouseout'].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: false })));
  const optionF = target => target.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyF', key: 'ƒ', altKey: true, bubbles: true, cancelable: true }));
  const plainF = target => {
    const ev = new KeyboardEvent('keydown', { code: 'KeyF', key: 'f', bubbles: true, cancelable: true });
    target.dispatchEvent(ev);
    return ev;
  };

  // 1. Hover II and press Option+F: flips it (mouse target, focus untouched).
  hover(chromosomes.II);
  optionF(modal.contentEl);
  T.pass(val('II.top') === 'CyO' && val('II.bottom') === 'Sp', 'hover Option+F flips II', 'II after hover flip: ' + val('II.top') + '/' + val('II.bottom'));

  // 2. Hover X (carries Y) and press Option+F: no-op; button hidden/disabled.
  unhover(chromosomes.II);
  hover(chromosomes.X);
  const beforeX = snap();
  optionF(modal.contentEl);
  T.pass(snap() === beforeX, 'Option+F does nothing on a Y-bearing chromosome', 'X changed: ' + beforeX + ' -> ' + snap());
  T.pass(!!flipButtons.X.disabled, 'flip button disabled on a Y-bearing chromosome', 'flipButtons.X.disabled = ' + flipButtons.X.disabled);

  // 3. No-hover path: unhover, focus III's top field mid-text, press Option+F:
  // flips III and focus follows the text (same cursor position) into III.bottom.
  unhover(chromosomes.X);
  inputs['III.top'].focus();
  inputs['III.top'].setSelectionRange(2, 2); // "TM|3"
  optionF(inputs['III.top']);
  const focusedKey = Object.keys(inputs).find(k => inputs[k] === document.activeElement);
  T.pass(val('III.top') === '+' && val('III.bottom') === 'TM3', 'no-hover Option+F flips the focused chromosome (III)', 'III after flip: ' + val('III.top') + '/' + val('III.bottom'));
  T.pass(focusedKey === 'III.bottom' && document.activeElement.selectionStart === 2,
    'focus follows the flipped text, cursor position kept',
    'focus is ' + focusedKey + ' at ' + document.activeElement?.selectionStart);

  // 4. The flip button: click flipButtons.II, flips it back.
  flipButtons.II.click();
  T.pass(val('II.top') === 'Sp' && val('II.bottom') === 'CyO', 'flip button click flips II', 'II after button click: ' + val('II.top') + '/' + val('II.bottom'));

  // 5. Plain "f" (no Option) in a field types normally: no flip, not prevented.
  const beforeF = snap();
  inputs['II.top'].focus();
  const ev = plainF(inputs['II.top']);
  T.pass(snap() === beforeF && !ev.defaultPrevented, 'plain f types normally, no flip', 'state changed or prevented: ' + beforeF + ' -> ' + snap() + ', prevented=' + ev.defaultPrevented);

  // Confirm -- but only into the throwaway harness drawing. F.view() throws
  // if the active view is not window.__flyDrawing, which aborts into the
  // finally block (cancelling the form) instead of committing anywhere else.
  F.view();
  const ok = [...modal.contentEl.querySelectorAll('button')].find(b => b.textContent === 'OK');
  if (!ok) throw new Error('OK button not found');
  ok.click();
  modalHandle = null; // the click closes the modal itself; nothing left to cancel
  let settled = 0;
  while (window._genotypeLastResult === undefined && settled < 8000) { await new Promise(r => setTimeout(r, 50)); settled += 50; }
  if (window._genotypeLastResult === undefined) throw new Error('Genotype did not commit within 8s of OK');

  const g = window.__t.G;
  const v = F.live();
  const of = (chr, side) => {
    const el = v.find(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-allele' && e.customData.chromosome === chr && e.customData.side === side);
    return el ? (el.originalText ?? el.text) : undefined;
  };
  const glyph = v.find(e => e.customData?.genotypeId === g && e.customData.kind === 'genotype-glyph');

  // X untouched (w/Y, never flippable); II flipped once then back by button
  // (Sp/CyO, unchanged from the start); III flipped once, still flipped (+/TM3).
  T.pass(of('X', 'top') === 'w' && of('X', 'bottom') === 'Y', 'drawn X unchanged (Y-bearing)', 'X drawn ' + of('X', 'top') + '/' + of('X', 'bottom'));
  T.pass(of('II', 'top') === 'Sp' && of('II', 'bottom') === 'CyO', 'drawn II back to original after two flips', 'II drawn ' + of('II', 'top') + '/' + of('II', 'bottom'));
  T.pass(of('III', 'top') === '+' && of('III', 'bottom') === 'TM3', 'drawn III flipped', 'III drawn ' + of('III', 'top') + '/' + of('III', 'bottom'));
  T.pass((glyph?.originalText ?? glyph?.text) === '♀', 'glyph untouched by chromosome flips', 'glyph ' + (glyph?.originalText ?? glyph?.text));
} finally {
  // Never leave a Genotype form open: on ANY exit (pass, thrown error,
  // timeout) cancel it before the harness trashes its drawing.
  const m = modalHandle || window._genotypeFormModal;
  if (m && m.modal) { try { m.modal.close(); } catch (e) {} }
}
JS
