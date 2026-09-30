import { afterEach, describe, expect, it } from "vitest";
import { alleleTexts, autoPick, centroidX, crossPlacement, glyphOf, parentDrawing, parentsInDrawing } from "../../src/commands/cross-genotypes";
import { LINEAGE_DROP } from "../../src/constants";
import { optionsFor, homologsOf } from "../../src/forms/picker-options";
import type { SceneElement } from "../../src/schema";

let n = 0;
const el = (kind: string, x: number, y: number, w: number, h: number, extra: Partial<SceneElement> = {}, cd: Record<string, unknown> = {}): SceneElement =>
  ({ id: `e${n++}`, type: "text", x, y, width: w, height: h, customData: { schemaVersion: 2, genotypeId: "g", kind, ...cd }, ...extra }) as SceneElement;
const allele = (chromosome: string, side: string, text: string, x = 0, y = 0) =>
  el("genotype-allele", x, y, 10, 20, { originalText: text, text }, { chromosome, side });

describe("centroidX", () => {
  it("is the mean of the element centers, 0 for none", () => {
    expect(centroidX([])).toBe(0);
    expect(centroidX([el("genotype-allele", 0, 0, 10, 5), el("genotype-allele", 20, 0, 30, 5)])).toBe((5 + 35) / 2);
  });
});

describe("glyphOf", () => {
  it("reads the sex glyph's text, null without one", () => {
    expect(glyphOf([allele("X", "single", "w")])).toBeNull();
    expect(glyphOf([allele("X", "single", "w"), el("genotype-glyph", 0, 0, 5, 5, { originalText: "♂", text: "♂" })])).toBe("♂");
  });
});

describe("alleleTexts", () => {
  it("lists the alleles only, trimmed, with chromosome and side", () => {
    expect(alleleTexts([allele("II", "top", " Sp "), el("genotype-separator", 0, 0, 5, 5, { text: ";" })])).toEqual([
      { chromosome: "II", side: "top", text: "Sp" },
    ]);
  });
});

describe("parentDrawing", () => {
  it("uses the fallback glyph and draws chromosomes in order, fractions and bare alleles", () => {
    const d = parentDrawing([allele("III", "top", "TM3"), allele("III", "bottom", "+"), allele("X", "single", "w")], "♀");
    expect(d).toEqual({ glyph: "♀", chroms: [{ single: "w" }, { top: "TM3", bottom: "+" }] });
  });
  it("keeps the parent's own glyph and a lone top or bottom as a bare allele", () => {
    const d = parentDrawing([el("genotype-glyph", 0, 0, 5, 5, { text: "☿" }), allele("II", "bottom", "CyO")], "♀");
    expect(d).toEqual({ glyph: "☿", chroms: [{ single: "CyO" }] });
  });
});

describe("crossPlacement", () => {
  it("centers on the gap between the parents, 2 * LINEAGE_DROP below the lower one", () => {
    const right = [el("genotype-allele", 300, 0, 50, 40)];
    const left = [el("genotype-allele", 0, 20, 100, 60)];
    // Maternal on the right: left/right are by maxX, not by role.
    const p = crossPlacement(right, left);
    expect(p.midX).toBe((100 + 300) / 2);
    expect(p.centerY).toBe(80 + LINEAGE_DROP * 2);
    expect(p.glyphMidY).toBe((20 + 50) / 2);
  });
});

describe("autoPick", () => {
  // The hooks live on window; in Node it is globalThis.
  const hooks = globalThis as unknown as Record<string, unknown>;
  hooks.window ??= globalThis;
  afterEach(() => { hooks._crossGenotypesOptions = undefined; });
  it("fills unpicked chromosomes with 0 and records the options", () => {
    const mat = homologsOf([{ chromosome: "X", side: "top", text: "w" }, { chromosome: "X", side: "bottom", text: "y" }], false);
    const pat = homologsOf([], true);
    const options = optionsFor(mat, pat);
    const r = autoPick({ offspringGlyph: null, pick: { II: 0, X: 2 } }, options);
    expect(r).toEqual({ sex: null, pick: { X: 2, II: 0, III: 0 }, label: "", criterion: "", options });
    expect(hooks._crossGenotypesOptions).toBe(options);
  });
});

describe("parentsInDrawing", () => {
  it("is false when a parent has no live element in the drawing (no placement from an empty box)", () => {
    const els = [
      { ...allele("X", "single", "w"), customData: { schemaVersion: 2, genotypeId: "A", kind: "genotype-allele" } },
      { ...allele("X", "single", "y"), customData: { schemaVersion: 2, genotypeId: "B", kind: "genotype-allele" }, isDeleted: true },
    ] as SceneElement[];
    expect(parentsInDrawing(["A", "A"], els)).toBe(true);
    expect(parentsInDrawing(["A", "B"], els)).toBe(false);
    expect(parentsInDrawing(["A", "C"], els)).toBe(false);
  });
});
