import { describe, expect, it } from "vitest";
import { gid, loadFixture } from "./helpers/fixtures";
import { planDuplicateSplit } from "../../src/duplicates/plan";
import type { SceneElement } from "../../src/schema";

const counter = () => { let n = 0; return () => `new-${++n}`; };

// Excalidraw's Cmd+D / copy-paste: same customData, new ids, a new group, moved by (dx, dy).
function copy(els: SceneElement[], dx: number, dy: number, tag: string): SceneElement[] {
  const ids = new Map(els.map((e) => [e.id, `${e.id}-${tag}`]));
  const groups = new Map<string, string>();
  const g = (id: string) => groups.get(id) ?? groups.set(id, `${id}-${tag}`).get(id)!;
  return els.map((e) => ({
    ...structuredClone(e),
    id: ids.get(e.id)!,
    x: e.x + dx, y: e.y + dy,
    groupIds: (e.groupIds ?? []).map(g),
    boundElements: (e.boundElements ?? []).filter((b) => ids.has(b.id)).map((b) => ({ ...b, id: ids.get(b.id)! })),
    containerId: e.containerId && ids.has(e.containerId) ? ids.get(e.containerId)! : e.containerId ?? null,
    startBinding: e.startBinding && ids.has(e.startBinding.elementId) ? { ...e.startBinding, elementId: ids.get(e.startBinding.elementId)! } : null,
    endBinding: e.endBinding && ids.has(e.endBinding.elementId) ? { ...e.endBinding, elementId: ids.get(e.endBinding.elementId)! } : null,
  }));
}
const cd = (plan: ReturnType<typeof planDuplicateSplit>, id: string) => plan?.patches.get(id)?.customData;

describe("planDuplicateSplit", () => {
  const fx = loadFixture("backcross");
  const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));

  it("does nothing without duplicates", () => {
    expect(planDuplicateSplit(fx.elements, counter())).toBe(null);
  });

  it("gives a copied founder a fresh genotypeId", () => {
    const dup = copy(of("P2"), 10, 10, "c");
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    const fresh = new Set(dup.map((e) => cd(plan, e.id)?.genotypeId));
    expect(fresh.size).toBe(1);
    expect([...fresh][0]).toMatch(/^new-/);
    for (const e of of("P2")) expect(plan?.patches.has(e.id) && cd(plan, e.id)?.genotypeId !== gid(fx, "P2")).toBe(false);
  });

  it("makes a lone copied offspring a founder", () => {
    const dup = copy(of("A"), 10, 10, "c");
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    for (const e of dup) {
      expect(cd(plan, e.id)?.genotypeId).toMatch(/^new-/);
      expect(cd(plan, e.id)?.parents).toBeUndefined();
    }
  });

  it("keeps a copied family a family", () => {
    const glyph = fx.elements.filter((e) => e.customData?.kind === "cross-glyph");
    const arrow = fx.elements.filter((e) => e.customData?.kind === "cross-lineage" || e.customData?.kind === "cross-criterion");
    const dup = copy([...of("P1"), ...of("P2"), ...of("A"), ...glyph, ...arrow], 400, 0, "c");
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    const newGid = (name: string) => cd(plan, `${of(name)[0].id}-c`)?.genotypeId;
    const [p1, p2, a] = [newGid("P1"), newGid("P2"), newGid("A")];
    expect(new Set([p1, p2, a]).size).toBe(3);
    expect(cd(plan, `${of("A")[0].id}-c`)?.parents).toEqual({ maternal: p1, paternal: p2 });
    expect(cd(plan, `${glyph[0].id}-c`)?.parents).toEqual({ maternal: p1, paternal: p2 });
    const arrowCopy = dup.find((e) => e.customData?.kind === "cross-lineage")!;
    expect(cd(plan, arrowCopy.id)?.childGenotypeId).toBe(a);
  });
});

// Excalidraw moves already-placed elements without touching customData or ids.
function move(els: SceneElement[], dx: number, dy: number): SceneElement[] {
  return els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy }));
}
const boundIds = (plan: ReturnType<typeof planDuplicateSplit>, id: string) => plan?.patches.get(id)?.boundElements;

// Keep-tier selection for a genotype's duplicated drawings: (1) the drawing a
// lineage arrow is bound to, else (2) the one nearest its cross's x glyphs,
// else (3) the first in scene order. A copy placed BEFORE the original in
// the elements array and, for (2)/(3), physically nearer the x glyph would
// be picked instead if a tier were skipped.
describe("planDuplicateSplit: genotype keep tiers", () => {
  const fx = loadFixture("backcross");
  const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));
  const glyphEl = fx.elements.find((e) => e.customData?.kind === "cross-glyph")!;
  const frame = () => of("A").find((e) => e.customData?.kind === "genotype-frame")!;

  it("(a) tier 1: the arrow-bound drawing is kept even when the copy is nearer the glyph and first in order", () => {
    const aEls = of("A");
    const f = frame();
    // Place the copy exactly on the glyph (much nearer than the untouched original).
    const dup = copy(aEls, glyphEl.x - f.x, glyphEl.y - f.y, "c");
    const plan = planDuplicateSplit([...dup, ...fx.elements], counter()); // copy first in scene order
    expect(cd(plan, f.id)).toBeUndefined(); // original untouched: it was kept
    expect(cd(plan, `${f.id}-c`)?.genotypeId).toMatch(/^new-/);
  });

  it("(b) tier 2: with no arrow bound to either, the drawing nearer the glyph is kept", () => {
    const aEls = of("A");
    const f = frame();
    const dup = copy(aEls, 1000, 1000, "c"); // far from the glyph
    const rebound = fx.elements.map((e) =>
      e.customData?.kind === "cross-lineage" ? { ...e, endBinding: { ...e.endBinding!, elementId: "nowhere" } } : e,
    );
    const plan = planDuplicateSplit([...dup, ...rebound], counter()); // copy first in scene order
    expect(cd(plan, f.id)).toBeUndefined();
    expect(cd(plan, `${f.id}-c`)?.genotypeId).toMatch(/^new-/);
  });

  it("(c) tie (< 25px): scene order decides, not raw distance", () => {
    const aEls = of("A");
    const f = frame();
    const d0 = Math.hypot(glyphEl.x - f.x, glyphEl.y - f.y);
    const ux = (glyphEl.x - f.x) / d0, uy = (glyphEl.y - f.y) / d0;
    const dup = copy(aEls, ux * 10, uy * 10, "c"); // 10px nearer the glyph: within DUPLICATE_TIE_PX
    const rebound = fx.elements.map((e) =>
      e.customData?.kind === "cross-lineage" ? { ...e, endBinding: { ...e.endBinding!, elementId: "nowhere" } } : e,
    );
    const plan = planDuplicateSplit([...rebound, ...dup], counter()); // original first in scene order
    expect(cd(plan, f.id)).toBeUndefined(); // the original wins the tie by scene order, not the (numerically nearer) copy
    expect(cd(plan, `${f.id}-c`)?.genotypeId).toMatch(/^new-/);
  });
});

// The parallel keep-tier selection for x glyphs of one parent pair: (1) a
// lineage arrow bound to it (into an original drawing), else (2) nearest the
// parents, else (3) scene order.
describe("planDuplicateSplit: x-glyph keep tiers", () => {
  const fx = loadFixture("backcross");
  const glyphEl = fx.elements.find((e) => e.customData?.kind === "cross-glyph")!;

  it("tier 1: the arrow-bound glyph is kept even when the copy is nearer the parents and first in order", () => {
    const dup = copy([glyphEl], 16.815, 0, "c"); // placed at the parents' midpoint: nearer than the original
    const plan = planDuplicateSplit([...dup, ...fx.elements], counter());
    expect(cd(plan, glyphEl.id)).toBeUndefined();
    expect(plan?.patches.get(`${glyphEl.id}-c`)?.isDeleted).toBe(true); // not part of a copied family: removed
  });

  it("tie: with no arrow bound to either, scene order decides", () => {
    const rebound = fx.elements.map((e) =>
      e.customData?.kind === "cross-lineage" ? { ...e, startBinding: { ...e.startBinding!, elementId: "nowhere" } } : e,
    );
    const dup = copy([glyphEl], 10, 0, "c"); // within DUPLICATE_TIE_PX
    const plan = planDuplicateSplit([...rebound, ...dup], counter()); // original first in scene order
    expect(cd(plan, glyphEl.id)).toBeUndefined();
    expect(plan?.patches.get(`${glyphEl.id}-c`)?.isDeleted).toBe(true);
  });
});

describe("planDuplicateSplit: alt-drag and offset matching", () => {
  it("alt-drag: align re-picks a moved parent using the child's own copy offset", () => {
    const fx = loadFixture("backcross");
    const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));
    const glyph = fx.elements.filter((e) => e.customData?.kind === "cross-glyph");
    const arrow = fx.elements.filter((e) => e.customData?.kind === "cross-lineage");
    const family = [...of("P1"), ...of("P2"), ...of("A"), ...glyph, ...arrow];
    const dup = copy(family, 400, 0, "c"); // the whole family copied as one block
    const p1Ids = new Set(of("P1").map((e) => e.id));
    const rest = fx.elements.filter((e) => !p1Ids.has(e.id));
    // Alt-drag: P1's original is moved on to a new spot, twice the family's
    // own copy offset away, leaving the (nearer, earlier in scene order) copy
    // in place. Distance/order alone would keep the wrong one; align must
    // use A's own (unambiguous, arrow-bound) copy offset to re-pick P1's.
    const movedP1 = move(of("P1"), 800, 0);
    const plan = planDuplicateSplit([...dup, ...rest, ...movedP1], counter());
    const p1Frame = of("P1").find((e) => e.customData?.kind === "genotype-frame")!;
    expect(cd(plan, p1Frame.id)).toBeUndefined(); // the moved original is still the one kept
    expect(cd(plan, `${p1Frame.id}-c`)?.genotypeId).toMatch(/^new-/); // the left-behind copy is renamed
  });

  it("copies at different offsets are not treated as copied together", () => {
    const fx = loadFixture("backcross");
    const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));
    const p1c = copy(of("P1"), 10, 10, "c");
    const p2c = copy(of("P2"), 40, 40, "c"); // 30px off P1's offset: well past DUPLICATE_SHIFT_PX
    const ac = copy(of("A"), 10, 10, "c"); // matches only P1's offset
    const plan = planDuplicateSplit([...fx.elements, ...p1c, ...p2c, ...ac], counter());
    const aId = of("A")[0].id;
    expect(cd(plan, `${aId}-c`)?.genotypeId).toMatch(/^new-/);
    expect(cd(plan, `${aId}-c`)?.parents).toBeUndefined(); // loose: P2 wasn't copied at A's offset
  });
});

describe("planDuplicateSplit: family pruning", () => {
  it("an x copied without both of its parents is removed", () => {
    const fx = loadFixture("backcross");
    const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));
    const glyph = fx.elements.filter((e) => e.customData?.kind === "cross-glyph");
    const dup = copy([...of("P1"), ...of("A"), ...glyph], 10, 10, "c"); // no P2
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    expect(plan?.patches.get(`${glyph[0].id}-c`)?.isDeleted).toBe(true);
    const aId = of("A")[0].id;
    expect(cd(plan, `${aId}-c`)?.parents).toBeUndefined();
  });

  it("a lineage arrow and criterion copied without a copied family are removed, and dangling bindings drop them", () => {
    const fx = loadFixture("label-criterion");
    const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));
    const arrow = fx.elements.filter((e) => e.customData?.kind === "cross-lineage" || e.customData?.kind === "cross-criterion");
    const fEls = of("F");
    const frame = fEls.find((e) => e.customData?.kind === "genotype-frame")!;
    const dup = copy([...fEls, ...arrow], 10, 10, "c"); // F copied alone: a loose founder
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    const arrowCopy = dup.find((e) => e.customData?.kind === "cross-lineage")!;
    const criterionCopy = dup.find((e) => e.customData?.kind === "cross-criterion")!;
    expect(plan?.patches.get(arrowCopy.id)?.isDeleted).toBe(true);
    expect(plan?.patches.get(criterionCopy.id)?.isDeleted).toBe(true);
    expect(boundIds(plan, `${frame.id}-c`)).toEqual([]); // the doomed arrow's reference is dropped
  });

  it("whole-family copy: the criterion is re-pointed, the arrow re-bound, and the x's boundElements repaired", () => {
    const fx = loadFixture("label-criterion");
    const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));
    const glyph = fx.elements.filter((e) => e.customData?.kind === "cross-glyph");
    const arrow = fx.elements.filter((e) => e.customData?.kind === "cross-lineage" || e.customData?.kind === "cross-criterion");
    const dup = copy([...of("P1"), ...of("P2"), ...of("F"), ...glyph, ...arrow], 400, 0, "c");
    const plan = planDuplicateSplit([...fx.elements, ...dup], counter());
    const fId = of("F")[0].id;
    const newFgid = cd(plan, `${fId}-c`)?.genotypeId;
    expect(newFgid).toMatch(/^new-/);
    const criterionCopy = dup.find((e) => e.customData?.kind === "cross-criterion")!;
    expect(cd(plan, criterionCopy.id)?.childGenotypeId).toBe(newFgid);
    const arrowCopy = dup.find((e) => e.customData?.kind === "cross-lineage")!;
    const glyphCopy = dup.find((e) => e.customData?.kind === "cross-glyph")!;
    const finalStart = plan?.patches.get(arrowCopy.id)?.startBinding?.elementId ?? arrowCopy.startBinding?.elementId;
    expect(finalStart).toBe(glyphCopy.id);
    expect(boundIds(plan, glyphCopy.id)).toEqual([{ type: "arrow", id: arrowCopy.id }]);
  });

  it("an arrow copied without its x glyph is re-bound to the glyph's own copy at the same offset", () => {
    const fx = loadFixture("label-criterion");
    const of = (name: string) => fx.elements.filter((e) => e.customData?.genotypeId === gid(fx, name));
    const glyph = fx.elements.filter((e) => e.customData?.kind === "cross-glyph");
    const arrow = fx.elements.filter((e) => e.customData?.kind === "cross-lineage" || e.customData?.kind === "cross-criterion");
    // Two separate copies at the same offset: parents+glyph in one, the
    // child+arrow in another (the glyph is NOT part of the child's copy, so
    // its raw startBinding is left unbound, not pointing at the glyph copy).
    const famCopy = copy([...of("P1"), ...of("P2"), ...glyph], 300, 0, "fam");
    const childCopy = copy([...of("F"), ...arrow], 300, 0, "child");
    const plan = planDuplicateSplit([...fx.elements, ...famCopy, ...childCopy], counter());
    const arrowCopy = childCopy.find((e) => e.customData?.kind === "cross-lineage")!;
    const glyphCopy = famCopy.find((e) => e.customData?.kind === "cross-glyph")!;
    expect(arrowCopy.startBinding).toBeNull(); // confirms the raw copy left it unbound
    expect(plan?.patches.get(arrowCopy.id)?.startBinding?.elementId).toBe(glyphCopy.id);
    expect(boundIds(plan, glyphCopy.id)).toEqual([{ type: "arrow", id: arrowCopy.id }]);
  });
});
