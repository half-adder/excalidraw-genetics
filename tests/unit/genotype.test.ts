import { describe, expect, it } from "vitest";
import { chromosomesOf, emptyGenotypeState, findFreeSpot } from "../../src/commands/genotype";

const state = (s: Partial<Record<"X" | "II" | "III" | "IV", [string, string]>>) => {
  const st = emptyGenotypeState();
  for (const [k, [top, bottom]] of Object.entries(s)) st[k as "X"] = { top, bottom };
  return st;
};

describe("chromosomesOf", () => {
  it("draws nothing for an entirely empty form (the delete case)", () => {
    expect(chromosomesOf(emptyGenotypeState())).toEqual([]);
  });
  it("draws an empty X, II or III as +/+ once any allele is filled; IV only when filled", () => {
    expect(chromosomesOf(state({ X: ["w", ""], III: [" MKRS ", "TM6B"] }))).toEqual([
      { label: "X", kind: "single", alleles: { single: "w" } },
      { label: "II", kind: "het", alleles: { top: "+", bottom: "+" } },
      { label: "III", kind: "het", alleles: { top: "MKRS", bottom: "TM6B" } },
    ]);
  });
  it("a bottom-only homolog is a bare allele; a filled IV is drawn", () => {
    expect(chromosomesOf(state({ X: ["", "y"], IV: ["ey", ""] })).map((c) => [c.label, c.kind, JSON.stringify(c.alleles)])).toEqual([
      ["X", "single", '{"single":"y"}'],
      ["II", "het", '{"top":"+","bottom":"+"}'],
      ["III", "het", '{"top":"+","bottom":"+"}'],
      ["IV", "single", '{"single":"ey"}'],
    ]);
  });
});

describe("findFreeSpot", () => {
  it("centers on the point when nothing is in the way", () => {
    expect(findFreeSpot([], 100, 50, 40, 10)).toEqual({ left: 80, midlineY: 50 });
  });
  it("moves to the nearest grid spot that clears a box by the margin", () => {
    // w 40, halfH 10: steps sx = 30, sy = 40. A box over the center blocks
    // it and the ring around it; the nearest free candidate wins.
    const spot = findFreeSpot([{ topX: 60, topY: 30, width: 40, height: 40 }], 100, 50, 40, 10);
    const clear = (l: number, t: number) => !(l < 120 && l + 60 > 60 && t < 90 && t + 40 > 30);
    expect(clear(spot.left, spot.midlineY - 10)).toBe(true);
    expect(Math.hypot(spot.left - 80, spot.midlineY - 50)).toBe(60);
  });
  it("falls back to the point when no candidate is free", () => {
    expect(findFreeSpot([{ topX: -1e6, topY: -1e6, width: 2e6, height: 2e6 }], 0, 0, 40, 10)).toEqual({ left: -20, midlineY: 0 });
  });
});
