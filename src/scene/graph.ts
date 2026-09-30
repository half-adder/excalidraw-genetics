// Lineage walks, depths and selection sets: pure functions over the v2
// `customData` graph (genotypeId, parents, cross-glyph/cross-lineage links).
// Ported from Tidy.md (`getGenotypeElements`, `getParentsFromGenotype`,
// `reconstructShorthand`, `walkAncestors`, `walkDescendants`,
// `collectLineage`, `topDownDepths`, `computeDepths`, the orphan-glyph
// `while (added)` fixpoint at the top of `tidyLineage`) and from
// `Select Below.md` / `Select Lineage.md` (the `MODE`-driven selection walk,
// identical apart from `MODE`).

import type { Parents, SceneElement } from "../schema";
import { CHROMOSOME_ORDER } from "../schema";

export function genotypeElements(gid: string, all: readonly SceneElement[]): SceneElement[] {
  return all.filter((e) => e.customData?.genotypeId === gid);
}

// Returns the genotype's `parents` (denormalized across its members) or null
// if it is a root. Reads from the first tagged element that carries it.
export function parentsOfGenotype(gid: string, all: readonly SceneElement[]): Parents | null {
  for (const el of all) {
    if (el.customData?.genotypeId === gid && el.customData?.parents) {
      return el.customData.parents;
    }
  }
  return null;
}

// Every genotype's `parents`, read once: for each genotype, from the first
// tagged element that carries it (as parentsOfGenotype). The walks and
// depths below look parents up here instead of scanning every element each
// time.
export function parentsMap(all: readonly SceneElement[]): Map<string, Parents> {
  const map = new Map<string, Parents>();
  for (const el of all) {
    const g = el.customData?.genotypeId;
    const p = el.customData?.parents;
    if (g && p && !map.has(g)) map.set(g, p);
  }
  return map;
}

// Inverse of parseShorthand: produces "w; +/+; TM3/+" from tagged elements.
// Reads `el.text` (Phase A's own accessor, not `textOf`).
export function reconstructShorthand(gid: string, all: readonly SceneElement[]): string {
  const members = genotypeElements(gid, all);
  const byChrom = new Map<string, Partial<Record<"single" | "top" | "bottom", string | undefined>>>();
  for (const el of members) {
    const cd = el.customData;
    if (cd?.kind !== "genotype-allele") continue;
    const chrom = String(cd.chromosome);
    const side = cd.side as "single" | "top" | "bottom";
    if (!byChrom.has(chrom)) byChrom.set(chrom, {});
    byChrom.get(chrom)![side] = el.text;
  }
  const parts: string[] = [];
  for (const label of CHROMOSOME_ORDER) {
    const a = byChrom.get(label);
    if (!a) continue;
    if (a.single !== undefined) parts.push(a.single);
    else if (a.top !== undefined && a.bottom !== undefined) parts.push(`${a.top}/${a.bottom}`);
  }
  return parts.join(" ; ");
}

export function walkAncestors(gid: string, all: readonly SceneElement[], visited: Set<string> = new Set()): Set<string> {
  const parentsOf = parentsMap(all);
  const walk = (g: string): void => {
    if (visited.has(g)) return;
    visited.add(g);
    const parents = parentsOf.get(g);
    if (!parents) return;
    if (parents.maternal) walk(parents.maternal);
    if (parents.paternal) walk(parents.paternal);
  };
  walk(gid);
  return visited;
}

// Fixpoint expansion: find every genotype whose parents reference any id
// already in the set.
export function walkDescendants(seeds: Iterable<string>, all: readonly SceneElement[]): Set<string> {
  const result = new Set<string>(seeds);
  const parentsOf = parentsMap(all);
  const allGenotypeIds = new Set<string>();
  for (const el of all) {
    const g = el.customData?.genotypeId;
    if (g) allGenotypeIds.add(g);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const gid of allGenotypeIds) {
      if (result.has(gid)) continue;
      const parents = parentsOf.get(gid);
      if (!parents) continue;
      if ((parents.maternal && result.has(parents.maternal)) || (parents.paternal && result.has(parents.paternal))) {
        result.add(gid);
        changed = true;
      }
    }
  }
  return result;
}

// The whole connected component of `gid`: parents, offspring and x-glyph
// partners, followed in every direction to a fixpoint. Ancestors plus
// descendants is not enough: a genotype crossed with a mate from another
// family would join a lineage without its own parents (and lose its arrow),
// and the two families would be laid out apart.
export function collectLineage(gid: string, all: readonly SceneElement[]): Set<string> {
  const set = walkDescendants(walkAncestors(gid, all), all);
  const links: string[][] = [];
  const seen = new Set<string>();
  for (const el of all) {
    const cd = el.customData;
    const p = cd?.parents;
    if (!p) continue;
    if (cd?.genotypeId && !seen.has(cd.genotypeId)) {
      seen.add(cd.genotypeId);
      links.push([cd.genotypeId, p.maternal, p.paternal].filter((x): x is string => !!x));
    } else if (cd?.kind === "cross-glyph") {
      links.push([p.maternal, p.paternal].filter((x): x is string => !!x));
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const ids of links) {
      if (!ids.some((g) => set.has(g))) continue;
      for (const g of ids) {
        if (!set.has(g)) {
          set.add(g);
          changed = true;
        }
      }
    }
  }
  return set;
}

// Top-down depth of each genotype in `lineage`: the longest path from a root
// of the lineage (roots are 0).
export function topDownDepths(lineage: ReadonlySet<string>, all: readonly SceneElement[]): Map<string, number> {
  const topDown = new Map<string, number>();
  const parentsOf = parentsMap(all);
  function td(gid: string, stack: Set<string> = new Set()): number {
    if (topDown.has(gid)) return topDown.get(gid) as number;
    if (stack.has(gid)) return 0; // cycle guard
    stack.add(gid);
    const parents = parentsOf.get(gid);
    let d = 0;
    if (parents) {
      const dm = parents.maternal && lineage.has(parents.maternal) ? td(parents.maternal, stack) : -1;
      const dp = parents.paternal && lineage.has(parents.paternal) ? td(parents.paternal, stack) : -1;
      d = 1 + Math.max(dm, dp);
      if (d < 0) d = 0;
    }
    stack.delete(gid);
    topDown.set(gid, d);
    return d;
  }
  for (const gid of lineage) td(gid);
  return topDown;
}

// Two-pass depth:
//   Pass 1: top-down depth = longest path from any root in the lineage.
//   Pass 2: a genotype's ROW = max(own top-down, max top-down of any
//           co-parent). A co-parent is the OTHER parent in a cross where
//           this genotype is also a parent.
//
// Why two passes: standard fly-cross notation places a genotype at the row
// where it's USED, not where it originated. A stock used at the F2
// generation should sit alongside F1 in the figure, even though it's a root
// genotype (top-down depth 0). Pure top-down would shove it back to row 0
// with the founding stocks, where the cross-glyph collides with it.
export function computeDepths(lineage: ReadonlySet<string>, all: readonly SceneElement[]): Map<string, number> {
  const topDown = topDownDepths(lineage, all);
  const parentsOf = parentsMap(all);
  // Each cross in the lineage (both parents in it) raises each parent to at
  // least the other's top-down depth: one pass over the lineage.
  const maxCoparent = new Map<string, number>();
  const raise = (gid: string, mate: string) => maxCoparent.set(gid, Math.max(maxCoparent.get(gid) ?? -1, topDown.get(mate) ?? 0));
  for (const cgid of lineage) {
    const p = parentsOf.get(cgid);
    if (!p?.maternal || !p.paternal || !lineage.has(p.maternal) || !lineage.has(p.paternal)) continue;
    raise(p.maternal, p.paternal);
    raise(p.paternal, p.maternal);
  }
  const result = new Map<string, number>();
  for (const gid of lineage) result.set(gid, Math.max(topDown.get(gid) ?? 0, maxCoparent.get(gid) ?? -1));
  return result;
}

// Extend a lineage with orphan cross-glyph pairs: any cross-glyph that
// references a genotype already in the lineage pulls in its partner. This
// makes "press Cross before typing offspring shorthand" tidy-able: the two
// parents are placed side-by-side at the same row and the glyph gets
// regenerated in Phase D. Fixpoint walk so a chain of orphan glyphs
// (A-x-B, B-x-C, ...) resolves in one pass. Mutates `lineage`.
export function extendWithOrphanGlyphs(lineage: Set<string>, all: readonly SceneElement[]): void {
  let added = true;
  while (added) {
    added = false;
    for (const el of all) {
      if (el.customData?.kind !== "cross-glyph") continue;
      const p = el.customData.parents;
      if (!p?.maternal || !p?.paternal) continue;
      const mIn = lineage.has(p.maternal);
      const pIn = lineage.has(p.paternal);
      if (mIn && !pIn) {
        lineage.add(p.paternal);
        added = true;
      } else if (pIn && !mIn) {
        lineage.add(p.maternal);
        added = true;
      }
    }
  }
}

export type SelectMode = "below" | "lineage";

export interface SelectionSet {
  genotypeIds: Set<string>;
  elements: SceneElement[];
}

// Select Below / Select Lineage's selection walk: `seed` is a parameter
// instead of read from the current view selection, the elements are
// `all.filter(el => !el.isDeleted)`, and this returns the genotype-id set and
// the pick list instead of selecting them in the view.
export function selectionSet(all: readonly SceneElement[], seed: string, mode: SelectMode): SelectionSet {
  const els = all.filter((el) => !el.isDeleted);

  // Crosses as [maternal, paternal, child] from offspring `parents`, plus
  // crosses that have an x but no offspring yet.
  const parentsOf = new Map<string, Parents>();
  for (const el of els) {
    const cd = el.customData;
    if (cd?.genotypeId && cd.parents?.maternal && cd.parents?.paternal) parentsOf.set(cd.genotypeId, cd.parents);
  }
  const pairs: Parents[] = [...parentsOf.values()];
  for (const el of els) {
    const p = el.customData?.kind === "cross-glyph" ? el.customData.parents : null;
    if (p?.maternal && p?.paternal) pairs.push(p);
  }

  const set = new Set<string>([seed]);
  if (mode === "lineage") {
    // Everything connected through parent/child and mate links.
    let grew = true;
    while (grew) {
      grew = false;
      const add = (g: string | undefined | null) => {
        if (g && !set.has(g)) {
          set.add(g);
          grew = true;
        }
      };
      for (const [child, p] of parentsOf) {
        if (set.has(child) || set.has(p.maternal) || set.has(p.paternal)) {
          add(child);
          add(p.maternal);
          add(p.paternal);
        }
      }
      for (const p of pairs) {
        if (set.has(p.maternal) || set.has(p.paternal)) {
          add(p.maternal);
          add(p.paternal);
        }
      }
    }
  } else {
    // The seed, its descendants, and the mates in every cross they parent.
    let grew = true;
    while (grew) {
      grew = false;
      for (const p of pairs) {
        if (!set.has(p.maternal) && !set.has(p.paternal)) continue;
        for (const g of [p.maternal, p.paternal]) {
          if (!set.has(g)) {
            set.add(g);
            grew = true;
          }
        }
      }
      for (const [child, p] of parentsOf) {
        if (!set.has(child) && (set.has(p.maternal) || set.has(p.paternal))) {
          set.add(child);
          grew = true;
        }
      }
    }
  }

  // Genotype elements, plus cross furniture whose cross lies inside the set.
  // An arrow is included only if both of its child's parents are in the set,
  // so in "below" mode the arrow into the seed stays behind (it is bound and
  // re-routes when the selection is dragged).
  const crossInside = (p: Parents | null | undefined) => !!p && set.has(p.maternal) && set.has(p.paternal);
  const pick = els.filter((el) => {
    const cd = el.customData;
    if (!cd) return false;
    if (cd.genotypeId) return set.has(cd.genotypeId);
    if (cd.kind === "cross-glyph") return crossInside(cd.parents ?? null);
    if (cd.kind === "cross-lineage" || cd.kind === "cross-criterion") {
      return crossInside(cd.childGenotypeId ? (parentsOf.get(cd.childGenotypeId) ?? null) : null);
    }
    return false;
  });

  return { genotypeIds: set, elements: pick };
}
