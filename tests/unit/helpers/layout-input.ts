import { boundingBox, collectLineage, computeDepths, extendWithOrphanGlyphs, snapshotGenotype, type Point } from "../../../src/scene";
import { collectCrossPairs, type LayoutInput, type LayoutNode } from "../../../src/layout";
import { FRAME_PAD } from "../../../src/constants";
import type { SceneElement } from "../../../src/schema";

const RENDERED = new Set(["genotype-allele", "genotype-fraction", "genotype-separator", "genotype-glyph"]);

// The layout input Tidy builds from `before` (the fixture), with the sizes it
// measured taken from `after` (the Tidy script's result, which has the same
// rendered sizes), and where the script put each genotype and x glyph.
export function layoutInputFromScenes(before: SceneElement[], after: SceneElement[]) {
  const live = before.filter((e) => !e.isDeleted);
  const founder = live.find((e) => e.customData?.genotypeId && !e.customData.parents)!.customData!.genotypeId!;
  const lineage = collectLineage(founder, live);
  extendWithOrphanGlyphs(lineage, live);
  const depths = computeDepths(lineage, live);
  const nodes: LayoutNode[] = [];
  const centers = new Map<string, Point>();
  for (const gid of lineage) {
    const snap = snapshotGenotype(gid, live, lineage, false).snapshot;
    if (!snap) continue;
    const drawn = after.filter((e) => e.customData?.genotypeId === gid && RENDERED.has(String(e.customData.kind)));
    const b = boundingBox(drawn);
    centers.set(gid, { x: b.topX + b.width / 2, y: b.topY + b.height / 2 });
    const labelBox = after.find((e) => e.customData?.genotypeId === gid && e.customData.kind === "genotype-label-box");
    const hasPair = !!snap.parents && lineage.has(snap.parents.maternal) && lineage.has(snap.parents.paternal);
    const lw = snap.labelText && hasPair && labelBox ? labelBox.width : 0;
    nodes.push({ gid, parents: snap.parents, width: b.width, height: b.height, half: Math.max(b.width / 2 + FRAME_PAD, lw / 2), originalCenter: snap.originalCenter, boundary: false });
  }
  const glyphs = after.filter((e) => e.customData?.kind === "cross-glyph");
  const glyphX = new Map(glyphs.map((g) => [`${g.customData!.parents!.maternal}|${g.customData!.parents!.paternal}`, g.x + g.width / 2]));
  const input: LayoutInput = { nodes, depths, crossPairs: collectCrossPairs(nodes, live), crossW: glyphs[0]?.width ?? 0, subset: false };
  return { input, expected: { centers, glyphX } };
}
