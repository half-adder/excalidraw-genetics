// Drawing through an EA workbench: genotypes, frames, labels, criteria, x
// glyphs, lineage arrows and text measuring. Writes only to the EA workbench
// (`ea.addText`, `ea.addLine`, ...); committing the workbench to the view is
// the caller's job, through `ctx.commit()` (src/operation), never here.
//
// Ported from scripts/Genotype.md, scripts/Cross Genotypes.md and
// scripts/Tidy.md on undo-safe@88155fb (see .superpowers/sdd/task-9-brief.md
// for exact line ranges). Element creation order, customData contents and
// geometry are kept identical; only the "ea" instance and any carried
// customData (parents, etc.) are now parameters instead of script-global
// state.

import type { EA } from "../excalidraw/ea";
import type { BoundRef, Chromosome, SceneElement } from "../schema";
import { SCHEMA_VERSION } from "../schema";
import { pathMidpoint } from "../scene";
import { boundLineagePoints } from "../layout";
import {
  CHROMOSOME_GAP,
  CROSS_GLYPH_CHAR,
  CROSS_GLYPH_FONT_FAMILY,
  FALLBACK_FONT_FAMILY,
  FRACTION_GAP,
  FRACTION_PADDING,
  FRAME_PAD,
  GLYPH_FONT_FAMILY,
  GLYPH_GAP,
  GLYPH_SIZE,
  LABEL_BOX_BG,
  LABEL_BOX_PAD,
  LOCAL_FONT_FAMILY,
  FONT_SIZE,
  STROKE_WIDTH,
} from "../constants";

export type TagFn = (id: string, data: Record<string, unknown>) => void;

export interface Slot {
  label: string;
  kind: "het" | "single";
  slotWidth: number;
  slotHeight: number;
  top?: string;
  bottom?: string;
  line?: string;
  single?: string;
}

export interface DrawnGenotype {
  slots: Slot[];
  separatorIds: string[];
  glyphId: string | null;
  ids: string[];
  totalWidth: number;
  halfHeight: number;
  slotMaxHeight: number;
}

// LOCAL_FONT_FAMILY (Computer Modern) when Excalidraw's local-font setting is
// on, else FALLBACK_FONT_FAMILY (Helvetica). The Genotype-only "local font is
// off" Notice stays in the Genotype command, not here.
export function genotypeFontFamily(ea: EA): number {
  return ea.plugin?.settings?.experimentalEnableFourthFont ? LOCAL_FONT_FAMILY : FALLBACK_FONT_FAMILY;
}

// Saves the workbench style genotype drawing depends on, sets it (straight
// fraction lines: roughness 0), runs `body`, and restores it afterward, even
// if `body` throws.
export function withGenotypeStyle<T>(ea: EA, fontFamily: number, body: () => T): T {
  const prev = {
    fontSize: ea.style.fontSize,
    fontFamily: ea.style.fontFamily,
    strokeColor: ea.style.strokeColor,
    strokeWidth: ea.style.strokeWidth,
    roughness: ea.style.roughness,
    backgroundColor: ea.style.backgroundColor,
  };
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = fontFamily;
  ea.style.strokeColor = "#000000";
  ea.style.strokeWidth = STROKE_WIDTH;
  ea.style.roughness = 0;
  try {
    return body();
  } finally {
    ea.style.fontSize = prev.fontSize;
    ea.style.fontFamily = prev.fontFamily;
    ea.style.strokeColor = prev.strokeColor;
    ea.style.strokeWidth = prev.strokeWidth;
    ea.style.roughness = prev.roughness;
    ea.style.backgroundColor = prev.backgroundColor;
  }
}

// Draws one genotype's alleles, fraction lines, separators and (optional) sex
// glyph at the origin, tagging each element through `tag`. Positions are
// filled in afterward by `placeGenotype`; call this inside
// `withGenotypeStyle` (or with `ea.style` already at FONT_SIZE/`fontFamily`).
export function drawGenotype(
  ea: EA,
  chromosomes: readonly Chromosome[],
  glyph: string | null,
  tag: TagFn,
  fontFamily: number,
): DrawnGenotype {
  const slots: Slot[] = chromosomes.map((c) => {
    if (c.kind === "single") {
      const id = ea.addText(0, 0, c.alleles.single);
      tag(id, { kind: "genotype-allele", chromosome: c.label, side: "single" });
      const el = ea.getElement(id)!;
      return { label: c.label, kind: "single", slotWidth: el.width, slotHeight: el.height, single: id };
    }
    const topId = ea.addText(0, 0, c.alleles.top);
    const botId = ea.addText(0, 0, c.alleles.bottom);
    tag(topId, { kind: "genotype-allele", chromosome: c.label, side: "top" });
    tag(botId, { kind: "genotype-allele", chromosome: c.label, side: "bottom" });
    const top = ea.getElement(topId)!;
    const bot = ea.getElement(botId)!;
    const textW = Math.max(top.width, bot.width);
    const slotWidth = textW + 2 * FRACTION_PADDING;
    const slotHeight = top.height + 2 * FRACTION_GAP + bot.height;
    const lineId = ea.addLine([[0, 0], [slotWidth, 0]]);
    tag(lineId, { kind: "genotype-fraction", chromosome: c.label });
    return { label: c.label, kind: "het", slotWidth, slotHeight, top: topId, bottom: botId, line: lineId };
  });

  const separatorIds: string[] = [];
  for (let i = 0; i < slots.length - 1; i++) {
    const sepId = ea.addText(0, 0, ";");
    tag(sepId, { kind: "genotype-separator", after: chromosomes[i].label });
    separatorIds.push(sepId);
  }

  let glyphId: string | null = null;
  // `slots.length` is unreachable as false from any caller today (every
  // caller passes at least one chromosome), but it matches the scripts'
  // effective behavior (Genotype.md: `state.glyph && chromosomeLayouts.length
  // ? state.glyph : null`) and keeps drawGenotype safe to call with `[]`.
  if (glyph && slots.length) {
    ea.style.fontSize = GLYPH_SIZE;
    ea.style.fontFamily = GLYPH_FONT_FAMILY;
    glyphId = ea.addText(0, 0, glyph);
    tag(glyphId, { kind: "genotype-glyph" });
    ea.style.fontSize = FONT_SIZE;
    ea.style.fontFamily = fontFamily;
  }

  let totalWidth = 0;
  if (glyphId) totalWidth += ea.getElement(glyphId)!.width + GLYPH_GAP;
  for (let i = 0; i < slots.length; i++) {
    totalWidth += slots[i].slotWidth;
    if (i < slots.length - 1) {
      totalWidth += CHROMOSOME_GAP + ea.getElement(separatorIds[i])!.width + CHROMOSOME_GAP;
    }
  }

  let halfHeight = 0;
  if (glyphId) halfHeight = ea.getElement(glyphId)!.height / 2;
  for (const s of slots) {
    if (s.kind === "single") {
      halfHeight = Math.max(halfHeight, ea.getElement(s.single!)!.height / 2);
    } else {
      const h = Math.max(ea.getElement(s.top!)!.height, ea.getElement(s.bottom!)!.height);
      halfHeight = Math.max(halfHeight, FRACTION_GAP + h);
    }
  }

  const slotMaxHeight = Math.max(...slots.map((s) => s.slotHeight));

  const ids: string[] = [];
  if (glyphId) ids.push(glyphId);
  for (const s of slots) {
    if (s.kind === "single") ids.push(s.single!);
    else ids.push(s.top!, s.bottom!, s.line!);
  }
  ids.push(...separatorIds);

  return { slots, separatorIds, glyphId, ids, totalWidth, halfHeight, slotMaxHeight };
}

// Positions a genotype drawn by `drawGenotype`: `left` is the x of its
// leftmost element (the sex glyph, if any, else the first slot); `midlineY`
// is the y every allele fraction is centered on.
export function placeGenotype(ea: EA, drawn: DrawnGenotype, left: number, midlineY: number): void {
  let cursorX = left;

  if (drawn.glyphId) {
    const g = ea.getElement(drawn.glyphId)!;
    g.x = cursorX;
    g.y = midlineY - g.height / 2;
    cursorX += g.width + GLYPH_GAP;
  }

  for (let i = 0; i < drawn.slots.length; i++) {
    const s = drawn.slots[i];
    const slotX = cursorX;
    if (s.kind === "single") {
      const t = ea.getElement(s.single!)!;
      t.x = slotX + (s.slotWidth - t.width) / 2;
      t.y = midlineY - t.height / 2;
    } else {
      const top = ea.getElement(s.top!)!;
      const bot = ea.getElement(s.bottom!)!;
      const line = ea.getElement(s.line!)!;
      top.x = slotX + (s.slotWidth - top.width) / 2;
      top.y = midlineY - FRACTION_GAP - top.height;
      line.x = slotX;
      line.y = midlineY;
      bot.x = slotX + (s.slotWidth - bot.width) / 2;
      bot.y = midlineY + FRACTION_GAP;
    }
    cursorX += s.slotWidth;
    if (i < drawn.slots.length - 1) {
      cursorX += CHROMOSOME_GAP;
      const sep = ea.getElement(drawn.separatorIds[i])!;
      sep.x = cursorX;
      sep.y = midlineY - sep.height / 2;
      cursorX += sep.width + CHROMOSOME_GAP;
    }
  }
}

// Invisible frame around `ids`' bounding box, padded by FRAME_PAD: the
// binding target for lineage arrows (top middle). Transparent stroke and
// background so it never draws; only the stroke color is put back afterward
// (the background is restored by the caller's withGenotypeStyle).
export function addFrame(ea: EA, ids: readonly string[], tag: TagFn): string {
  const box = ea.getBoundingBox(ids.map((id) => ea.getElement(id)!));
  ea.style.strokeColor = "transparent";
  ea.style.backgroundColor = "transparent";
  const frameId = ea.addRect(box.topX - FRAME_PAD, box.topY - FRAME_PAD, box.width + 2 * FRAME_PAD, box.height + 2 * FRAME_PAD);
  tag(frameId, { kind: "genotype-frame" });
  ea.style.strokeColor = "#000000";
  return frameId;
}

// Offspring label: text in a black-outlined, light-blue box, centered on
// `centerX` with its bottom edge at `bottomY`. The text is tagged
// `genotype-label`, the box `genotype-label-box`; both carry `data`.
export function addLabelBox(ea: EA, text: string, centerX: number, bottomY: number, data: Record<string, unknown>): { boxId: string; textId: string } {
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
  const box = ea.getElement(boxId)!;
  const textId = (box.boundElements!.find((b) => b.type === "text") as BoundRef).id;
  const dx = centerX - box.width / 2 - box.x, dy = bottomY - box.height - box.y;
  for (const el of [box, ea.getElement(textId)!]) { el.x += dx; el.y += dy; }
  ea.addAppendUpdateCustomData(textId, { ...data, kind: "genotype-label" });
  ea.addAppendUpdateCustomData(boxId, { ...data, kind: "genotype-label-box" });
  return { boxId, textId };
}

// Selection criterion: a real Excalidraw arrow label (text bound to
// `arrowId`), centered at the midpoint of its path. May be multi-line.
export function addArrowLabel(ea: EA, arrowId: string, text: string, data: Record<string, unknown>): string {
  const arrow = ea.getElement(arrowId)!;
  const [mx, my] = pathMidpoint(arrow);
  const textId = ea.addText(0, 0, text, { textAlign: "center", textVerticalAlign: "middle" });
  const t = ea.getElement(textId)!;
  t.containerId = arrowId;
  t.x = mx - t.width / 2;
  t.y = my - t.height / 2;
  arrow.boundElements = [...(arrow.boundElements ?? []), { type: "text", id: textId }];
  ea.addAppendUpdateCustomData(textId, { ...data, kind: "cross-criterion" });
  return textId;
}

// A cross's x glyph (hand-drawn, Virgil), centered on `center`, tagged with
// its parents. `fontFamily` is the genotype font the workbench style is put
// back to afterward (LOCAL_FONT_FAMILY or FALLBACK_FONT_FAMILY), not the
// glyph's own CROSS_GLYPH_FONT_FAMILY.
export function addCrossGlyph(ea: EA, maternalId: string, paternalId: string, center: { x: number; y: number }, fontFamily: number): SceneElement {
  ea.style.fontSize = GLYPH_SIZE;
  ea.style.fontFamily = CROSS_GLYPH_FONT_FAMILY;
  const glyphId = ea.addText(0, 0, CROSS_GLYPH_CHAR);
  ea.addAppendUpdateCustomData(glyphId, {
    schemaVersion: SCHEMA_VERSION,
    kind: "cross-glyph",
    parents: { maternal: maternalId, paternal: paternalId },
  });
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = fontFamily;
  const glyphEl = ea.getElement(glyphId)!;
  glyphEl.x = center.x - glyphEl.width / 2;
  glyphEl.y = center.y - glyphEl.height / 2;
  return glyphEl;
}

// A lineage arrow along `points` (an elbow path from a cross's x glyph to a
// child's frame), bound at the x glyph's bottom middle (`startId`) and the
// child frame's top middle (`endId`). A path with more than one elbow (it
// routed through a lane) keeps its inner segments pinned with
// `fixedSegments`; otherwise Excalidraw would re-route it as a plain elbow
// straight through any rows in between.
export function addLineageArrow(ea: EA, points: Array<[number, number]>, startId: string, endId: string, childGenotypeId: string): string {
  const arrowId = ea.addArrow(points, {
    startArrowHead: null, endArrowHead: "triangle", elbowed: true,
    startObjectId: startId, startFixedPoint: [0.5, 1],
    endObjectId: endId, endFixedPoint: [0.5, 0],
  });
  ea.addAppendUpdateCustomData(arrowId, {
    schemaVersion: SCHEMA_VERSION,
    kind: "cross-lineage",
    childGenotypeId,
  });
  const arrow = ea.getElement(arrowId)!;
  if (arrow.points!.length > 4) {
    arrow.fixedSegments = arrow.points!.slice(2, -1).map((p, i) => ({
      start: [...arrow.points![i + 1]], end: [...p], index: i + 2,
    }));
  }
  return arrowId;
}

// Width of `text` created in the current workbench style, in `fontSize` /
// `fontFamily` (then discarded).
export function measureTextWidth(ea: EA, text: string, fontSize: number, fontFamily: number): number {
  const saved = { fontSize: ea.style.fontSize, fontFamily: ea.style.fontFamily };
  ea.style.fontSize = fontSize;
  ea.style.fontFamily = fontFamily;
  const id = ea.addText(0, 0, text);
  const w = ea.getElement(id)!.width;
  delete ea.elementsDict[id];
  ea.style.fontSize = saved.fontSize;
  ea.style.fontFamily = saved.fontFamily;
  return w;
}

// Width a label box for `text` would come out to (drawn, measured, discarded).
export function labelBoxWidth(ea: EA, text: string): number {
  const { boxId, textId } = addLabelBox(ea, text, 0, 0, {});
  const w = ea.getElement(boxId)!.width;
  delete ea.elementsDict[boxId];
  delete ea.elementsDict[textId];
  return w;
}

// Re-routes a workbench lineage arrow along its bound ends (via `lookup`)
// and re-centers its criterion label, after one end has moved.
export function routeLineageArrow(ea: EA, arrow: SceneElement, lookup: { get(id: string): SceneElement | undefined }): void {
  const pts = boundLineagePoints(arrow, lookup);
  if (!pts) return;
  const [x0, y0] = pts[0];
  arrow.x = x0;
  arrow.y = y0;
  arrow.points = pts.map(([x, y]) => [x - x0, y - y0]);
  const xs = arrow.points.map((p) => p[0]), ys = arrow.points.map((p) => p[1]);
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
