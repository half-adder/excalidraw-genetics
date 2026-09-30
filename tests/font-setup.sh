#!/usr/bin/env bash
# The font setup offer, in a throwaway folder (_flygen-test/Fonts), against
# an injected stand-in for Excalidraw's settings (never Excalidraw's own:
# every call arms _flyFontAuto together with _flyFontTestMode, with a
# fontFolder and a fake settings object whose saveExcalidraw only counts):
#   1. confirm, no font, local font off: the font is written byte-identical
#      to fonts/ in this repo, with its license, and the (fake) local font
#      is set and saved once;
#   2. again with everything in place: nothing needed, nothing rewritten;
#   3. a different-size font and another local font, "Keep my font": the
#      font is replaced, the license rewritten, the local font kept;
#   4. decline: nothing is written;
#   5. the prompt itself: "Not now" writes nothing, closes it, and is
#      remembered as declined;
#   6. closing the prompt without a button also declines;
#   7. "Set up", then the second question ("Use Computer Modern"): both
#      prompts are real modals; the fake local font is replaced;
#   8. a stray _flyFontAuto without _flyFontTestMode is ignored: the saved
#      "declined" answer stands and nothing is written.
# Excalidraw's own in-memory local-font settings are compared before and
# after. Cleanup removes only paths strictly inside _flygen-test/, file by
# file through the vault adapter (never app.fileManager.trashFile, never the
# system Trash). Test mode keeps the plugin's answer in memory (its data.json
# is compared before and after); the in-memory answer is restored. Prints
# PASS/FAIL.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const fs = require('fs'), P = app.plugins.plugins['fly-genetics'], vault = app.vault;
const ROOT = '_flygen-test', DIR = ROOT + '/Fonts', FONT = DIR + '/cmu-serif-500-roman.ttf', LICENSE = DIR + '/CMU-OFL.txt';
const REAL_FONT = fs.readFileSync(T.repo + '/fonts/cmu-serif-500-roman.ttf'), REAL_LICENSE = fs.readFileSync(T.repo + '/fonts/CMU-OFL.txt', 'utf8');
const saved = P.settings.font;
// Test mode keeps answers in memory: the plugin's data.json must not change.
const DATA = vault.adapter.getFullPath(P.manifest.dir + '/data.json'), dataBefore = fs.readFileSync(DATA, 'utf8');
const X = app.plugins.plugins['obsidian-excalidraw-plugin'].settings;
const realBefore = JSON.stringify([X.experimentalEnableFourthFont, X.experimantalFourthFont]);
const has = p => !!vault.getAbstractFileByPath(p);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function removeAllUnder(root) {
  if (root !== ROOT && !root.startsWith(ROOT + '/')) throw new Error('refusing to remove outside ' + ROOT + '/: ' + root);
  let listing;
  try { listing = await vault.adapter.list(root); } catch (e) { return; }
  for (const f of listing.files) await vault.adapter.remove(f);
  for (const d of listing.folders) await removeAllUnder(d);
  try { await vault.adapter.rmdir(root, true); } catch (e) { /* already gone */ }
}
// Removes the throwaway folder and waits (bounded) for the vault index to catch up.
async function clear() {
  await removeAllUnder(ROOT);
  for (let i = 0; i < 100 && has(ROOT); i++) await sleep(50);
  if (has(ROOT)) throw new Error('the vault index still lists ' + ROOT);
}
const fontBytes = async () => { const f = vault.getAbstractFileByPath(FONT); return f ? Buffer.from(await vault.readBinary(f)) : null; };
let saves = 0;
const fake = (on, font) => ({ experimentalEnableFourthFont: on, experimantalFourthFont: font });
function arm(auto) {
  window._flyFontAuto = { fontFolder: DIR, saveExcalidraw: async () => { saves++; }, ...auto };
  window._flyFontTestMode = true;
}
async function button(text) {
  let b = null;
  for (let i = 0; i < 100 && !(b = [...document.querySelectorAll('.modal-container .modal button')].find(x => x.textContent === text)); i++) await sleep(50);
  if (!b) throw new Error('no "' + text + '" button: the font prompt did not open');
  return b;
}
try {
  await clear();

  // 1. confirm
  let xs = fake(false, '');
  saves = 0;
  arm({ confirm: true, settings: xs });
  await P.offerFontSetup();
  let bytes = await fontBytes();
  T.pass(!!bytes && bytes.equals(REAL_FONT) && has(LICENSE) && (await vault.adapter.read(LICENSE)) === REAL_LICENSE,
    'confirm: font byte-identical to fonts/, license written', 'confirm: ' + JSON.stringify(window._flyFontResult));
  T.pass(xs.experimentalEnableFourthFont === true && xs.experimantalFourthFont === FONT && saves === 1 && window._flyFontResult.wroteFont === true,
    'confirm: the (injected) local font is set to the font and saved once', 'settings: ' + JSON.stringify(xs) + ' saves=' + saves);

  // 2. nothing needed
  const mtime = vault.getAbstractFileByPath(FONT).stat.mtime;
  saves = 0;
  arm({ confirm: true, settings: xs });
  await P.offerFontSetup();
  T.pass(window._flyFontResult.wroteFont === false && vault.getAbstractFileByPath(FONT).stat.mtime === mtime && saves === 0,
    'already set up: nothing rewritten, settings not saved', 'again: ' + JSON.stringify(window._flyFontResult) + ' saves=' + saves);

  // 3. different-size font, another local font, keep it
  await clear();
  await vault.createFolder(ROOT); await vault.createFolder(DIR);
  await vault.createBinary(FONT, new Uint8Array([1, 2, 3]).buffer);
  await vault.create(LICENSE, 'old');
  xs = fake(true, 'Excalidraw/Fonts/mine.ttf');
  saves = 0;
  arm({ confirm: true, replaceOther: false, settings: xs });
  await P.offerFontSetup();
  bytes = await fontBytes();
  T.pass(!!bytes && bytes.equals(REAL_FONT) && (await vault.adapter.read(LICENSE)) === REAL_LICENSE,
    'different size: font replaced, license rewritten', 'replace: ' + JSON.stringify(window._flyFontResult));
  T.pass(xs.experimantalFourthFont === 'Excalidraw/Fonts/mine.ttf' && saves === 0 && /Kept your local font/.test(window._flyFontResult.note),
    'another local font, "Keep my font": kept', 'settings: ' + JSON.stringify(xs) + ' note=' + window._flyFontResult.note);

  // 4. decline
  await clear();
  arm({ confirm: false, settings: fake(false, '') });
  await P.offerFontSetup();
  T.pass(!has(FONT) && !has(LICENSE) && window._flyFontResult.declined, 'decline: nothing written', 'decline: ' + JSON.stringify(window._flyFontResult));

  // 5. the prompt: Not now
  P.settings.font = 'pending';
  xs = fake(false, '');
  arm({ settings: xs });
  let run = P.offerFontSetup();
  (await button('Not now')).click();
  await run;
  T.pass(!has(FONT) && !has(LICENSE) && xs.experimentalEnableFourthFont === false && P.settings.font === 'declined' && !document.querySelector('.modal-container'),
    'prompt: Not now writes nothing, closes, is remembered as declined', 'not now: ' + JSON.stringify(window._flyFontResult) + ' font=' + P.settings.font);

  // 6. the prompt: closed without a button
  P.settings.font = 'pending';
  arm({ settings: fake(false, '') });
  run = P.offerFontSetup();
  await button('Set up');
  P.testing.closeModals();
  await run;
  T.pass(!has(FONT) && P.settings.font === 'declined' && window._flyFontResult.declined, 'prompt: closing it declines', 'close: ' + JSON.stringify(window._flyFontResult));

  // 7. the prompt: Set up, then replace another local font
  xs = fake(true, 'Excalidraw/Fonts/mine.ttf');
  saves = 0;
  arm({ settings: xs });
  run = P.offerFontSetup();
  (await button('Set up')).click();
  (await button('Use Computer Modern')).click();
  await run;
  bytes = await fontBytes();
  T.pass(!!bytes && bytes.equals(REAL_FONT) && xs.experimantalFourthFont === FONT && saves === 1 && !document.querySelector('.modal-container'),
    'prompt: Set up, then "Use Computer Modern": font written, local font replaced, prompts closed', 'set up: ' + JSON.stringify(xs) + ' saves=' + saves);

  // 8. a stray hook without test mode
  await clear();
  P.settings.font = 'declined';
  window._flyFontResult = undefined;
  window._flyFontAuto = { fontFolder: DIR, confirm: true, skipSettings: true };
  window._flyFontTestMode = undefined;
  await P.offerFontSetup();
  T.pass(!has(FONT) && window._flyFontResult === undefined && window._flyFontAuto === undefined,
    'a stray _flyFontAuto without test mode is cleared and ignored', 'stray: ' + JSON.stringify(window._flyFontResult));
} finally {
  P.testing.closeModals();
  window._flyFontAuto = undefined;
  window._flyFontTestMode = undefined;
  P.settings.font = saved;   // in memory only; nothing was saved
  await removeAllUnder(ROOT);
}
T.pass(fs.readFileSync(DATA, 'utf8') === dataBefore, "the plugin's data.json was not written", "data.json changed: " + fs.readFileSync(DATA, 'utf8'));
const realAfter = JSON.stringify([X.experimentalEnableFourthFont, X.experimantalFourthFont]);
T.pass(realAfter === realBefore, "Excalidraw's own local-font settings unchanged " + realAfter, 'Excalidraw settings changed: ' + realBefore + ' -> ' + realAfter);
JS
