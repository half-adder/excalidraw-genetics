import { describe, expect, it } from "vitest";
import { assignParents, canFlip, flippedOption, homologsOf, offspringChromosomes, optionsFor, sexFromX, xFromSex, type AlleleText } from "../../src/forms/picker-options";

type G = { X: [string, string]; II: [string, string]; III: [string, string] };
const alleles = (g: G): AlleleText[] => (["X", "II", "III"] as const).flatMap((c) => [
  { chromosome: c, side: "top", text: g[c][0] }, { chromosome: c, side: "bottom", text: g[c][1] }]);
const cards = (list: Array<{ top: string; bottom: string; sex?: string }>) => list.map((o) => o.top + "/" + o.bottom + (o.sex ? " " + o.sex : ""));
const options = (m: G, f: G) => optionsFor(homologsOf(alleles(m), false), homologsOf(alleles(f), true));

describe("optionsFor (cross-picker-dedup cases)", () => {
  it("homozygous mother", () => {
    const o = options({ X: ["w", "w"], II: ["+", "+"], III: ["+", "+"] }, { X: ["w", "Y"], II: ["CyO", "Gla"], III: ["MKRS", "TM6B"] });
    expect(cards(o.II)).toEqual(["+/CyO", "+/Gla"]);
    expect(cards(o.III)).toEqual(["+/MKRS", "+/TM6B"]);
    expect(cards(o.X)).toEqual(["w/w female", "w/Y male", "w/w or Y both"]);
  });
  it("homozygous father", () => {
    const o = options({ X: ["w", "+"], II: ["Sp", "CyO"], III: ["+", "+"] }, { X: ["w", "Y"], II: ["Gla", "Gla"], III: ["+", "+"] });
    expect(cards(o.II)).toEqual(["Sp/Gla", "CyO/Gla"]);
    expect(cards(o.III)).toEqual(["+/+"]);
    expect(cards(o.X)).toEqual(["w/w female", "+/w female", "w/Y male", "+/Y male", "w/w or Y both", "+/w or Y both"]);
  });
  it("flipped pairs are one card", () => {
    const o = options({ X: ["w", "w"], II: ["CyO", "+"], III: ["TM3", "+"] }, { X: ["w", "Y"], II: ["CyO", "+"], III: ["+", "TM3"] });
    expect(cards(o.II)).toEqual(["CyO/CyO", "CyO/+", "+/+"]);
    expect(cards(o.III)).toEqual(["TM3/+", "TM3/TM3", "+/+"]);
  });
  it("nothing to merge", () => {
    const o = options({ X: ["w", "y"], II: ["Sp", "CyO"], III: ["+", "+"] }, { X: ["w", "Y"], II: ["Gla", "Bc"], III: ["+", "+"] });
    expect(cards(o.II)).toEqual(["Sp/Gla", "Sp/Bc", "CyO/Gla", "CyO/Bc"]);
  });
  it("father's X both Y falls back to a + placeholder for the female/both pairing", () => {
    const pat = homologsOf(
      [{ chromosome: "X", side: "top", text: "Y" }, { chromosome: "X", side: "bottom", text: "Y" }],
      true,
    );
    expect(pat.X).toEqual(["Y", "Y"]);
    const mat = homologsOf(alleles({ X: ["w", "w"], II: ["+", "+"], III: ["+", "+"] }), false);
    const o = optionsFor(mat, pat);
    expect(cards(o.X)).toEqual(["w/+ female", "w/Y male", "w/+ or Y both"]);
  });
});

describe("homologsOf", () => {
  it("fills missing chromosomes and a bare father X", () => {
    const h = homologsOf([{ chromosome: "X", side: "single", text: "w" }], true);
    expect(h.X).toEqual(["w", "Y"]);
    expect(h.II).toEqual(["+", "+"]);
    expect([...h.present]).toEqual(["X"]);
  });
  it("father X entirely absent from the allele list is +/Y, mother X is +/+", () => {
    const alleles: AlleleText[] = [{ chromosome: "II", side: "single", text: "CyO" }];
    expect(homologsOf(alleles, true).X).toEqual(["+", "Y"]);
    expect(homologsOf(alleles, false).X).toEqual(["+", "+"]);
  });
  it("a single (bare) allele doubles on an autosome and on the mother's X", () => {
    const alleles: AlleleText[] = [
      { chromosome: "X", side: "single", text: "w" },
      { chromosome: "II", side: "single", text: "CyO" },
    ];
    const h = homologsOf(alleles, false);
    expect(h.X).toEqual(["w", "w"]);
    expect(h.II).toEqual(["CyO", "CyO"]);
  });
  it("single takes precedence over a stray top when both are present", () => {
    const alleles: AlleleText[] = [
      { chromosome: "II", side: "single", text: "CyO" },
      { chromosome: "II", side: "top", text: "Bogus" },
    ];
    expect(homologsOf(alleles, false).II).toEqual(["CyO", "CyO"]);
  });
  it("a lone top (no single, no bottom) doubles like a bare allele", () => {
    const alleles: AlleleText[] = [{ chromosome: "II", side: "top", text: "Sp" }];
    expect(homologsOf(alleles, false).II).toEqual(["Sp", "Sp"]);
  });
});

describe("flip and sex rules", () => {
  const o = options({ X: ["w", "y"], II: ["Sp", "CyO"], III: ["TM3", "+"] }, { X: ["w", "Y"], II: ["Gla", "Gla"], III: ["+", "TM6B"] });
  it("never flips an X card carrying a Y", () => {
    expect(o.X.map(canFlip)).toEqual(o.X.map((c) => c.sex === "female"));
    expect(canFlip(o.II[0])).toBe(true);
  });
  it("flippedOption swaps top/bottom only when flagged", () => {
    expect(flippedOption(o, { X: {}, II: {}, III: {} }, "II", 0)).toEqual(o.II[0]);
    expect(flippedOption(o, { X: {}, II: { 0: true }, III: {} }, "II", 0)).toEqual({ ...o.II[0], top: o.II[0].bottom, bottom: o.II[0].top });
  });
  it("sex follows the X card, keeping a virgin female", () => {
    const son = o.X.findIndex((c) => c.sex === "male");
    const both = o.X.findIndex((c) => c.sex === "both");
    expect(sexFromX(o, son, null)).toBe("♂");
    expect(sexFromX(o, both, null)).toBe("⚥");
    expect(sexFromX(o, 0, "☿")).toBe("☿");
    expect(sexFromX(o, 0, "♂")).toBe("♀");
    expect(xFromSex(o, 0, "♂")).toBe(son);
    expect(xFromSex(o, 0, "♀")).toBe(0);
    expect(xFromSex(o, both, "☿")).toBe(0);
    expect(xFromSex(o, 0, "⚥")).toBe(both);
  });
  it("applies flips to the offspring, all three chromosomes (cross-picker-flip.sh)", () => {
    const h = [homologsOf(alleles({ X: ["w", "y"], II: ["Sp", "CyO"], III: ["TM3", "+"] }), false), homologsOf(alleles({ X: ["w", "Y"], II: ["Gla", "Gla"], III: ["+", "TM6B"] }), true)] as const;
    const got = offspringChromosomes(o, { X: 1, II: 0, III: 0 }, { X: { 1: true }, II: { 0: true }, III: { 0: true } }, h[0], h[1]);
    expect(got).toEqual([
      { label: "X", kind: "het", alleles: { top: "w", bottom: "y" } },
      { label: "II", kind: "het", alleles: { top: "Gla", bottom: "Sp" } },
      { label: "III", kind: "het", alleles: { top: "+", bottom: "TM3" } },
    ]);
  });
  it("reports a missing option instead of throwing", () => {
    const h0 = homologsOf(alleles({ X: ["w", "y"], II: ["Sp", "CyO"], III: ["TM3", "+"] }), false);
    const h1 = homologsOf(alleles({ X: ["w", "Y"], II: ["Gla", "Gla"], III: ["+", "TM6B"] }), true);
    const got = offspringChromosomes(o, { X: 0, II: 5, III: 0 }, undefined, h0, h1);
    expect(got).toEqual({ missing: "II", index: 5 });
  });
  it("carries chromosome IV through untouched when either parent has it", () => {
    const matAlleles: AlleleText[] = [
      ...alleles({ X: ["w", "y"], II: ["Sp", "CyO"], III: ["TM3", "+"] }),
      { chromosome: "IV", side: "single", text: "+" },
    ];
    const h0 = homologsOf(matAlleles, false);
    const h1 = homologsOf(alleles({ X: ["w", "Y"], II: ["Gla", "Gla"], III: ["+", "TM6B"] }), true);
    const got = offspringChromosomes(o, { X: 0, II: 0, III: 0 }, undefined, h0, h1);
    expect(Array.isArray(got)).toBe(true);
    expect((got as Array<{ label: string }>).at(-1)).toEqual({ label: "IV", kind: "het", alleles: { top: "+", bottom: "+" } });
  });
});

describe("assignParents", () => {
  it("uses glyphs, then left to right", () => {
    expect(assignParents({ id: "a", glyph: "♂", centroidX: 0 }, { id: "b", glyph: "♀", centroidX: 9 })).toEqual({ maternalId: "b", paternalId: "a" });
    expect(assignParents({ id: "a", glyph: null, centroidX: 9 }, { id: "b", glyph: null, centroidX: 0 })).toEqual({ maternalId: "b", paternalId: "a" });
  });
  // Each case below sets centroidX so that the leftmost-fallback would pick
  // the wrong parent, so only the single-glyph branch (not the centroid
  // fallback) can make it pass.
  it("a lone virgin-female glyph (☿) wins maternal against no glyph", () => {
    expect(assignParents({ id: "a", glyph: "☿", centroidX: 9 }, { id: "b", glyph: null, centroidX: 0 })).toEqual({ maternalId: "a", paternalId: "b" });
  });
  it("a lone male glyph wins paternal against no glyph", () => {
    expect(assignParents({ id: "a", glyph: "♂", centroidX: 0 }, { id: "b", glyph: null, centroidX: 9 })).toEqual({ maternalId: "b", paternalId: "a" });
  });
  it("a lone female glyph on the second parent wins maternal regardless of position", () => {
    expect(assignParents({ id: "a", glyph: null, centroidX: 0 }, { id: "b", glyph: "♀", centroidX: 9 })).toEqual({ maternalId: "b", paternalId: "a" });
  });
});
