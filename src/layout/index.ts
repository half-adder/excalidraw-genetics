// Tidy's layout engine as pure functions (Tidy.md, `tidyLineage` Phase A2
// onward: "Cross-aware x layout", row units, the median translation, lineage
// arrow routes and the clearance helpers of Phase E). Genotypes, crosses and
// their measured sizes go in; centers, x glyph positions and arrow routes
// come out. Nothing here reads or writes a drawing.

import { FRAME_GAP, FRAME_PAD, GENERATION_GAP_Y, GLYPH_PAD, SIBLING_GAP_X } from "../constants";
import type { Parents, SceneElement } from "../schema";
import { lineagePoints, type Point } from "../scene";

// One genotype to lay out: its parents, its rendered size (without frame),
// the half-width of its frame (which Phase D grows to cover the offspring
// label box, centered on the genotype), and where it was before Tidy.
export interface LayoutNode {
  gid: string;
  parents: Parents | null;
  width: number;
  height: number;
  half: number;
  originalCenter: Point;
  boundary: boolean;
}

export interface LayoutInput {
  nodes: LayoutNode[];
  depths: ReadonlyMap<string, number>;
  crossPairs: Array<[string, string]>;
  // Width of the x glyph.
  crossW: number;
  // Subset mode (Tidy Below, or two or more selected genotypes).
  subset: boolean;
}

// Rows by depth: vertical extent of the genotypes (not labels) in each row.
export interface RowBands {
  sortedDepths: number[];
  rowTop: Map<number, number>;
  rowBottom: Map<number, number>;
}

export interface LayoutResult {
  centers: Map<string, Point>;
  // "maternal|paternal" -> x glyph center x
  glyphX: Map<string, number>;
  // gid -> genotypes of its row unit
  unitOf: Map<string, string[]>;
  // The genotypes whose offsets the median translation was taken over.
  anchors: string[];
  rows: RowBands;
}

// What `linearize` and `layoutUnit` need to know about the genotypes of a row.
export interface RowContext {
  half(gid: string): number;
  ox(gid: string): number;
  crossW: number;
}

// One laid-out unit: member centers and x glyph centers relative to the
// unit's left edge, and the unit's width.
export interface UnitLayout {
  seq: string[];
  offsets: Map<string, number>;
  glyphOff: Map<string, number>;
  width: number;
}

// A unit being placed in its row by `resolveRow`, which sets `left`.
export interface RowUnit extends UnitLayout {
  anchored: boolean;
  weight: number;
  left: number;
  key: number;
  oxKey: number;
}

const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const mean = (v: readonly number[]): number => v.reduce((s, x) => s + x, 0) / v.length;

// "maternal|paternal" when both parents are among the genotypes laid out.
export function parentPairKey(node: Pick<LayoutNode, "parents">, known: ReadonlySet<string>): string | null {
  if (!node.parents) return null;
  const m = node.parents.maternal;
  const p = node.parents.paternal;
  if (!m || !p) return null;
  if (!known.has(m) || !known.has(p)) return null;
  return m + "|" + p;
}

// Every cross in the lineage as [maternalGid, paternalGid], one entry per
// parent pair (offspring `parents`, plus x glyphs with no offspring yet).
export function collectCrossPairs(nodes: readonly LayoutNode[], all: readonly SceneElement[]): Array<[string, string]> {
  const known = new Set(nodes.map((n) => n.gid));
  const crossPairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const node of nodes) {
    const key = parentPairKey(node, known);
    if (!key || seen.has(key) || !node.parents) continue;
    seen.add(key);
    crossPairs.push([node.parents.maternal, node.parents.paternal]);
  }
  for (const el of all) {
    if (el.customData?.kind !== "cross-glyph") continue;
    const p = el.customData.parents;
    if (!p?.maternal || !p?.paternal) continue;
    if (!known.has(p.maternal) || !known.has(p.paternal)) continue;
    const key = p.maternal + "|" + p.paternal;
    if (seen.has(key)) continue;
    seen.add(key);
    crossPairs.push([p.maternal, p.paternal]);
  }
  return crossPairs;
}

// Order one unit's genotypes left to right.
//   - A single cross: maternal left, paternal right.
//   - A chain (A x B, A x C, ...; every genotype crossed with at most two
//     others): in chain order, oriented so the end that was further left
//     stays on the left.
//   - Otherwise a hub H (most crosses): H's partners that were left of it
//     go left, the rest right, each side in pre-Tidy order, and at least one
//     partner on each side, so the two nearest partners sit directly beside
//     H. Genotypes further out in the unit go beyond the partner they hang
//     off, in pre-Tidy order.
// Only relative pre-Tidy positions and genotype ids are used, so a second
// Tidy reproduces the same order.
export function linearize(
  nodes: string[],
  adj: ReadonlyMap<string, ReadonlySet<string>>,
  crosses: ReadonlyArray<readonly [string, string]>,
  anchorX: (gid: string) => number | null,
  ctx: RowContext,
): string[] {
  const ox = ctx.ox;
  const byOx = (a: string, b: string): number => ox(a) - ox(b) || cmpStr(a, b);
  if (nodes.length === 1) return nodes;
  const deg = (g: string): number => adj.get(g)!.size;
  if (nodes.length === 2) {
    // Two parents hung from different crosses above (families joined by
    // this cross) go on the side of their own parents, so the arrows into
    // them do not cross.
    const [a, b] = nodes.map(anchorX);
    if (a !== null && b !== null && Math.abs(a - b) > 0.5) return a < b ? nodes : [nodes[1], nodes[0]];
    return crosses.length === 1 ? [crosses[0][0], crosses[0][1]] : [...nodes].sort(byOx);
  }
  const edges = nodes.reduce((s, g) => s + deg(g), 0) / 2;
  if (edges === nodes.length - 1 && nodes.every((g) => deg(g) <= 2)) {
    const seq = [nodes.filter((g) => deg(g) === 1).sort(byOx)[0]];
    while (seq.length < nodes.length) {
      const last = seq[seq.length - 1], before = seq[seq.length - 2];
      seq.push([...adj.get(last)!].find((n) => n !== before)!);
    }
    return seq;
  }
  const hub = [...nodes].sort((a, b) => deg(b) - deg(a) || cmpStr(a, b))[0];
  const partners = [...adj.get(hub)!].sort(byOx);
  const L = partners.filter((g) => ox(g) < ox(hub));
  const R = partners.filter((g) => ox(g) >= ox(hub));
  if (!L.length) L.push(R.shift()!);
  else if (!R.length) R.unshift(L.pop()!);
  const side = new Map<string, number>([...L.map((g): [string, number] => [g, -1]), ...R.map((g): [string, number] => [g, 1])]);
  const outerL: string[] = [], outerR: string[] = [];
  const seen = new Set([hub, ...partners]);
  let frontier = [...partners].sort(cmpStr);
  while (frontier.length) {
    const next: string[] = [];
    for (const g of frontier) {
      for (const n of [...adj.get(g)!].sort(cmpStr)) {
        if (seen.has(n)) continue;
        seen.add(n);
        side.set(n, side.get(g)!);
        (side.get(g)! < 0 ? outerL : outerR).push(n);
        next.push(n);
      }
    }
    frontier = next.sort(cmpStr);
  }
  return [...outerL.sort(byOx), ...L, hub, ...R, ...outerR.sort(byOx)];
}

// Lay out one unit from x = 0. Returns member centers and x glyph centers
// relative to the unit's left edge, and the unit's width.
// A cross between neighbors gets its x in the middle of their gap. A cross
// between genotypes that are not neighbors (a hub's third partner and
// beyond) gets its x right beside the partner with fewer crosses, on the
// side facing the other parent. Each gap is widened to fit its x glyphs.
export function layoutUnit(
  seq: string[],
  adj: ReadonlyMap<string, ReadonlySet<string>>,
  crosses: ReadonlyArray<readonly [string, string]>,
  ctx: RowContext,
): UnitLayout {
  const CROSS_W = ctx.crossW;
  const idx = new Map(seq.map((g, i) => [g, i]));
  const gaps = seq.slice(1).map(() => ({ left: [] as string[], mid: [] as string[], right: [] as string[] }));
  for (const [m, p] of crosses) {
    const key = m + "|" + p;
    let lo = idx.get(m)!, hi = idx.get(p)!;
    if (lo > hi) [lo, hi] = [hi, lo];
    if (hi - lo === 1) gaps[lo].mid.push(key);
    else if (adj.get(seq[lo])!.size < adj.get(seq[hi])!.size) gaps[lo].left.push(key);
    else gaps[hi - 1].right.push(key);
  }
  const offsets = new Map<string, number>();
  const glyphOff = new Map<string, number>();
  const step = CROSS_W + GLYPH_PAD;
  let cursor = 0;
  seq.forEach((g, i) => {
    const half = ctx.half(g);
    offsets.set(g, cursor + half);
    cursor += 2 * half;
    if (i === seq.length - 1) return;
    const gap = gaps[i];
    gap.left.sort(cmpStr); gap.mid.sort(cmpStr); gap.right.sort(cmpStr);
    const n = gap.left.length + gap.mid.length + gap.right.length;
    const gw = Math.max(FRAME_GAP, GLYPH_PAD * (n + 1) + CROSS_W * n);
    gap.left.forEach((k, j) => glyphOff.set(k, cursor + GLYPH_PAD + CROSS_W / 2 + j * step));
    gap.right.forEach((k, j) => glyphOff.set(k, cursor + gw - GLYPH_PAD - CROSS_W / 2 - j * step));
    const a = cursor + gap.left.length * step;
    const b = cursor + gw - gap.right.length * step;
    const midW = gap.mid.length * step - GLYPH_PAD;
    gap.mid.forEach((k, j) => glyphOff.set(k, (a + b) / 2 - midW / 2 + CROSS_W / 2 + j * step));
    cursor += gw;
  });
  return { seq, offsets, glyphOff, width: cursor };
}

// Place units without overlap (FRAME_GAP apart), keeping their order and
// minimizing squared distance from desired positions: consecutive
// overlapping units merge into a block, and a block sits at the mean of its
// members' desired positions (weighted by anchored genotypes; a unit with
// no anchored genotype only counts in a block of such units). `packAll`
// merges the whole row into one block. Sorts `units` and sets each `left`.
export function resolveRow(units: RowUnit[], packAll: boolean): void {
  units.sort((a, b) => a.key - b.key || a.oxKey - b.oxKey || cmpStr(a.seq[0], b.seq[0]));
  interface Block { units: RowUnit[]; width: number; wA: number; sA: number; wF: number; sF: number }
  const pos = (c: Block): number => (c.wA ? c.sA / c.wA : c.sF / c.wF);
  const blocks: Block[] = [];
  for (const u of units) {
    blocks.push({
      units: [u], width: u.width,
      wA: u.anchored ? u.weight : 0, sA: u.anchored ? u.weight * u.left : 0,
      wF: u.anchored ? 0 : 1, sF: u.anchored ? 0 : u.left,
    });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (!packAll && pos(a) + a.width + FRAME_GAP <= pos(b) + 0.01) break;
      const shift = a.width + FRAME_GAP;
      a.sA += b.sA - b.wA * shift;
      a.sF += b.sF - b.wF * shift;
      a.wA += b.wA;
      a.wF += b.wF;
      a.units.push(...b.units);
      a.width = shift + b.width;
      blocks.pop();
    }
  }
  for (const blk of blocks) {
    let x = pos(blk);
    for (const u of blk.units) { u.left = x; x += u.width + FRAME_GAP; }
  }
}

// Layered layout of one lineage. Each genotype's generation depth (longest
// path from any root in the lineage) picks its row; rows are stacked
// downward, centered on 0, and each row is laid out left to right:
//
// Every row is split into UNITS: the connected components of the crosses
// whose two parents are both in that row (a lone genotype is a unit of one).
// A unit is laid out as a chain (see `linearize`), with each cross's x glyph
// in a gap of the chain (see `layoutUnit`). Each unit then gets a desired
// position: offspring want to sit under their parents' x glyph (row above);
// a unit with no such offspring wants to stay where it was. Units are
// ordered by desired center (ties: pre-Tidy x, which keeps the user's
// sibling order) and overlaps are resolved in 1D with least total
// displacement (`resolveRow`). Row 0 is packed into one block, as before.
//
// Everything is computed in drawing coordinates, so the layout is
// translation-equivariant and a second Tidy reproduces the first. Finally
// the whole lineage is translated so it moves as little as possible.
export function layoutLineage(input: LayoutInput): LayoutResult {
  const { nodes, depths, crossPairs } = input;
  const nodeByGid = new Map(nodes.map((n) => [n.gid, n]));
  const known = new Set(nodeByGid.keys());
  const depthOf = (gid: string): number => depths.get(gid) ?? 0;

  // Bucket nodes by depth.
  const buckets = new Map<number, LayoutNode[]>();
  for (const n of nodes) {
    const d = depthOf(n.gid);
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d)!.push(n);
  }
  const sortedDepths = [...buckets.keys()].sort((a, b) => a - b);

  // y for each depth: stacked downward, centered on 0.
  const rowHeights = sortedDepths.map((d) => Math.max(...buckets.get(d)!.map((s) => s.height)));
  const totalHeight = rowHeights.reduce((s, h) => s + h, 0) + GENERATION_GAP_Y * Math.max(0, sortedDepths.length - 1);
  let cursorY = -totalHeight / 2;
  const depthY = new Map<number, number>();
  for (let i = 0; i < sortedDepths.length; i++) {
    const d = sortedDepths[i];
    depthY.set(d, cursorY + rowHeights[i] / 2);
    cursorY += rowHeights[i] + GENERATION_GAP_Y;
  }

  const centers = new Map<string, Point>();
  for (const n of nodes) centers.set(n.gid, { x: 0, y: depthY.get(depthOf(n.gid))! });

  const finalX = new Map<string, number>();   // gid -> laid-out center x
  const unitOf = new Map<string, string[]>(); // gid -> genotypes of its row unit
  const glyphPos = new Map<string, number>(); // "maternal|paternal" -> x glyph center x

  const placeAt = (gid: string, x: number): void => {
    finalX.set(gid, x);
    centers.get(gid)!.x = x;
  };
  const ctx: RowContext = {
    half: (g) => nodeByGid.get(g)!.half,
    ox: (g) => nodeByGid.get(g)!.originalCenter.x,
    crossW: input.crossW,
  };

  // Midpoint of the gap between two placed genotypes' frames. Used for a
  // cross whose parents ended up in different rows (no unit holds both).
  const gapMidX = (m: string, p: string): number => {
    const a = nodeByGid.get(m)!, b = nodeByGid.get(p)!;
    const ca = centers.get(m)!, cb = centers.get(p)!;
    const [l, lc, r, rc] = ca.x <= cb.x ? [a, ca, b, cb] : [b, cb, a, ca];
    if (l === r) return lc.x;
    return (lc.x + l.half + rc.x - r.half) / 2;
  };

  for (const d of sortedDepths) {
    const rowGids = buckets.get(d)!.map((s) => s.gid).sort(cmpStr);
    const rowSet = new Set(rowGids);
    const rowCrosses = crossPairs.filter(([m, p]) => m !== p && rowSet.has(m) && rowSet.has(p));
    const adj = new Map(rowGids.map((g) => [g, new Set<string>()]));
    for (const [m, p] of rowCrosses) { adj.get(m)!.add(p); adj.get(p)!.add(m); }

    const units: RowUnit[] = [];
    const seen = new Set<string>();
    for (const g of rowGids) {
      if (seen.has(g)) continue;
      const comp: string[] = [];
      const stack = [g];
      seen.add(g);
      while (stack.length) {
        const x = stack.pop()!;
        comp.push(x);
        for (const n of adj.get(x)!) if (!seen.has(n)) { seen.add(n); stack.push(n); }
      }
      const compSet = new Set(comp);
      const crosses = rowCrosses.filter(([m]) => compSet.has(m));
      // Anchored members: offspring whose parents are already placed want to
      // be centered under their parents' x glyph.
      const anchorX = (m: string): number | null => {
        const s = nodeByGid.get(m)!;
        const key = parentPairKey(s, known);
        if (!key || !s.parents || !finalX.has(s.parents.maternal) || !finalX.has(s.parents.paternal)) return null;
        return glyphPos.has(key) ? glyphPos.get(key)! : gapMidX(s.parents.maternal, s.parents.paternal);
      };
      const lay = layoutUnit(linearize(comp, adj, crosses, anchorX, ctx), adj, crosses, ctx);
      const wants: number[] = [];
      for (const m of lay.seq) {
        const t = anchorX(m);
        if (t !== null) wants.push(t - lay.offsets.get(m)!);
      }
      const anchored = wants.length > 0;
      const left = anchored ? mean(wants) : mean(lay.seq.map((m) => ctx.ox(m) - lay.offsets.get(m)!));
      units.push({
        ...lay,
        anchored,
        weight: wants.length,
        left,
        key: left + lay.width / 2,
        oxKey: mean(lay.seq.map(ctx.ox)),
      });
    }

    resolveRow(units, d === sortedDepths[0]);
    for (const u of units) {
      for (const m of u.seq) unitOf.set(m, u.seq);
      for (const m of u.seq) placeAt(m, u.left + u.offsets.get(m)!);
      for (const [k, o] of u.glyphOff) glyphPos.set(k, u.left + o);
    }
  }
  for (const [m, p] of crossPairs) {
    const key = m + "|" + p;
    if (!glyphPos.has(key)) glyphPos.set(key, gapMidX(m, p));
  }

  // Translate the relative layout by the per-axis MEDIAN of each genotype's
  // (pre-Tidy - laid-out) offset. This minimizes total movement (L1): genotypes
  // already in formation stay put and stray ones move back, rather than the
  // whole lineage following whichever genotype was dragged last. Idempotent:
  // an already-tidy lineage has zero offset everywhere.
  const median = (vals: readonly number[]): number => {
    const v = [...vals].sort((a, b) => a - b);
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  // Subset mode takes the median over the ANCHORS only: the top-row genotypes
  // whose parents are outside the subset (hung from a fixed x glyph), else all
  // top-row genotypes. A single anchor does not move.
  const topRow = nodes.filter((s) => depthOf(s.gid) === sortedDepths[0]);
  const anchors = !input.subset ? nodes
    : topRow.some((s) => s.boundary) ? topRow.filter((s) => s.boundary) : topRow;
  if (nodes.length) {
    const dx = median(anchors.map((s) => s.originalCenter.x - centers.get(s.gid)!.x));
    const dy = median(anchors.map((s) => s.originalCenter.y - centers.get(s.gid)!.y));
    for (const n of nodes) {
      const c = centers.get(n.gid)!;
      centers.set(n.gid, { x: c.x + dx, y: c.y + dy });
    }
    for (const [k, x] of glyphPos) glyphPos.set(k, x + dx);
  }

  // Rows by depth: vertical extent of the genotypes (not labels) in each row.
  const rowTop = new Map<number, number>(), rowBottom = new Map<number, number>();
  for (const s of nodes) {
    const d = depthOf(s.gid);
    const c = centers.get(s.gid)!;
    rowTop.set(d, Math.min(rowTop.get(d) ?? Infinity, c.y - s.height / 2));
    rowBottom.set(d, Math.max(rowBottom.get(d) ?? -Infinity, c.y + s.height / 2));
  }

  return { centers, glyphX: glyphPos, unitOf, anchors: anchors.map((s) => s.gid), rows: { sortedDepths, rowTop, rowBottom } };
}

// An obstacle for lineage arrows in a row between the x glyph and the child:
// a genotype frame (after labels grow it) or an x glyph, by its x span.
export interface ArrowObstacle {
  depth: number;
  left: number;
  right: number;
}

// Path of a lineage arrow from the x glyph's bottom middle (`from`, on row
// `from.depth`) to the child's frame top middle (`to`, on row `to.depth`).
// Into the next row: the usual elbow. Further down: drop into the gap below
// the parents' row, run across to a vertical lane that is clear of every
// genotype frame and x glyph in the rows in between (`obstacles`), go down it
// to the gap above the child's row, across, and down into the child.
export function childArrowPoints(
  from: { x: number; y: number; depth: number },
  to: { x: number; y: number; depth: number },
  rows: RowBands,
  obstacles: readonly ArrowObstacle[],
): Array<[number, number]> {
  const { x: x1, y: y1, depth: dFrom } = from;
  const { x: x2, y: y2, depth: dTo } = to;
  const between = rows.sortedDepths.filter((d) => d > dFrom && d < dTo);
  if (!between.length) return lineagePoints(x1, y1, x2, y2);
  const inBetween = new Set(between);
  const spans: Array<[number, number]> = obstacles.filter((o) => inBetween.has(o.depth)).map((o) => [o.left, o.right]);
  const clearOf = FRAME_GAP / 4;
  const free = (x: number): boolean => spans.every(([l, r]) => x <= l - clearOf || x >= r + clearOf);
  // Candidates: straight down from the x or up to the child, the middle of
  // each gap between obstacles, and just outside the obstacles.
  spans.sort((a, b) => a[0] - b[0]);
  const cands = [x1, x2];
  let reach = -Infinity;
  for (const [l, r] of spans) {
    if (reach > -Infinity && l > reach) cands.push((reach + l) / 2);
    reach = Math.max(reach, r);
  }
  // (Every row in between holds a genotype, so Tidy always has obstacles
  // here; without any, the straight candidates are free.)
  if (spans.length) cands.push(spans[0][0] - FRAME_GAP / 2, reach + FRAME_GAP / 2);
  const lane = cands.filter(free)
    .sort((a, b) => (Math.abs(a - x1) + Math.abs(a - x2)) - (Math.abs(b - x1) + Math.abs(b - x2)) || a - b)[0];
  const yTop = (rows.rowBottom.get(dFrom)! + rows.rowTop.get(between[0])!) / 2;
  const yLow = Math.min((rows.rowBottom.get(between[between.length - 1])! + rows.rowTop.get(dTo)!) / 2, y2 - FRAME_PAD);
  const pts: Array<[number, number]> = [[x1, y1], [x1, yTop], [lane, yTop], [lane, yLow], [x2, yLow], [x2, y2]];
  // Drop zero-length segments and straight-through corners.
  const out: Array<[number, number]> = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5) continue;
    const o = out[out.length - 2];
    if (o && ((Math.abs(o[0] - q[0]) < 0.5 && Math.abs(q[0] - p[0]) < 0.5)
           || (Math.abs(o[1] - q[1]) < 0.5 && Math.abs(q[1] - p[1]) < 0.5))) out.pop();
    out.push(p);
  }
  return out;
}

// ---- Clearance (Tidy's Phase E) --------------------------------------------

// A box a lineage occupies. Frames carry their `gid` and x glyphs (and the
// first segment of a lineage arrow) their `parents`, so a genotype is not
// kept clear of its own cross's x.
export interface ClearBox {
  x: number;
  y: number;
  w: number;
  h: number;
  gid?: string;
  parents?: Array<string | undefined>;
}

type Lookup = { get(id: string): SceneElement | undefined };
const byBinding = (lookup: Lookup, id: string | undefined): SceneElement | undefined => (id ? lookup.get(id) : undefined);

// Boxes a lineage occupies: genotype frames (which cover labels), x glyphs,
// and each lineage arrow's span from its glyph to its child frame (taken
// from the bound ends, not the routed path, which Excalidraw may reshape).
export function lineageBoxes(els: readonly SceneElement[]): ClearBox[] {
  const byId = new Map(els.map((e) => [e.id, e]));
  const boxes: ClearBox[] = [];
  for (const e of els) {
    const kind = e.customData?.kind;
    if (kind === "genotype-frame" || kind === "cross-glyph") {
      boxes.push({ x: e.x, y: e.y, w: e.width, h: e.height });
    } else if (kind === "cross-lineage" && e.type === "arrow") {
      const s = byBinding(byId, e.startBinding?.elementId), t = byBinding(byId, e.endBinding?.elementId);
      if (!s || !t) continue;
      const x1 = s.x + s.width / 2, x2 = t.x + t.width / 2;
      const y1 = s.y + s.height, y2 = t.y;
      boxes.push({ x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) });
    }
  }
  return boxes;
}

// Smallest horizontal shift (ties: rightward) that keeps every box in `mine`
// at least SIBLING_GAP_X - 2 * FRAME_PAD from every vertically overlapping
// box in `others`.
export function clearingShift(mine: readonly ClearBox[], others: readonly ClearBox[]): number {
  const { ok, candidates } = clearance(mine, others);
  return candidates.find(ok) ?? 0;
}

// The shifts to consider for `clearingShift`, nearest first (ties:
// rightward), and a test of whether a shift clears.
export function clearance(mine: readonly ClearBox[], others: readonly ClearBox[]): { ok(shift: number): boolean; candidates: number[] } {
  const gap = SIBLING_GAP_X - 2 * FRAME_PAD, vpad = 2 * FRAME_PAD;
  const bad: Array<[number, number]> = [];
  for (const a of mine) {
    for (const b of others) {
      if (a.y >= b.y + b.h + vpad || a.y + a.h + vpad <= b.y) continue;
      // A genotype sits beside the x of its own cross by design.
      if ((a.gid && b.parents?.includes(a.gid)) || (b.gid && a.parents?.includes(b.gid))) continue;
      bad.push([b.x - (a.x + a.w) - gap, b.x + b.w - a.x + gap]);
    }
  }
  const ok = (s: number): boolean => bad.every(([lo, hi]) => s <= lo + 0.5 || s >= hi - 0.5);
  const candidates = [0, ...bad.flat()].sort((p, q) => Math.abs(p) - Math.abs(q) || q - p);
  return { ok, candidates };
}

// Like `lineageBoxes`, but a lineage arrow is its three elbow segments (from
// the bound ends) rather than their bounding box, so a sibling beside the
// arrow's corner is not counted as hitting it. Bound ends are looked up in
// `lookup` (id -> element). Frames carry their `gid` and x glyphs their
// `parents`, so a genotype is not kept clear of its own cross's x. Used in
// subset mode, whose obstacles sit right next to the tidied genotypes.
export function segmentBoxes(els: readonly SceneElement[], lookup: Lookup): ClearBox[] {
  const boxes: ClearBox[] = [];
  for (const e of els) {
    const kind = e.customData?.kind;
    if (kind === "genotype-frame") {
      boxes.push({ x: e.x, y: e.y, w: e.width, h: e.height, gid: e.customData?.genotypeId });
    } else if (kind === "cross-glyph") {
      const p = e.customData?.parents;
      boxes.push({ x: e.x, y: e.y, w: e.width, h: e.height, parents: [p?.maternal, p?.paternal] });
    } else if (kind === "cross-lineage" && e.type === "arrow") {
      const pts = boundLineagePoints(e, lookup);
      if (!pts) continue;
      // The first segment drops from the x between the parents, like the x.
      const p = byBinding(lookup, e.startBinding?.elementId)?.customData?.parents;
      for (let i = 1; i < pts.length; i++) {
        const [x1, y1] = pts[i - 1], [x2, y2] = pts[i];
        const box: ClearBox = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
        if (i === 1) box.parents = [p?.maternal, p?.paternal];
        boxes.push(box);
      }
    }
  }
  return boxes;
}

// Elbow path of a lineage arrow from its x glyph's bottom middle to its
// child frame's top middle, or null if either end is not found.
export function boundLineagePoints(arrow: SceneElement, lookup: Lookup): Array<[number, number]> | null {
  const s = byBinding(lookup, arrow.startBinding?.elementId), t = byBinding(lookup, arrow.endBinding?.elementId);
  if (!s || !t) return null;
  return lineagePoints(s.x + s.width / 2, s.y + s.height, t.x + t.width / 2, t.y);
}
