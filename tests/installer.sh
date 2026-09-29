#!/usr/bin/env bash
# Install Fly Genetics. Builds the installer (installer/build.py) to a
# temporary file, copies it into the vault's script folder as
# "Install Fly Genetics.md" (a real file, so Excalidraw registers it) and runs
# it with the test target hook: scripts to _flygen-test/Scripts, font to
# _flygen-test/Fonts, settings untouched, prompts answered by `confirm`.
# Checks
#   1. first run: every script installed, byte-identical to scripts/, and
#      every script in scripts/ is in the installer; font byte-identical;
#      license present; .fly-genetics.json has the version and one SHA-256
#      per script, matching the installed text;
#   2. second run: every script "same";
#   3. one installed script edited, confirm:false: it is "kept" (still edited);
#   4. again with confirm:true: it is "changed" (replaced with the source);
#   5. an older unedited version (other text, manifest hash of that text),
#      confirm:false: it is "update" (replaced without asking).
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
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const text = fs.readFileSync(BUILD, 'utf8');
const payload = JSON.parse(text.match(/^const PAYLOAD = (.*);$/m)[1]);
const names = Object.keys(payload.scripts);
const src = n => fs.readFileSync(T.repo + '/scripts/' + n + '.md', 'utf8');
const read = p => vault.adapter.read(p);
const manifest = async () => JSON.parse(await read(SCRIPTS + '/.fly-genetics.json'));
const write = async (p, t) => vault.modify(vault.getAbstractFileByPath(p), t);
const cleanup = async () => {
  for (const p of [INST, ROOT]) { const f = vault.getAbstractFileByPath(p); if (f) await vault.delete(f, true); }
};

if (vault.getAbstractFileByPath(INST)) throw new Error(INST + ' already exists; not touching it');
await cleanup();
try {
  await vault.create(INST, text);
  const run = async confirm => {
    window._flyGeneticsInstallResult = undefined;
    window._flyGeneticsInstallTarget = { scriptFolder: SCRIPTS, fontFolder: FONTS, skipSettings: true, confirm };
    await T.run('Install Fly Genetics');
    const r = window._flyGeneticsInstallResult;
    if (!r) throw new Error('installer reported no result');
    return Object.fromEntries(r.plan.map(p => [p.name, p.state]));
  };
  const only = (st, want, others) => Object.entries(st).filter(([n, s]) => s !== (want[n] ?? others)).map(([n, s]) => n + ':' + s);

  // 1. First install.
  let st = await run(true);
  let bad = only(st, {}, 'new');
  T.pass(!bad.length, 'first run: ' + names.length + ' scripts "new"', 'first run states: ' + bad.join(', '));
  const repoScripts = fs.readdirSync(T.repo + '/scripts').filter(f => f.endsWith('.md')).map(f => f.slice(0, -3));
  const missing = repoScripts.filter(n => !names.includes(n));
  T.pass(!missing.length, 'installer carries every script in scripts/', 'installer is missing ' + missing.join(', '));
  bad = [];
  for (const n of names) if (await read(SCRIPTS + '/' + n + '.md') !== src(n)) bad.push(n);
  T.pass(!bad.length, 'installed scripts byte-identical to scripts/', 'differ from scripts/: ' + bad.join(', '));
  const font = Buffer.from(await vault.adapter.readBinary(FONTS + '/' + payload.font.name));
  T.pass(font.equals(fs.readFileSync(T.repo + '/fonts/' + payload.font.name)), 'font byte-identical (' + font.length + ' bytes)', 'font differs (' + font.length + ' bytes)');
  const lic = vault.getAbstractFileByPath(FONTS + '/' + payload.license.name);
  T.pass(lic && (await read(lic.path)) === fs.readFileSync(T.repo + '/fonts/' + payload.license.name, 'utf8'), 'license present', 'license missing or different');
  let m = await manifest();
  bad = names.filter(n => m.hashes?.[n] !== sha(src(n)));
  const extra = Object.keys(m.hashes ?? {}).filter(n => !names.includes(n));
  T.pass(m.version === payload.version && !bad.length && !extra.length, 'manifest: version ' + m.version + ', one matching hash per script',
    'manifest: version ' + m.version + ' (want ' + payload.version + '), bad hashes ' + bad.join(',') + ', extra ' + extra.join(','));

  // 2. Second run.
  st = await run(true);
  bad = only(st, {}, 'same');
  T.pass(!bad.length, 'second run: every script "same"', 'second run states: ' + bad.join(', '));

  // 3-4. An edited script: kept with confirm:false, replaced with confirm:true.
  const E = 'Tidy', edited = src(E) + '\n// my edit\n';
  await write(SCRIPTS + '/' + E + '.md', edited);
  st = await run(false);
  bad = only(st, { [E]: 'kept' }, 'same');
  T.pass(!bad.length && (await read(SCRIPTS + '/' + E + '.md')) === edited, 'edited ' + E + ', confirm:false: "kept", edit still there',
    'edited ' + E + ', confirm:false: ' + bad.join(', '));
  st = await run(true);
  bad = only(st, { [E]: 'changed' }, 'same');
  T.pass(!bad.length && (await read(SCRIPTS + '/' + E + '.md')) === src(E), 'edited ' + E + ', confirm:true: "changed", replaced with the source',
    'edited ' + E + ', confirm:true: ' + bad.join(', '));

  // 5. An unedited older version: updated without asking (confirm:false).
  const O = 'Genotype', older = src(O).replace(/\n$/, '') + '\n// older version\n';
  await write(SCRIPTS + '/' + O + '.md', older);
  m = await manifest();
  m.hashes[O] = sha(older);
  await vault.adapter.write(SCRIPTS + '/.fly-genetics.json', JSON.stringify(m, null, 2));
  st = await run(false);
  bad = only(st, { [O]: 'update' }, 'same');
  T.pass(!bad.length && (await read(SCRIPTS + '/' + O + '.md')) === src(O), 'older unedited ' + O + ': "update" without asking, replaced with the source',
    'older unedited ' + O + ': ' + bad.join(', '));
  T.pass((await manifest()).hashes[O] === sha(src(O)), 'manifest hash of ' + O + ' updated', 'manifest hash of ' + O + ' not updated');
} finally {
  await cleanup();
  const left = [INST, ROOT].filter(p => vault.getAbstractFileByPath(p) || fs.existsSync(vault.adapter.basePath + '/' + p));
  T.pass(!left.length, 'cleaned up _flygen-test/ and the installer', 'left behind: ' + left.join(', '));
  fs.rmSync(require('path').dirname(BUILD), { recursive: true, force: true });
}
JS
