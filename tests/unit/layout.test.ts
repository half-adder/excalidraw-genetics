import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { layoutInputFromScenes } from "./helpers/layout-input";
import type { SceneElement } from "../../src/schema";
import { boundLineagePoints, childArrowPoints, clearingShift, collectCrossPairs, layoutLineage, layoutUnit, lineageBoxes, linearize, resolveRow, segmentBoxes, type LayoutInput, type LayoutNode, type LayoutResult, type RowContext, type RowUnit } from "../../src/layout";
import { boundingBox, computeDepths } from "../../src/scene";
import { FRAME_GAP, FRAME_PAD, GENERATION_GAP_Y, GLYPH_PAD } from "../../src/constants";

const GOLDEN = ["below", "joined-families", "three-partners", "sibling-chain", "sibling-cross", "sibling-order", "select-move", "label-criterion"];

// Each fixture as the scripts built it (already tidy), and with its genotypes
// first moved by fixed offsets (`-moved`). sibling-order is also captured with
// its two offspring's x swapped. Every golden keeps the scene Tidy started
// from as `before`, so it does not depend on the fixtures as rebuilt since.
const CASES = [...GOLDEN.flatMap((name) => [name, `${name}-moved`]), "sibling-order-swapped"];

describe.each(CASES)("layoutLineage reproduces the Tidy script: %s", (name) => {
  const golden = JSON.parse(readFileSync(join(__dirname, "golden", `tidy-${name}.json`), "utf8"));
  const before = golden.before;
  const { input, expected } = layoutInputFromScenes(before, golden.elements);
  const out = layoutLineage(input);
  it("checks every genotype and x glyph Tidy drew", () => {
    const drawn = new Set(golden.elements.map((e: SceneElement) => e.customData?.genotypeId).filter(Boolean));
    expect(expected.centers.size).toBe(drawn.size);
    expect(expected.glyphX.size).toBe(golden.elements.filter((e: SceneElement) => e.customData?.kind === "cross-glyph").length);
  });
  it("places every genotype where Tidy did (0.5 px)", () => {
    for (const [gid, c] of expected.centers) {
      const got = out.centers.get(gid);
      expect(got, gid).toBeDefined();
      expect(Math.abs(got!.x - c.x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(got!.y - c.y)).toBeLessThanOrEqual(0.5);
    }
  });
  it("places every x glyph where Tidy did (0.5 px)", () => {
    for (const [key, x] of expected.glyphX) expect(Math.abs((out.glyphX.get(key) ?? NaN) - x), key).toBeLessThanOrEqual(0.5);
  });
});

describe("childArrowPoints", () => {
  const rows = { sortedDepths: [0, 1, 2], rowTop: new Map([[0, 0], [1, 150], [2, 300]]), rowBottom: new Map([[0, 50], [1, 200], [2, 350]]) };
  it("uses a plain elbow into the next row", () => {
    expect(childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 100, y: 146, depth: 1 }, rows, [])).toEqual([[0, 40], [0, 93], [100, 93], [100, 146]]);
  });
  it("takes a clear lane past the rows in between", () => {
    const pts = childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 100, y: 296, depth: 2 }, rows, [{ depth: 1, left: -20, right: 20 }]);
    expect(pts).toEqual([[0, 40], [0, 100], [46, 100], [46, 250], [100, 250], [100, 296]]);
  });
});

describe("clearingShift", () => {
  it("does not move a clear lineage and moves an overlapping one the least", () => {
    expect(clearingShift([{ x: 0, y: 0, w: 10, h: 10 }], [{ x: 200, y: 0, w: 10, h: 10 }])).toBe(0);
    expect(clearingShift([{ x: 0, y: 0, w: 10, h: 10 }], [{ x: 5, y: 0, w: 10, h: 10 }])).toBe(-57);
  });
});

// ---- Rule-level tests: the layout's decision points on small inputs --------

const W = 40, H = 30, CROSS_W = 10;
const node = (gid: string, ox: number, oy: number, parents: [string, string] | null = null, opts: Partial<LayoutNode> = {}): LayoutNode => {
  const width = opts.width ?? W;
  return {
    gid, parents: parents && { maternal: parents[0], paternal: parents[1] }, width, height: opts.height ?? H,
    half: width / 2 + FRAME_PAD, originalCenter: { x: ox, y: oy }, boundary: false, ...opts,
  };
};
// Crosses from the nodes' parents, as collectCrossPairs finds them.
const input = (nodes: LayoutNode[], depths: Record<string, number>, subset = false): LayoutInput => ({
  nodes, depths: new Map(Object.entries(depths)), crossPairs: collectCrossPairs(nodes, []), crossW: CROSS_W, subset,
});
const cx = (out: LayoutResult, g: string) => out.centers.get(g)!.x;
const cy = (out: LayoutResult, g: string) => out.centers.get(g)!.y;
const ctxOf = (ox: Record<string, number>): RowContext => ({ half: () => W / 2 + FRAME_PAD, ox: (g) => ox[g], crossW: CROSS_W });
const adjOf = (crosses: Array<[string, string]>) => {
  const adj = new Map<string, Set<string>>();
  for (const [m, p] of crosses) {
    if (!adj.has(m)) adj.set(m, new Set());
    if (!adj.has(p)) adj.set(p, new Set());
    adj.get(m)!.add(p); adj.get(p)!.add(m);
  }
  return adj;
};

describe("layout rules: sibling order", () => {
  // Two offspring of one cross want the same spot under its x; their
  // pre-Tidy x decides the order (not their ids).
  const family = (oxA: number, oxB: number) => layoutLineage(input(
    [node("P", 0, 0), node("Q", 100, 0), node("A", oxA, 200, ["P", "Q"]), node("B", oxB, 200, ["P", "Q"])],
    { P: 0, Q: 0, A: 1, B: 1 },
  ));
  it("keeps the offspring in their pre-Tidy left-to-right order", () => {
    const out = family(300, 100);
    expect(cx(out, "B")).toBeLessThan(cx(out, "A"));
    const swapped = family(100, 300);
    expect(cx(swapped, "A")).toBeLessThan(cx(swapped, "B"));
  });
});

describe("layout rules: crossed genotypes sit side by side", () => {
  it("a single cross: maternal left, paternal right, one frame gap apart, whatever their pre-Tidy order", () => {
    const out = layoutLineage(input([node("P", 500, 0), node("Q", 0, 0), node("A", 250, 200, ["P", "Q"])], { P: 0, Q: 0, A: 1 }));
    expect(cx(out, "P")).toBeLessThan(cx(out, "Q"));
    expect(cx(out, "Q") - cx(out, "P")).toBeCloseTo(2 * (W / 2 + FRAME_PAD) + FRAME_GAP, 9);
    expect(out.unitOf.get("P")).toEqual(["P", "Q"]);
  });
  it("two parents from different families go on the side of their own parents, whichever is maternal", () => {
    // P1 x P2 -> Z (left family), Q1 x Q2 -> B (right family); B (maternal) x Z -> C.
    // (Z sorts after B, so neither id order nor maternal-left puts Z left.)
    const out = layoutLineage(input(
      [node("P1", 0, 0), node("P2", 100, 0), node("Q1", 400, 0), node("Q2", 500, 0),
       node("Z", 50, 200, ["P1", "P2"]), node("B", 450, 200, ["Q1", "Q2"]), node("C", 250, 400, ["B", "Z"])],
      { P1: 0, P2: 0, Q1: 0, Q2: 0, Z: 1, B: 1, C: 2 },
    ));
    expect(cx(out, "Z")).toBeLessThan(cx(out, "B"));
    expect(out.unitOf.get("Z")).toEqual(["Z", "B"]);
  });
  it("a chain: in chain order, the end that was further left on the left", () => {
    const crosses: Array<[string, string]> = [["A", "B"], ["B", "C"]];
    const ox = { A: 200, B: 100, C: 0 };
    expect(linearize(["A", "B", "C"], adjOf(crosses), crosses, () => null, ctxOf(ox))).toEqual(["C", "B", "A"]);
  });
  it("a hub keeps at least one partner on each side", () => {
    const crosses: Array<[string, string]> = [["H", "X"], ["H", "Y"], ["H", "Z"]];
    const ox = { H: 0, X: 100, Y: 200, Z: 300 };
    expect(linearize(["H", "X", "Y", "Z"], adjOf(crosses), crosses, () => null, ctxOf(ox))).toEqual(["X", "H", "Y", "Z"]);
  });
});

describe("layout rules: rows from depths", () => {
  it("stacks rows GENERATION_GAP_Y apart by their tallest genotype, one y per row", () => {
    const out = layoutLineage(input(
      [node("P", 0, 0), node("Q", 100, 0), node("A", 0, 200, ["P", "Q"], { height: 50 }), node("B", 100, 200, ["P", "Q"]), node("C", 0, 400, ["A", "B"])],
      { P: 0, Q: 0, A: 1, B: 1, C: 2 },
    ));
    expect(cy(out, "P")).toBe(cy(out, "Q"));
    expect(cy(out, "A")).toBe(cy(out, "B"));
    expect(cy(out, "A") - cy(out, "P")).toBeCloseTo(H / 2 + GENERATION_GAP_Y + 50 / 2, 9);
    expect(cy(out, "C") - cy(out, "A")).toBeCloseTo(50 / 2 + GENERATION_GAP_Y + H / 2, 9);
    expect(out.rows.sortedDepths).toEqual([0, 1, 2]);
    expect(out.rows.rowBottom.get(1)! - out.rows.rowTop.get(1)!).toBeCloseTo(50, 9);
  });
  it("a stock crossed into a later generation sits on its partner's row (co-parent row)", () => {
    // P x Q -> F; S (a stock, no parents) x F -> G.
    const el = (g: string, parents?: [string, string]): SceneElement => ({
      id: "e" + g, type: "text", x: 0, y: 0, width: 10, height: 10,
      customData: { genotypeId: g, kind: "genotype-allele", ...(parents ? { parents: { maternal: parents[0], paternal: parents[1] } } : {}) },
    });
    const scene = [el("P"), el("Q"), el("S"), el("F", ["P", "Q"]), el("G", ["S", "F"])];
    const depths = computeDepths(new Set(["P", "Q", "S", "F", "G"]), scene);
    const nodes = [node("P", 0, 0), node("Q", 100, 0), node("S", -100, 0), node("F", 50, 200, ["P", "Q"]), node("G", 0, 400, ["S", "F"])];
    const out = layoutLineage({ nodes, depths, crossPairs: collectCrossPairs(nodes, []), crossW: CROSS_W, subset: false });
    expect(cy(out, "S")).toBe(cy(out, "F"));
    expect(cy(out, "S")).toBeGreaterThan(cy(out, "P"));
  });
});

describe("layout rules: x glyph between its parents", () => {
  it("centers the x in the gap between neighboring parents' frames", () => {
    const out = layoutLineage(input([node("P", 0, 0), node("Q", 100, 0), node("A", 50, 200, ["P", "Q"])], { P: 0, Q: 0, A: 1 }));
    const half = W / 2 + FRAME_PAD;
    const gx = out.glyphX.get("P|Q")!;
    expect(gx).toBeCloseTo((cx(out, "P") + half + cx(out, "Q") - half) / 2, 9);
    expect(cx(out, "A")).toBeCloseTo(gx, 9);
  });
  it("puts a hub's non-neighbor cross beside the partner with fewer crosses, facing the hub", () => {
    const crosses: Array<[string, string]> = [["H", "X"], ["H", "Y"], ["H", "Z"]];
    const adj = adjOf(crosses);
    const u = layoutUnit(["X", "H", "Y", "Z"], adj, crosses, ctxOf({}));
    const half = W / 2 + FRAME_PAD;
    // Z's frame starts after three frames and three gaps (H x Z sits in the last).
    const zLeft = 3 * 2 * half + 3 * FRAME_GAP;
    expect(u.glyphOff.get("H|Z")).toBeCloseTo(zLeft - GLYPH_PAD - CROSS_W / 2, 9);
  });
});

describe("layout rules: no overlap", () => {
  it("pushes apart offspring that want overlapping spots, exactly one frame gap apart", () => {
    const wide = { width: 300 };
    const out = layoutLineage(input(
      [node("P", 0, 0), node("Q", 100, 0), node("R", 200, 0), node("T", 300, 0),
       node("A", 50, 200, ["P", "Q"], wide), node("B", 250, 200, ["R", "T"], wide)],
      { P: 0, Q: 0, R: 0, T: 0, A: 1, B: 1 },
    ));
    expect(cx(out, "B") - cx(out, "A")).toBeCloseTo(2 * (300 / 2 + FRAME_PAD) + FRAME_GAP, 9);
    // Least displacement: the pair stays centered on its two x glyphs.
    expect((cx(out, "A") + cx(out, "B")) / 2).toBeCloseTo((out.glyphX.get("P|Q")! + out.glyphX.get("R|T")!) / 2, 9);
  });
  it("does not keep a genotype clear of its own cross's x", () => {
    const frame = { x: 0, y: 0, w: 40, h: 30, gid: "A" };
    const glyph = { x: 45, y: 5, w: 10, h: 20, parents: ["A", "B"] };
    expect(clearingShift([frame], [glyph])).toBe(0);
    expect(clearingShift([frame], [{ ...glyph, parents: ["C", "B"] }])).not.toBe(0);
  });
});

describe("layout rules: the lineage moves as little as possible", () => {
  const nodes = () => [node("P", 0, 0), node("Q", 100, 0), node("A", 50, 200, ["P", "Q"])];
  const depths = { P: 0, Q: 0, A: 1 };
  it("reproduces a tidy lineage, and brings back one dragged genotype without moving the rest", () => {
    const first = layoutLineage(input(nodes(), depths));
    const tidy = nodes().map((n) => ({ ...n, originalCenter: first.centers.get(n.gid)! }));
    const again = layoutLineage(input(tidy, depths));
    for (const n of tidy) expect(again.centers.get(n.gid)).toEqual(n.originalCenter);
    const dragged = tidy.map((n) => n.gid === "A" ? { ...n, originalCenter: { x: n.originalCenter.x + 400, y: n.originalCenter.y + 90 } } : n);
    const back = layoutLineage(input(dragged, depths));
    for (const n of tidy) expect(back.centers.get(n.gid)).toEqual(n.originalCenter);
  });
  it("subset mode: anchors on the boundary genotypes of the top row, which do not move", () => {
    const sub = [node("A", 0, 0, ["X", "Y"], { boundary: true }), node("M", 300, 0), node("C", 100, 200, ["A", "M"])];
    const out = layoutLineage(input(sub, { A: 0, M: 0, C: 1 }, true));
    expect(out.anchors).toEqual(["A"]);
    expect(out.centers.get("A")).toEqual({ x: 0, y: 0 });
  });
});

describe("layout rules: arrow routes", () => {
  const rows = { sortedDepths: [0, 1, 2], rowTop: new Map([[0, 0], [1, 150], [2, 300]]), rowBottom: new Map([[0, 50], [1, 200], [2, 350]]) };
  it("drops straight into a child right under the x", () => {
    expect(childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 0.2, y: 146, depth: 1 }, rows, [])).toEqual([[0, 40], [0, 146]]);
  });
  it("takes the straight lane past clear rows, merging straight-through corners", () => {
    const pts = childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 100, y: 296, depth: 2 }, rows, [{ depth: 1, left: 300, right: 400 }]);
    expect(pts).toEqual([[0, 40], [0, 250], [100, 250], [100, 296]]);
  });
  it("ignores obstacles outside the rows in between", () => {
    const pts = childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 100, y: 296, depth: 2 }, rows, [{ depth: 2, left: -20, right: 20 }]);
    expect(pts).toEqual([[0, 40], [0, 250], [100, 250], [100, 296]]);
  });
});

describe("layout rules: boxes a lineage occupies", () => {
  const glyph: SceneElement = { id: "g", type: "text", x: 40, y: 0, width: 10, height: 20, customData: { kind: "cross-glyph", parents: { maternal: "P", paternal: "Q" } } };
  const frame: SceneElement = { id: "f", type: "rectangle", x: 100, y: 100, width: 40, height: 30, customData: { kind: "genotype-frame", genotypeId: "A" } };
  const arrow: SceneElement = { id: "a", type: "arrow", x: 0, y: 0, width: 0, height: 0, startBinding: { elementId: "g" }, endBinding: { elementId: "f" }, customData: { kind: "cross-lineage", childGenotypeId: "A" } };
  const lookup = new Map([glyph, frame, arrow].map((e) => [e.id, e]));
  it("lineageBoxes: frames, x glyphs, and an arrow's span between its bound ends", () => {
    expect(lineageBoxes([glyph, frame, arrow])).toEqual([
      { x: 40, y: 0, w: 10, h: 20 }, { x: 100, y: 100, w: 40, h: 30 }, { x: 45, y: 20, w: 75, h: 80 },
    ]);
  });
  it("segmentBoxes: an arrow is its elbow segments, the first one carrying the cross's parents", () => {
    expect(segmentBoxes([arrow], lookup)).toEqual([
      { x: 45, y: 20, w: 0, h: 40, parents: ["P", "Q"] }, { x: 45, y: 60, w: 75, h: 0 }, { x: 120, y: 60, w: 0, h: 40 },
    ]);
    expect(segmentBoxes([frame, glyph], lookup).map((b) => b.gid ?? b.parents)).toEqual(["A", ["P", "Q"]]);
  });
  it("boundLineagePoints: null when an end is missing", () => {
    expect(boundLineagePoints(arrow, new Map([["g", glyph]]))).toBe(null);
  });
});

// ---- Review fixes: rules the first tests did not pin down ------------------

describe("layout rules (review): row order and units", () => {
  it("orders a row's units by desired center before pre-Tidy x: each child goes under its own family", () => {
    // P x Q -> A, R x T -> C; A was dragged far right and C far left.
    const out = layoutLineage(input(
      [node("P", 0, 0), node("Q", 100, 0), node("R", 200, 0), node("T", 300, 0),
       node("A", 400, 200, ["P", "Q"]), node("C", -100, 200, ["R", "T"])],
      { P: 0, Q: 0, R: 0, T: 0, A: 1, C: 1 },
    ));
    expect(cx(out, "A")).toBeCloseTo(out.glyphX.get("P|Q")!, 9);
    expect(cx(out, "C")).toBeCloseTo(out.glyphX.get("R|T")!, 9);
    expect(cx(out, "A")).toBeLessThan(cx(out, "C"));
  });
  it("keeps units whose desired spots are just inside the 0.01 px tolerance where they want to be", () => {
    const unit = (id: string, left: number): RowUnit => ({ seq: [id], offsets: new Map([[id, 5]]), glyphOff: new Map(), width: 10, anchored: false, weight: 0, left, key: left + 5, oxKey: left });
    const units = [unit("a", 0), unit("b", 10 + FRAME_GAP - 0.005)];
    resolveRow(units, false);
    expect(units[1].left - units[0].left).toBeCloseTo(10 + FRAME_GAP - 0.005, 9);
  });
  it("ignores a genotype crossed with itself when building row units", () => {
    const out = layoutLineage(input([node("P", 0, 0), node("Q", 200, 0), node("A", 0, 200, ["P", "P"])], { P: 0, Q: 0, A: 1 }));
    expect(out.unitOf.get("P")).toEqual(["P"]);
    expect(out.glyphX.get("P|P")).toBeCloseTo(cx(out, "P"), 9);
  });
});

describe("layout rules (review): linearize", () => {
  it("puts a genotype hanging off a left partner on the far left, whatever its pre-Tidy x", () => {
    const crosses: Array<[string, string]> = [["H", "X"], ["H", "Y"], ["H", "Z"], ["X", "O"]];
    const ox = { H: 0, X: -100, Y: 100, Z: 200, O: 300 };
    expect(linearize(["H", "X", "Y", "Z", "O"], adjOf(crosses), crosses, () => null, ctxOf(ox))).toEqual(["O", "X", "H", "Y", "Z"]);
  });
  it("breaks a tie for the hub by genotype id", () => {
    // A and B both have three crosses; A is the hub.
    const crosses: Array<[string, string]> = [["A", "B"], ["A", "C"], ["A", "D"], ["B", "E"], ["B", "F"]];
    const ox = { A: 0, B: -100, C: 100, D: 200, E: 300, F: 400 };
    expect(linearize(["A", "B", "C", "D", "E", "F"], adjOf(crosses), crosses, () => null, ctxOf(ox))).toEqual(["E", "F", "B", "A", "C", "D"]);
  });
  it("puts a partner at exactly the hub's pre-Tidy x on the right", () => {
    const crosses: Array<[string, string]> = [["H", "X"], ["H", "Y"], ["H", "Z"]];
    const ox = { H: 0, X: 0, Y: -100, Z: 100 };
    expect(linearize(["H", "X", "Y", "Z"], adjOf(crosses), crosses, () => null, ctxOf(ox))).toEqual(["Y", "H", "X", "Z"]);
  });
});

describe("layout rules (review): x glyphs in a unit", () => {
  const half = W / 2 + FRAME_PAD;
  it("puts a non-neighbor cross between genotypes with equally many crosses beside the right one", () => {
    const crosses: Array<[string, string]> = [["X", "Z"]];
    const adj = adjOf(crosses);
    adj.set("Y", new Set());
    const u = layoutUnit(["X", "Y", "Z"], adj, crosses, ctxOf({}));
    const zLeft = 2 * 2 * half + 2 * FRAME_GAP;
    expect(u.glyphOff.get("X|Z")).toBeCloseTo(zLeft - GLYPH_PAD - CROSS_W / 2, 9);
  });
  it("stacks two right-side x glyphs in one gap leftward from the right genotype", () => {
    const crosses: Array<[string, string]> = [["A", "B"], ["A", "D"], ["B", "D"]];
    const adj = adjOf(crosses);
    adj.set("C", new Set());
    const u = layoutUnit(["A", "B", "C", "D"], adj, crosses, ctxOf({}));
    const dLeft = 3 * 2 * half + 3 * FRAME_GAP;
    expect(u.glyphOff.get("A|D")).toBeCloseTo(dLeft - GLYPH_PAD - CROSS_W / 2, 9);
    expect(u.glyphOff.get("B|D")).toBeCloseTo(dLeft - GLYPH_PAD - CROSS_W / 2 - (CROSS_W + GLYPH_PAD), 9);
  });
  it("puts the x of parents on different rows in the middle of the gap between their frames", () => {
    // S (a stock kept on row 0 here) x F (row 1) -> G.
    const out = layoutLineage(input(
      [node("P", 0, 0), node("Q", 100, 0), node("S", 300, 0), node("F", 50, 200, ["P", "Q"]), node("G", 200, 400, ["S", "F"])],
      { P: 0, Q: 0, S: 0, F: 1, G: 2 },
    ));
    const [l, r] = cx(out, "F") <= cx(out, "S") ? ["F", "S"] : ["S", "F"];
    const gx = out.glyphX.get("S|F");
    expect(gx).toBeDefined();
    expect(gx!).toBeCloseTo((cx(out, l) + half + cx(out, r) - half) / 2, 9);
    expect(cx(out, "G")).toBeCloseTo(gx!, 9);
  });
});

describe("layout rules (review): subset anchors", () => {
  it("with no boundary genotype, anchors on the whole top row", () => {
    const out = layoutLineage(input([node("A", 0, 0), node("B", 300, 0), node("C", 100, 200, ["A", "B"])], { A: 0, B: 0, C: 1 }, true));
    expect(out.anchors).toEqual(["A", "B"]);
  });
});

describe("layout rules (review): arrow lanes", () => {
  const rows = { sortedDepths: [0, 1, 2], rowTop: new Map([[0, 0], [1, 150], [2, 300]]), rowBottom: new Map([[0, 50], [1, 200], [2, 350]]) };
  const lane = (pts: Array<[number, number]>) => pts[2][0];
  it("keeps a lane FRAME_GAP / 4 clear of obstacles", () => {
    // x = 0 is outside the obstacle but within the margin.
    const pts = childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 0, y: 296, depth: 2 }, rows, [{ depth: 1, left: 5, right: 50 }]);
    expect(lane(pts)).toBe(5 - FRAME_GAP / 2);
  });
  it("takes the middle of a gap between obstacles", () => {
    const pts = childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 100, y: 296, depth: 2 }, rows,
      [{ depth: 1, left: -100, right: -10 }, { depth: 1, left: 110, right: 200 }]);
    expect(lane(pts)).toBe(50);
  });
  it("ends the lane FRAME_PAD above a child whose label raises its frame top", () => {
    const pts = childArrowPoints({ x: 0, y: 40, depth: 0 }, { x: 100, y: 240, depth: 2 }, rows, [{ depth: 1, left: -20, right: 20 }]);
    expect(pts[3][1]).toBe(240 - FRAME_PAD);
  });
});

describe("clearance (review)", () => {
  it("breaks an equal-size tie rightward", () => {
    expect(clearingShift([{ x: 0, y: 0, w: 10, h: 10 }], [{ x: 0, y: 0, w: 10, h: 10 }])).toBe(10 + FRAME_GAP);
  });
  it("keeps clear of boxes less than 2 * FRAME_PAD apart vertically", () => {
    expect(clearingShift([{ x: 0, y: 0, w: 10, h: 10 }], [{ x: 0, y: 15, w: 10, h: 10 }])).not.toBe(0);
    expect(clearingShift([{ x: 0, y: 0, w: 10, h: 10 }], [{ x: 0, y: 19, w: 10, h: 10 }])).toBe(0);
  });
});

describe("layout rules (review): tolerances and unanchored units", () => {
  it("counts a shift within 0.5 px of clearing as clear", () => {
    expect(clearingShift([{ x: 0, y: 0, w: 10, h: 10 }], [{ x: 10 + FRAME_GAP - 0.3, y: 0, w: 10, h: 10 }])).toBe(0);
  });
  it("centers a unit with no anchored genotype on its members' mean pre-Tidy x", () => {
    // P x Q -> A; X x Y (no parents, kept on row 1 here) -> Z. X and Y were spread apart.
    const out = layoutLineage(input(
      [node("P", 0, 0), node("Q", 100, 0), node("A", 50, 200, ["P", "Q"]),
       node("X", 1000, 200), node("Y", 1300, 200), node("Z", 1150, 400, ["X", "Y"])],
      { P: 0, Q: 0, A: 1, X: 1, Y: 1, Z: 2 },
    ));
    // Relative to A (under P x Q, which did not move), the unit sits where X and Y were on average.
    expect((cx(out, "X") + cx(out, "Y")) / 2 - cx(out, "A")).toBeCloseTo((1000 + 1300) / 2 - 50, 9);
  });
});

describe("sibling-order-swapped golden", () => {
  it("has the offspring in the opposite order from the fixture", () => {
    const golden = JSON.parse(readFileSync(join(__dirname, "golden", "tidy-sibling-order-swapped.json"), "utf8"));
    // The fixture as the scripts built it (the unswapped golden's `before`).
    const base = JSON.parse(readFileSync(join(__dirname, "golden", "tidy-sibling-order.json"), "utf8"));
    const fx = { names: base.names as Record<string, string>, elements: base.before as SceneElement[] };
    const x = (els: SceneElement[], n: string) => {
      const b = boundingBox(els.filter((e) => e.customData?.genotypeId === fx.names[n] && e.customData.kind === "genotype-allele"));
      return b.topX + b.width / 2;
    };
    expect(Math.sign(x(golden.elements, "A") - x(golden.elements, "B"))).toBe(-Math.sign(x(fx.elements, "A") - x(fx.elements, "B")));
  });
});
