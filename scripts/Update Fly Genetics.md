/*
Update Fly Genetics
===================
Checks GitHub for a newer version of the Fly Genetics scripts and, if there
is one, downloads the latest installer and runs it. The installer replaces
scripts you have not edited and asks about any you have.

Installed by "Install Fly Genetics". Source:
https://github.com/half-adder/excalidraw-genetics

Test hooks (consumed on read):
  window._flyGeneticsUpdateSource = "<installer text>"  skip the download
  window._flyGeneticsUpdateTarget = { scriptFolder, ...installer target }
*/

const INSTALLER_URL =
  "https://raw.githubusercontent.com/half-adder/excalidraw-genetics/main/dist/Install%20Fly%20Genetics.md";
const INSTALLER_NAME = "Install Fly Genetics";

const source = window._flyGeneticsUpdateSource ?? null;
window._flyGeneticsUpdateSource = undefined;
const target = window._flyGeneticsUpdateTarget ?? null;
window._flyGeneticsUpdateTarget = undefined;

const vault = app.vault;
// The installer must live in the real script folder (the only one Excalidraw
// registers scripts from); the test target only redirects installed files.
const realScriptFolder = (ea.plugin.settings.scriptFolderPath ?? "Excalidraw/Scripts").replace(/\/+$/, "");
const scriptFolder = (target?.scriptFolder ?? realScriptFolder).replace(/\/+$/, "");
const manifestPath = `${scriptFolder}/.fly-genetics.json`;

let manifest = {};
try {
  manifest = JSON.parse(await vault.adapter.read(manifestPath));
} catch (e) { /* no manifest yet: treat as out of date */ }
const installed = manifest.version ?? null;

let text = source;
if (text === null) {
  try {
    const res = await ea.obsidian.requestUrl({ url: `${INSTALLER_URL}?t=${Date.now()}`, throw: false });
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
    text = res.text;
  } catch (e) {
    new Notice(`Fly Genetics: could not reach GitHub (${e.message}).`);
    return;
  }
}

let payload = null;
try {
  const i = text.indexOf("const PAYLOAD = ") + "const PAYLOAD = ".length;
  payload = JSON.parse(text.slice(i, text.indexOf("\n", i)).replace(/;\s*$/, ""));
} catch (e) { /* handled below */ }
const latest = payload?.version;
if (!latest || !payload.scripts) {
  new Notice("Fly Genetics: the downloaded installer looks wrong; nothing changed.");
  return;
}
window._flyGeneticsUpdateResult = { installed, latest, installedFingerprint: manifest.fingerprint ?? null, latestFingerprint: payload.fingerprint ?? null };
// Same contents means up to date. Fingerprints decide when both sides have one
// (so a release with an unchanged version name is still picked up); older
// installs without a fingerprint fall back to the version name.
const upToDate = manifest.fingerprint && payload.fingerprint
  ? manifest.fingerprint === payload.fingerprint
  : installed === latest;
if (upToDate) {
  new Notice(`Fly Genetics is up to date (${latest}).`);
  return;
}

const installerPath = `${realScriptFolder}/${INSTALLER_NAME}.md`;
const existing = vault.getAbstractFileByPath(installerPath);
if (existing) await vault.modify(existing, text);
else await vault.create(installerPath, text);

new Notice(`Fly Genetics: updating ${installed ?? "unknown version"} -> ${latest}...`);
// Give the Script Engine a moment to pick up the new installer, then run it.
await new Promise(r => setTimeout(r, 1500));
if (target) window._flyGeneticsInstallTarget = target;
app.commands.executeCommandById(`obsidian-excalidraw-plugin:${INSTALLER_NAME}`);
