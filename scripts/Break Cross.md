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

// ---- Duplicated genotypes (same in every script; keep in sync) -------------
// A genotype copied in Excalidraw (Cmd+D, copy/paste, alt-drag) keeps the
// original's customData, genotypeId and `parents` included, in a new group;
// a copied x glyph keeps its `parents`. Of the drawings of one genotypeId,
// the original is the one the lineage arrow into the genotype is bound to,
// else the one nearest the x glyphs of its crosses, else the first in scene
// order; every other drawing is a copy and gets a fresh genotypeId. Of the x
// glyphs of one parent pair, the original is the one with a lineage arrow
// into an original drawing, else the one nearest the parents, else the first.
//
// Copied together: Excalidraw moves a copied selection as one block, so the
// copies of one Cmd+D, paste or alt-drag all lie at the same offset from
// their originals (frame top-left of a drawing, top-left of an x glyph;
// equal within DUPLICATE_SHIFT_PX). Before offsets are compared, the
// originals of each copied family (both parents and their x) are re-picked
// to lie to the original child as the copies lie to the copied child, the
// child's arrow being the surest sign of its original (the rules above can
// split a family, e.g. alt-drag moves the originals and leaves copies).
// Separate copies that happen to share an offset (two Cmd+D, not moved)
// count as copied together.
//
// A copied family stays a family: a copy whose two parents were copied at
// its offset keeps `parents`, pointing at those copies; an x glyph copied
// with both of its parents points at their copies; a lineage arrow copied
// into such a copy (and its criterion) is kept, re-pointed at the copy and
// bound from the copied x (unbound if the x was not copied). Every other
// copy is a new founder (no `parents`); lineage arrows copied into it (and
// their criteria) are removed, and so is an x glyph copied without both of
// its parents. Commits (one scene update) only if a duplicate was found;
// returns whether it did.
const DUPLICATE_TIE_PX = 25;   // nearer by less than this: a tie (Cmd+D offsets a copy by 10 px)
const DUPLICATE_SHIFT_PX = 2;  // offsets closer than this: copied together
async function splitDuplicateGenotypes() {
  const all = ea.getViewElements().filter(el => !el.isDeleted);
  const byId = new Map(all.map(el => [el.id, el]));
  const order = new Map(all.map((el, i) => [el.id, i]));
  const first = els => Math.min(...els.map(e => order.get(e.id)));
  const alleles = els => els.filter(e => e.customData.kind === "genotype-allele");
  const center = els => { const b = ea.getBoundingBox(els); return [b.topX + b.width / 2, b.topY + b.height / 2]; };
  const topLeft = els => {
    const f = els.find(e => e.customData.kind === "genotype-frame");
    if (f) return [f.x, f.y];
    const b = ea.getBoundingBox(els);
    return [b.topX, b.topY];
  };
  // Drawings of each genotypeId, told apart by their innermost group; x
  // glyphs of each parent pair.
  const drawingsOf = new Map(), parentsOf = new Map(), xsOf = new Map();
  for (const el of all) {
    const cd = el.customData;
    if (cd?.genotypeId) {
      const groups = drawingsOf.get(cd.genotypeId) ?? drawingsOf.set(cd.genotypeId, new Map()).get(cd.genotypeId);
      const key = el.groupIds?.[0] ?? "";
      (groups.get(key) ?? groups.set(key, []).get(key)).push(el);
      if (cd.parents && !parentsOf.has(cd.genotypeId)) parentsOf.set(cd.genotypeId, cd.parents);
    } else if (cd?.kind === "cross-glyph" && cd.parents?.maternal && cd.parents?.paternal) {
      const key = cd.parents.maternal + "|" + cd.parents.paternal;
      (xsOf.get(key) ?? xsOf.set(key, []).get(key)).push(el);
    }
  }
  // Duplicated genotypes (by genotypeId) and x glyphs (by "x:" + parent
  // pair): { units: element lists, at: their top-left, keep: the original }.
  const dup = new Map();
  for (const [gid, groups] of drawingsOf) {
    const drawings = [...groups.values()].filter(els => els.some(e => e.customData.kind === "genotype-allele"));
    if (drawings.length < 2) continue;
    const members = drawings.map(els => new Set(els.map(e => e.id)));
    const arrowsIn = all.filter(e => e.customData?.kind === "cross-lineage" && e.customData.childGenotypeId === gid);
    const bound = drawings.map((_, i) => i).filter(i => arrowsIn.some(a => members[i].has(a.endBinding?.elementId)));
    let keep = bound.length === 1 ? bound[0] : null;
    if (keep === null) {
      const pool = bound.length ? bound : drawings.map((_, i) => i);
      const parents = parentsOf.get(gid);
      const glyphs = all.filter(e => {
        const p = e.customData?.kind === "cross-glyph" ? e.customData.parents : null;
        return p && (p.maternal === gid || p.paternal === gid
          || (parents && p.maternal === parents.maternal && p.paternal === parents.paternal));
      });
      const dist = i => {
        if (!glyphs.length) return 0;
        const [cx, cy] = center(alleles(drawings[i]));
        return Math.min(...glyphs.map(g => Math.hypot(g.x + g.width / 2 - cx, g.y + g.height / 2 - cy)));
      };
      const best = Math.min(...pool.map(dist));
      keep = pool.filter(i => dist(i) - best < DUPLICATE_TIE_PX).sort((a, b) => first(drawings[a]) - first(drawings[b]))[0];
    }
    dup.set(gid, { units: drawings, at: drawings.map(topLeft), keep });
  }
  const original = el => {
    const d = el && dup.get(el.customData?.genotypeId);
    return !!el && (!d || d.units[d.keep].includes(el));
  };
  for (const [key, xs] of xsOf) {
    if (xs.length < 2) continue;
    const [m, p] = key.split("|");
    const arrowed = xs.map((_, i) => i).filter(i => all.some(a => a.customData?.kind === "cross-lineage"
      && a.startBinding?.elementId === xs[i].id && original(byId.get(a.endBinding?.elementId))));
    let keep = arrowed.length === 1 ? arrowed[0] : null;
    if (keep === null) {
      const pool = arrowed.length ? arrowed : xs.map((_, i) => i);
      const ends = [m, p].map(g => {
        const d = dup.get(g);
        return alleles(d ? d.units[d.keep] : [...(drawingsOf.get(g)?.values() ?? [])].flat());
      }).filter(els => els.length).map(center);
      const mid = ends.length ? [0, 1].map(k => ends.reduce((s, c) => s + c[k], 0) / ends.length) : null;
      const dist = i => {
        if (!mid) return 0;
        const [cx, cy] = center(xs.slice(i, i + 1));
        return Math.hypot(cx - mid[0], cy - mid[1]);
      };
      const best = Math.min(...pool.map(dist));
      keep = pool.filter(i => dist(i) - best < DUPLICATE_TIE_PX).sort((a, b) => first([xs[a]]) - first([xs[b]]))[0];
    }
    dup.set("x:" + key, { units: xs.map(x => [x]), at: xs.map(x => [x.x, x.y]), keep, parents: { maternal: m, paternal: p } });
  }
  if (!dup.size) return false;

  // Offset of unit i from the original; whether two offsets are one.
  const offset = (d, i) => [d.at[i][0] - d.at[d.keep][0], d.at[i][1] - d.at[d.keep][1]];
  const same = (a, b) => Math.abs(a[0] - b[0]) < DUPLICATE_SHIFT_PX && Math.abs(a[1] - b[1]) < DUPLICATE_SHIFT_PX;
  // Re-picks the original of d as the unit from which the most of ref's copy
  // offsets lead to another unit of d (the current original wins ties).
  const align = (d, ref) => {
    const shifts = ref.units.map((_, r) => r).filter(r => r !== ref.keep).map(r => offset(ref, r));
    const score = i => shifts.filter(s => d.at.some((a, j) => j !== i && same([a[0] - d.at[i][0], a[1] - d.at[i][1]], s))).length;
    const scores = d.units.map((_, i) => score(i));
    const best = Math.max(...scores);
    if (best > 0 && scores[d.keep] < best) d.keep = scores.indexOf(best);
  };
  // Generations below the founders, so a family is lined up with its child
  // before it serves as the child of the family above.
  const depth = new Map();
  const depthOf = (g, seen = new Set()) => {
    if (depth.has(g)) return depth.get(g);
    const p = parentsOf.get(g);
    if (!p || seen.has(g)) return 0;
    seen.add(g);
    const d = 1 + Math.max(depthOf(p.maternal, seen), depthOf(p.paternal, seen));
    depth.set(g, d);
    return d;
  };
  const copiedPair = p => !!p && dup.has(p.maternal) && dup.has(p.paternal);
  const lined = new Set();
  const children = [...dup.keys()].filter(g => copiedPair(parentsOf.get(g))).sort((a, b) => depthOf(b) - depthOf(a));
  for (const c of children) {
    const p = parentsOf.get(c);
    for (const g of [p.maternal, p.paternal]) { align(dup.get(g), dup.get(c)); lined.add(g); }
  }
  for (const d of dup.values()) {
    if (!copiedPair(d.parents)) continue;
    const m = dup.get(d.parents.maternal), p = dup.get(d.parents.paternal);
    if (!lined.has(d.parents.maternal) && !lined.has(d.parents.paternal)) align(p, m);
    align(d, m);
  }

  // Every copy: a fresh genotypeId, and the copies of its parents if both
  // were copied at its offset.
  for (const d of dup.values()) if (!d.parents) d.fresh = d.units.map((_, i) => i === d.keep ? null : crypto.randomUUID());
  const copyAt = (key, s) => {
    const d = dup.get(key);
    const i = d ? d.units.findIndex((_, j) => j !== d.keep && same(offset(d, j), s)) : -1;
    return i < 0 ? null : i;
  };
  const copiedParents = (p, s) => {
    const m = p && copyAt(p.maternal, s), f = p && copyAt(p.paternal, s);
    return m === null || f === null || !p ? null
      : { maternal: dup.get(p.maternal).fresh[m], paternal: dup.get(p.paternal).fresh[f] };
  };
  const renamed = new Map();   // element id -> { genotypeId, parents (null: a founder), of, shift }
  const xCopies = new Map();   // x glyph id -> parents of its copy (null: removed)
  for (const [key, d] of dup) d.units.forEach((els, i) => {
    if (i === d.keep) return;
    const s = offset(d, i);
    if (d.parents) { xCopies.set(els[0].id, copiedParents(d.parents, s)); return; }
    const info = { genotypeId: d.fresh[i], parents: copiedParents(parentsOf.get(key), s), of: key, shift: s };
    for (const el of els) renamed.set(el.id, info);
  });

  // Lineage arrows into a copy, with their criteria: kept into a copied
  // family (re-pointed, bound from its x), else removed.
  const doomed = new Set();
  const startOf = new Map();   // re-bound arrow id -> its new start (null: none)
  const childOf = new Map();   // kept arrow or criterion id -> the copy's genotypeId
  for (const [id, parents] of xCopies) if (!parents) doomed.add(id);
  for (const a of all) {
    const info = a.customData?.kind === "cross-lineage" ? renamed.get(a.endBinding?.elementId) : null;
    if (!info) continue;
    const texts = (a.boundElements ?? []).filter(b => b.type === "text").map(b => b.id);
    if (!info.parents) {
      doomed.add(a.id);
      for (const t of texts) doomed.add(t);
      continue;
    }
    for (const id of [a.id, ...texts]) childOf.set(id, info.genotypeId);
    const p = parentsOf.get(info.of), key = "x:" + p.maternal + "|" + p.paternal;
    const i = copyAt(key, info.shift);
    const x = i === null ? null : dup.get(key).units[i][0].id;
    if (a.startBinding?.elementId !== x) startOf.set(a.id, x);
  }
  for (const a of all) {
    if (a.customData?.kind === "cross-lineage" && !doomed.has(a.id) && !startOf.has(a.id)
        && doomed.has(a.startBinding?.elementId)) startOf.set(a.id, null);
  }
  // A binding is kept only if the other end still points back at `el`.
  const startId = o => startOf.has(o.id) ? startOf.get(o.id) : o.startBinding?.elementId;
  const bindsTo = (b, el) => {
    const o = byId.get(b.id);
    if (!o || doomed.has(o.id)) return false;
    return b.type === "text" ? o.containerId === el.id
      : startId(o) === el.id || o.endBinding?.elementId === el.id;
  };
  const newlyBound = new Map();   // element id -> arrows now starting on it
  for (const [a, x] of startOf) if (x) (newlyBound.get(x) ?? newlyBound.set(x, []).get(x)).push(a);
  ea.clear();
  const edit = el => ea.getElement(el.id) ?? (ea.copyViewElementsToEAforEditing([el]), ea.getElement(el.id));
  for (const el of all) {
    if (doomed.has(el.id)) { edit(el).isDeleted = true; continue; }
    const info = renamed.get(el.id);
    if (info) {
      const { parents, ...rest } = el.customData;
      edit(el).customData = { ...rest, genotypeId: info.genotypeId, ...(info.parents ? { parents: info.parents } : {}) };
    }
    if (xCopies.has(el.id)) edit(el).customData = { ...el.customData, parents: xCopies.get(el.id) };
    if (childOf.has(el.id) && el.customData?.childGenotypeId) edit(el).customData = { ...el.customData, childGenotypeId: childOf.get(el.id) };
    if (startOf.has(el.id)) {
      const x = startOf.get(el.id);
      edit(el).startBinding = x ? { ...(el.startBinding ?? { mode: "orbit", fixedPoint: [0.5, 1] }), elementId: x } : null;
    }
    const touched = info || xCopies.has(el.id) || newlyBound.has(el.id)
      || el.boundElements?.some(b => doomed.has(b.id) || startOf.has(b.id));
    if (touched && (el.boundElements?.length || newlyBound.has(el.id))) {
      const kept = (el.boundElements ?? []).filter(b => bindsTo(b, el));
      for (const id of newlyBound.get(el.id) ?? []) if (!kept.some(b => b.id === id)) kept.push({ type: "arrow", id });
      edit(el).boundElements = kept;
    }
  }
  await ea.addElementsToView(false, false, true);
  ea.clear();
  return true;
}

// Copies of a genotype made in Excalidraw become their own genotypes first.
await splitDuplicateGenotypes();

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
