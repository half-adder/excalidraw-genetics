import { describe, expect, it } from "vitest";
import { CROSS_LINE, genotypeAt, glyphOf, isCrossLine, lineEnds, opposite, resolveLine, type LineSteps } from "../../src/commands/cross-mode";
import type { SceneElement } from "../../src/schema";

let n = 0;
const el = (props: Partial<SceneElement>): SceneElement =>
  ({ id: `e${n++}`, type: "text", x: 0, y: 0, width: 10, height: 10, ...props }) as SceneElement;
const part = (gid: string, kind: string, x: number, y: number, w: number, h: number, extra: Partial<SceneElement> = {}): SceneElement =>
  el({ x, y, width: w, height: h, customData: { schemaVersion: 2, genotypeId: gid, kind }, ...extra });
const line = (points: Array<[number, number]>, x = 0, y = 0, style: Partial<SceneElement> = CROSS_LINE): SceneElement =>
  el({ type: "line", x, y, points, ...style });

describe("isCrossLine", () => {
  it("is a live line in the cross-line style only", () => {
    expect(isCrossLine(line([[0, 0], [1, 1]]))).toBe(true);
    expect(isCrossLine(line([[0, 0], [1, 1]], 0, 0, { ...CROSS_LINE, isDeleted: true }))).toBe(false);
    expect(isCrossLine(el({ type: "arrow", points: [[0, 0], [1, 1]], ...CROSS_LINE }))).toBe(false);
    expect(isCrossLine(line([[0, 0], [1, 1]], 0, 0, { ...CROSS_LINE, strokeColor: "#000000" }))).toBe(false);
    expect(isCrossLine(line([[0, 0], [1, 1]], 0, 0, { ...CROSS_LINE, strokeStyle: "solid" }))).toBe(false);
    expect(isCrossLine(line([[0, 0], [1, 1]], 0, 0, { ...CROSS_LINE, opacity: 100 }))).toBe(false);
  });
});

describe("lineEnds", () => {
  it("is the first and last point, in scene coordinates", () => {
    expect(lineEnds(line([[0, 0], [5, 5], [30, -10]], 100, 200))).toEqual({ start: { x: 100, y: 200 }, end: { x: 130, y: 190 } });
  });
});

describe("genotypeAt", () => {
  it("finds a genotype by its frame, edges included", () => {
    const els = [part("A", "genotype-frame", 0, 0, 100, 50), part("A", "genotype-allele", 10, 10, 20, 20)];
    expect(genotypeAt(els, 0, 0)).toBe("A");
    expect(genotypeAt(els, 100, 50)).toBe("A");
    // Outside the frame, the padded box of all its elements (frame included) still holds.
    expect(genotypeAt(els, 108, 25)).toBe("A");
    expect(genotypeAt(els, 109, 25)).toBeNull();
  });
  it("without a frame, finds it in its elements' box padded by 8 px", () => {
    const els = [part("B", "genotype-allele", 0, 0, 20, 20), part("B", "genotype-glyph", 40, 0, 10, 20)];
    expect(genotypeAt(els, 45, 10)).toBe("B");
    expect(genotypeAt(els, 58, 28)).toBe("B");
    expect(genotypeAt(els, 59, 10)).toBeNull();
    expect(genotypeAt(els, -9, 10)).toBeNull();
  });
  it("prefers a frame hit over another genotype's padded box, skips deleted and untagged elements", () => {
    const els = [
      part("B", "genotype-allele", 0, 0, 20, 20),
      part("A", "genotype-frame", 22, 0, 50, 20),
      part("C", "genotype-frame", 200, 0, 50, 50, { isDeleted: true }),
      el({ x: 300, y: 0, width: 50, height: 50 }),
    ];
    expect(genotypeAt(els, 25, 10)).toBe("A");
    expect(genotypeAt(els, 210, 10)).toBeNull();
    expect(genotypeAt(els, 310, 10)).toBeNull();
  });
});

describe("glyphOf and opposite", () => {
  it("reads a genotype's sex glyph (null without one) and presets the opposite sex", () => {
    const els = [part("A", "genotype-glyph", 0, 0, 5, 5, { originalText: "♂", text: "♂" }), part("B", "genotype-allele", 0, 0, 5, 5, { text: "w" })];
    expect(glyphOf(els, "A")).toBe("♂");
    expect(glyphOf(els, "B")).toBeNull();
    expect(opposite("♂")).toBe("♀");
    expect(opposite("♀")).toBe("♂");
    expect(opposite("☿")).toBe("♂");
    expect(opposite(null)).toBeNull();
  });
});

// A scene with genotypes A (♀, at 0..100) and B (♂, at 500..600), and fake
// steps that record what runs.
function steps(created: Array<string | null> = [], crossed: string | null = "X") {
  const els = [
    part("A", "genotype-frame", 0, 0, 100, 50), part("A", "genotype-glyph", 5, 5, 5, 5, { text: "♀" }),
    part("B", "genotype-frame", 500, 0, 100, 50), part("B", "genotype-glyph", 505, 5, 5, 5, { text: "♂" }),
  ];
  const log: string[] = [];
  const s: LineSteps = {
    elements: () => els,
    createAt: async (p, glyph) => {
      const g = created.shift() ?? null;
      log.push(`create ${p.x},${p.y} ${glyph} -> ${g}`);
      // Without a preset, the user picks ♀ in the form.
      if (g) els.push(part(g, "genotype-glyph", p.x, p.y, 5, 5, { text: glyph ?? "♀" }));
      return g;
    },
    cross: async (a, b) => { log.push(`cross ${a} ${b}`); return crossed; },
    stop: (m) => { log.push(`stop ${m}`); },
  };
  return { s, log };
}

describe("resolveLine", () => {
  it("genotype to genotype: crosses the two, then leaves the mode", async () => {
    const { s, log } = steps();
    await resolveLine(line([[50, 25], [550, 25]]), s);
    expect(log).toEqual(["cross A B", "stop Cross mode off (offspring created)."]);
  });
  it("keeps the mode on when the cross is cancelled", async () => {
    const { s, log } = steps([], null);
    await resolveLine(line([[550, 25], [50, 25]]), s);
    expect(log).toEqual(["cross B A"]);
  });
  it("a line within one genotype runs nothing", async () => {
    const { s, log } = steps();
    await resolveLine(line([[10, 10], [90, 40]]), s);
    expect(log).toEqual([]);
  });
  it("genotype to empty space: a new genotype at the end, the other sex, then the cross", async () => {
    const { s, log } = steps(["N"]);
    await resolveLine(line([[50, 25], [50, 900]]), s);
    expect(log).toEqual(["create 50,900 ♂ -> N", "cross A N", "stop Cross mode off (offspring created)."]);
  });
  it("empty space to genotype: a new genotype at the start, the other sex", async () => {
    const { s, log } = steps(["N"]);
    await resolveLine(line([[50, 900], [550, 25]]), s);
    expect(log).toEqual(["create 50,900 ♀ -> N", "cross N B", "stop Cross mode off (offspring created)."]);
  });
  it("empty to empty: the start (no preset), then the end opposite the start, then the cross", async () => {
    const { s, log } = steps(["M", "N"]);
    await resolveLine(line([[0, 0], [0, 400]], 1000, 1000), s);
    expect(log).toEqual(["create 1000,1000 null -> M", "create 1000,1400 ♂ -> N", "cross M N", "stop Cross mode off (offspring created)."]);
  });
  it("a cancelled Genotype form leaves the mode, with no cross", async () => {
    const start = steps([null]);
    await resolveLine(line([[50, 900], [550, 25]]), start.s);
    expect(start.log).toEqual(["create 50,900 ♀ -> null", "stop Cross mode off (cancelled)."]);
    const end = steps(["M", null]);
    await resolveLine(line([[0, 0], [0, 400]], 1000, 1000), end.s);
    expect(end.log).toEqual(["create 1000,1000 null -> M", "create 1000,1400 ♂ -> null", "stop Cross mode off (cancelled)."]);
  });
});
