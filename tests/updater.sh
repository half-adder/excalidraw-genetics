#!/usr/bin/env bash
# Update Fly Genetics, with the download replaced by a freshly built installer
# (window._flyGeneticsUpdateSource) and the install redirected to
# _flygen-test/Scripts (window._flyGeneticsUpdateTarget). Starts from an
# install in _flygen-test/Scripts made from that installer's payload. Checks
#   1. manifest at the installer's version: "up to date" (installed = latest),
#      no installer written to the script folder, installed files unchanged;
#   2. manifest at an older version, with one unedited older script: the
#      updater writes "Install Fly Genetics.md" into the real script folder
#      and runs it; the older script ends up replaced with the source
#      ("update"), the others "same", and the manifest version is the new one.
# Removes _flygen-test/ and the installer afterwards. Refuses to run if an
# "Install Fly Genetics.md" is already in the script folder.
# Prints PASS/FAIL; exit 0 only if all pass.
source "$(dirname "$0")/lib.sh"
build=$(mktemp -d)/install.md
(cd "$REPO" && uv run --quiet installer/build.py "$build" >/dev/null) || { echo "FAIL: installer build failed"; exit 1; }
{ echo "const BUILD = '$build';"; cat <<'JS'; } | fly_test
const fs = require('fs'), crypto = require('crypto');
const vault = app.vault;
const INST = 'Excalidraw/Scripts/Install Fly Genetics.md', ROOT = '_flygen-test', SCRIPTS = ROOT + '/Scripts', FONTS = ROOT + '/Fonts';
const MANIFEST = SCRIPTS + '/.fly-genetics.json';
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const text = fs.readFileSync(BUILD, 'utf8');
const payload = JSON.parse(text.match(/^const PAYLOAD = (.*);$/m)[1]);
const names = Object.keys(payload.scripts);
const read = p => vault.adapter.read(p);
const cleanup = async () => {
  for (const p of [INST, ROOT]) { const f = vault.getAbstractFileByPath(p); if (f) await vault.delete(f, true); }
};
// Text of every file under _flygen-test/Scripts, manifest included.
const folder = async () => {
  const o = {};
  for (const n of names) o[n] = await read(SCRIPTS + '/' + n + '.md');
  o.manifest = await read(MANIFEST);
  return o;
};
const update = async () => {
  window._flyGeneticsUpdateResult = undefined;
  window._flyGeneticsInstallResult = undefined;
  window._flyGeneticsUpdateSource = text;
  window._flyGeneticsUpdateTarget = { scriptFolder: SCRIPTS, fontFolder: FONTS, skipSettings: true, confirm: false };
  await T.run('Update Fly Genetics');
  return window._flyGeneticsUpdateResult;
};

if (vault.getAbstractFileByPath(INST)) throw new Error(INST + ' already exists; not touching it');
await cleanup();
try {
  // An existing install of this payload; Genotype is an unedited older version.
  await vault.createFolder(ROOT);
  await vault.createFolder(SCRIPTS);
  const O = 'Genotype', older = payload.scripts[O].replace(/\n$/, '') + '\n// older version\n';
  const hashes = {};
  for (const n of names) {
    const t = n === O ? older : payload.scripts[n];
    await vault.create(SCRIPTS + '/' + n + '.md', t);
    hashes[n] = sha(t);
  }
  const setVersion = v => vault.adapter.write(MANIFEST, JSON.stringify({ version: v, hashes }, null, 2));

  // 1. Same version: up to date, nothing written.
  await setVersion(payload.version);
  const before = await folder();
  let r = await update();
  T.pass(r?.installed === payload.version && r?.latest === payload.version, 'same version: up to date (' + payload.version + ')', 'same version: result ' + JSON.stringify(r));
  const after = await folder();
  const diff = Object.keys(before).filter(k => before[k] !== after[k]);
  T.pass(!diff.length && !vault.getAbstractFileByPath(INST) && !window._flyGeneticsInstallResult,
    'same version: no installer written, installer not run, installed files unchanged',
    'same version: changed ' + diff.join(', ') + (vault.getAbstractFileByPath(INST) ? '; installer written' : '') + (window._flyGeneticsInstallResult ? '; installer ran' : ''));

  // 2. Older version installed: the updater writes the installer and runs it.
  await setVersion('0000000 (2000-01-01)');
  r = await update();
  T.pass(r?.installed === '0000000 (2000-01-01)' && r?.latest === payload.version, 'older version: update found (' + r?.installed + ' -> ' + r?.latest + ')', 'older version: result ' + JSON.stringify(r));
  const inst = vault.getAbstractFileByPath(INST);
  T.pass(inst && (await read(INST)) === text, 'installer written to the script folder', 'installer ' + (inst ? 'differs from the source' : 'not written'));
  const plan = Object.fromEntries((window._flyGeneticsInstallResult?.plan ?? []).map(p => [p.name, p.state]));
  const bad = names.filter(n => plan[n] !== (n === O ? 'update' : 'same')).map(n => n + ':' + plan[n]);
  T.pass(!bad.length, 'installer ran: ' + O + ' "update", the rest "same"', 'installer states: ' + (bad.join(', ') || 'none'));
  const now = await folder();
  const wrong = names.filter(n => now[n] !== payload.scripts[n]);
  const m = JSON.parse(now.manifest);
  T.pass(!wrong.length && m.version === payload.version && m.hashes[O] === sha(payload.scripts[O]),
    'installed scripts current, manifest version ' + m.version,
    'after update: differ ' + wrong.join(', ') + '; manifest version ' + m.version);
  T.pass(m.fingerprint === payload.fingerprint, 'manifest records the fingerprint (' + m.fingerprint + ')', 'manifest fingerprint ' + m.fingerprint + ', want ' + payload.fingerprint);
  T.pass(typeof window._flyGeneticsInstallResult?.whatsNew === 'string' && window._flyGeneticsInstallResult.whatsNew.includes(payload.version),
    "installer reports what's new for " + payload.version, "what's new: " + JSON.stringify(window._flyGeneticsInstallResult?.whatsNew));

  // 3. Same version name, different contents (a release without a VERSION bump): still an update.
  const cur = {}; for (const n of names) cur[n] = sha(payload.scripts[n]);
  await vault.delete(vault.getAbstractFileByPath(INST));
  await vault.adapter.write(MANIFEST, JSON.stringify({ version: payload.version, fingerprint: 'stale0000000', hashes: cur }, null, 2));
  r = await update();
  T.pass(r?.installedFingerprint === 'stale0000000' && !!window._flyGeneticsInstallResult,
    'same version, different fingerprint: update found and installed', 'result ' + JSON.stringify(r) + (window._flyGeneticsInstallResult ? '' : '; installer did not run'));

  // 4. Different version name, same contents: up to date (fingerprint decides).
  await vault.delete(vault.getAbstractFileByPath(INST));
  await vault.adapter.write(MANIFEST, JSON.stringify({ version: 'renamed', fingerprint: payload.fingerprint, hashes: cur }, null, 2));
  r = await update();
  T.pass(r?.installed === 'renamed' && !window._flyGeneticsInstallResult && !vault.getAbstractFileByPath(INST),
    'different version name, same fingerprint: up to date', 'result ' + JSON.stringify(r) + (window._flyGeneticsInstallResult ? '; installer ran' : ''));
} finally {
  await cleanup();
  const left = [INST, ROOT].filter(p => vault.getAbstractFileByPath(p) || fs.existsSync(vault.adapter.basePath + '/' + p));
  T.pass(!left.length, 'cleaned up _flygen-test/ and the installer', 'left behind: ' + left.join(', '));
  fs.rmSync(require('path').dirname(BUILD), { recursive: true, force: true });
}
JS
