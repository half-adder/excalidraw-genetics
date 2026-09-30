import { describe, expect, it } from "vitest";
import { fakeEA } from "./helpers/fake-ea";
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
} from "../../src/render";
import type { Chromosome, SceneElement } from "../../src/schema";
import {
  CROSS_GLYPH_FONT_FAMILY,
  FALLBACK_FONT_FAMILY,
  FONT_SIZE,
  FRAME_PAD,
  GLYPH_FONT_FAMILY,
  GLYPH_SIZE,
  LABEL_BOX_BG,
  LABEL_BOX_PAD,
  LOCAL_FONT_FAMILY,
  STROKE_WIDTH,
} from "../../src/constants";

const chromosomes: Chromosome[] = [
  { label: "X", kind: "het", alleles: { top: "w", bottom: "Y" } },
  { label: "II", kind: "het", alleles: { top: "Sp", bottom: "CyO" } },
  { label: "III", kind: "single", alleles: { single: "+" } },
];

describe("drawGenotype + placeGenotype", () => {
  it("lays out glyph, fractions and separators as the scripts do", () => {
    const ea = fakeEA();
    const tags: Array<[string, Record<string, unknown>]> = [];
    const d = drawGenotype(ea, chromosomes, "♂", (id, data) => tags.push([id, data]), 2);
    // Creation order (z-order): per chromosome top, bottom, line (or single), then separators, then glyph.
    expect(ea.order.map((id) => ea.getElement(id)!.text ?? ea.getElement(id)!.type)).toEqual(["w", "Y", "line", "Sp", "CyO", "line", "+", ";", ";", "♂"]);
    expect(d.totalWidth).toBe(166);
    expect(d.halfHeight).toBe(30);
    placeGenotype(ea, d, 100, 50);
    const at = (id: string | null | undefined) => { const e = ea.getElement(id!)!; return [e.x, e.y]; };
    expect(at(d.glyphId)).toEqual([100, 35]);
    expect(at(d.slots[0].top)).toEqual([128, 20]);
    expect(at(d.slots[0].line)).toEqual([124, 50]);
    expect(at(d.slots[0].bottom)).toEqual([128, 55]);
    expect(at(d.separatorIds[0])).toEqual([156, 37.5]);
    expect(at(d.slots[1].top)).toEqual([189, 20]);
    expect(at(d.slots[1].bottom)).toEqual([184, 55]);
    expect(at(d.separatorIds[1])).toEqual([232, 37.5]);
    expect(at(d.slots[2].single)).toEqual([256, 37.5]);
    expect(d.ids).toEqual([d.glyphId, d.slots[0].top, d.slots[0].bottom, d.slots[0].line, d.slots[1].top, d.slots[1].bottom, d.slots[1].line, d.slots[2].single, ...d.separatorIds]);
    expect(tags.find(([id]) => id === d.slots[0].top)?.[1]).toEqual({ kind: "genotype-allele", chromosome: "X", side: "top" });
    // The fraction line spans the slot, not just the wider allele's text width.
    expect(ea.getElement(d.slots[0].line!)!.points).toEqual([[0, 0], [18, 0]]);
    expect(ea.getElement(d.slots[1].line!)!.points).toEqual([[0, 0], [38, 0]]);
  });

  it("draws the sex glyph in GLYPH_FONT_FAMILY/GLYPH_SIZE, then restores the caller's genotype font", () => {
    const ea = fakeEA();
    // fontFamily 4 here is deliberately different from GLYPH_FONT_FAMILY (2),
    // so drawing the glyph in the wrong font is observable.
    const d = drawGenotype(ea, chromosomes, "♂", () => {}, 4);
    const glyph = ea.getElement(d.glyphId!)!;
    expect(glyph.fontFamily).toBe(GLYPH_FONT_FAMILY);
    expect(glyph.fontSize).toBe(GLYPH_SIZE);
    expect(ea.style.fontFamily).toBe(4);
    expect(ea.style.fontSize).toBe(FONT_SIZE);
  });

  it("tags separators, the single allele and the sex glyph with their own kinds", () => {
    const ea = fakeEA();
    const tags: Array<[string, Record<string, unknown>]> = [];
    const d = drawGenotype(ea, chromosomes, "♀", (id, data) => tags.push([id, data]), 2);
    const dataFor = (id: string | null) => tags.find(([tid]) => tid === id)?.[1];
    expect(dataFor(d.separatorIds[0])).toEqual({ kind: "genotype-separator", after: "X" });
    expect(dataFor(d.separatorIds[1])).toEqual({ kind: "genotype-separator", after: "II" });
    expect(dataFor(d.slots[2].single!)).toEqual({ kind: "genotype-allele", chromosome: "III", side: "single" });
    expect(dataFor(d.glyphId)).toEqual({ kind: "genotype-glyph" });
    // Mutation check (reverted): flipping "after: chromosomes[i].label" to
    // "chromosomes[i + 1].label" in drawGenotype makes this assertion fail
    // (after becomes "II" then "III" instead of "X" then "II").
  });

  it("omits the glyph when none is given, and slot widths use the wider allele, not the sum", () => {
    const ea = fakeEA();
    const d = drawGenotype(ea, chromosomes, null, () => {}, 2);
    expect(d.glyphId).toBeNull();
    // II: top "Sp" (width 20) vs bottom "CyO" (width 30) -> slotWidth = 30 + 2*4 = 38, not 20+30+8.
    expect(d.slots[1].slotWidth).toBe(38);
  });

  it("a glyph with no chromosomes is not drawn (callers gate this, drawGenotype mirrors it)", () => {
    const ea = fakeEA();
    const d = drawGenotype(ea, [], "♂", () => {}, 2);
    expect(d.glyphId).toBeNull();
    expect(d.ids).toEqual([]);
  });
});

describe("genotypeFontFamily", () => {
  it("is the local font when Excalidraw's local-font setting is on", () => {
    const ea = fakeEA();
    ea.plugin.settings.experimentalEnableFourthFont = true;
    expect(genotypeFontFamily(ea)).toBe(LOCAL_FONT_FAMILY);
  });
  it("falls back to Helvetica when the setting is off", () => {
    const ea = fakeEA();
    ea.plugin.settings.experimentalEnableFourthFont = false;
    expect(genotypeFontFamily(ea)).toBe(FALLBACK_FONT_FAMILY);
  });
});

describe("withGenotypeStyle", () => {
  it("sets genotype style for the body and restores the caller's style after", () => {
    const ea = fakeEA();
    // Every starting value differs from what withGenotypeStyle sets, so a
    // dropped set (during) or a dropped restore (after) is both observable.
    ea.style.fontSize = 12;
    ea.style.fontFamily = 1;
    ea.style.strokeColor = "#ff0000";
    ea.style.strokeWidth = 1;
    ea.style.roughness = 2;
    ea.style.backgroundColor = "#00ff00";
    let seenDuring: { fontSize: number; fontFamily: number; strokeColor: string; strokeWidth: number; roughness: number } | null = null;
    withGenotypeStyle(ea, 4, () => {
      seenDuring = {
        fontSize: ea.style.fontSize, fontFamily: ea.style.fontFamily, strokeColor: ea.style.strokeColor,
        strokeWidth: ea.style.strokeWidth, roughness: ea.style.roughness,
      };
    });
    expect(seenDuring).toEqual({ fontSize: FONT_SIZE, fontFamily: 4, strokeColor: "#000000", strokeWidth: STROKE_WIDTH, roughness: 0 });
    expect(ea.style.fontSize).toBe(12);
    expect(ea.style.fontFamily).toBe(1);
    expect(ea.style.strokeColor).toBe("#ff0000");
    expect(ea.style.strokeWidth).toBe(1);
    expect(ea.style.roughness).toBe(2);
    expect(ea.style.backgroundColor).toBe("#00ff00");
  });
  it("restores style even when the body throws", () => {
    const ea = fakeEA();
    ea.style.strokeColor = "#123456";
    expect(() => withGenotypeStyle(ea, 4, () => { throw new Error("boom"); })).toThrow("boom");
    expect(ea.style.strokeColor).toBe("#123456");
  });
});

describe("addFrame", () => {
  it("pads the bounding box of its ids by FRAME_PAD and tags genotype-frame", () => {
    const ea = fakeEA();
    const tags: Array<[string, Record<string, unknown>]> = [];
    const d = drawGenotype(ea, chromosomes, null, () => {}, 2);
    placeGenotype(ea, d, 100, 50);
    const frameId = addFrame(ea, d.ids, (id, data) => tags.push([id, data]));
    const box = ea.getBoundingBox(d.ids.map((id) => ea.getElement(id)!));
    const frame = ea.getElement(frameId)!;
    expect(frame.x).toBe(box.topX - FRAME_PAD);
    expect(frame.y).toBe(box.topY - FRAME_PAD);
    expect(frame.width).toBe(box.width + 2 * FRAME_PAD);
    expect(frame.height).toBe(box.height + 2 * FRAME_PAD);
    expect(tags).toEqual([[frameId, { kind: "genotype-frame" }]]);
  });
  it("leaves the frame transparent and restores only the stroke color", () => {
    const ea = fakeEA();
    ea.style.backgroundColor = "#pink";
    const d = drawGenotype(ea, chromosomes, null, () => {}, 2);
    placeGenotype(ea, d, 0, 0);
    const frameId = addFrame(ea, d.ids, () => {});
    expect(ea.getElement(frameId)!.strokeColor).toBe("transparent");
    expect(ea.getElement(frameId)!.backgroundColor).toBe("transparent");
    expect(ea.style.strokeColor).toBe("#000000");
  });
});

describe("addLabelBox", () => {
  it("centers the box on centerX with its bottom edge at bottomY, box under text in z-order", () => {
    const ea = fakeEA();
    const { boxId, textId } = addLabelBox(ea, "F1", 200, 80, {});
    const box = ea.getElement(boxId)!;
    expect(box.x + box.width / 2).toBeCloseTo(200);
    expect(box.y + box.height).toBeCloseTo(80);
    expect(ea.getElement(textId)).toBeDefined();
    // The container renders under its bound text (real Excalidraw creates
    // the rect first too).
    expect(ea.order.indexOf(boxId)).toBeLessThan(ea.order.indexOf(textId));
  });
  it("tags the text genotype-label and the box genotype-label-box, both carrying data", () => {
    const ea = fakeEA();
    const { boxId, textId } = addLabelBox(ea, "F1", 0, 0, { genotypeId: "g1", schemaVersion: 2 });
    expect(ea.getElement(textId)!.customData).toEqual({ genotypeId: "g1", schemaVersion: 2, kind: "genotype-label" });
    expect(ea.getElement(boxId)!.customData).toEqual({ genotypeId: "g1", schemaVersion: 2, kind: "genotype-label-box" });
  });
  it("draws a black-outlined, solid-filled, light-blue box around center-aligned text", () => {
    const ea = fakeEA();
    const { boxId, textId } = addLabelBox(ea, "F1", 0, 0, {});
    const box = ea.getElement(boxId)!;
    const text = ea.getElement(textId)!;
    expect(box.backgroundColor).toBe(LABEL_BOX_BG);
    expect(box.fillStyle).toBe("solid");
    expect(box.strokeColor).toBe("#000000");
    expect(text.textAlign).toBe("center");
    expect(text.verticalAlign).toBe("middle");
  });
  it("pads the box by LABEL_BOX_PAD around the text on every side", () => {
    const ea = fakeEA();
    const { boxId, textId } = addLabelBox(ea, "F1", 0, 0, {});
    const box = ea.getElement(boxId)!;
    const text = ea.getElement(textId)!;
    expect(box.width - text.width).toBeCloseTo(2 * LABEL_BOX_PAD);
    expect(box.height - text.height).toBeCloseTo(2 * LABEL_BOX_PAD);
  });
  it("leaves the caller's style (background, fill, stroke) as it was before the call", () => {
    const ea = fakeEA();
    ea.style.backgroundColor = "#00ff00";
    ea.style.fillStyle = "hachure";
    ea.style.strokeColor = "#ff0000";
    addLabelBox(ea, "F1", 0, 0, {});
    expect(ea.style.backgroundColor).toBe("#00ff00");
    expect(ea.style.fillStyle).toBe("hachure");
    expect(ea.style.strokeColor).toBe("#ff0000");
  });
});

describe("labelBoxWidth", () => {
  it("measures a label box's width and cleans up its scratch elements", () => {
    const ea = fakeEA();
    const before = ea.getElements().length;
    const w = labelBoxWidth(ea, "F1");
    expect(w).toBeGreaterThan(0);
    expect(ea.getElements().length).toBe(before);
  });
});

describe("addArrowLabel", () => {
  it("binds a centered text label to the arrow's midpoint and tags cross-criterion", () => {
    const ea = fakeEA();
    const arrowId = ea.addArrow([[0, 0], [0, 40]]);
    const textId = addArrowLabel(ea, arrowId, "Cy+", { childGenotypeId: "g1", schemaVersion: 2 });
    const t = ea.getElement(textId)!;
    expect(t.containerId).toBe(arrowId);
    expect(t.x + t.width / 2).toBeCloseTo(0);
    expect(t.y + t.height / 2).toBeCloseTo(20);
    expect(t.textAlign).toBe("center");
    expect(t.verticalAlign).toBe("middle");
    expect(t.customData).toEqual({ childGenotypeId: "g1", schemaVersion: 2, kind: "cross-criterion" });
    expect(ea.getElement(arrowId)!.boundElements).toEqual([{ type: "text", id: textId }]);
  });
});

describe("addCrossGlyph", () => {
  it("draws the x in the cross-glyph font, tags parents, then restores the genotype font", () => {
    const ea = fakeEA();
    const glyphEl = addCrossGlyph(ea, "matId", "patId", { x: 100, y: 200 }, 4);
    expect(glyphEl.customData).toEqual({ schemaVersion: 2, kind: "cross-glyph", parents: { maternal: "matId", paternal: "patId" } });
    expect(glyphEl.fontFamily).toBe(CROSS_GLYPH_FONT_FAMILY);
    expect(glyphEl.fontSize).toBe(GLYPH_SIZE);
    expect(glyphEl.x + glyphEl.width / 2).toBeCloseTo(100);
    expect(glyphEl.y + glyphEl.height / 2).toBeCloseTo(200);
    // Style is put back to the caller's genotype font, not the glyph's own.
    expect(ea.style.fontFamily).toBe(4);
    expect(ea.style.fontSize).toBe(20);
  });
});

describe("addLineageArrow", () => {
  it("is an elbowed arrow bound at the glyph's bottom middle and the child frame's top middle", () => {
    const ea = fakeEA();
    const arrowId = addLineageArrow(ea, [[10, 20], [10, 60]], "glyphId", "frameId", "childGid");
    const arrow = ea.getElement(arrowId)!;
    expect(arrow.elbowed).toBe(true);
    expect(arrow.startArrowHead).toBeNull();
    expect(arrow.endArrowHead).toBe("triangle");
    expect(arrow.startBinding).toEqual({ elementId: "glyphId", fixedPoint: [0.5, 1] });
    expect(arrow.endBinding).toEqual({ elementId: "frameId", fixedPoint: [0.5, 0] });
    expect(arrow.customData).toEqual({ schemaVersion: 2, kind: "cross-lineage", childGenotypeId: "childGid" });
    expect(arrow.fixedSegments).toBeUndefined();
  });
  it("does not add fixedSegments for a plain 4-point elbow path", () => {
    const ea = fakeEA();
    const arrowId = addLineageArrow(ea, [[0, 0], [0, 50], [200, 50], [200, 90]], "glyphId", "frameId", "childGid");
    expect(ea.getElement(arrowId)!.fixedSegments).toBeUndefined();
  });
  it("pins the inner segments of a routed (more than 4 point) path", () => {
    const ea = fakeEA();
    const points: Array<[number, number]> = [[0, 0], [0, 50], [200, 50], [200, 90], [400, 90], [400, 120]];
    const arrowId = addLineageArrow(ea, points, "glyphId", "frameId", "childGid");
    const arrow = ea.getElement(arrowId)!;
    expect(arrow.fixedSegments).toEqual([
      { start: [0, 50], end: [200, 50], index: 2 },
      { start: [200, 50], end: [200, 90], index: 3 },
      { start: [200, 90], end: [400, 90], index: 4 },
    ]);
  });
});

describe("measureTextWidth", () => {
  it("measures at the given font size/family and restores the caller's style", () => {
    const ea = fakeEA();
    ea.style.fontSize = 20;
    ea.style.fontFamily = 4;
    const w = measureTextWidth(ea, "x", 24, 1);
    expect(w).toBe("x".length * 24 / 2);
    expect(ea.style.fontSize).toBe(20);
    expect(ea.style.fontFamily).toBe(4);
  });
  it("discards its scratch element", () => {
    const ea = fakeEA();
    const before = Object.keys(ea.elementsDict).length;
    measureTextWidth(ea, "hello", 20, 1);
    expect(Object.keys(ea.elementsDict).length).toBe(before);
  });
});

describe("routeLineageArrow", () => {
  it("re-routes a bound arrow to its (moved) ends and re-centers its label", () => {
    const ea = fakeEA();
    const glyph = { id: "glyph1", type: "text", x: 0, y: 0, width: 20, height: 30 } as SceneElement;
    const frame = { id: "frame1", type: "rectangle", x: 90, y: 200, width: 20, height: 10 } as SceneElement;
    const byId: Record<string, SceneElement> = { glyph1: glyph, frame1: frame };
    const lookup = { get: (id: string) => byId[id] };
    const arrowId = addLineageArrow(ea, [[10, 30], [10, 200]], "glyph1", "frame1", "childGid");
    addArrowLabel(ea, arrowId, "label", {});
    const arrow = ea.getElement(arrowId)!;
    arrow.startBinding = { elementId: "glyph1" };
    arrow.endBinding = { elementId: "frame1" };
    // Stale position from before the glyph/frame moved: routeLineageArrow must overwrite it.
    arrow.x = -999;
    arrow.y = -999;
    routeLineageArrow(ea, arrow, lookup);
    // glyph bottom middle (10, 30) to frame top middle (100, 200): x1 != x2, so an elbow through the vertical midpoint.
    expect(arrow.x).toBe(10);
    expect(arrow.y).toBe(30);
    expect(arrow.points).toEqual([[0, 0], [0, 85], [90, 85], [90, 170]]);
    const labelId = arrow.boundElements!.find((b) => b.type === "text")!.id;
    const label = ea.getElement(labelId)!;
    expect(label.x + label.width / 2).toBeCloseTo(55);
    expect(label.y + label.height / 2).toBeCloseTo(115);
  });
  it("leaves the arrow alone when either bound end is missing", () => {
    const ea = fakeEA();
    const arrowId = addLineageArrow(ea, [[0, 0], [0, 40]], "missingStart", "missingEnd", "childGid");
    const arrow = ea.getElement(arrowId)!;
    const before = { x: arrow.x, y: arrow.y, points: arrow.points };
    routeLineageArrow(ea, arrow, { get: () => undefined });
    expect(arrow.x).toBe(before.x);
    expect(arrow.y).toBe(before.y);
    expect(arrow.points).toEqual(before.points);
  });
});
