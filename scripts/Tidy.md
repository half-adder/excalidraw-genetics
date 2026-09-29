/*
Tidy
====
Reflows the connected lineage of the selected element.

In v1 terms: if the selected genotype has no parents and no descendants,
this behaves identically to "Tidy Genotype" (reflows just that genotype).

In v2: walks the connected DAG of genotypes via the `parents` field on each
offspring's elements. Collects ancestors and descendants to a fixpoint,
computes per-genotype generation depth (longest path from any root), lays
out each generation in a horizontal band ordered by parent-position barycenter,
and renders cross furniture (x glyph, lineage lines, optional selection
criteria) from the offspring-side `parents` field as the source of truth.

Manual text edits to alleles, labels, and criteria are honored. Element ids
regenerate. `genotypeId` is preserved.

Usage:
  Nothing selected: every lineage is reflowed.
  Elements of ONE genotype selected: that genotype's whole lineage is
  reflowed; everything else is untouched.
  Elements of TWO OR MORE genotypes selected: exactly those genotypes are
  reflowed (Tidy Below selects a genotype and everything under it, then runs
  Tidy). Everything else is a fixed obstacle. The selected genotypes with no
  selected parents, in the top row, stay where they are if possible. An
  arrow into a selected genotype from a cross outside the selection is kept
  (with its criterion) and re-bound to the genotype's new frame.
*/
using _tidyDone = { [Symbol.dispose]() { window._tidyLastResult = (window._tidyLastResult ?? 0) + 1; } }; // tests wait on this: bumped whenever Tidy exits

if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.9.0")) {
  new Notice("Requires Excalidraw plugin 1.9.0+.");
  return;
}

const SCHEMA = 2;
const FONT_SIZE = 20;
// Same style as Genotype / Cross Genotypes: Computer Modern via Excalidraw's
// Local Font (4), Helvetica (2) fallback and for the sex glyph.
const LOCAL_FONT_FAMILY = 4;
const FALLBACK_FONT_FAMILY = 2;
const GLYPH_FONT_FAMILY = 2;
const FRAME_PAD = 4;              // invisible genotype-frame padding, px

// Offspring label: text in a black-outlined, light-blue box, centered on
// `centerX` with its bottom edge at `bottomY`. The text is tagged
// `genotype-label`, the box `genotype-label-box`; both carry `data`.
const LABEL_BOX_BG = "#a5d8ff";
const LABEL_BOX_PAD = 6;
function addLabelBox(text, centerX, bottomY, data) {
  const saved = { bg: ea.style.backgroundColor, fill: ea.style.fillStyle, stroke: ea.style.strokeColor };
  ea.style.backgroundColor = LABEL_BOX_BG;
  ea.style.fillStyle = "solid";
  ea.style.strokeColor = "#000000";
  const boxId = ea.addText(0, 0, text, {
    box: "box", boxPadding: LABEL_BOX_PAD, boxStrokeColor: "#000000",
    textAlign: "center", textVerticalAlign: "middle",
  });
  ea.style.backgroundColor = saved.bg;
  ea.style.fillStyle = saved.fill;
  ea.style.strokeColor = saved.stroke;
  const box = ea.getElement(boxId);
  const textId = box.boundElements.find(b => b.type === "text").id;
  const dx = centerX - box.width / 2 - box.x, dy = bottomY - box.height - box.y;
  for (const el of [box, ea.getElement(textId)]) { el.x += dx; el.y += dy; }
  ea.addAppendUpdateCustomData(textId, { ...data, kind: "genotype-label" });
  ea.addAppendUpdateCustomData(boxId, { ...data, kind: "genotype-label-box" });
  return { boxId, textId };
}

// Selection criterion: a real Excalidraw arrow label (text bound to the
// arrow), centered at the midpoint of the arrow's path. May be multi-line.
function pathMidpoint(arrow) {
  const pts = arrow.points.map(([x, y]) => [arrow.x + x, arrow.y + y]);
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let half = segs.reduce((a, b) => a + b, 0) / 2, mx = pts[0][0], my = pts[0][1];
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      mx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      my = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      break;
    }
    half -= segs[i];
  }
  return [mx, my];
}
function addArrowLabel(arrowId, text, data) {
  const arrow = ea.getElement(arrowId);
  const [mx, my] = pathMidpoint(arrow);
  const textId = ea.addText(0, 0, text, { textAlign: "center", textVerticalAlign: "middle" });
  const t = ea.getElement(textId);
  t.containerId = arrowId;
  t.x = mx - t.width / 2;
  t.y = my - t.height / 2;
  arrow.boundElements = [...(arrow.boundElements ?? []), { type: "text", id: textId }];
  ea.addAppendUpdateCustomData(textId, { ...data, kind: "cross-criterion" });
  return textId;
}
const CROSS_GLYPH_FONT_FAMILY = 1;   // Virgil: hand-drawn "x" between parents

// Lineage arrows are elbow arrows: straight down when the child is under the
// cross glyph, otherwise down / across / down through the vertical midpoint.
function lineagePoints(x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 0.5) return [[x1, y1], [x1, y2]];
  const midY = (y1 + y2) / 2;
  return [[x1, y1], [x1, midY], [x2, midY], [x2, y2]];
}
const FONT_FAMILY = ea.plugin?.settings?.experimentalEnableFourthFont
  ? LOCAL_FONT_FAMILY : FALLBACK_FONT_FAMILY;
const GLYPH_SIZE = 24;
const CHROMOSOME_GAP = 14;
const FRACTION_PADDING = 4;
const FRACTION_GAP = 5;
const GLYPH_GAP = 12;
const STROKE_WIDTH = 1.5;
const GENERATION_GAP_Y = 140;   // vertical gap between generation rows
const SIBLING_GAP_X = 60;       // horizontal gap between same-depth genotypes
const CHROMOSOME_ORDER = ["X", "II", "III", "IV"];
const CROSS_GLYPH_CHAR = "x";
const LINEAGE_DROP = 60;       // (not strictly used; layout y-spacing dominates)
const LABEL_GAP = 8;           // gap between label baseline and genotype top

// ---- v2 helpers ----------------------------------------------------------

function getGenotypeIdFromElement(el) {
  return el?.customData?.genotypeId ?? null;
}

function getGenotypeElements(genotypeId, allElements) {
  return allElements.filter(e => e.customData?.genotypeId === genotypeId);
}

function getParentsFromGenotype(genotypeId, allElements) {
  // Returns { maternal, paternal } or null if this is a root.
  // Reads from any element of the genotype (parents is denormalized).
  for (const el of allElements) {
    if (el.customData?.genotypeId === genotypeId && el.customData?.parents) {
      return el.customData.parents;
    }
  }
  return null;
}

function reconstructShorthand(genotypeId, allElements) {
  // Inverse of parseShorthand: produces "w; +/+; TM3/+" from tagged elements.
  const members = getGenotypeElements(genotypeId, allElements);
  const byChrom = {};
  for (const el of members) {
    const cd = el.customData;
    if (cd?.kind !== "genotype-allele") continue;
    if (!byChrom[cd.chromosome]) byChrom[cd.chromosome] = {};
    byChrom[cd.chromosome][cd.side] = el.text;
  }
  const parts = [];
  for (const label of CHROMOSOME_ORDER) {
    const a = byChrom[label];
    if (!a) continue;
    if (a.single !== undefined) parts.push(a.single);
    else if (a.top !== undefined && a.bottom !== undefined) parts.push(`${a.top}/${a.bottom}`);
  }
  return parts.join(" ; ");
}

function walkAncestors(genotypeId, allElements, visited = new Set()) {
  if (visited.has(genotypeId)) return visited;
  visited.add(genotypeId);
  const parents = getParentsFromGenotype(genotypeId, allElements);
  if (!parents) return visited;
  if (parents.maternal) walkAncestors(parents.maternal, allElements, visited);
  if (parents.paternal) walkAncestors(parents.paternal, allElements, visited);
  return visited;
}

function walkDescendants(seedIds, allElements) {
  // Fixpoint expansion: find every genotype whose parents reference any id in the set.
  const result = new Set(seedIds);
  const allGenotypeIds = new Set(
    allElements.map(e => e.customData?.genotypeId).filter(Boolean)
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const gid of allGenotypeIds) {
      if (result.has(gid)) continue;
      const parents = getParentsFromGenotype(gid, allElements);
      if (!parents) continue;
      if ((parents.maternal && result.has(parents.maternal)) ||
          (parents.paternal && result.has(parents.paternal))) {
        result.add(gid);
        changed = true;
      }
    }
  }
  return result;
}

// The whole connected component of `genotypeId`: parents, offspring and x
// glyph partners, followed in every direction to a fixpoint. Ancestors plus
// descendants is not enough: a genotype crossed with a mate from another
// family would join a lineage without its own parents (and lose its arrow),
// and the two families would be laid out apart.
function collectLineage(genotypeId, allElements) {
  const set = walkDescendants(walkAncestors(genotypeId, allElements), allElements);
  const links = [];
  const seen = new Set();
  for (const el of allElements) {
    const cd = el.customData;
    const p = cd?.parents;
    if (!p) continue;
    if (cd.genotypeId && !seen.has(cd.genotypeId)) {
      seen.add(cd.genotypeId);
      links.push([cd.genotypeId, p.maternal, p.paternal].filter(Boolean));
    } else if (cd.kind === "cross-glyph") {
      links.push([p.maternal, p.paternal].filter(Boolean));
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const ids of links) {
      if (!ids.some(g => set.has(g))) continue;
      for (const g of ids) if (!set.has(g)) { set.add(g); changed = true; }
    }
  }
  return set;
}

function computeDepths(lineageSet, allElements) {
  // Two-pass depth:
  //   Pass 1: top-down depth = longest path from any root in the lineage.
  //   Pass 2: a genotype's ROW = max(own top-down, max top-down of any
  //           co-parent). A co-parent is the OTHER parent in a cross where
  //           this genotype is also a parent.
  //
  // Why two passes: standard fly-cross notation places a genotype at the
  // row where it's USED, not where it originated. A stock used at the F2
  // generation should sit alongside F1 in the figure, even though it's a
  // root genotype (top-down depth 0). Pure top-down would shove it back
  // to row 0 with the founding stocks, where the cross-glyph collides
  // with it.
  const topDown = new Map();
  function td(gid, stack = new Set()) {
    if (topDown.has(gid)) return topDown.get(gid);
    if (stack.has(gid)) return 0; // cycle guard
    stack.add(gid);
    const parents = getParentsFromGenotype(gid, allElements);
    let d = 0;
    if (parents) {
      const dm = parents.maternal && lineageSet.has(parents.maternal)
        ? td(parents.maternal, stack) : -1;
      const dp = parents.paternal && lineageSet.has(parents.paternal)
        ? td(parents.paternal, stack) : -1;
      d = 1 + Math.max(dm, dp);
      if (d < 0) d = 0;
    }
    stack.delete(gid);
    topDown.set(gid, d);
    return d;
  }
  for (const gid of lineageSet) td(gid);

  // Pass 2: for each genotype, find max top-down depth of any co-parent.
  const result = new Map();
  for (const gid of lineageSet) {
    let maxCoparent = -1;
    for (const cgid of lineageSet) {
      const cParents = getParentsFromGenotype(cgid, allElements);
      if (!cParents) continue;
      if (cParents.maternal === gid && cParents.paternal && lineageSet.has(cParents.paternal)) {
        maxCoparent = Math.max(maxCoparent, topDown.get(cParents.paternal) ?? 0);
      }
      if (cParents.paternal === gid && cParents.maternal && lineageSet.has(cParents.maternal)) {
        maxCoparent = Math.max(maxCoparent, topDown.get(cParents.maternal) ?? 0);
      }
    }
    result.set(gid, Math.max(topDown.get(gid) ?? 0, maxCoparent));
  }
  return result;
}

// ---- Locate the seed genotype --------------------------------------------
// With a genotype element selected, tidy that genotype's lineage. With
// nothing selected, tidy every lineage in the drawing (see end of file).

// A script that starts Tidy right after changing the selection (Cross
// Genotypes, Tidy Below) passes the genotypes to tidy in
// window._tidySeed = { genotypeIds: [...], at: Date.now() } instead, since a
// selection set with updateScene only lands on Excalidraw's next render.
// The seed is used once, and only if fresh.
const seed = window._tidySeed;
window._tidySeed = undefined;
const seedGids = seed && Date.now() - seed.at < 10000 ? (seed.genotypeIds ?? []).filter(Boolean) : null;
const selected = seedGids ? [] : ea.getViewSelectedElements();
let selectedSeedId = seedGids ? (seedGids[0] ?? null) : null;
for (const el of selected) {
  if (el.customData?.genotypeId) { selectedSeedId = el.customData.genotypeId; break; }
}
if (selected.length > 0 && !selectedSeedId) {
  new Notice("Selected element is not part of a tagged genotype.");
  return;
}
const selectedGids = new Set(seedGids ?? selected.map(el => el.customData?.genotypeId).filter(Boolean));

// Tidies the lineage containing `seedGenotypeId` and returns its genotype-id
// set. Each call starts from a clean workbench and commits on its own.
// `avoid`: genotype ids of other lineages the result must keep clear of.
// `subset`: tidy exactly these genotype ids instead of a lineage (two or
// more selected); `avoid` is then ignored and every element outside the
// subset is an obstacle.
async function tidyLineage(seedGenotypeId, avoid, subset = null) {
ea.clear();
const below = !!subset;   // subset mode

// ---- Compute lineage set --------------------------------------------------

const allElements = ea.getViewElements();
const lineageSet = below
  ? new Set(subset)
  : collectLineage(seedGenotypeId, allElements);

// Extend lineage with orphan cross-glyph pairs: any cross-glyph that
// references a genotype already in the lineage pulls in its partner. This
// makes "press Cross before typing offspring shorthand" tidy-able: the two
// parents are placed side-by-side at the same row and the glyph gets
// regenerated between them in Phase D. Fixpoint walk so a chain of
// orphan glyphs (A-x-B, B-x-C, ...) resolves in one pass. A subset is
// tidied exactly as selected.
if (!below) {
  let added = true;
  while (added) {
    added = false;
    for (const el of allElements) {
      if (el.customData?.kind !== "cross-glyph") continue;
      const p = el.customData.parents;
      if (!p?.maternal || !p?.paternal) continue;
      const mIn = lineageSet.has(p.maternal);
      const pIn = lineageSet.has(p.paternal);
      if (mIn && !pIn) { lineageSet.add(p.paternal); added = true; }
      else if (pIn && !mIn) { lineageSet.add(p.maternal); added = true; }
    }
  }
}

if (lineageSet.size === 0) {
  new Notice("Empty lineage; nothing to tidy.");
  return lineageSet;
}

// ---- Phase A: snapshot each genotype in the lineage ----------------------

const snapshots = [];
const furnitureToDelete = [];
for (const gid of lineageSet) {
  const members = getGenotypeElements(gid, allElements);
  if (members.length === 0) continue;

  // v2 elements that the current Tidy knows how to render. Labels and criteria
  // (added in Phase 3) are intentionally excluded here; they'll be handled in
  // Task 4.3. The v1-style member kinds are: allele, fraction, separator, glyph.
  const renderableKinds = new Set([
    "genotype-allele",
    "genotype-fraction",
    "genotype-separator",
    "genotype-glyph",
  ]);
  const renderableMembers = members.filter(m => renderableKinds.has(m.customData?.kind));
  if (renderableMembers.length === 0) continue;

  // Capture parents (denormalized across members).
  let parents = null;
  for (const m of members) {
    if (m.customData?.parents) { parents = m.customData.parents; break; }
  }

  // Read structure out of tagged elements.
  const allelesByChromosome = {};
  let glyphChar = null;
  for (const el of renderableMembers) {
    const cd = el.customData;
    if (cd.kind === "genotype-allele") {
      if (!allelesByChromosome[cd.chromosome]) allelesByChromosome[cd.chromosome] = {};
      allelesByChromosome[cd.chromosome][cd.side] = el;
    } else if (cd.kind === "genotype-glyph") {
      glyphChar = el.text;
    }
  }

  const presentChromosomes = CHROMOSOME_ORDER.filter(c => allelesByChromosome[c]);
  if (presentChromosomes.length === 0) {
    new Notice(`Genotype ${gid.slice(0, 8)} has no allele elements; skipping.`);
    continue;
  }

  let structureOk = true;
  const chromosomes = [];
  // X, II and III are always drawn; a genotype drawn before that rule gets its
  // missing ones filled in as +/+.
  const labels = CHROMOSOME_ORDER.filter(c => ["X", "II", "III"].includes(c) || allelesByChromosome[c]);
  for (const label of labels) {
    const a = allelesByChromosome[label];
    if (!a) {
      chromosomes.push({ label, kind: "het", alleles: { top: "+", bottom: "+" } });
    } else if (a.single && !a.top && !a.bottom) {
      chromosomes.push({ label, kind: "single", alleles: { single: a.single.text } });
    } else if (a.top && a.bottom) {
      chromosomes.push({ label, kind: "het", alleles: { top: a.top.text, bottom: a.bottom.text } });
    } else {
      new Notice(`Chromosome ${label} of genotype ${gid.slice(0, 8)} has incomplete alleles; skipping that genotype.`);
      structureOk = false;
      break;
    }
  }
  if (!structureOk) continue;

  // Capture current bbox center using only the renderable members (these are
  // what we'll delete + re-create; we want the new layout centered on the
  // visual centroid of what was there).
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const m of renderableMembers) {
    minX = Math.min(minX, m.x);
    minY = Math.min(minY, m.y);
    maxX = Math.max(maxX, m.x + (m.width || 0));
    maxY = Math.max(maxY, m.y + (m.height || 0));
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };

  // Capture furniture text for label and criterion BEFORE deletion (honors user edits).
  // Label: a single text element grouped with the offspring genotype.
  const labelEl = members.find(m => m.customData?.kind === "genotype-label");
  const labelText = labelEl ? (labelEl.originalText ?? labelEl.text) : null;
  // Criterion: standalone, NOT in the offspring's group. Keyed by childGenotypeId.
  const criterionEl = allElements.find(
    e => e.customData?.kind === "cross-criterion" && e.customData?.childGenotypeId === gid
  );
  const criterionText = criterionEl ? (criterionEl.originalText ?? criterionEl.text) : null;

  if (labelEl) furnitureToDelete.push(labelEl);
  // Invisible binding frames and label boxes are regenerated below.
  for (const m of members) {
    if (m.customData?.kind === "genotype-frame" || m.customData?.kind === "genotype-label-box") furnitureToDelete.push(m);
  }
  // Subset mode: a genotype whose parents are not both in the subset keeps
  // its arrow and criterion (re-bound in Phase D).
  const boundary = below && !!parents?.maternal && !!parents?.paternal
    && !(lineageSet.has(parents.maternal) && lineageSet.has(parents.paternal));
  if (criterionEl && !boundary) furnitureToDelete.push(criterionEl);

  // Stash a copy of the pre-Tidy center as `originalCenter`. The layout pass
  // overwrites `center`, but we need the original to anchor on the seed
  // genotype so Tidy is idempotent under repeated invocations.
  const originalCenter = { x: center.x, y: center.y };
  snapshots.push({ gid, members: renderableMembers, parents, chromosomes, glyphChar, center, originalCenter, width, height, labelText, criterionText, boundary });
}

// Sweep cross-glyphs and cross-lineages tied to this lineage. Subset mode
// keeps the arrows into boundary genotypes.
const boundaryIds = new Set(snapshots.filter(s => s.boundary).map(s => s.gid));
const keptArrows = [];
for (const el of allElements) {
  const cd = el.customData;
  if (!cd) continue;
  if (cd.kind === "cross-glyph"
      && cd.parents
      && lineageSet.has(cd.parents.maternal)
      && lineageSet.has(cd.parents.paternal)) {
    furnitureToDelete.push(el);
  } else if (cd.kind === "cross-lineage"
      && lineageSet.has(cd.childGenotypeId)) {
    if (below && boundaryIds.has(cd.childGenotypeId)) keptArrows.push(el);
    else furnitureToDelete.push(el);
  }
}

if (snapshots.length === 0) {
  new Notice("No tidy-able genotypes in lineage.");
  return lineageSet;
}

// ---- Phase A2: layered DAG layout ----------------------------------------
//
// Compute generation depth for each genotype (longest path from any root in
// the lineage), bucket by depth, lay each row out left to right (see
// "Cross-aware x layout"), then translate the whole lineage so it moves as
// little as possible.

const snapshotByGid = new Map(snapshots.map(s => [s.gid, s]));
const depths = computeDepths(lineageSet, allElements);

// ---- Phase B: delete every old member across all genotypes ---------------

const allOldMembers = snapshots.flatMap(s => s.members);
ea.deleteViewElements([...allOldMembers, ...furnitureToDelete]);

// ---- Phase C: save style, render each genotype at the origin -------------
//
// Rendering before layout gives exact widths (text edits can change them).
// Each genotype is rendered centered on (0, 0) and moved to its laid-out
// center after layout.

const prev = {
  fontSize: ea.style.fontSize,
  fontFamily: ea.style.fontFamily,
  strokeColor: ea.style.strokeColor,
  strokeWidth: ea.style.strokeWidth,
  roughness: ea.style.roughness,
  backgroundColor: ea.style.backgroundColor,
};
ea.style.fontSize = FONT_SIZE;
ea.style.fontFamily = FONT_FAMILY;
ea.style.strokeColor = "#000000";
ea.style.strokeWidth = STROKE_WIDTH;
ea.style.roughness = 0;

function reflowGenotypeFromSnapshot(snap, center) {
  const { gid, parents, chromosomes, glyphChar } = snap;

  function tag(id, data) {
    const base = { schemaVersion: SCHEMA, genotypeId: gid, ...data };
    if (parents) base.parents = parents;
    ea.addAppendUpdateCustomData(id, base);
  }

  const layouts = chromosomes.map(c => {
    const slot = { ...c, elements: {} };
    if (c.kind === "single") {
      const id = ea.addText(0, 0, c.alleles.single);
      slot.elements.single = id;
      tag(id, { kind: "genotype-allele", chromosome: c.label, side: "single" });
      const el = ea.getElement(id);
      slot.slotWidth = el.width;
      slot.slotHeight = el.height;
    } else {
      const topId = ea.addText(0, 0, c.alleles.top);
      const botId = ea.addText(0, 0, c.alleles.bottom);
      slot.elements.top = topId;
      slot.elements.bottom = botId;
      tag(topId, { kind: "genotype-allele", chromosome: c.label, side: "top" });
      tag(botId, { kind: "genotype-allele", chromosome: c.label, side: "bottom" });
      const top = ea.getElement(topId);
      const bot = ea.getElement(botId);
      const textW = Math.max(top.width, bot.width);
      slot.slotWidth = textW + 2 * FRACTION_PADDING;
      slot.slotHeight = top.height + 2 * FRACTION_GAP + bot.height;
      const lineId = ea.addLine([[0, 0], [slot.slotWidth, 0]]);
      slot.elements.line = lineId;
      tag(lineId, { kind: "genotype-fraction", chromosome: c.label });
    }
    return slot;
  });

  const separatorIds = [];
  for (let i = 0; i < layouts.length - 1; i++) {
    const sepId = ea.addText(0, 0, ";");
    tag(sepId, { kind: "genotype-separator", after: layouts[i].label });
    separatorIds.push(sepId);
  }

  let glyphId = null;
  if (glyphChar) {
    ea.style.fontSize = GLYPH_SIZE;
    ea.style.fontFamily = GLYPH_FONT_FAMILY;
    glyphId = ea.addText(0, 0, glyphChar);
    tag(glyphId, { kind: "genotype-glyph" });
    ea.style.fontSize = FONT_SIZE;
    ea.style.fontFamily = FONT_FAMILY;
  }

  let totalWidth = 0;
  if (glyphId) totalWidth += ea.getElement(glyphId).width + GLYPH_GAP;
  for (let i = 0; i < layouts.length; i++) {
    totalWidth += layouts[i].slotWidth;
    if (i < layouts.length - 1) {
      totalWidth += CHROMOSOME_GAP + ea.getElement(separatorIds[i]).width + CHROMOSOME_GAP;
    }
  }

  let cursorX = center.x - totalWidth / 2;
  const midlineY = center.y;

  if (glyphId) {
    const g = ea.getElement(glyphId);
    g.x = cursorX;
    g.y = midlineY - g.height / 2;
    cursorX += g.width + GLYPH_GAP;
  }

  for (let i = 0; i < layouts.length; i++) {
    const c = layouts[i];
    const slotX = cursorX;
    if (c.kind === "single") {
      const t = ea.getElement(c.elements.single);
      t.x = slotX + (c.slotWidth - t.width) / 2;
      t.y = midlineY - t.height / 2;
    } else {
      const top = ea.getElement(c.elements.top);
      const bot = ea.getElement(c.elements.bottom);
      const line = ea.getElement(c.elements.line);
      top.x = slotX + (c.slotWidth - top.width) / 2;
      top.y = midlineY - FRACTION_GAP - top.height;
      line.x = slotX;
      line.y = midlineY;
      bot.x = slotX + (c.slotWidth - bot.width) / 2;
      bot.y = midlineY + FRACTION_GAP;
    }
    cursorX += c.slotWidth;
    if (i < layouts.length - 1) {
      cursorX += CHROMOSOME_GAP;
      const sep = ea.getElement(separatorIds[i]);
      sep.x = cursorX;
      sep.y = midlineY - sep.height / 2;
      cursorX += sep.width + CHROMOSOME_GAP;
    }
  }

  const allIds = [];
  if (glyphId) allIds.push(glyphId);
  for (const c of layouts) {
    if (c.kind === "single") allIds.push(c.elements.single);
    else allIds.push(c.elements.top, c.elements.bottom, c.elements.line);
  }
  allIds.push(...separatorIds);

  // Invisible frame around the genotype: the binding target for lineage
  // arrows (top middle). Phase D grows it to cover the label, if any.
  const box = ea.getBoundingBox(allIds.map(id => ea.getElement(id)));
  ea.style.strokeColor = "transparent";
  ea.style.backgroundColor = "transparent";
  const frameId = ea.addRect(box.topX - FRAME_PAD, box.topY - FRAME_PAD,
    box.width + 2 * FRAME_PAD, box.height + 2 * FRAME_PAD);
  tag(frameId, { kind: "genotype-frame" });
  ea.style.strokeColor = "#000000";
  allIds.push(frameId);

  ea.addToGroup(allIds);

  return { genotypeId: gid, allIds, frameId };
}

// Render each genotype, then recenter its visible bbox exactly on (0, 0) so
// the laid-out center is also the center Tidy measures on the next run.
for (const snap of snapshots) {
  const r = reflowGenotypeFromSnapshot(snap, { x: 0, y: 0 });
  const box = ea.getBoundingBox(r.allIds.filter(id => id !== r.frameId).map(id => ea.getElement(id)));
  const bx = box.topX + box.width / 2, by = box.topY + box.height / 2;
  for (const id of r.allIds) { const e = ea.getElement(id); e.x -= bx; e.y -= by; }
  snap.ids = r.allIds;
  snap.frameId = r.frameId;
  snap.width = box.width;
  snap.height = box.height;
}

// Bucket snapshots by depth.
const buckets = new Map();
for (const snap of snapshots) {
  const d = depths.get(snap.gid) ?? 0;
  if (!buckets.has(d)) buckets.set(d, []);
  buckets.get(d).push(snap);
}
const sortedDepths = [...buckets.keys()].sort((a, b) => a - b);

// y for each depth: stacked downward, centered on 0.
const rowHeights = sortedDepths.map(d =>
  Math.max(...buckets.get(d).map(s => s.height))
);
const totalHeight =
  rowHeights.reduce((s, h) => s + h, 0) +
  GENERATION_GAP_Y * Math.max(0, sortedDepths.length - 1);

let cursorY = -totalHeight / 2;
const depthY = new Map();
for (let i = 0; i < sortedDepths.length; i++) {
  const d = sortedDepths[i];
  depthY.set(d, cursorY + rowHeights[i] / 2);
  cursorY += rowHeights[i] + GENERATION_GAP_Y;
}

// ---- Cross-aware x layout ------------------------------------------------
//
// Every row is split into UNITS: the connected components of the crosses
// whose two parents are both in that row (a lone genotype is a unit of one).
// A unit is laid out as a chain (see `linearize`), with each cross's x glyph
// in a gap of the chain (see `layoutUnit`). Each unit then gets a desired
// position: offspring want to sit under their parents' x glyph (row above);
// a unit with no such offspring wants to stay where it was. Units are
// ordered by desired center (ties: pre-Tidy x, which keeps the user's
// sibling order) and overlaps are resolved in 1D with least total
// displacement (`resolveRow`). Row 0 is packed into one block, as before.
//
// Everything is computed in drawing coordinates, so the layout is
// translation-equivariant and a second Tidy reproduces the first.

for (const snap of snapshots) {
  const d = depths.get(snap.gid) ?? 0;
  snap.center = { x: 0, y: depthY.get(d) };
}

const FRAME_GAP = SIBLING_GAP_X - 2 * FRAME_PAD;   // between genotype frames
const GLYPH_PAD = 8;           // x glyph to the frame it sits beside

// Width of text created in the current workbench style (then discarded).
function measureTextWidth(text, fontSize, fontFamily) {
  const saved = { fontSize: ea.style.fontSize, fontFamily: ea.style.fontFamily };
  ea.style.fontSize = fontSize;
  ea.style.fontFamily = fontFamily;
  const id = ea.addText(0, 0, text);
  const w = ea.getElement(id).width;
  delete ea.elementsDict[id];
  ea.style.fontSize = saved.fontSize;
  ea.style.fontFamily = saved.fontFamily;
  return w;
}
const CROSS_W = measureTextWidth(CROSS_GLYPH_CHAR, GLYPH_SIZE, CROSS_GLYPH_FONT_FAMILY);

function labelBoxWidth(text) {
  const { boxId, textId } = addLabelBox(text, 0, 0, {});
  const w = ea.getElement(boxId).width;
  delete ea.elementsDict[boxId];
  delete ea.elementsDict[textId];
  return w;
}

function getParentPairKey(snap) {
  if (!snap.parents) return null;
  const m = snap.parents.maternal;
  const p = snap.parents.paternal;
  if (!m || !p) return null;
  if (!snapshotByGid.has(m) || !snapshotByGid.has(p)) return null;
  return m + "|" + p;
}

// Half-width of each genotype's frame, which Phase D grows to cover the
// offspring label box (centered on the genotype).
for (const snap of snapshots) {
  const lw = snap.labelText && (getParentPairKey(snap) || snap.boundary)
    ? labelBoxWidth(snap.labelText) : 0;
  snap.half = Math.max(snap.width / 2 + FRAME_PAD, lw / 2);
}

// Every cross in the lineage as [maternalGid, paternalGid], one entry per
// parent pair (offspring `parents`, plus x glyphs with no offspring yet).
const crossPairs = [];
{
  const seen = new Set();
  for (const snap of snapshots) {
    const key = getParentPairKey(snap);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    crossPairs.push([snap.parents.maternal, snap.parents.paternal]);
  }
  for (const el of allElements) {
    if (el.customData?.kind !== "cross-glyph") continue;
    const p = el.customData.parents;
    if (!p?.maternal || !p?.paternal) continue;
    if (!snapshotByGid.has(p.maternal) || !snapshotByGid.has(p.paternal)) continue;
    const key = p.maternal + "|" + p.paternal;
    if (seen.has(key)) continue;
    seen.add(key);
    crossPairs.push([p.maternal, p.paternal]);
  }
}

const finalX = new Map();      // gid -> laid-out center x
const unitOf = new Map();      // gid -> genotypes of its row unit
const glyphPos = new Map();    // "maternal|paternal" -> x glyph center x

function placeAt(gid, x) {
  finalX.set(gid, x);
  snapshotByGid.get(gid).center.x = x;
}

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const ox = gid => snapshotByGid.get(gid).originalCenter.x;
const byOx = (a, b) => ox(a) - ox(b) || cmpStr(a, b);
const mean = v => v.reduce((s, x) => s + x, 0) / v.length;

// Midpoint of the gap between two placed genotypes' frames. Used for a
// cross whose parents ended up in different rows (no unit holds both).
function gapMidX(m, p) {
  const a = snapshotByGid.get(m), b = snapshotByGid.get(p);
  const [l, r] = a.center.x <= b.center.x ? [a, b] : [b, a];
  if (l === r) return l.center.x;
  return (l.center.x + l.half + r.center.x - r.half) / 2;
}

// Order one unit's genotypes left to right.
//   - A single cross: maternal left, paternal right.
//   - A chain (A x B, A x C, ...; every genotype crossed with at most two
//     others): in chain order, oriented so the end that was further left
//     stays on the left.
//   - Otherwise a hub H (most crosses): H's partners that were left of it
//     go left, the rest right, each side in pre-Tidy order, and at least one
//     partner on each side, so the two nearest partners sit directly beside
//     H. Genotypes further out in the unit go beyond the partner they hang
//     off, in pre-Tidy order.
// Only relative pre-Tidy positions and genotype ids are used, so a second
// Tidy reproduces the same order.
function linearize(nodes, adj, crosses, anchorX) {
  if (nodes.length === 1) return nodes;
  const deg = g => adj.get(g).size;
  if (nodes.length === 2) {
    // Two parents hung from different crosses above (families joined by
    // this cross) go on the side of their own parents, so the arrows into
    // them do not cross.
    const [a, b] = nodes.map(anchorX);
    if (a !== null && b !== null && Math.abs(a - b) > 0.5) return a < b ? nodes : [nodes[1], nodes[0]];
    return crosses.length === 1 ? [crosses[0][0], crosses[0][1]] : [...nodes].sort(byOx);
  }
  const edges = nodes.reduce((s, g) => s + deg(g), 0) / 2;
  if (edges === nodes.length - 1 && nodes.every(g => deg(g) <= 2)) {
    const seq = [nodes.filter(g => deg(g) === 1).sort(byOx)[0]];
    while (seq.length < nodes.length) {
      const last = seq[seq.length - 1], before = seq[seq.length - 2];
      seq.push([...adj.get(last)].find(n => n !== before));
    }
    return seq;
  }
  const hub = [...nodes].sort((a, b) => deg(b) - deg(a) || cmpStr(a, b))[0];
  const partners = [...adj.get(hub)].sort(byOx);
  const L = partners.filter(g => ox(g) < ox(hub));
  const R = partners.filter(g => ox(g) >= ox(hub));
  if (!L.length) L.push(R.shift());
  else if (!R.length) R.unshift(L.pop());
  const side = new Map([...L.map(g => [g, -1]), ...R.map(g => [g, 1])]);
  const outerL = [], outerR = [];
  const seen = new Set([hub, ...partners]);
  let frontier = [...partners].sort(cmpStr);
  while (frontier.length) {
    const next = [];
    for (const g of frontier) {
      for (const n of [...adj.get(g)].sort(cmpStr)) {
        if (seen.has(n)) continue;
        seen.add(n);
        side.set(n, side.get(g));
        (side.get(g) < 0 ? outerL : outerR).push(n);
        next.push(n);
      }
    }
    frontier = next.sort(cmpStr);
  }
  return [...outerL.sort(byOx), ...L, hub, ...R, ...outerR.sort(byOx)];
}

// Lay out one unit from x = 0. Returns member centers and x glyph centers
// relative to the unit's left edge, and the unit's width.
// A cross between neighbors gets its x in the middle of their gap. A cross
// between genotypes that are not neighbors (a hub's third partner and
// beyond) gets its x right beside the partner with fewer crosses, on the
// side facing the other parent. Each gap is widened to fit its x glyphs.
function layoutUnit(seq, adj, crosses) {
  const idx = new Map(seq.map((g, i) => [g, i]));
  const gaps = seq.slice(1).map(() => ({ left: [], mid: [], right: [] }));
  for (const [m, p] of crosses) {
    const key = m + "|" + p;
    let lo = idx.get(m), hi = idx.get(p);
    if (lo > hi) [lo, hi] = [hi, lo];
    if (hi - lo === 1) gaps[lo].mid.push(key);
    else if (adj.get(seq[lo]).size < adj.get(seq[hi]).size) gaps[lo].left.push(key);
    else gaps[hi - 1].right.push(key);
  }
  const offsets = new Map();
  const glyphOff = new Map();
  const step = CROSS_W + GLYPH_PAD;
  let cursor = 0;
  seq.forEach((g, i) => {
    const s = snapshotByGid.get(g);
    offsets.set(g, cursor + s.half);
    cursor += 2 * s.half;
    if (i === seq.length - 1) return;
    const gap = gaps[i];
    gap.left.sort(cmpStr); gap.mid.sort(cmpStr); gap.right.sort(cmpStr);
    const n = gap.left.length + gap.mid.length + gap.right.length;
    const gw = Math.max(FRAME_GAP, GLYPH_PAD * (n + 1) + CROSS_W * n);
    gap.left.forEach((k, j) => glyphOff.set(k, cursor + GLYPH_PAD + CROSS_W / 2 + j * step));
    gap.right.forEach((k, j) => glyphOff.set(k, cursor + gw - GLYPH_PAD - CROSS_W / 2 - j * step));
    const a = cursor + gap.left.length * step;
    const b = cursor + gw - gap.right.length * step;
    const midW = gap.mid.length * step - GLYPH_PAD;
    gap.mid.forEach((k, j) => glyphOff.set(k, (a + b) / 2 - midW / 2 + CROSS_W / 2 + j * step));
    cursor += gw;
  });
  return { seq, offsets, glyphOff, width: cursor };
}

// Place units without overlap (FRAME_GAP apart), keeping their order and
// minimizing squared distance from desired positions: consecutive
// overlapping units merge into a block, and a block sits at the mean of its
// members' desired positions (weighted by anchored genotypes; a unit with
// no anchored genotype only counts in a block of such units). `packAll`
// merges the whole row into one block.
function resolveRow(units, packAll) {
  units.sort((a, b) => a.key - b.key || a.oxKey - b.oxKey || cmpStr(a.seq[0], b.seq[0]));
  const pos = c => (c.wA ? c.sA / c.wA : c.sF / c.wF);
  const blocks = [];
  for (const u of units) {
    blocks.push({
      units: [u], width: u.width,
      wA: u.anchored ? u.weight : 0, sA: u.anchored ? u.weight * u.left : 0,
      wF: u.anchored ? 0 : 1, sF: u.anchored ? 0 : u.left,
    });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (!packAll && pos(a) + a.width + FRAME_GAP <= pos(b) + 0.01) break;
      const shift = a.width + FRAME_GAP;
      a.sA += b.sA - b.wA * shift;
      a.sF += b.sF - b.wF * shift;
      a.wA += b.wA;
      a.wF += b.wF;
      a.units.push(...b.units);
      a.width = shift + b.width;
      blocks.pop();
    }
  }
  for (const blk of blocks) {
    let x = pos(blk);
    for (const u of blk.units) { u.left = x; x += u.width + FRAME_GAP; }
  }
}

for (const d of sortedDepths) {
  const rowGids = buckets.get(d).map(s => s.gid).sort(cmpStr);
  const rowSet = new Set(rowGids);
  const rowCrosses = crossPairs.filter(([m, p]) => m !== p && rowSet.has(m) && rowSet.has(p));
  const adj = new Map(rowGids.map(g => [g, new Set()]));
  for (const [m, p] of rowCrosses) { adj.get(m).add(p); adj.get(p).add(m); }

  const units = [];
  const seen = new Set();
  for (const g of rowGids) {
    if (seen.has(g)) continue;
    const comp = [];
    const stack = [g];
    seen.add(g);
    while (stack.length) {
      const x = stack.pop();
      comp.push(x);
      for (const n of adj.get(x)) if (!seen.has(n)) { seen.add(n); stack.push(n); }
    }
    const compSet = new Set(comp);
    const crosses = rowCrosses.filter(([m]) => compSet.has(m));
    // Anchored members: offspring whose parents are already placed want to
    // be centered under their parents' x glyph.
    const anchorX = m => {
      const s = snapshotByGid.get(m);
      const key = getParentPairKey(s);
      if (!key || !finalX.has(s.parents.maternal) || !finalX.has(s.parents.paternal)) return null;
      return glyphPos.has(key) ? glyphPos.get(key) : gapMidX(s.parents.maternal, s.parents.paternal);
    };
    const u = layoutUnit(linearize(comp, adj, crosses, anchorX), adj, crosses);
    const wants = [];
    for (const m of u.seq) {
      const t = anchorX(m);
      if (t !== null) wants.push(t - u.offsets.get(m));
    }
    u.anchored = wants.length > 0;
    u.weight = wants.length;
    u.left = u.anchored ? mean(wants) : mean(u.seq.map(m => ox(m) - u.offsets.get(m)));
    u.key = u.left + u.width / 2;
    u.oxKey = mean(u.seq.map(ox));
    units.push(u);
  }

  resolveRow(units, d === sortedDepths[0]);
  for (const u of units) {
    for (const m of u.seq) unitOf.set(m, u.seq);
    for (const m of u.seq) placeAt(m, u.left + u.offsets.get(m));
    for (const [k, o] of u.glyphOff) glyphPos.set(k, u.left + o);
  }
}
for (const [m, p] of crossPairs) {
  const key = m + "|" + p;
  if (!glyphPos.has(key)) glyphPos.set(key, gapMidX(m, p));
}

// Translate the relative layout by the per-axis MEDIAN of each genotype's
// (pre-Tidy - laid-out) offset. This minimizes total movement (L1): genotypes
// already in formation stay put and stray ones move back, rather than the
// whole lineage following whichever genotype was dragged last. Idempotent:
// an already-tidy lineage has zero offset everywhere.
const median = vals => {
  const v = [...vals].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
// Subset mode takes the median over the ANCHORS only: the top-row genotypes
// whose parents are outside the subset (hung from a fixed x glyph), else all
// top-row genotypes. A single anchor does not move.
const topRow = snapshots.filter(s => (depths.get(s.gid) ?? 0) === sortedDepths[0]);
const anchors = !below ? snapshots
  : topRow.some(s => s.boundary) ? topRow.filter(s => s.boundary) : topRow;
if (snapshots.length) {
  const dx = median(anchors.map(s => s.originalCenter.x - s.center.x));
  const dy = median(anchors.map(s => s.originalCenter.y - s.center.y));
  for (const snap of snapshots) {
    snap.center = { x: snap.center.x + dx, y: snap.center.y + dy };
  }
  for (const [k, x] of glyphPos) glyphPos.set(k, x + dx);
}

// Move each rendered genotype to its laid-out center.
for (const snap of snapshots) {
  for (const id of snap.ids) {
    const e = ea.getElement(id);
    e.x += snap.center.x;
    e.y += snap.center.y;
  }
}

// ---- Phase D: regenerate cross furniture from offspring `parents` ---------

function tagFurniture(id, data) {
  ea.addAppendUpdateCustomData(id, { schemaVersion: SCHEMA, ...data });
}

// Creates a cross's x glyph at the laid-out position, on the row of the
// left parent. Returns the glyph element.
function addCrossGlyph(maternalId, paternalId) {
  const matSnap = snapshotByGid.get(maternalId);
  const patSnap = snapshotByGid.get(paternalId);
  const leftSnap = matSnap.center.x <= patSnap.center.x ? matSnap : patSnap;
  const glyphCenterX = glyphPos.get(`${maternalId}|${paternalId}`);
  // Glyph sits ON the parent row (depth-aligned y per the design doc).
  // This matches standard fly-cross notation ("parent1 × parent2" on one line)
  // and frees the vertical gap below for a visible lineage arrow.
  const glyphCenterY = leftSnap.center.y;

  ea.style.fontSize = GLYPH_SIZE;
  ea.style.fontFamily = CROSS_GLYPH_FONT_FAMILY;
  const glyphId = ea.addText(0, 0, CROSS_GLYPH_CHAR);
  tagFurniture(glyphId, {
    kind: "cross-glyph",
    parents: { maternal: maternalId, paternal: paternalId },
  });
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = FONT_FAMILY;
  const glyphEl = ea.getElement(glyphId);
  glyphEl.x = glyphCenterX - glyphEl.width / 2;
  glyphEl.y = glyphCenterY - glyphEl.height / 2;
  return glyphEl;
}

// Group offspring by parent pair.
const pairs = new Map();
for (const snap of snapshots) {
  const key = getParentPairKey(snap);
  if (!key) continue;
  if (!pairs.has(key)) {
    pairs.set(key, { maternalId: snap.parents.maternal, paternalId: snap.parents.paternal, children: [] });
  }
  pairs.get(key).children.push(snap);
}

// Label box (and frame growth to cover it) for one offspring.
function addChildLabel(child) {
  const frame = ea.getElement(child.frameId);
  const renderableTop = frame.y + FRAME_PAD;

  // Create label FIRST so we can measure its height and route the lineage
  // arrow to terminate above the label (otherwise the arrow's endpoint sits
  // INSIDE the label's vertical band and visually crosses through it).
  let labelEl = null;
  let labelParts = [];
  if (child.labelText) {
    const { boxId, textId } = addLabelBox(child.labelText, child.center.x, renderableTop - LABEL_GAP, {
      schemaVersion: SCHEMA, genotypeId: child.gid, parents: child.parents, text: child.labelText,
    });
    labelEl = ea.getElement(boxId);
    labelParts = [labelEl, ea.getElement(textId)];
  }

  // Grow the child's frame to cover its label box, and group the label with it.
  if (labelEl) {
    const box = ea.getBoundingBox([frame, labelEl]);
    const top = labelEl.y - FRAME_PAD;
    frame.x = box.topX; frame.width = box.width;
    frame.height = frame.y + frame.height - top;
    frame.y = top;
    for (const el of labelParts) el.groupIds = [...frame.groupIds];
  }
}

// Rows by depth: vertical extent of the genotypes (not labels) in each row.
const rowTop = new Map(), rowBottom = new Map();
for (const s of snapshots) {
  const d = depths.get(s.gid) ?? 0;
  rowTop.set(d, Math.min(rowTop.get(d) ?? Infinity, s.center.y - s.height / 2));
  rowBottom.set(d, Math.max(rowBottom.get(d) ?? -Infinity, s.center.y + s.height / 2));
}

// Path of a lineage arrow from the x glyph's bottom middle (x1, y1) on row
// `dFrom` to the child's frame top middle (x2, y2) on row `dTo`. Into the
// next row: the usual elbow. Further down: drop into the gap below the
// parents' row, run across to a vertical lane that is clear of every
// genotype frame and x glyph in the rows in between, go down it to the gap
// above the child's row, across, and down into the child.
function childArrowPoints(x1, y1, x2, y2, dFrom, dTo) {
  const between = sortedDepths.filter(d => d > dFrom && d < dTo);
  if (!between.length) return lineagePoints(x1, y1, x2, y2);
  const inBetween = new Set(between);
  const spans = [];
  for (const s of snapshots) {
    if (!inBetween.has(depths.get(s.gid) ?? 0)) continue;
    const f = ea.getElement(s.frameId);
    spans.push([f.x, f.x + f.width]);
  }
  for (const [m, p] of crossPairs) {
    const a = snapshotByGid.get(m), b = snapshotByGid.get(p);
    const left = a.center.x <= b.center.x ? a : b;
    if (!inBetween.has(depths.get(left.gid) ?? 0)) continue;
    const gx = glyphPos.get(m + "|" + p);
    spans.push([gx - CROSS_W / 2, gx + CROSS_W / 2]);
  }
  const clearOf = FRAME_GAP / 4;
  const free = x => spans.every(([l, r]) => x <= l - clearOf || x >= r + clearOf);
  // Candidates: straight down from the x or up to the child, the middle of
  // each gap between obstacles, and just outside the obstacles.
  spans.sort((a, b) => a[0] - b[0]);
  const cands = [x1, x2];
  let reach = -Infinity;
  for (const [l, r] of spans) {
    if (reach > -Infinity && l > reach) cands.push((reach + l) / 2);
    reach = Math.max(reach, r);
  }
  cands.push(spans[0][0] - FRAME_GAP / 2, reach + FRAME_GAP / 2);
  const lane = cands.filter(free)
    .sort((a, b) => (Math.abs(a - x1) + Math.abs(a - x2)) - (Math.abs(b - x1) + Math.abs(b - x2)) || a - b)[0];
  const yTop = (rowBottom.get(dFrom) + rowTop.get(between[0])) / 2;
  const yLow = Math.min((rowBottom.get(between[between.length - 1]) + rowTop.get(dTo)) / 2, y2 - FRAME_PAD);
  const pts = [[x1, y1], [x1, yTop], [lane, yTop], [lane, yLow], [x2, yLow], [x2, y2]];
  // Drop zero-length segments and straight-through corners.
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5) continue;
    const o = out[out.length - 2];
    if (o && ((Math.abs(o[0] - q[0]) < 0.5 && Math.abs(q[0] - p[0]) < 0.5)
           || (Math.abs(o[1] - q[1]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5))) out.pop();
    out.push(p);
  }
  return out;
}

// Lineage arrow and criterion for one offspring whose parents' x glyph is
// `glyphEl` (a workbench element). Its label must already be in place.
function addChildArrow(child, glyphEl, glyphDepth) {
  const glyphBottomX = glyphEl.x + glyphEl.width / 2;
  const glyphBottomY = glyphEl.y + glyphEl.height;
  const frame = ea.getElement(child.frameId);
  // Bound at the x glyph's bottom middle and the child frame's top middle.
  const childTopX = frame.x + frame.width / 2;
  const childTopY = frame.y;
  const arrowId = ea.addArrow(
    childArrowPoints(glyphBottomX, glyphBottomY, childTopX, childTopY, glyphDepth, depths.get(child.gid) ?? 0),
    {
      startArrowHead: null, endArrowHead: "triangle", elbowed: true,
      startObjectId: glyphEl.id, startFixedPoint: [0.5, 1],
      endObjectId: child.frameId, endFixedPoint: [0.5, 0],
    }
  );
  tagFurniture(arrowId, {
    kind: "cross-lineage",
    childGenotypeId: child.gid,
  });
  // A path with more than one elbow (through a lane) keeps its inner
  // segments pinned; otherwise Excalidraw re-routes it as a plain elbow
  // straight through the rows in between.
  const arrow = ea.getElement(arrowId);
  if (arrow.points.length > 4) {
    arrow.fixedSegments = arrow.points.slice(2, -1).map((p, i) => ({
      start: [...arrow.points[i + 1]], end: [...p], index: i + 2,
    }));
  }

  if (child.criterionText) {
    addArrowLabel(arrowId, child.criterionText, {
      schemaVersion: SCHEMA, childGenotypeId: child.gid, text: child.criterionText,
    });
  }
  return arrowId;
}

// Every label first, so arrows are routed around the frames that cover them.
const pairGlyphs = [...pairs.values()].map(pair => [pair, addCrossGlyph(pair.maternalId, pair.paternalId)]);
for (const pair of pairs.values()) for (const child of pair.children) addChildLabel(child);
for (const child of snapshots.filter(s => s.boundary)) addChildLabel(child);
for (const [pair, glyphEl] of pairGlyphs) {
  const a = snapshotByGid.get(pair.maternalId), b = snapshotByGid.get(pair.paternalId);
  const glyphDepth = depths.get((a.center.x <= b.center.x ? a : b).gid) ?? 0;
  for (const child of pair.children) addChildArrow(child, glyphEl, glyphDepth);
}

// Subset mode boundary: keep the arrow into each boundary genotype (and its
// criterion), re-bind its end to the genotype's new frame at the top
// middle and re-route it from its unchanged start.
const gone = new Set([...allOldMembers, ...furnitureToDelete].map(e => e.id));
const boundaryArrowIds = new Set();
{
  const viewById = new Map(allElements.map(e => [e.id, e]));
  const lookup = { get: id => ea.getElement(id) ?? viewById.get(id) };
  for (const view of keptArrows) {
    const child = snapshotByGid.get(view.customData.childGenotypeId);
    const texts = (view.boundElements ?? []).filter(b => b.type === "text")
      .map(b => viewById.get(b.id)).filter(t => t && !t.isDeleted);
    ea.copyViewElementsToEAforEditing([view, ...texts]);
    const arrow = ea.getElement(view.id);
    arrow.endBinding = { ...(arrow.endBinding ?? {}), elementId: child.frameId, fixedPoint: [0.5, 0] };
    boundaryArrowIds.add(arrow.id);
  }
  for (const id of boundaryArrowIds) {
    const arrow = ea.getElement(id);
    const frame = ea.getElement(arrow.endBinding.elementId);
    frame.boundElements = [...(frame.boundElements ?? []), { type: "arrow", id }];
    routeLineageArrow(arrow, lookup);
  }
}

// Orphan cross-glyphs: pair-keyed glyphs with no offspring referencing the
// pair. Regenerated at their laid-out position so the "Cross pressed before
// offspring shorthand was typed" state survives Tidy.
for (const [m, p] of crossPairs) {
  if (!pairs.has(`${m}|${p}`)) addCrossGlyph(m, p);
}

ea.style.fontSize = prev.fontSize;
ea.style.fontFamily = prev.fontFamily;
ea.style.strokeColor = prev.strokeColor;
ea.style.strokeWidth = prev.strokeWidth;
ea.style.roughness = prev.roughness;
ea.style.backgroundColor = prev.backgroundColor;

if (below) {
  // ---- Phase E (subset): keep clear of everything outside the subset -------
  //
  // Every element outside the subset is an obstacle. The anchors stay put
  // if at all possible:
  //   1. the layout as anchored, if it is already clear;
  //   2. else shift the rest of the subset sideways (smallest shift, ties
  //      rightward), keeping the anchor units (each anchor and the same-row
  //      genotypes it is crossed with, their x glyphs and the boundary
  //      arrows into them) fixed; arrows whose start stays put are
  //      re-routed to their shifted child;
  //   3. else, last resort, shift the whole subset, anchors included, as
  //      Phase E does for a lineage.
  // Boundary arrows are left out of the checks against obstacles: they
  // start on an outside x glyph by design.
  const isOut = g => !lineageSet.has(g);
  const obstacleEls = ea.getViewElements().filter(e => {
    if (e.isDeleted || gone.has(e.id)) return false;
    const cd = e.customData;
    if (!cd) return false;
    if (cd.genotypeId) return isOut(cd.genotypeId);
    if (cd.kind === "cross-glyph") return isOut(cd.parents?.maternal) || isOut(cd.parents?.paternal);
    if (cd.kind === "cross-lineage") return isOut(cd.childGenotypeId);
    return false;
  });
  const mine = ea.getElements();
  const lookup = new Map([...obstacleEls, ...ea.getElements()].map(e => [e.id, e]));
  const boxes = els => segmentBoxes(els, lookup);
  const obstacles = boxes(obstacleEls);
  const checked = els => els.filter(e => !boundaryArrowIds.has(e.id));
  const clear = (a, b) => clearance(boxes(a), b).ok(0);

  if (!clear(checked(mine), obstacles)) {
    const anchorGids = new Set(anchors.flatMap(s => unitOf.get(s.gid) ?? [s.gid]));
    const inAnchor = e => {
      const cd = e.customData ?? {};
      if (cd.kind === "cross-glyph") return anchorGids.has(cd.parents?.maternal) && anchorGids.has(cd.parents?.paternal);
      return anchorGids.has(cd.genotypeId ?? cd.childGenotypeId);
    };
    const anchorEls = mine.filter(inAnchor);
    const rest = mine.filter(e => !inAnchor(e));
    const anchorGlyphIds = new Set(anchorEls.filter(e => e.customData?.kind === "cross-glyph").map(e => e.id));
    // Arrows whose start stays put while their child moves: from an anchor
    // x glyph, or from an outside x glyph (boundary). They are re-routed.
    const links = rest.filter(e => e.type === "arrow"
      && (anchorGlyphIds.has(e.startBinding?.elementId) || boundaryArrowIds.has(e.id)));
    const rigid = rest.filter(e => !links.includes(e));
    const move = h => {
      for (const e of rest) e.x += h;
      for (const a of links) routeLineageArrow(a, lookup);
    };
    let done = false;
    if (clear(checked(anchorEls), obstacles)) {
      const fixed = [...obstacles, ...boxes(anchorEls)];
      for (const h of clearance(boxes(rigid), fixed).candidates) {
        if (h === 0) continue;
        move(h);
        if (clear(rigid, fixed) && clear(checked(links), obstacles)) { done = true; break; }
        move(-h);
      }
    }
    if (!done) {
      const h = clearingShift(boxes(checked(mine)), obstacles);
      for (const e of mine) e.x += h;
      for (const id of boundaryArrowIds) routeLineageArrow(ea.getElement(id), lookup);
      new Notice("Tidy: moved the top selected genotype(s) to keep clear of the rest of the drawing.");
    }
  }
}

// ---- Phase E: keep clear of other lineages --------------------------------
//
// Lineages are laid out independently, so a tidied lineage can land on
// another one. Shift it sideways by the smallest amount that clears every
// element of the lineages in `avoid` (genotype frames, x glyphs, and the
// span of each lineage arrow) by FRAME_GAP. Already-clear lineages do not
// move, so a second Tidy moves nothing.
if (!below && avoid && avoid.size) {
  const isOther = g => avoid.has(g) && !lineageSet.has(g);
  const others = ea.getViewElements().filter(e => {
    if (e.isDeleted || gone.has(e.id)) return false;
    const cd = e.customData;
    if (!cd) return false;
    if (cd.genotypeId) return isOther(cd.genotypeId);
    if (cd.kind === "cross-glyph") return isOther(cd.parents?.maternal) || isOther(cd.parents?.paternal);
    if (cd.kind === "cross-lineage") return isOther(cd.childGenotypeId);
    return false;
  });
  const mine = ea.getElements();
  const shift = clearingShift(lineageBoxes(mine), lineageBoxes(others));
  if (shift) for (const e of mine) e.x += shift;
}

await ea.addElementsToView(false, false, true);
return lineageSet;
}

// Boxes a lineage occupies: genotype frames (which cover labels), x glyphs,
// and each lineage arrow's span from its glyph to its child frame (taken
// from the bound ends, not the routed path, which Excalidraw may reshape).
function lineageBoxes(els) {
  const byId = new Map(els.map(e => [e.id, e]));
  const boxes = [];
  for (const e of els) {
    const kind = e.customData?.kind;
    if (kind === "genotype-frame" || kind === "cross-glyph") {
      boxes.push({ x: e.x, y: e.y, w: e.width, h: e.height });
    } else if (kind === "cross-lineage" && e.type === "arrow") {
      const s = byId.get(e.startBinding?.elementId), t = byId.get(e.endBinding?.elementId);
      if (!s || !t) continue;
      const x1 = s.x + s.width / 2, x2 = t.x + t.width / 2;
      const y1 = s.y + s.height, y2 = t.y;
      boxes.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
    }
  }
  return boxes;
}

// Smallest horizontal shift (ties: rightward) that keeps every box in `mine`
// at least SIBLING_GAP_X - 2 * FRAME_PAD from every vertically overlapping
// box in `others`.
function clearingShift(mine, others) {
  const { ok, candidates } = clearance(mine, others);
  return candidates.find(ok) ?? 0;
}

// The shifts to consider for `clearingShift`, nearest first (ties:
// rightward), and a test of whether a shift clears.
function clearance(mine, others) {
  const gap = SIBLING_GAP_X - 2 * FRAME_PAD, vpad = 2 * FRAME_PAD;
  const bad = [];
  for (const a of mine) {
    for (const b of others) {
      if (a.y >= b.y + b.h + vpad || a.y + a.h + vpad <= b.y) continue;
      // A genotype sits beside the x of its own cross by design.
      if ((a.gid && b.parents?.includes(a.gid)) || (b.gid && a.parents?.includes(b.gid))) continue;
      bad.push([b.x - (a.x + a.w) - gap, b.x + b.w - a.x + gap]);
    }
  }
  const ok = s => bad.every(([lo, hi]) => s <= lo + 0.5 || s >= hi - 0.5);
  const candidates = [0, ...bad.flat()].sort((p, q) => Math.abs(p) - Math.abs(q) || q - p);
  return { ok, candidates };
}

// Like `lineageBoxes`, but a lineage arrow is its three elbow segments (from
// the bound ends) rather than their bounding box, so a sibling beside the
// arrow's corner is not counted as hitting it. Bound ends are looked up in
// `lookup` (id -> element). Frames carry their `gid` and x glyphs their
// `parents`, so a genotype is not kept clear of its own cross's x. Used in
// subset mode, whose obstacles sit right next to the tidied genotypes.
function segmentBoxes(els, lookup) {
  const boxes = [];
  for (const e of els) {
    const kind = e.customData?.kind;
    if (kind === "genotype-frame") {
      boxes.push({ x: e.x, y: e.y, w: e.width, h: e.height, gid: e.customData.genotypeId });
    } else if (kind === "cross-glyph") {
      const p = e.customData.parents ?? {};
      boxes.push({ x: e.x, y: e.y, w: e.width, h: e.height, parents: [p.maternal, p.paternal] });
    } else if (kind === "cross-lineage" && e.type === "arrow") {
      const pts = boundLineagePoints(e, lookup);
      if (!pts) continue;
      // The first segment drops from the x between the parents, like the x.
      const p = lookup.get(e.startBinding?.elementId)?.customData?.parents ?? {};
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
        const box = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        if (i === 1) box.parents = [p.maternal, p.paternal];
        boxes.push(box);
      }
    }
  }
  return boxes;
}

// Elbow path of a lineage arrow from its x glyph's bottom middle to its
// child frame's top middle, or null if either end is not found.
function boundLineagePoints(arrow, lookup) {
  const s = lookup.get(arrow.startBinding?.elementId), t = lookup.get(arrow.endBinding?.elementId);
  if (!s || !t) return null;
  return lineagePoints(s.x + s.width / 2, s.y + s.height, t.x + t.width / 2, t.y);
}

// Re-route a workbench lineage arrow along its bound ends and re-center its
// criterion label, after one end has moved.
function routeLineageArrow(arrow, lookup) {
  const pts = boundLineagePoints(arrow, lookup);
  if (!pts) return;
  const [x0, y0] = pts[0];
  arrow.x = x0; arrow.y = y0;
  arrow.points = pts.map(([x, y]) => [x - x0, y - y0]);
  const xs = arrow.points.map(p => p[0]), ys = arrow.points.map(p => p[1]);
  arrow.width = Math.max(...xs) - Math.min(...xs);
  arrow.height = Math.max(...ys) - Math.min(...ys);
  for (const b of arrow.boundElements ?? []) {
    const t = b.type === "text" ? ea.getElement(b.id) : null;
    if (!t) continue;
    const [mx, my] = pathMidpoint(arrow);
    t.x = mx - t.width / 2;
    t.y = my - t.height / 2;
  }
}

// ---- Dispatch -------------------------------------------------------------

if (selectedGids.size >= 2) {
  // Exactly the selected genotypes; everything else is an obstacle.
  await tidyLineage(selectedSeedId, null, selectedGids);
} else if (selectedSeedId) {
  // Keep the tidied lineage clear of everything else in the drawing.
  const others = new Set(ea.getViewElements()
    .filter(el => !el.isDeleted && el.customData?.genotypeId)
    .map(el => el.customData.genotypeId));
  await tidyLineage(selectedSeedId, others);
} else {
  const covered = new Set();
  // Seed each lineage on a founder (no parents) so parents stay put and
  // offspring are arranged under them; founders are tried first. Each
  // lineage keeps clear of the lineages tidied before it.
  const members = ea.getViewElements().filter(el => !el.isDeleted && el.customData?.genotypeId);
  const hasParents = new Set(members.filter(el => el.customData.parents).map(el => el.customData.genotypeId));
  const genotypeIds = [...new Set(members.map(el => el.customData.genotypeId))]
    .sort((a, b) => hasParents.has(a) - hasParents.has(b));
  let lineages = 0;
  for (const gid of genotypeIds) {
    if (covered.has(gid)) continue;
    const set = await tidyLineage(gid, new Set(covered));
    covered.add(gid);
    for (const g of set ?? []) covered.add(g);
    lineages++;
  }
  new Notice(lineages ? `Tidied ${lineages} lineage(s).` : "No genotypes to tidy.");
}
