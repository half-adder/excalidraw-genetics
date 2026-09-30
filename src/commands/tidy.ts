// Tidy: reflows the connected lineage of the selected genotype. Ported from
// scripts/Tidy.md (the operation's body).
//
// Walks the connected DAG of genotypes through the `parents` field on each
// offspring's elements, computes each genotype's generation depth, lays each
// generation out in a row (src/layout), and redraws the genotypes and the
// cross furniture (x glyph, lineage arrows, labels, selection criteria) from
// the offspring-side `parents` field (src/render). Manual text edits to
// alleles, labels and criteria are honored. Element ids regenerate;
// `genotypeId` is preserved.
//
// Modes:
//   Nothing selected: every lineage is reflowed, each kept clear of the
//   lineages tidied before it.
//   Elements of ONE genotype selected: that genotype's whole lineage is
//   reflowed, kept clear of everything else.
//   Elements of TWO OR MORE genotypes selected (or `seed` from Cross
//   Genotypes / Tidy Below): exactly those genotypes are reflowed; everything
//   else is a fixed obstacle. The selected genotypes with no selected parents,
//   in the top row, stay where they are if possible. An arrow into a selected
//   genotype from a cross outside the selection is kept (with its criterion)
//   and re-bound to the genotype's new frame.
//
// Hooks: _tidyLastResult is bumped on every exit; _tidyFailAfterDelete
// (consumed on read) throws right after the delete.

import { Notice } from "obsidian";
import type { OperationContext } from "../operation";
import { peek, put, take } from "../hooks";
import { splitDuplicateGenotypes } from "../duplicates";
import { splitMultiRowParents } from "../backcross";
import { collectLineage, computeDepths, extendWithOrphanGlyphs, snapshotGenotype, type GenotypeSnapshot } from "../scene";
import {
  childArrowPoints,
  clearance,
  clearingShift,
  collectCrossPairs,
  layoutLineage,
  lineageBoxes,
  parentPairKey,
  segmentBoxes,
  type ArrowObstacle,
  type LayoutNode,
} from "../layout";
import {
  addArrowLabel,
  addCrossGlyph,
  addFrame,
  addLabelBox,
  addLineageArrow,
  drawGenotype,
  genotypeFontFamily,
  labelBoxWidth,
  measureTextWidth,
  placeGenotype,
  routeLineageArrow,
  withGenotypeStyle,
  type TagFn,
} from "../render";
import { SCHEMA_VERSION, type SceneElement } from "../schema";
import { CROSS_GLYPH_CHAR, CROSS_GLYPH_FONT_FAMILY, FRAME_PAD, GLYPH_SIZE, LABEL_GAP } from "../constants";

export interface TidyParams {
  // Genotypes to tidy instead of the selection (Cross Genotypes and Tidy
  // Below, which change the selection just before starting Tidy).
  seed?: string[];
}

// What to tidy: the seed genotype and the set of selected (or seeded)
// genotype ids, or a Notice when the selection holds no tagged genotype.
export interface TidyTarget {
  seedId: string | null;
  gids: Set<string>;
  notice: string | null;
}

export function tidyTarget(seed: readonly string[] | undefined, selected: readonly SceneElement[]): TidyTarget {
  const seedGids = seed ? seed.filter(Boolean) : null;
  const sel = seedGids ? [] : selected;
  let seedId = seedGids ? (seedGids[0] ?? null) : null;
  for (const el of sel) {
    if (el.customData?.genotypeId) { seedId = el.customData.genotypeId; break; }
  }
  if (sel.length > 0 && !seedId) return { seedId: null, gids: new Set(), notice: "Selected element is not part of a tagged genotype." };
  const gids = new Set(seedGids ?? sel.map((el) => el.customData?.genotypeId).filter((g): g is string => !!g));
  return { seedId, gids, notice: null };
}

export async function tidy(ctx: OperationContext, params: TidyParams = {}): Promise<void> {
  try {
    const ea = ctx.ea;
    // Copies of a genotype made in Excalidraw become their own genotypes first.
    await splitDuplicateGenotypes(ctx);

    const target = tidyTarget(params.seed, params.seed ? [] : ea.getViewSelectedElements());
    if (target.notice) {
      new Notice(target.notice);
      return;
    }
    const { seedId, gids } = target;

    if (gids.size >= 2) {
      // Exactly the selected genotypes; everything else is an obstacle.
      await tidyLineage(ctx, seedId, null, gids);
    } else if (seedId) {
      // Keep the tidied lineage clear of everything else in the drawing.
      const others = new Set(ea.getViewElements()
        .filter((el) => !el.isDeleted && el.customData?.genotypeId)
        .map((el) => el.customData!.genotypeId!));
      await tidyLineage(ctx, seedId, others, null);
    } else {
      const covered = new Set<string>();
      // Seed each lineage on a founder (no parents) so parents stay put and
      // offspring are arranged under them; founders are tried first. Each
      // lineage keeps clear of the lineages tidied before it.
      const members = ea.getViewElements().filter((el) => !el.isDeleted && el.customData?.genotypeId);
      const hasParents = new Set(members.filter((el) => el.customData!.parents).map((el) => el.customData!.genotypeId!));
      const genotypeIds = [...new Set(members.map((el) => el.customData!.genotypeId!))]
        .sort((a, b) => Number(hasParents.has(a)) - Number(hasParents.has(b)));
      let lineages = 0;
      for (const gid of genotypeIds) {
        if (covered.has(gid)) continue;
        const set = await tidyLineage(ctx, gid, new Set(covered), null);
        covered.add(gid);
        for (const g of set) covered.add(g);
        lineages++;
      }
      new Notice(lineages ? `Tidied ${lineages} lineage(s).` : "No genotypes to tidy.");
    }
  } finally {
    put("_tidyLastResult", (peek("_tidyLastResult") ?? 0) + 1);
  }
}

interface Drawn {
  snap: GenotypeSnapshot;
  ids: string[];
  frameId: string;
  width: number;
  height: number;
  center: { x: number; y: number };
}

// Tidies the lineage containing `seedGid` and returns its genotype-id set.
// Each call starts from a clean workbench and commits its own scene updates
// (all part of the one Tidy operation).
// `avoid`: genotype ids of other lineages the result must keep clear of.
// `subset`: tidy exactly these genotype ids instead of a lineage (two or
// more selected); `avoid` is then ignored and every element outside the
// subset is an obstacle.
export async function tidyLineage(
  ctx: OperationContext,
  seedGid: string | null,
  avoid: ReadonlySet<string> | null,
  subset: Set<string> | null,
): Promise<Set<string>> {
  const ea = ctx.ea;
  ea.clear();
  const below = !!subset; // subset mode

  // A parent crossed on more than one row gets a copy per extra row first. A
  // subset finds conflicts over the whole lineages of its genotypes and takes
  // its copies along.
  {
    const view = ea.getViewElements();
    const lineage = below || !seedGid ? new Set<string>() : collectLineage(seedGid, view);
    if (subset) for (const g of subset) if (!lineage.has(g)) for (const h of collectLineage(g, view)) lineage.add(h);
    await splitMultiRowParents(ctx, lineage, subset);
  }
  ea.clear();

  // ---- Lineage set ----
  const allElements = ea.getViewElements();
  const lineageSet = subset ? new Set(subset) : seedGid ? collectLineage(seedGid, allElements) : new Set<string>();
  // Orphan cross-glyph pairs pull in their partner; a subset is tidied
  // exactly as selected.
  if (!below) extendWithOrphanGlyphs(lineageSet, allElements);

  if (lineageSet.size === 0) {
    new Notice("Empty lineage; nothing to tidy.");
    return lineageSet;
  }

  // ---- Phase A: snapshot each genotype in the lineage ----
  const snapshots: GenotypeSnapshot[] = [];
  const furnitureToDelete: SceneElement[] = [];
  for (const gid of lineageSet) {
    const r = snapshotGenotype(gid, allElements, lineageSet, below);
    if (r.notice) new Notice(r.notice);
    if (!r.snapshot) continue;
    furnitureToDelete.push(...r.furniture);
    snapshots.push(r.snapshot);
  }

  // Sweep cross-glyphs and cross-lineages tied to this lineage. Subset mode
  // keeps the arrows into boundary genotypes.
  const boundaryIds = new Set(snapshots.filter((s) => s.boundary).map((s) => s.gid));
  const keptArrows: SceneElement[] = [];
  for (const el of allElements) {
    const cd = el.customData;
    if (!cd) continue;
    if (cd.kind === "cross-glyph" && cd.parents
        && lineageSet.has(cd.parents.maternal) && lineageSet.has(cd.parents.paternal)) {
      furnitureToDelete.push(el);
    } else if (cd.kind === "cross-lineage" && cd.childGenotypeId && lineageSet.has(cd.childGenotypeId)) {
      if (below && boundaryIds.has(cd.childGenotypeId)) keptArrows.push(el);
      else furnitureToDelete.push(el);
    }
  }

  if (snapshots.length === 0) {
    new Notice("No tidy-able genotypes in lineage.");
    return lineageSet;
  }

  const depths = computeDepths(lineageSet, allElements);
  const depthOf = (gid: string): number => depths.get(gid) ?? 0;

  // ---- Phase B: delete every old member across all genotypes ----
  const allOldMembers = snapshots.flatMap((s) => s.members);
  await ctx.deleteElements([...allOldMembers, ...furnitureToDelete]);
  // Test hook (consumed on read): fail right after the delete, to test that
  // the operation puts back what Tidy changed.
  if (take("_tidyFailAfterDelete")) throw new Error("test hook: Tidy failed after its delete");

  const fontFamily = genotypeFontFamily(ea);
  const { boundaryArrowIds, anchors, unitOf } = withGenotypeStyle(ea, fontFamily, () => {
    // ---- Phase C: render each genotype at the origin ----
    // Rendering before layout gives exact widths (text edits can change
    // them). Each genotype is rendered centered on (0, 0), its visible bbox
    // recentered exactly on (0, 0) so the laid-out center is also the center
    // Tidy measures on the next run, and moved after layout.
    const drawn: Drawn[] = [];
    for (const snap of snapshots) {
      const tag: TagFn = (id, data) => {
        const base: Record<string, unknown> = { schemaVersion: SCHEMA_VERSION, genotypeId: snap.gid, ...data };
        if (snap.parents) base.parents = snap.parents;
        ea.addAppendUpdateCustomData(id, base);
      };
      const g = drawGenotype(ea, snap.chromosomes, snap.glyphChar, tag, fontFamily);
      placeGenotype(ea, g, -g.totalWidth / 2, 0);
      const frameId = addFrame(ea, g.ids, tag);
      const ids = [...g.ids, frameId];
      ea.addToGroup(ids);
      const box = ea.getBoundingBox(g.ids.map((id) => ea.getElement(id)!));
      const bx = box.topX + box.width / 2, by = box.topY + box.height / 2;
      for (const id of ids) { const e = ea.getElement(id)!; e.x -= bx; e.y -= by; }
      drawn.push({ snap, ids, frameId, width: box.width, height: box.height, center: { x: 0, y: 0 } });
    }
    const byGid = new Map(drawn.map((d) => [d.snap.gid, d]));
    const known = new Set(byGid.keys());

    // ---- Layout ----
    const crossW = measureTextWidth(ea, CROSS_GLYPH_CHAR, GLYPH_SIZE, CROSS_GLYPH_FONT_FAMILY);
    // Half-width of each genotype's frame, which Phase D grows to cover the
    // offspring label box (centered on the genotype).
    const nodes: LayoutNode[] = drawn.map((d) => {
      const s = d.snap;
      const lw = s.labelText && (parentPairKey(s, known) || s.boundary) ? labelBoxWidth(ea, s.labelText) : 0;
      return {
        gid: s.gid, parents: s.parents, width: d.width, height: d.height,
        half: Math.max(d.width / 2 + FRAME_PAD, lw / 2), originalCenter: s.originalCenter, boundary: s.boundary,
      };
    });
    const crossPairs = collectCrossPairs(nodes, allElements);
    const layout = layoutLineage({ nodes, depths, crossPairs, crossW, subset: below });

    // Move each rendered genotype to its laid-out center.
    for (const d of drawn) {
      d.center = layout.centers.get(d.snap.gid)!;
      for (const id of d.ids) {
        const e = ea.getElement(id)!;
        e.x += d.center.x;
        e.y += d.center.y;
      }
    }

    // ---- Phase D: regenerate cross furniture from offspring `parents` ----
    // A cross's x glyph at the laid-out position, on the row of the left parent.
    const leftOf = (m: string, p: string): Drawn => {
      const a = byGid.get(m)!, b = byGid.get(p)!;
      return a.center.x <= b.center.x ? a : b;
    };
    const glyphAt = (m: string, p: string): SceneElement =>
      addCrossGlyph(ea, m, p, { x: layout.glyphX.get(`${m}|${p}`)!, y: leftOf(m, p).center.y }, fontFamily);

    // Group offspring by parent pair.
    const pairs = new Map<string, { maternalId: string; paternalId: string; children: Drawn[] }>();
    for (const d of drawn) {
      const key = parentPairKey(d.snap, known);
      if (!key || !d.snap.parents) continue;
      if (!pairs.has(key)) pairs.set(key, { maternalId: d.snap.parents.maternal, paternalId: d.snap.parents.paternal, children: [] });
      pairs.get(key)!.children.push(d);
    }

    // Label box (and frame growth to cover it) for one offspring.
    const addChildLabel = (child: Drawn): void => {
      const frame = ea.getElement(child.frameId)!;
      const renderableTop = frame.y + FRAME_PAD;
      if (!child.snap.labelText) return;
      const { boxId, textId } = addLabelBox(ea, child.snap.labelText, child.center.x, renderableTop - LABEL_GAP, {
        schemaVersion: SCHEMA_VERSION, genotypeId: child.snap.gid, parents: child.snap.parents, text: child.snap.labelText,
      });
      const labelEl = ea.getElement(boxId)!;
      const labelParts = [labelEl, ea.getElement(textId)!];
      // Grow the child's frame to cover its label box, and group the label with it.
      const box = ea.getBoundingBox([frame, labelEl]);
      const top = labelEl.y - FRAME_PAD;
      frame.x = box.topX; frame.width = box.width;
      frame.height = frame.y + frame.height - top;
      frame.y = top;
      for (const el of labelParts) el.groupIds = [...(frame.groupIds ?? [])];
    };

    // Every label first, so arrows are routed around the frames that cover them.
    const pairGlyphs = [...pairs.values()].map((pair) => [pair, glyphAt(pair.maternalId, pair.paternalId)] as const);
    for (const pair of pairs.values()) for (const child of pair.children) addChildLabel(child);
    for (const child of drawn.filter((d) => d.snap.boundary)) addChildLabel(child);

    // Obstacles for lineage arrows: the (grown) genotype frames and the x
    // glyphs, by row.
    const obstacles: ArrowObstacle[] = [];
    for (const d of drawn) {
      const f = ea.getElement(d.frameId)!;
      obstacles.push({ depth: depthOf(d.snap.gid), left: f.x, right: f.x + f.width });
    }
    for (const [m, p] of crossPairs) {
      const gx = layout.glyphX.get(m + "|" + p)!;
      obstacles.push({ depth: depthOf(leftOf(m, p).snap.gid), left: gx - crossW / 2, right: gx + crossW / 2 });
    }

    // Lineage arrow and criterion for one offspring whose parents' x glyph is
    // `glyphEl` (a workbench element). Its label must already be in place.
    for (const [pair, glyphEl] of pairGlyphs) {
      const glyphDepth = depthOf(leftOf(pair.maternalId, pair.paternalId).snap.gid);
      for (const child of pair.children) {
        const frame = ea.getElement(child.frameId)!;
        // Bound at the x glyph's bottom middle and the child frame's top middle.
        const points = childArrowPoints(
          { x: glyphEl.x + glyphEl.width / 2, y: glyphEl.y + glyphEl.height, depth: glyphDepth },
          { x: frame.x + frame.width / 2, y: frame.y, depth: depthOf(child.snap.gid) },
          layout.rows,
          obstacles,
        );
        const arrowId = addLineageArrow(ea, points, glyphEl.id, child.frameId, child.snap.gid);
        if (child.snap.criterionText) {
          addArrowLabel(ea, arrowId, child.snap.criterionText, {
            schemaVersion: SCHEMA_VERSION, childGenotypeId: child.snap.gid, text: child.snap.criterionText,
          });
        }
      }
    }

    // Subset mode boundary: keep the arrow into each boundary genotype (and
    // its criterion), re-bind its end to the genotype's new frame at the top
    // middle and re-route it from its unchanged start.
    const boundaryArrowIds = new Set<string>();
    {
      const viewById = new Map(allElements.map((e) => [e.id, e]));
      const lookup = { get: (id: string) => ea.getElement(id) ?? viewById.get(id) };
      for (const view of keptArrows) {
        const child = byGid.get(view.customData!.childGenotypeId!)!;
        const texts = (view.boundElements ?? []).filter((b) => b.type === "text")
          .map((b) => viewById.get(b.id)).filter((t): t is SceneElement => !!t && !t.isDeleted);
        ea.copyViewElementsToEAforEditing([view, ...texts]);
        const arrow = ea.getElement(view.id)!;
        arrow.endBinding = { ...(arrow.endBinding ?? {}), elementId: child.frameId, fixedPoint: [0.5, 0] };
        boundaryArrowIds.add(arrow.id);
      }
      for (const id of boundaryArrowIds) {
        const arrow = ea.getElement(id)!;
        const frame = ea.getElement(arrow.endBinding!.elementId)!;
        frame.boundElements = [...(frame.boundElements ?? []), { type: "arrow", id }];
        routeLineageArrow(ea, arrow, lookup);
      }
    }

    // Orphan cross-glyphs: pair-keyed glyphs with no offspring referencing
    // the pair. Regenerated at their laid-out position so the "Cross pressed
    // before offspring shorthand was typed" state survives Tidy.
    for (const [m, p] of crossPairs) {
      if (!pairs.has(`${m}|${p}`)) glyphAt(m, p);
    }

    return { boundaryArrowIds, anchors: layout.anchors, unitOf: layout.unitOf };
  });

  const gone = new Set([...allOldMembers, ...furnitureToDelete].map((e) => e.id));

  if (below) {
    // ---- Phase E (subset): keep clear of everything outside the subset ----
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
    const isOut = (g: string | undefined): boolean => !g || !lineageSet.has(g);
    const obstacleEls = ea.getViewElements().filter((e) => {
      if (e.isDeleted || gone.has(e.id)) return false;
      const cd = e.customData;
      if (!cd) return false;
      if (cd.genotypeId) return isOut(cd.genotypeId);
      if (cd.kind === "cross-glyph") return isOut(cd.parents?.maternal) || isOut(cd.parents?.paternal);
      if (cd.kind === "cross-lineage") return isOut(cd.childGenotypeId);
      return false;
    });
    const mine = ea.getElements();
    const lookup = new Map([...obstacleEls, ...ea.getElements()].map((e) => [e.id, e]));
    const boxes = (els: readonly SceneElement[]) => segmentBoxes(els, lookup);
    const obstacles = boxes(obstacleEls);
    const checked = (els: readonly SceneElement[]) => els.filter((e) => !boundaryArrowIds.has(e.id));
    const clear = (a: readonly SceneElement[], b: ReturnType<typeof boxes>) => clearance(boxes(a), b).ok(0);

    if (!clear(checked(mine), obstacles)) {
      const anchorGids = new Set(anchors.flatMap((g) => unitOf.get(g) ?? [g]));
      const inAnchor = (e: SceneElement): boolean => {
        const cd = e.customData ?? {};
        if (cd.kind === "cross-glyph") return anchorGids.has(cd.parents?.maternal ?? "") && anchorGids.has(cd.parents?.paternal ?? "");
        return anchorGids.has(cd.genotypeId ?? cd.childGenotypeId ?? "");
      };
      const anchorEls = mine.filter(inAnchor);
      const rest = mine.filter((e) => !inAnchor(e));
      const anchorGlyphIds = new Set(anchorEls.filter((e) => e.customData?.kind === "cross-glyph").map((e) => e.id));
      // Arrows whose start stays put while their child moves: from an anchor
      // x glyph, or from an outside x glyph (boundary). They are re-routed.
      const links = rest.filter((e) => e.type === "arrow"
        && (anchorGlyphIds.has(e.startBinding?.elementId ?? "") || boundaryArrowIds.has(e.id)));
      const rigid = rest.filter((e) => !links.includes(e));
      const move = (h: number): void => {
        for (const e of rest) e.x += h;
        for (const a of links) routeLineageArrow(ea, a, lookup);
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
        for (const id of boundaryArrowIds) routeLineageArrow(ea, ea.getElement(id)!, lookup);
        new Notice("Tidy: moved the top selected genotype(s) to keep clear of the rest of the drawing.");
      }
    }
  }

  // ---- Phase E: keep clear of other lineages ----
  //
  // Lineages are laid out independently, so a tidied lineage can land on
  // another one. Shift it sideways by the smallest amount that clears every
  // element of the lineages in `avoid` (genotype frames, x glyphs, and the
  // span of each lineage arrow) by FRAME_GAP. Already-clear lineages do not
  // move, so a second Tidy moves nothing.
  if (!below && avoid && avoid.size) {
    const isOther = (g: string | undefined): boolean => !!g && avoid.has(g) && !lineageSet.has(g);
    const others = ea.getViewElements().filter((e) => {
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

  await ctx.commit();
  return lineageSet;
}
