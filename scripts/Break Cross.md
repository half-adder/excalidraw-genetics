/*
Break Cross
===========
Undo the link between parents and offspring without deleting any genotype.

Selection:
  - The x between two parents, or elements of BOTH parents of a cross:
      break that whole cross. The x, all its lineage arrows and selection
      criteria are removed, and every offspring becomes a standalone genotype.
  - Elements of an offspring (a genotype with parents):
      detach just that offspring. Its lineage arrow and criterion are removed;
      its label stays. If its cross has no offspring left, the x is removed.
Whole-cross breaks take precedence: selecting a genotype that is both an
offspring and one of two selected parents breaks the cross it is a parent in.

Everything happens in one scene update, so one undo restores it.
*/

if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.9.0")) {
  new Notice("Requires Excalidraw plugin 1.9.0+.");
  return;
}

ea.clear();
const all = ea.getViewElements().filter(el => !el.isDeleted);
const selected = ea.getViewSelectedElements();
const kind = el => el.customData?.kind;
const pairKey = p => `${p.maternal}|${p.paternal}`;

// ---- What to break -------------------------------------------------------------

const crosses = new Map(); // pairKey -> { maternal, paternal }
for (const el of selected) {
  if (kind(el) === "cross-glyph" && el.customData.parents) {
    crosses.set(pairKey(el.customData.parents), el.customData.parents);
  }
}
const selectedGids = new Set(selected.map(el => el.customData?.genotypeId).filter(Boolean));
for (const el of all) {
  const p = el.customData?.parents;
  if (kind(el) === "cross-glyph" && p && selectedGids.has(p.maternal) && selectedGids.has(p.paternal)) {
    crosses.set(pairKey(p), p);
  }
}

// Offspring to detach: every child of a broken cross, plus any selected
// genotype that has parents and is not itself a parent of a broken cross.
const parentsOf = gid => all.find(el => el.customData?.genotypeId === gid && el.customData?.parents)?.customData.parents;
const brokenParents = new Set([...crosses.values()].flatMap(p => [p.maternal, p.paternal]));
const detach = new Set();
for (const gid of new Set(all.map(el => el.customData?.genotypeId).filter(Boolean))) {
  const p = parentsOf(gid);
  if (!p) continue;
  if (crosses.has(pairKey(p))) detach.add(gid);
  else if (selectedGids.has(gid) && !brokenParents.has(gid)) detach.add(gid);
}

if (!crosses.size && !detach.size) {
  new Notice("Select the x of a cross, both of its parents, or an offspring to detach.");
  return;
}

// ---- Apply ---------------------------------------------------------------------

const toDelete = new Set();
const edits = new Map(); // id -> element in the workbench
const edit = el => {
  if (!edits.has(el.id)) {
    ea.copyViewElementsToEAforEditing([el]);
    edits.set(el.id, ea.getElement(el.id));
  }
  return edits.get(el.id);
};

for (const gid of detach) {
  // Lineage arrows into this offspring, and their bound criterion labels.
  for (const el of all) {
    if (el.customData?.childGenotypeId !== gid) continue;
    if (kind(el) === "cross-lineage" || kind(el) === "cross-criterion") toDelete.add(el.id);
  }
  // Drop `parents` from the offspring's own elements (genotype, frame, label).
  for (const el of all) {
    if (el.customData?.genotypeId !== gid || !el.customData.parents) continue;
    const { parents, ...rest } = el.customData;
    edit(el).customData = rest;
  }
}

// Remove the x of every broken cross, and of any cross that just lost its
// last offspring.
const touchedPairs = new Set([...detach].map(gid => pairKey(parentsOf(gid))));
const hasRemainingChild = key => all.some(el =>
  el.customData?.genotypeId && el.customData.parents &&
  !detach.has(el.customData.genotypeId) && pairKey(el.customData.parents) === key);
for (const el of all) {
  if (kind(el) !== "cross-glyph" || !el.customData.parents) continue;
  const key = pairKey(el.customData.parents);
  if (crosses.has(key) || (touchedPairs.has(key) && !hasRemainingChild(key))) toDelete.add(el.id);
}

// Unhook deleted elements from anything that lists them as bound.
for (const el of all) {
  if (toDelete.has(el.id) || !el.boundElements?.some(b => toDelete.has(b.id))) continue;
  edit(el).boundElements = el.boundElements.filter(b => !toDelete.has(b.id));
}
for (const el of all.filter(el => toDelete.has(el.id))) edit(el).isDeleted = true;

await ea.addElementsToView(false, false, true);

const n = detach.size;
new Notice(crosses.size
  ? `Broke ${crosses.size} cross(es); ${n} offspring now standalone.`
  : `Detached ${n} offspring from ${n === 1 ? "its" : "their"} parents.`);
