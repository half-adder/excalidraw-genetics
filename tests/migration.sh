#!/usr/bin/env bash
# The migration offer, in a throwaway script folder (_flygen-test/Scripts):
#   1. confirm: files whose content hash matches the manifest (and the
#      manifest itself) go to the trash; a same-named file whose content
#      does not match the manifest, an unrelated file, and a symlinked file
#      (a development copy, even though its content matches) are all left
#      alone;
#   2. decline: nothing is trashed;
#   3. the prompt itself: it lists the files, preselecting the hash-matched
#      one, leaving the mismatched one unchecked with a note, leaving the
#      manifest itself unchecked (not everything above matched) with a note,
#      and "Keep them" trashes nothing, closes it, and is remembered;
#   4. unchecking a preselected box before clicking "Move to trash" excludes
#      exactly that file;
#   5. closing the prompt without a button (P.testing.closeModals(), as Esc
#      or the titlebar X would) also trashes nothing, and is remembered as
#      declined.
# _flyMigrationTrash (armed with _flyMigrationTestMode) is installed before
# EVERY offerMigration call in this file, confirm and decline and modal
# scenarios alike, and removes the test's own throwaway files itself: this
# test never calls the real trashSystem/trashLocal (and so never touches
# Sean's system Trash or the vault's own .trash) for anything. Cleanup at
# the end removes only paths strictly inside _flygen-test/, file by file
# through the vault adapter (the symlink included, unlinked as itself, never
# its target), never app.fileManager.trashFile. In test mode the plugin keeps
# its answer in memory only: the test checks that the plugin's data.json is
# unchanged, and restores the in-memory answer afterwards. Prints PASS/FAIL.
source "$(dirname "$0")/lib.sh"
fly_test <<'JS'
const P = app.plugins.plugins['fly-genetics'], vault = app.vault, DIR = '_flygen-test/Scripts', ROOT = '_flygen-test';
const saved = P.settings.migration;
const DATA = P.manifest.dir + '/data.json';
const readData = async () => (await vault.adapter.exists(DATA)) ? await vault.adapter.read(DATA) : null;
const dataBefore = await readData();
const has = p => !!vault.getAbstractFileByPath(p);
const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(b => b.toString(16).padStart(2, '0')).join('');
async function write(path, text) {
  const f = vault.getAbstractFileByPath(path);
  if (f) { await vault.modify(f, text); return; }
  try {
    await vault.create(path, text);
  } catch (e) {
    // The vault index can lag a beat behind a file this same script just
    // trashed and recreated; fall back to modify if it turns out to exist.
    const again = vault.getAbstractFileByPath(path);
    if (!again) throw new Error('write(' + path + '): ' + (e && e.message ? e.message : e));
    await vault.modify(again, text);
  }
}
// A real symlink, exactly like the dev vault's own Excalidraw/Scripts:
// points outside the vault at a scratch file, never at anything real. The
// scratch file is reused across runs (never deleted by this test: it lives
// outside the vault and outside _flygen-test/, which is all this test is
// allowed to remove).
const fs = require('fs'), osPath = require('path'), os = require('os');
const LINK_TARGET = osPath.join(os.tmpdir(), 'fly-genetics-migration-test-link-target.md');
if (!fs.existsSync(LINK_TARGET)) fs.writeFileSync(LINK_TARGET, '// test');
function ensureLink(path) {
  const full = vault.adapter.getFullPath(path);
  try {
    const st = fs.lstatSync(full);
    if (st.isSymbolicLink()) return;
    fs.unlinkSync(full);
  } catch (e) { /* nothing there yet */ }
  fs.symlinkSync(LINK_TARGET, full);
}
// Removes the test's own throwaway file directly: never the real
// trashSystem (would touch macOS's Trash) or trashLocal (would touch the
// real vault's own .trash folder). Armed fresh (both hooks together) before
// every single offerMigration call below, confirm/decline/modal alike.
const trashedByTest = [];
function useTestTrash() {
  window._flyMigrationTrash = async (p) => { trashedByTest.push(p); await vault.adapter.remove(p); };
  window._flyMigrationTestMode = true;
}
// Removes only paths strictly inside _flygen-test/: lists a folder, removes
// each file directly through the adapter (a symlink is removed as itself,
// via adapter.remove == unlink, never its target; verified empirically
// before this test was written), recurses into subfolders, then removes the
// now-empty folder tree. Never app.fileManager.trashFile (real system/vault
// trash) and never a shell rm.
async function removeAllUnder(root) {
  if (root !== ROOT && !root.startsWith(ROOT + '/')) throw new Error('refusing to remove outside ' + ROOT + '/: ' + root);
  let listing;
  try { listing = await vault.adapter.list(root); } catch (e) { return; }
  for (const f of listing.files) await vault.adapter.remove(f);
  for (const d of listing.folders) await removeAllUnder(d);
  try { await vault.adapter.rmdir(root, true); } catch (e) { /* already empty or gone */ }
}
// Tidy/Cross Genotypes/Install Fly Genetics: content the manifest says the
// installer wrote (hash matches). Genotype: same name, but its content was
// changed since (hash does not match). Cross Mode: content also matches,
// but it is a symlink (a development copy) and must never be preselected
// regardless. My own script: not an installer name at all.
async function seed() {
  for (const p of [ROOT, DIR]) if (!has(p)) await vault.createFolder(p);
  await write(DIR + '/Tidy.md', '// test');
  await write(DIR + '/Cross Genotypes.md', '// test');
  await write(DIR + '/Install Fly Genetics.md', '// test');
  await write(DIR + '/Genotype.md', '// I edited this one');
  await write(DIR + '/My own script.md', "// mine, not the installer's");
  ensureLink(DIR + '/Cross Mode.md');
  const hashes = {
    'Tidy': await sha256('// test'),
    'Cross Genotypes': await sha256('// test'),
    'Install Fly Genetics': await sha256('// test'),
    'Genotype': await sha256('// this is what the installer actually wrote'),
    'Cross Mode': await sha256('// test'),
  };
  // .fly-genetics.json is a dotfile: Obsidian's Vault index (getAbstractFileByPath
  // / vault.create) does not see it, same as migration.ts itself reads and
  // writes it through vault.adapter, not the Vault API.
  await vault.adapter.write(DIR + '/.fly-genetics.json', JSON.stringify({ version: 'test', fingerprint: 'test', hashes }, null, 2));
}
try {
  await seed();
  useTestTrash();
  window._flyMigrationAuto = { confirm: true };
  await P.offerMigration(DIR);
  T.pass(!has(DIR + '/Tidy.md') && !has(DIR + '/Install Fly Genetics.md') && (await vault.adapter.exists(DIR + '/.fly-genetics.json')),
    'confirm: hash-matched installer files are trashed; the manifest itself is not, because Cross Mode (a symlink) keeps not everything above matching',
    'confirm: ' + JSON.stringify(window._flyMigrationResult));
  T.pass(has(DIR + '/Genotype.md') && has(DIR + '/My own script.md') && has(DIR + '/Cross Mode.md'),
    'confirm: a hash-mismatched file, an unrelated file, and a symlinked file (content matches, but it is a link) are all kept',
    'kept check: Genotype.md=' + has(DIR + '/Genotype.md') + ' My own script.md=' + has(DIR + '/My own script.md') + ' Cross Mode.md=' + has(DIR + '/Cross Mode.md'));

  await seed();
  useTestTrash();
  window._flyMigrationAuto = { confirm: false };
  await P.offerMigration(DIR);
  T.pass(has(DIR + '/Tidy.md') && window._flyMigrationResult.declined, 'decline: nothing trashed', 'decline: ' + JSON.stringify(window._flyMigrationResult));

  await seed();
  useTestTrash();
  P.settings.migration = 'pending';
  const run = P.offerMigration(DIR);
  let keep = null;
  for (let i = 0; i < 100 && !(keep = [...document.querySelectorAll('.modal-container .modal button')].find(b => b.textContent === 'Keep them')); i++) await new Promise(r => setTimeout(r, 50));
  if (!keep) throw new Error('the migration prompt did not open');
  const rows = [...document.querySelectorAll('.modal-container .modal li')];
  const tidyRow = rows.find(li => li.textContent.includes(DIR + '/Tidy.md'));
  const genotypeRow = rows.find(li => li.textContent.includes(DIR + '/Genotype.md'));
  const crossModeRow = rows.find(li => li.textContent.includes(DIR + '/Cross Mode.md'));
  const manifestRow = rows.find(li => li.textContent.includes(DIR + '/.fly-genetics.json'));
  const tidyChecked = tidyRow?.querySelector('input[type=checkbox]')?.checked;
  const genotypeChecked = genotypeRow?.querySelector('input[type=checkbox]')?.checked;
  const crossModeChecked = crossModeRow?.querySelector('input[type=checkbox]')?.checked;
  const manifestChecked = manifestRow?.querySelector('input[type=checkbox]')?.checked;
  const genotypeNoted = genotypeRow?.textContent.includes('differs from what the installer wrote');
  const crossModeNoted = crossModeRow?.textContent.includes('link, not preselected');
  const manifestNoted = manifestRow?.textContent.includes('some scripts above were not preselected');
  keep.click();
  await run;
  T.pass(!!tidyRow && has(DIR + '/Tidy.md'), 'prompt lists the files; Keep trashes nothing', 'rows: ' + rows.map(li => li.textContent).join(' | '));
  T.pass(tidyChecked === true && genotypeChecked === false && genotypeNoted === true,
    'prompt preselects the hash-matched file, leaves the mismatched one unchecked with a note',
    'tidyChecked=' + tidyChecked + ' genotypeChecked=' + genotypeChecked + ' genotypeNoted=' + genotypeNoted);
  T.pass(crossModeChecked === false && crossModeNoted === true,
    'prompt leaves a symlinked file unchecked with its own note, even though its content matches',
    'crossModeChecked=' + crossModeChecked + ' crossModeNoted=' + crossModeNoted);
  T.pass(manifestChecked === false && manifestNoted === true,
    'prompt leaves the manifest unchecked (not everything above matched), with a note',
    'manifestChecked=' + manifestChecked + ' manifestNoted=' + manifestNoted);
  T.pass(P.settings.migration === 'declined', 'clicking Keep them is remembered as declined', 'migration=' + P.settings.migration);

  await seed();
  useTestTrash();
  P.settings.migration = 'pending';
  const run2 = P.offerMigration(DIR);
  let trashBtn = null;
  for (let i = 0; i < 100 && !(trashBtn = [...document.querySelectorAll('.modal-container .modal button')].find(b => b.textContent === 'Move to trash')); i++) await new Promise(r => setTimeout(r, 50));
  if (!trashBtn) throw new Error('the migration prompt did not open (uncheck test)');
  const rows2 = [...document.querySelectorAll('.modal-container .modal li')];
  const tidyRow2 = rows2.find(li => li.textContent.includes(DIR + '/Tidy.md'));
  const crossRow2 = rows2.find(li => li.textContent.includes(DIR + '/Cross Genotypes.md'));
  const tidyBox2 = tidyRow2.querySelector('input[type=checkbox]');
  if (!tidyBox2.checked) throw new Error('Tidy.md was not preselected before the uncheck test');
  tidyBox2.checked = false; // the user unchecks a preselected file by hand
  trashBtn.click();
  await run2;
  T.pass(has(DIR + '/Tidy.md') && !has(DIR + '/Cross Genotypes.md') && !has(DIR + '/Install Fly Genetics.md'),
    'unchecking a preselected box excludes it: Tidy.md kept, the still-checked matches trashed',
    'Tidy.md=' + has(DIR + '/Tidy.md') + ' Cross Genotypes.md=' + has(DIR + '/Cross Genotypes.md') + ' Install Fly Genetics.md=' + has(DIR + '/Install Fly Genetics.md'));

  await seed();
  useTestTrash();
  P.settings.migration = 'pending';
  const run3 = P.offerMigration(DIR);
  for (let i = 0; i < 100 && !document.querySelector('.modal-container .modal'); i++) await new Promise(r => setTimeout(r, 50));
  if (!document.querySelector('.modal-container .modal')) throw new Error('the migration prompt did not open (close test)');
  P.testing.closeModals();
  await run3;
  T.pass(has(DIR + '/Tidy.md') && P.settings.migration === 'declined' && window._flyMigrationResult.declined,
    'closing the prompt without a button (closeModals) declines: nothing trashed',
    'close test: ' + JSON.stringify(window._flyMigrationResult) + ' migration=' + P.settings.migration);

  T.pass(trashedByTest.every(p => p.startsWith(DIR)), 'the injected test trash function only ever touched the throwaway folder', 'trashedByTest: ' + JSON.stringify(trashedByTest));
  const dataAfter = await readData();
  T.pass(dataAfter === dataBefore, 'test mode never wrote the plugin\'s data.json', 'data.json changed: ' + dataBefore + ' -> ' + dataAfter);
} finally {
  P.testing.closeModals();
  P.settings.migration = saved;
  window._flyMigrationTrash = undefined;
  window._flyMigrationTestMode = undefined;
  await removeAllUnder(ROOT);
}
JS
