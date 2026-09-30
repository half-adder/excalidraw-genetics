/*
Install Fly Genetics
====================
One-file installer for the Drosophila genotype scripts (Genotype, Cross
Genotypes, Cross Mode, Tidy, Tidy Below, Select Lineage, Select Below, Break
Cross, Update Fly Genetics) and the Computer Modern font they draw with.

To install: put this file in your Excalidraw script folder (Settings ->
Excalidraw -> Basic -> Files and folders -> Excalidraw Automate script folder;
default Excalidraw/Scripts), then run "Install Fly Genetics" from the command
palette.

What it does:
  1. Writes the scripts into the script folder. Scripts you have not edited are
     updated silently; it asks before replacing ones you have edited.
     "Update Fly Genetics" later pulls newer versions from GitHub.
  2. Writes the Computer Modern Serif font (cmu-serif-500-roman.ttf) and its
     license (SIL Open Font License) to Excalidraw/Fonts/.
  3. Enables Excalidraw's local font and points it at that file. Asks first
     if the local font is already set to a different file.
It does not change hotkeys. Suggested (Settings -> Hotkeys): Genotype,
Cross Genotypes, Cross Mode (Shift+9), Tidy, Tidy Below, Select Below.

Built from https://github.com/half-adder/excalidraw-genetics by
installer/build.py; version and build date are in PAYLOAD below.

Test hook (consumed on read): window._flyGeneticsInstallTarget =
  { scriptFolder, fontFolder, skipSettings, confirm }
redirects the install and answers the prompts, for testing.
*/

const PAYLOAD = /*__PAYLOAD__*/null;

if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("2.20.2")) {
  new Notice("Fly Genetics needs Excalidraw plugin 2.20.2 or newer.");
  return;
}

const target = window._flyGeneticsInstallTarget ?? null;
window._flyGeneticsInstallTarget = undefined;

const vault = app.vault;
const settings = ea.plugin.settings;
const scriptFolder = (target?.scriptFolder ?? settings.scriptFolderPath ?? "Excalidraw/Scripts").replace(/\/+$/, "");
const fontFolder = (target?.fontFolder ?? "Excalidraw/Fonts").replace(/\/+$/, "");
const fontPath = `${fontFolder}/${PAYLOAD.font.name}`;

const confirm = async (question, yes, no) => {
  if (target) return target.confirm ?? true;
  const answer = await utils.suggester([yes, no], [true, false], question);
  return answer === true;
};

async function ensureFolder(path) {
  let cur = "";
  for (const part of path.split("/")) {
    cur = cur ? `${cur}/${part}` : part;
    if (!vault.getAbstractFileByPath(cur)) await vault.createFolder(cur);
  }
}

async function writeText(path, text) {
  const f = vault.getAbstractFileByPath(path);
  if (f) await vault.modify(f, text);
  else await vault.create(path, text);
}

async function writeBinary(path, buffer) {
  const f = vault.getAbstractFileByPath(path);
  if (f) await vault.modifyBinary(f, buffer);
  else await vault.createBinary(path, buffer);
}

const fromBase64 = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;

// ---- 1. Scripts -------------------------------------------------------------
// A manifest (.fly-genetics.json in the script folder) records the version
// and a SHA-256 of each script as installed. A script whose current contents
// still match that hash was not edited by the user and is replaced silently;
// edited scripts are only replaced after asking.

const sha256 = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))]
  .map(b => b.toString(16).padStart(2, "0")).join("");
const manifestPath = `${scriptFolder}/.fly-genetics.json`;
let manifest = { version: null, hashes: {} };
try { manifest = JSON.parse(await vault.adapter.read(manifestPath)); } catch (e) { /* first install */ }

await ensureFolder(scriptFolder);
const plan = [];
for (const [name, text] of Object.entries(PAYLOAD.scripts)) {
  const path = `${scriptFolder}/${name}.md`;
  const f = vault.getAbstractFileByPath(path);
  const current = f ? await vault.read(f) : null;
  let state = current === null ? "new" : current === text ? "same" : "changed";
  // A symbolic link is a development copy (the scripts linked from a clone of
  // the repo): never write through it, whatever the prompts say.
  try {
    const fsm = require("fs");
    const abs = `${vault.adapter.basePath}/${path}`;
    if (fsm.existsSync(abs) && fsm.lstatSync(abs).isSymbolicLink()) state = "linked";
  } catch (e) { /* not a desktop filesystem: no links to protect */ }
  if (state === "changed" && manifest.hashes?.[name] === await sha256(current)) state = "update";
  plan.push({ name, path, text, state });
}
const edited = plan.filter(p => p.state === "changed");
if (edited.length && !(await confirm(
  `You have edited ${edited.map(p => p.name).join(", ")}. Replace with version ${PAYLOAD.version}?`,
  "Replace", "Keep my edited copies"
))) {
  for (const p of edited) p.state = "kept";
}
const hashes = { ...(manifest.hashes ?? {}) };
for (const p of plan) {
  if (p.state === "new" || p.state === "changed" || p.state === "update") await writeText(p.path, p.text);
  if (p.state !== "kept" && p.state !== "linked") hashes[p.name] = await sha256(p.text);
}
await vault.adapter.write(manifestPath, JSON.stringify({ version: PAYLOAD.version, fingerprint: PAYLOAD.fingerprint, hashes }, null, 2));

// ---- 2. Font ------------------------------------------------------------------

await ensureFolder(fontFolder);
const fontFile = vault.getAbstractFileByPath(fontPath);
if (!fontFile || fontFile.stat.size !== PAYLOAD.font.size) {
  await writeBinary(fontPath, fromBase64(PAYLOAD.font.base64));
}
await writeText(`${fontFolder}/${PAYLOAD.license.name}`, PAYLOAD.license.text);

// ---- 3. Excalidraw local font setting -----------------------------------------

let fontNote = "";
if (!target?.skipSettings) {
  const alreadyOurs = settings.experimentalEnableFourthFont && settings.experimantalFourthFont === fontPath;
  const otherFont = settings.experimentalEnableFourthFont && !alreadyOurs;
  if (alreadyOurs) {
    fontNote = "Local font was already set to Computer Modern.";
  } else if (!otherFont || await confirm(
    `Excalidraw's local font is set to "${settings.experimantalFourthFont}". Replace it with Computer Modern?`,
    "Use Computer Modern", "Keep my font"
  )) {
    settings.experimentalEnableFourthFont = true;
    settings.experimantalFourthFont = fontPath;
    await ea.plugin.saveSettings();
    if (ea.plugin.initializeFonts) await ea.plugin.initializeFonts();
    fontNote = "Local font set to Computer Modern. Reopen open drawings to see it.";
  } else {
    fontNote = "Kept your local font; genotypes will be drawn in it.";
  }
}

// ---- Report -------------------------------------------------------------------

const summary = plan.map(p => `${p.name}: ${{ new: "installed", changed: "replaced", update: "updated", same: "already current", kept: "kept yours", linked: "linked (development copy, left alone)" }[p.state]}`);
// What's new: changelog entries newer than the previously installed version
// (just the latest entry on a first install or an unknown old version).
const entries = PAYLOAD.changelog ?? [];
const seen = entries.findIndex(e => e.version === manifest.version);
const news = manifest.version === PAYLOAD.version ? [] : entries.slice(0, seen > 0 ? seen : 1);
const whatsNew = news.map(e => `${e.version}\n${e.text}`).join("\n\n");

window._flyGeneticsInstallResult = { plan: plan.map(({ name, state }) => ({ name, state })), fontPath, fontNote, whatsNew };
new Notice(
  `Fly Genetics ${PAYLOAD.version}\n${summary.join("\n")}\n${fontNote}\n` +
  (whatsNew ? `\nWhat's new:\n${whatsNew}\n\n` : "") +
  "Optional: assign hotkeys in Settings -> Hotkeys (search \"Genotype\").",
  15000
);
