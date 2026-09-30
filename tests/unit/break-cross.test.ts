import { describe, expect, it } from "vitest";
import { gid, loadFixture } from "./helpers/fixtures";
import { planBreakCross } from "../../src/commands/break-cross";
import type { SceneElement } from "../../src/schema";

// Fixture "below": P1 x P2 -> A (criterion CyO), B; A x P3 -> C, D; C x P4 -> E.
const fx = loadFixture("below");
const of = (name: string): SceneElement[] => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));
const glyphOf = (m: string, p: string): SceneElement =>
  fx.elements.find(
    (e) => e.customData?.kind === "cross-glyph" && e.customData.parents?.maternal === gid(fx, m) && e.customData.parents?.paternal === gid(fx, p),
  ) as SceneElement;
const into = (name: string): SceneElement[] =>
  fx.elements.filter(
    (e) => (e.customData?.kind === "cross-lineage" || e.customData?.kind === "cross-criterion") && e.customData.childGenotypeId === gid(fx, name),
  );
const isDeleted = (plan: ReturnType<typeof planBreakCross>, el: SceneElement): boolean | undefined => plan?.patches.get(el.id)?.isDeleted;
const customDataOf = (plan: ReturnType<typeof planBreakCross>, el: SceneElement) => plan?.patches.get(el.id)?.customData ?? el.customData;
const boundOf = (plan: ReturnType<typeof planBreakCross>, el: SceneElement) => plan?.patches.get(el.id)?.boundElements ?? el.boundElements;

// Independent oracle for "nothing else changed" checks, built straight from
// the raw fixture (not from planBreakCross's own machinery): an element is
// patched exactly when it is removed (`gone`), or is one of a detached
// genotype's own elements that carries `parents`, or has a boundElements
// entry pointing at something removed.
const expectedPatchedIds = (gone: ReadonlySet<string>, detachedGids: ReadonlySet<string>): Set<string> => {
  const ids = new Set<string>();
  for (const el of fx.elements) {
    if (gone.has(el.id)) { ids.add(el.id); continue; }
    if (el.customData?.genotypeId && detachedGids.has(el.customData.genotypeId) && el.customData.parents) ids.add(el.id);
    if (el.boundElements?.some((b) => gone.has(b.id))) ids.add(el.id);
  }
  return ids;
};
const patchedIds = (plan: ReturnType<typeof planBreakCross>): Set<string> => new Set(plan?.patches.keys());

describe("planBreakCross", () => {
  it("returns null when nothing selected qualifies (no cross, no offspring)", () => {
    // A founder (no parents) selected: neither a cross's x nor an offspring.
    expect(planBreakCross(fx.elements, of("P1"))).toBeNull();
  });

  // Mutation 1: offspring-selected vs x-selected pick different rules.
  it("offspring selected: detaches only that offspring, not its whole cross", () => {
    const plan = planBreakCross(fx.elements, of("A"));
    expect(plan).not.toBeNull();
    expect(plan?.crosses.size).toBe(0);
    expect(plan?.detach).toEqual(new Set([gid(fx, "A")]));
    // A's own lineage arrow and criterion are removed.
    for (const el of into("A")) expect(isDeleted(plan, el)).toBe(true);
    // B's arrow and criterion are untouched: it keeps its parents.
    for (const el of into("B")) expect(isDeleted(plan, el)).toBeUndefined();
    // The P1 x P2 x stays (B is still its offspring).
    expect(isDeleted(plan, glyphOf("P1", "P2"))).toBeUndefined();
  });

  it("x glyph selected: breaks the whole cross, both offspring detached, the x removed", () => {
    const plan = planBreakCross(fx.elements, [glyphOf("P1", "P2")]);
    expect(plan).not.toBeNull();
    expect(plan?.crosses.size).toBe(1);
    expect(plan?.detach).toEqual(new Set([gid(fx, "A"), gid(fx, "B")]));
    expect(isDeleted(plan, glyphOf("P1", "P2"))).toBe(true);
    for (const el of [...into("A"), ...into("B")]) expect(isDeleted(plan, el)).toBe(true);
  });

  // Mutation 2: detaching the LAST offspring of a cross must remove its x too,
  // even though the x itself was never selected.
  it("detaching the only offspring of a cross removes that cross's x", () => {
    const plan = planBreakCross(fx.elements, of("E"));
    expect(plan).not.toBeNull();
    expect(plan?.crosses.size).toBe(0); // the x was not selected
    expect(plan?.detach).toEqual(new Set([gid(fx, "E")]));
    expect(isDeleted(plan, glyphOf("C", "P4"))).toBe(true);
  });

  it("detaching one of several offspring does NOT remove the x (a sibling remains)", () => {
    const plan = planBreakCross(fx.elements, of("A"));
    expect(isDeleted(plan, glyphOf("P1", "P2"))).toBeUndefined();
  });

  // Mutation 3: parents stripping removes exactly the `parents` key, nothing else.
  it("strips only `parents` from a detached offspring's customData, keeping every other field", () => {
    const plan = planBreakCross(fx.elements, of("A"));
    for (const el of of("A")) {
      const patched = customDataOf(plan, el);
      expect(patched.parents).toBeUndefined();
      const { parents: _dropped, ...rest } = el.customData as Record<string, unknown>;
      expect(patched).toEqual(rest);
    }
  });

  it("leaves customData of the sibling and of the parents untouched", () => {
    const plan = planBreakCross(fx.elements, of("A"));
    for (const el of of("B")) expect(plan?.patches.has(el.id)).toBe(false);
    for (const el of [...of("P1"), ...of("P2")]) expect(plan?.patches.has(el.id)).toBe(false);
  });

  // Mutation 4: binding cleanup drops references to removed elements from
  // boundElements lists of elements that are themselves kept.
  it("drops the removed arrow's id from the x glyph's boundElements when a sibling remains", () => {
    const plan = planBreakCross(fx.elements, of("A"));
    const x = glyphOf("P1", "P2");
    const arrowIntoA = into("A").find((e) => e.customData?.kind === "cross-lineage") as SceneElement;
    const arrowIntoB = into("B").find((e) => e.customData?.kind === "cross-lineage") as SceneElement;
    expect(x.boundElements?.map((b) => b.id)).toContain(arrowIntoA.id);
    const bound = boundOf(plan, x) as SceneElement["boundElements"];
    expect(bound?.map((b) => b?.id)).not.toContain(arrowIntoA.id);
    expect(bound?.map((b) => b?.id)).toContain(arrowIntoB.id);
  });

  it("also strips the removed arrow's id from the offspring frame's boundElements", () => {
    const plan = planBreakCross(fx.elements, of("A"));
    const frame = of("A").find((e) => e.customData?.kind === "genotype-frame") as SceneElement;
    const arrowIntoA = into("A").find((e) => e.customData?.kind === "cross-lineage") as SceneElement;
    expect(frame.boundElements?.map((b) => b.id)).toContain(arrowIntoA.id);
    const patch = plan?.patches.get(frame.id);
    // Both edits land on the same element: parents dropped AND the binding cleaned up.
    expect(patch?.customData?.parents).toBeUndefined();
    expect(patch?.boundElements?.map((b) => b?.id)).not.toContain(arrowIntoA.id);
  });

  it("no genotype-bearing element is ever deleted, only cross furniture", () => {
    const plan = planBreakCross(fx.elements, [glyphOf("P1", "P2")]);
    for (const [id, patch] of plan?.patches ?? []) {
      if (!patch.isDeleted) continue;
      const el = fx.elements.find((e) => e.id === id) as SceneElement;
      expect(el.customData?.genotypeId).toBeUndefined();
    }
  });

  // Mutation 5: BOTH parents selected (neither the x itself, nor any single
  // offspring) must also break the whole cross, exactly as selecting the x
  // does. This is a distinct code path (the second `crosses`-building loop,
  // over all elements rather than just `selected`).
  it("both parents selected (not the x): breaks the whole cross, x deleted, both offspring detached", () => {
    const plan = planBreakCross(fx.elements, [...of("P1"), ...of("P2")]);
    expect(plan).not.toBeNull();
    expect(plan?.crosses.size).toBe(1);
    expect(plan?.crosses.get(`${gid(fx, "P1")}|${gid(fx, "P2")}`)).toEqual({ maternal: gid(fx, "P1"), paternal: gid(fx, "P2") });
    expect(plan?.detach).toEqual(new Set([gid(fx, "A"), gid(fx, "B")]));
    expect(isDeleted(plan, glyphOf("P1", "P2"))).toBe(true);
    const gone = new Set([glyphOf("P1", "P2").id, ...into("A").map((e) => e.id), ...into("B").map((e) => e.id)]);
    const detachedGids = new Set([gid(fx, "A"), gid(fx, "B")]);
    expect(patchedIds(plan)).toEqual(expectedPatchedIds(gone, detachedGids));
  });

  // Mutation 6: a genotype that is simultaneously an offspring (of P1 x P2)
  // and a selected parent (of A x P3) must be treated as the latter: the A x
  // P3 cross breaks, but A itself is NOT detached from P1 x P2, and none of
  // A's own elements or incoming lineage are touched.
  it("a selected offspring that is also a selected parent: its own cross as a parent breaks, it is not itself detached", () => {
    const plan = planBreakCross(fx.elements, [...of("A"), ...of("P3")]);
    expect(plan).not.toBeNull();
    expect(plan?.crosses.size).toBe(1);
    expect(plan?.crosses.has(`${gid(fx, "A")}|${gid(fx, "P3")}`)).toBe(true);
    expect(plan?.detach).toEqual(new Set([gid(fx, "C"), gid(fx, "D")]));
    expect(plan?.detach.has(gid(fx, "A"))).toBe(false);
    // A's own customData is not patched...
    for (const el of of("A")) expect(plan?.patches.has(el.id)).toBe(false);
    // ...and its incoming lineage from P1 x P2 (arrow and criterion) stays.
    for (const el of into("A")) expect(isDeleted(plan, el)).toBeUndefined();
    const gone = new Set([glyphOf("A", "P3").id, ...into("C").map((e) => e.id), ...into("D").map((e) => e.id)]);
    const detachedGids = new Set([gid(fx, "C"), gid(fx, "D")]);
    expect(patchedIds(plan)).toEqual(expectedPatchedIds(gone, detachedGids));
  });

  // Multi-offspring last-offspring path: detaching BOTH of a cross's
  // offspring in one call must remove its x, the same as detaching its one
  // and only offspring does.
  it("selecting A and B together detaches both and removes the x via the last-offspring path", () => {
    const plan = planBreakCross(fx.elements, [...of("A"), ...of("B")]);
    expect(plan).not.toBeNull();
    expect(plan?.crosses.size).toBe(0); // broken by detaching, not by selecting the x or both parents
    expect(plan?.detach).toEqual(new Set([gid(fx, "A"), gid(fx, "B")]));
    expect(isDeleted(plan, glyphOf("P1", "P2"))).toBe(true);
    const gone = new Set([glyphOf("P1", "P2").id, ...into("A").map((e) => e.id), ...into("B").map((e) => e.id)]);
    const detachedGids = new Set([gid(fx, "A"), gid(fx, "B")]);
    expect(patchedIds(plan)).toEqual(expectedPatchedIds(gone, detachedGids));
  });
});
