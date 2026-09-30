import { describe, expect, it } from "vitest";
import { fixtureNames, loadFixture } from "./helpers/fixtures";
import { collectLineage, computeDepths, extendWithOrphanGlyphs, topDownDepths, walkAncestors, walkDescendants } from "../../src/scene/graph";
import type { Parents, SceneElement } from "../../src/schema";

// The lineage walks and depths read each genotype's parents from a map built
// once. Reference: the earlier implementation, which looked the parents up
// by scanning every element each time (first element carrying `parents`
// wins), kept here verbatim to prove the results are unchanged.
function refParents(gid: string, all: readonly SceneElement[]): Parents | null {
  for (const el of all) if (el.customData?.genotypeId === gid && el.customData?.parents) return el.customData.parents;
  return null;
}
function refAncestors(gid: string, all: readonly SceneElement[], visited: Set<string> = new Set()): Set<string> {
  if (visited.has(gid)) return visited;
  visited.add(gid);
  const parents = refParents(gid, all);
  if (!parents) return visited;
  if (parents.maternal) refAncestors(parents.maternal, all, visited);
  if (parents.paternal) refAncestors(parents.paternal, all, visited);
  return visited;
}
function refDescendants(seeds: Iterable<string>, all: readonly SceneElement[]): Set<string> {
  const result = new Set<string>(seeds);
  const ids = new Set<string>();
  for (const el of all) if (el.customData?.genotypeId) ids.add(el.customData.genotypeId);
  let changed = true;
  while (changed) {
    changed = false;
    for (const gid of ids) {
      if (result.has(gid)) continue;
      const p = refParents(gid, all);
      if (p && ((p.maternal && result.has(p.maternal)) || (p.paternal && result.has(p.paternal)))) { result.add(gid); changed = true; }
    }
  }
  return result;
}
function refTopDown(lineage: ReadonlySet<string>, all: readonly SceneElement[]): Map<string, number> {
  const topDown = new Map<string, number>();
  function td(gid: string, stack: Set<string> = new Set()): number {
    if (topDown.has(gid)) return topDown.get(gid) as number;
    if (stack.has(gid)) return 0;
    stack.add(gid);
    const p = refParents(gid, all);
    let d = 0;
    if (p) {
      const dm = p.maternal && lineage.has(p.maternal) ? td(p.maternal, stack) : -1;
      const dp = p.paternal && lineage.has(p.paternal) ? td(p.paternal, stack) : -1;
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
function refDepths(lineage: ReadonlySet<string>, all: readonly SceneElement[]): Map<string, number> {
  const topDown = refTopDown(lineage, all);
  const result = new Map<string, number>();
  for (const gid of lineage) {
    let max = -1;
    for (const c of lineage) {
      const p = refParents(c, all);
      if (!p) continue;
      if (p.maternal === gid && p.paternal && lineage.has(p.paternal)) max = Math.max(max, topDown.get(p.paternal) ?? 0);
      if (p.paternal === gid && p.maternal && lineage.has(p.maternal)) max = Math.max(max, topDown.get(p.maternal) ?? 0);
    }
    result.set(gid, Math.max(topDown.get(gid) ?? 0, max));
  }
  return result;
}

const genotypeIds = (all: readonly SceneElement[]) => [...new Set(all.map((e) => e.customData?.genotypeId).filter((g): g is string => !!g))];
const entries = (m: Map<string, number>) => [...m].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

describe("lineage walks and depths match the element-scanning reference", () => {
  it.each(fixtureNames())("fixture %s, every genotype's lineage", (name) => {
    const all = loadFixture(name).elements;
    for (const g of genotypeIds(all)) {
      expect([...walkAncestors(g, all)].sort()).toEqual([...refAncestors(g, all)].sort());
      expect([...walkDescendants([g], all)].sort()).toEqual([...refDescendants([g], all)].sort());
      const lineage = collectLineage(g, all);
      extendWithOrphanGlyphs(lineage, all);
      expect(entries(topDownDepths(lineage, all))).toEqual(entries(refTopDown(lineage, all)));
      expect(entries(computeDepths(lineage, all))).toEqual(entries(refDepths(lineage, all)));
    }
  });

  // Members of one genotype that disagree on `parents` (and a member with
  // none): the first element carrying parents wins, as before.
  it("the first element carrying parents wins", () => {
    const el = (id: string, genotypeId: string, parents?: Parents): SceneElement =>
      ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, customData: { genotypeId, ...(parents ? { parents } : {}) } }) as unknown as SceneElement;
    const all = [
      el("a", "A"), el("b", "B"), el("c", "C"), el("x", "X", { maternal: "A", paternal: "B" }),
      el("m", "M"), el("n1", "N"), el("n2", "N", { maternal: "A", paternal: "B" }), el("n3", "N", { maternal: "X", paternal: "C" }),
      el("s", "S", { maternal: "N", paternal: "M" }),
    ];
    const lineage = new Set(["A", "B", "C", "X", "M", "N", "S"]);
    expect(entries(computeDepths(lineage, all))).toEqual(entries(refDepths(lineage, all)));
    expect(computeDepths(lineage, all).get("N")).toBe(1); // n2's parents (A x B), not n3's
    expect([...walkDescendants(["X"], all)].sort()).toEqual([...refDescendants(["X"], all)].sort());
  });
});

// A rough sanity check that the depths no longer scan every element for
// every pair of genotypes: a 600-genotype chain of 8-element genotypes (the
// element-scanning version does about L^2 x N = 1.7e9 element reads here,
// several seconds) finishes well inside a bound that leaves orders of magnitude of
// headroom for a slow machine.
describe("computeDepths scales", () => {
  it("a 600-genotype lineage in well under 1 s", () => {
    const all: SceneElement[] = [];
    const L = 600;
    for (let i = 0; i < L; i++) {
      const parents = i >= 2 ? { maternal: `g${i - 1}`, paternal: `g${i - 2}` } : undefined;
      for (let k = 0; k < 8; k++) {
        all.push({ id: `e${i}-${k}`, type: "text", x: 0, y: 0, width: 1, height: 1, customData: { genotypeId: `g${i}`, ...(parents ? { parents } : {}) } } as unknown as SceneElement);
      }
    }
    const lineage = new Set(Array.from({ length: L }, (_, i) => `g${i}`));
    const t0 = performance.now();
    const d = computeDepths(lineage, all);
    walkDescendants(["g0"], all);
    const ms = performance.now() - t0;
    expect(d.get(`g${L - 1}`)).toBe(L - 2);
    expect(ms).toBeLessThan(1000);
  });
});
