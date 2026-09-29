/*
Select Lineage
==============
Selects the whole lineage of the selected genotype: its ancestors,
descendants and mates, with every x, arrow, criterion and label between
them. Drag the selection to move the lineage together.
*/

const MODE = "lineage";

if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.9.0")) {
  new Notice("Requires Excalidraw plugin 1.9.0+.");
  return;
}

const all = ea.getViewElements().filter(el => !el.isDeleted);
const seed = ea.getViewSelectedElements().find(el => el.customData?.genotypeId)?.customData.genotypeId;
if (!seed) {
  new Notice("Select a genotype first.");
  return;
}

// Crosses as [maternal, paternal, child] from offspring `parents`, plus
// crosses that have an x but no offspring yet.
const parentsOf = new Map();
for (const el of all) {
  const cd = el.customData;
  if (cd?.genotypeId && cd.parents?.maternal && cd.parents?.paternal) parentsOf.set(cd.genotypeId, cd.parents);
}
const pairs = [...parentsOf.values()];
for (const el of all) {
  const p = el.customData?.kind === "cross-glyph" ? el.customData.parents : null;
  if (p?.maternal && p?.paternal) pairs.push(p);
}

const set = new Set([seed]);
if (MODE === "lineage") {
  // Everything connected through parent/child and mate links.
  let grew = true;
  while (grew) {
    grew = false;
    const add = g => { if (g && !set.has(g)) { set.add(g); grew = true; } };
    for (const [child, p] of parentsOf) {
      if (set.has(child) || set.has(p.maternal) || set.has(p.paternal)) { add(child); add(p.maternal); add(p.paternal); }
    }
    for (const p of pairs) if (set.has(p.maternal) || set.has(p.paternal)) { add(p.maternal); add(p.paternal); }
  }
} else {
  // The seed, its descendants, and the mates in every cross they parent.
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of pairs) {
      if (!set.has(p.maternal) && !set.has(p.paternal)) continue;
      for (const g of [p.maternal, p.paternal]) if (!set.has(g)) { set.add(g); grew = true; }
    }
    for (const [child, p] of parentsOf) {
      if (!set.has(child) && (set.has(p.maternal) || set.has(p.paternal))) { set.add(child); grew = true; }
    }
  }
}

// Genotype elements, plus cross furniture whose cross lies inside the set.
// An arrow is included only if both of its child's parents are in the set, so
// in "below" mode the arrow into the seed stays behind (it is bound and
// re-routes when the selection is dragged).
const crossInside = p => p && set.has(p.maternal) && set.has(p.paternal);
const pick = all.filter(el => {
  const cd = el.customData;
  if (!cd) return false;
  if (cd.genotypeId) return set.has(cd.genotypeId);
  if (cd.kind === "cross-glyph") return crossInside(cd.parents);
  if (cd.kind === "cross-lineage" || cd.kind === "cross-criterion") return crossInside(parentsOf.get(cd.childGenotypeId));
  return false;
});
ea.selectElementsInView(pick);
window._flySelectResult = { mode: MODE, genotypes: set.size, genotypeIds: [...set], elements: pick.length };
