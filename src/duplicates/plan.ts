// Duplicated genotypes (same in every script; keep in sync). A genotype
// copied in Excalidraw (Cmd+D, copy/paste, alt-drag) keeps the original's
// customData, genotypeId and `parents` included, in a new group; a copied x
// glyph keeps its `parents`. Of the drawings of one genotypeId, the original
// is the one the lineage arrow into the genotype is bound to, else the one
// nearest the x glyphs of its crosses, else the first in scene order; every
// other drawing is a copy and gets a fresh genotypeId. Of the x glyphs of one
// parent pair, the original is the one with a lineage arrow into an original
// drawing, else the one nearest the parents, else the first.
//
// Copied together: Excalidraw moves a copied selection as one block, so the
// copies of one Cmd+D, paste or alt-drag all lie at the same offset from
// their originals (frame top-left of a drawing, top-left of an x glyph;
// equal within DUPLICATE_SHIFT_PX). Before offsets are compared, the
// originals of each copied family (both parents and their x) are re-picked
// to lie to the original child as the copies lie to the copied child, the
// child's arrow being the surest sign of its original (the rules above can
// split a family, e.g. alt-drag moves the originals and leaves copies).
// Separate copies that happen to share an offset (two Cmd+D, not moved)
// count as copied together.
//
// A copied family stays a family: a copy whose two parents were copied at
// its offset keeps `parents`, pointing at those copies; an x glyph copied
// with both of its parents points at their copies; a lineage arrow copied
// into such a copy (and its criterion) is kept, re-pointed at the copy and
// bound from the copied x (unbound if the x was not copied). Every other
// copy is a new founder (no `parents`); lineage arrows copied into it (and
// their criteria) are removed, and so is an x glyph copied without both of
// its parents. Returns the patches that make this so, or null if no
// duplicate was found.

import { DUPLICATE_SHIFT_PX, DUPLICATE_TIE_PX } from "../constants";
import { boundingBox } from "../scene/geometry";
import type { BoundRef, CustomData, Parents, SceneElement } from "../schema";

export interface DuplicateSplitPlan {
  patches: Map<string, Partial<SceneElement>>;
}

type Point = [number, number];

// One genotypeId's drawings, or one parent pair's x glyphs: the element
// groups, their top-lefts, which is kept as the original. `parents` is set
// only for an x-glyph entry (its parent pair); `fresh` only for a genotype
// entry (a fresh genotypeId per copy, null for the kept original).
interface DupEntry {
  units: SceneElement[][];
  at: Point[];
  keep: number;
  parents?: Parents;
  fresh?: Array<string | null>;
}

export function planDuplicateSplit(
  all: readonly SceneElement[],
  newId: () => string = () => crypto.randomUUID(),
): DuplicateSplitPlan | null {
  const elements = all.filter((el) => !el.isDeleted);
  const byId = new Map(elements.map((el) => [el.id, el]));
  const order = new Map(elements.map((el, i) => [el.id, i]));
  const first = (els: SceneElement[]): number => Math.min(...els.map((e) => order.get(e.id) as number));
  const alleles = (els: SceneElement[]): SceneElement[] => els.filter((e) => e.customData?.kind === "genotype-allele");
  const center = (els: SceneElement[]): Point => {
    const b = boundingBox(els);
    return [b.topX + b.width / 2, b.topY + b.height / 2];
  };
  const topLeft = (els: SceneElement[]): Point => {
    const f = els.find((e) => e.customData?.kind === "genotype-frame");
    if (f) return [f.x, f.y];
    const b = boundingBox(els);
    return [b.topX, b.topY];
  };

  // Drawings of each genotypeId, told apart by their innermost group; x
  // glyphs of each parent pair.
  const drawingsOf = new Map<string, Map<string, SceneElement[]>>();
  const parentsOf = new Map<string, Parents>();
  const xsOf = new Map<string, SceneElement[]>();
  for (const el of elements) {
    const cd = el.customData;
    if (cd?.genotypeId) {
      let groups = drawingsOf.get(cd.genotypeId);
      if (!groups) drawingsOf.set(cd.genotypeId, (groups = new Map()));
      const key = el.groupIds?.[0] ?? "";
      let group = groups.get(key);
      if (!group) groups.set(key, (group = []));
      group.push(el);
      if (cd.parents && !parentsOf.has(cd.genotypeId)) parentsOf.set(cd.genotypeId, cd.parents);
    } else if (cd?.kind === "cross-glyph" && cd.parents?.maternal && cd.parents?.paternal) {
      const key = `${cd.parents.maternal}|${cd.parents.paternal}`;
      let xs = xsOf.get(key);
      if (!xs) xsOf.set(key, (xs = []));
      xs.push(el);
    }
  }

  // Duplicated genotypes (by genotypeId) and x glyphs (by "x:" + parent
  // pair): { units: element lists, at: their top-left, keep: the original }.
  const dup = new Map<string, DupEntry>();
  for (const [gid, groups] of drawingsOf) {
    const drawings = [...groups.values()].filter((els) => els.some((e) => e.customData?.kind === "genotype-allele"));
    if (drawings.length < 2) continue;
    const members = drawings.map((els) => new Set(els.map((e) => e.id)));
    const arrowsIn = elements.filter((e) => e.customData?.kind === "cross-lineage" && e.customData.childGenotypeId === gid);
    const bound = drawings.map((_, i) => i).filter((i) => arrowsIn.some((a) => members[i].has(a.endBinding?.elementId ?? "")));
    let keep: number | null = bound.length === 1 ? bound[0] : null;
    if (keep === null) {
      const pool = bound.length ? bound : drawings.map((_, i) => i);
      const parents = parentsOf.get(gid);
      const glyphs = elements.filter((e) => {
        const p = e.customData?.kind === "cross-glyph" ? (e.customData.parents ?? null) : null;
        return (
          p &&
          (p.maternal === gid || p.paternal === gid || (parents && p.maternal === parents.maternal && p.paternal === parents.paternal))
        );
      });
      const dist = (i: number): number => {
        if (!glyphs.length) return 0;
        const [cx, cy] = center(alleles(drawings[i]));
        return Math.min(...glyphs.map((g) => Math.hypot(g.x + g.width / 2 - cx, g.y + g.height / 2 - cy)));
      };
      const best = Math.min(...pool.map(dist));
      keep = pool.filter((i) => dist(i) - best < DUPLICATE_TIE_PX).sort((a, b) => first(drawings[a]) - first(drawings[b]))[0];
    }
    dup.set(gid, { units: drawings, at: drawings.map(topLeft), keep });
  }
  const original = (el: SceneElement | null | undefined): boolean => {
    const d = el?.customData?.genotypeId ? dup.get(el.customData.genotypeId) : undefined;
    return !!el && (!d || d.units[d.keep].includes(el));
  };
  for (const [key, xs] of xsOf) {
    if (xs.length < 2) continue;
    const [m, p] = key.split("|");
    const arrowed = xs
      .map((_, i) => i)
      .filter((i) =>
        elements.some(
          (a) => a.customData?.kind === "cross-lineage" && a.startBinding?.elementId === xs[i].id && original(byId.get(a.endBinding?.elementId ?? "")),
        ),
      );
    let keep: number | null = arrowed.length === 1 ? arrowed[0] : null;
    if (keep === null) {
      const pool = arrowed.length ? arrowed : xs.map((_, i) => i);
      const ends = [m, p]
        .map((g) => {
          const d = dup.get(g);
          return alleles(d ? d.units[d.keep] : [...(drawingsOf.get(g)?.values() ?? [])].flat());
        })
        .filter((els) => els.length)
        .map(center);
      const mid: Point | null = ends.length ? [0, 1].map((k) => ends.reduce((s, c) => s + c[k], 0) / ends.length) as Point : null;
      const dist = (i: number): number => {
        if (!mid) return 0;
        const [cx, cy] = center(xs.slice(i, i + 1));
        return Math.hypot(cx - mid[0], cy - mid[1]);
      };
      const best = Math.min(...pool.map(dist));
      keep = pool.filter((i) => dist(i) - best < DUPLICATE_TIE_PX).sort((a, b) => first([xs[a]]) - first([xs[b]]))[0];
    }
    dup.set(`x:${key}`, {
      units: xs.map((x) => [x]),
      at: xs.map((x): Point => [x.x, x.y]),
      keep,
      parents: { maternal: m, paternal: p },
    });
  }
  if (!dup.size) return null;

  // Offset of unit i from the original; whether two offsets are one.
  const offset = (d: DupEntry, i: number): Point => [d.at[i][0] - d.at[d.keep][0], d.at[i][1] - d.at[d.keep][1]];
  const same = (a: Point, b: Point): boolean => Math.abs(a[0] - b[0]) < DUPLICATE_SHIFT_PX && Math.abs(a[1] - b[1]) < DUPLICATE_SHIFT_PX;
  // Re-picks the original of d as the unit from which the most of ref's copy
  // offsets lead to another unit of d (the current original wins ties).
  const align = (d: DupEntry, ref: DupEntry): void => {
    const shifts = ref.units.map((_, r) => r).filter((r) => r !== ref.keep).map((r) => offset(ref, r));
    const score = (i: number): number =>
      shifts.filter((s) => d.at.some((a, j) => j !== i && same([a[0] - d.at[i][0], a[1] - d.at[i][1]], s))).length;
    const scores = d.units.map((_, i) => score(i));
    const best = Math.max(...scores);
    if (best > 0 && scores[d.keep] < best) d.keep = scores.indexOf(best);
  };
  // Generations below the founders, so a family is lined up with its child
  // before it serves as the child of the family above.
  const depth = new Map<string, number>();
  const depthOf = (g: string, seen: Set<string> = new Set()): number => {
    if (depth.has(g)) return depth.get(g) as number;
    const p = parentsOf.get(g);
    if (!p || seen.has(g)) return 0;
    seen.add(g);
    const d = 1 + Math.max(depthOf(p.maternal, seen), depthOf(p.paternal, seen));
    depth.set(g, d);
    return d;
  };
  const copiedPair = (p: Parents | null | undefined): boolean => !!p && dup.has(p.maternal) && dup.has(p.paternal);
  const lined = new Set<string>();
  const children = [...dup.keys()].filter((g) => copiedPair(parentsOf.get(g))).sort((a, b) => depthOf(b) - depthOf(a));
  for (const c of children) {
    const p = parentsOf.get(c) as Parents;
    for (const g of [p.maternal, p.paternal]) {
      align(dup.get(g) as DupEntry, dup.get(c) as DupEntry);
      lined.add(g);
    }
  }
  for (const d of dup.values()) {
    if (!copiedPair(d.parents)) continue;
    const parents = d.parents as Parents;
    const m = dup.get(parents.maternal) as DupEntry;
    const p = dup.get(parents.paternal) as DupEntry;
    if (!lined.has(parents.maternal) && !lined.has(parents.paternal)) align(p, m);
    align(d, m);
  }

  // Every copy: a fresh genotypeId, and the copies of its parents if both
  // were copied at its offset.
  for (const d of dup.values()) if (!d.parents) d.fresh = d.units.map((_, i) => (i === d.keep ? null : newId()));
  const copyAt = (key: string, s: Point): number | null => {
    const d = dup.get(key);
    const i = d ? d.units.findIndex((_, j) => j !== d.keep && same(offset(d, j), s)) : -1;
    return i < 0 ? null : i;
  };
  const copiedParents = (p: Parents | null | undefined, s: Point): Parents | null => {
    if (!p) return null;
    const m = copyAt(p.maternal, s);
    const f = copyAt(p.paternal, s);
    if (m === null || f === null) return null;
    const maternal = dup.get(p.maternal)?.fresh?.[m];
    const paternal = dup.get(p.paternal)?.fresh?.[f];
    // m/f non-null means copyAt found d.units[m]/[f] in a genotype dup entry, which always has
    // .fresh set with a non-null id at every non-keep index: maternal/paternal can't be falsy here.
    // The `&&` only satisfies the type checker (dup.get(...)?.fresh?.[...] types as string | undefined).
    return maternal && paternal ? { maternal, paternal } : null;
  };
  interface RenameInfo {
    genotypeId: string;
    parents: Parents | null;
    of: string;
    shift: Point;
  }
  const renamed = new Map<string, RenameInfo>(); // element id -> new genotypeId, parents (null: a founder), of, shift
  const xCopies = new Map<string, Parents | null>(); // x glyph id -> parents of its copy (null: removed)
  for (const [key, d] of dup) {
    d.units.forEach((els, i) => {
      if (i === d.keep) return;
      const s = offset(d, i);
      if (d.parents) {
        xCopies.set(els[0].id, copiedParents(d.parents, s));
        return;
      }
      const info: RenameInfo = {
        genotypeId: (d.fresh as Array<string | null>)[i] as string,
        parents: copiedParents(parentsOf.get(key) ?? null, s),
        of: key,
        shift: s,
      };
      for (const el of els) renamed.set(el.id, info);
    });
  }

  // Lineage arrows into a copy, with their criteria: kept into a copied
  // family (re-pointed, bound from its x), else removed.
  const doomed = new Set<string>();
  const startOf = new Map<string, string | null>(); // re-bound arrow id -> its new start (null: none)
  const childOf = new Map<string, string>(); // kept arrow or criterion id -> the copy's genotypeId
  for (const [id, parents] of xCopies) if (!parents) doomed.add(id);
  for (const a of elements) {
    const info = a.customData?.kind === "cross-lineage" ? renamed.get(a.endBinding?.elementId ?? "") : undefined;
    if (!info) continue;
    const texts = (a.boundElements ?? []).filter((b) => b.type === "text").map((b) => b.id);
    if (!info.parents) {
      doomed.add(a.id);
      for (const t of texts) doomed.add(t);
      continue;
    }
    for (const id of [a.id, ...texts]) childOf.set(id, info.genotypeId);
    const p = parentsOf.get(info.of) as Parents;
    const key = `x:${p.maternal}|${p.paternal}`;
    const i = copyAt(key, info.shift);
    const x = i === null ? null : (dup.get(key) as DupEntry).units[i][0].id;
    if (a.startBinding?.elementId !== x) startOf.set(a.id, x);
  }
  for (const a of elements) {
    if (
      a.customData?.kind === "cross-lineage" &&
      !doomed.has(a.id) &&
      !startOf.has(a.id) &&
      doomed.has(a.startBinding?.elementId ?? "")
    ) {
      startOf.set(a.id, null);
    }
  }
  // A binding is kept only if the other end still points back at `el`.
  const startId = (o: SceneElement): string | null | undefined => (startOf.has(o.id) ? startOf.get(o.id) : o.startBinding?.elementId);
  const bindsTo = (b: BoundRef, el: SceneElement): boolean => {
    const o = byId.get(b.id);
    if (!o || doomed.has(o.id)) return false;
    return b.type === "text" ? o.containerId === el.id : startId(o) === el.id || o.endBinding?.elementId === el.id;
  };
  const newlyBound = new Map<string, string[]>(); // element id -> arrows now starting on it
  for (const [a, x] of startOf) {
    if (!x) continue;
    const arrows = newlyBound.get(x);
    if (arrows) arrows.push(a);
    else newlyBound.set(x, [a]);
  }

  const patches = new Map<string, Partial<SceneElement>>();
  const patch = (id: string, fields: Partial<SceneElement>): void => {
    patches.set(id, { ...patches.get(id), ...fields });
  };
  for (const el of elements) {
    if (doomed.has(el.id)) {
      patch(el.id, { isDeleted: true });
      continue;
    }
    let customData: CustomData | undefined;
    const info = renamed.get(el.id);
    if (info) {
      const { parents, ...rest } = el.customData ?? {};
      customData = { ...rest, genotypeId: info.genotypeId, ...(info.parents ? { parents: info.parents } : {}) };
    }
    if (xCopies.has(el.id)) customData = { ...el.customData, parents: xCopies.get(el.id) as Parents };
    if (childOf.has(el.id) && el.customData?.childGenotypeId) customData = { ...el.customData, childGenotypeId: childOf.get(el.id) };
    if (customData) patch(el.id, { customData });
    if (startOf.has(el.id)) {
      const x = startOf.get(el.id);
      const startBinding = x
        ? { ...(el.startBinding ?? { mode: "orbit", fixedPoint: [0.5, 1] as [number, number] }), elementId: x }
        : null;
      patch(el.id, { startBinding });
    }
    const touched =
      !!info ||
      xCopies.has(el.id) ||
      newlyBound.has(el.id) ||
      !!el.boundElements?.some((b) => doomed.has(b.id) || startOf.has(b.id));
    if (touched && (el.boundElements?.length || newlyBound.has(el.id))) {
      const kept: BoundRef[] = (el.boundElements ?? []).filter((b) => bindsTo(b, el));
      for (const id of newlyBound.get(el.id) ?? []) if (!kept.some((b) => b.id === id)) kept.push({ type: "arrow", id });
      patch(el.id, { boundElements: kept });
    }
  }
  return { patches };
}
