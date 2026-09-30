import { describe, expect, it } from "vitest";
import { gid, loadFixture, nameOf } from "./helpers/fixtures";
import { boundingBox, collectLineage, computeDepths, lineagePoints, pathMidpoint, selectionSet, snapshotGenotype } from "../../src/scene";

const names = (fx: ReturnType<typeof loadFixture>, ids: Iterable<string>) => [...ids].map((g) => nameOf(fx, g)).sort();

describe("lineage", () => {
  it("collects a whole connected family (joined-families)", () => {
    const fx = loadFixture("joined-families");
    expect(names(fx, collectLineage(gid(fx, "P1"), fx.elements))).toEqual(["A", "B", "C", "D", "E", "F", "P1", "P2", "P3", "Q1", "Q2"]);
  });
  it("places a genotype on the row where it is used (below)", () => {
    const fx = loadFixture("below");
    const lineage = collectLineage(gid(fx, "P1"), fx.elements);
    const d = computeDepths(lineage, fx.elements);
    const byName = Object.fromEntries([...d].map(([g, v]) => [nameOf(fx, g), v]));
    expect(byName).toEqual({ P1: 0, P2: 0, A: 1, B: 1, P3: 1, C: 2, D: 2, P4: 2, E: 3 });
  });
});

describe("selectionSet", () => {
  const fx = loadFixture("below");
  it("below: the genotype, its descendants and their mates", () => {
    expect(names(fx, selectionSet(fx.elements, gid(fx, "C"), "below").genotypeIds)).toEqual(["C", "E", "P4"]);
  });
  it("below: leaves out the arrow into the seed", () => {
    const s = selectionSet(fx.elements, gid(fx, "C"), "below");
    const arrowIntoC = fx.elements.find((e) => e.customData?.kind === "cross-lineage" && e.customData.childGenotypeId === gid(fx, "C"));
    expect(arrowIntoC && s.elements.includes(arrowIntoC)).toBe(false);
  });
  it("lineage: everything connected", () => {
    expect(names(fx, selectionSet(fx.elements, gid(fx, "C"), "lineage").genotypeIds)).toEqual(["A", "B", "C", "D", "E", "P1", "P2", "P3", "P4"]);
  });
});

describe("snapshotGenotype", () => {
  it("reads chromosomes, label and criterion (label-criterion)", () => {
    const fx = loadFixture("label-criterion");
    const lineage = collectLineage(gid(fx, "F"), fx.elements);
    const r = snapshotGenotype(gid(fx, "F"), fx.elements, lineage, false);
    expect(r.notice).toBe(null);
    expect(r.snapshot?.labelText).toBe("F1-a");
    expect(r.snapshot?.criterionText).toBe("non-Cy");
    expect(r.snapshot?.chromosomes.map((c) => c.label)).toEqual(["X", "II", "III"]);
    expect(r.furniture.some((e) => e.customData?.kind === "genotype-frame")).toBe(true);
  });
});

describe("geometry", () => {
  it("routes an elbow or a straight drop", () => {
    expect(lineagePoints(0, 0, 0.2, 100)).toEqual([[0, 0], [0, 100]]);
    expect(lineagePoints(0, 0, 50, 100)).toEqual([[0, 0], [0, 50], [50, 50], [50, 100]]);
  });
  it("finds the middle of a path", () => {
    const arrow = { id: "a", type: "arrow", x: 10, y: 10, width: 50, height: 100, points: [[0, 0], [0, 50], [50, 50], [50, 100]] as Array<[number, number]> };
    expect(pathMidpoint(arrow)).toEqual([35, 60]);
  });
  it("bounds text boxes and lines", () => {
    const t = { id: "t", type: "text", x: 0, y: 0, width: 10, height: 20 };
    const l = { id: "l", type: "line", x: 5, y: 30, width: 40, height: 0, points: [[0, 0], [40, 0]] as Array<[number, number]> };
    expect(boundingBox([t, l])).toEqual({ topX: 0, topY: 0, width: 45, height: 30 });
  });
});
