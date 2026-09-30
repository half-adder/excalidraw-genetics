// Break Cross: undo the link between parents and offspring without deleting
// any genotype. Ported from scripts/Break Cross.md (the operation's body).
//
// Selection:
//   - The x between two parents, or elements of BOTH parents of a cross:
//       break that whole cross. The x, all its lineage arrows and selection
//       criteria are removed, and every offspring becomes a standalone
//       genotype.
//   - Elements of an offspring (a genotype with parents):
//       detach just that offspring. Its lineage arrow and criterion are
//       removed; its label stays. If its cross has no offspring left, the x
//       is removed.
// Whole-cross breaks take precedence: selecting a genotype that is both an
// offspring and one of two selected parents breaks the cross it is a parent
// in.
//
// It is one undoable operation: one undo restores it.

import { Notice } from "obsidian";
import type { OperationContext } from "../operation";
import { splitDuplicateGenotypes } from "../duplicates";
import type { Parents, SceneElement } from "../schema";

export interface BreakPlan {
  crosses: Map<string, Parents>;
  detach: Set<string>;
  patches: Map<string, Partial<SceneElement>>;
}

const pairKey = (p: Parents): string => `${p.maternal}|${p.paternal}`;

// What to break, and the patches that make it so, or null if nothing
// selected qualifies (neither a cross's x/parents nor an offspring).
export function planBreakCross(all: readonly SceneElement[], selected: readonly SceneElement[]): BreakPlan | null {
  const elements = all.filter((el) => !el.isDeleted);
  const kind = (el: SceneElement): string | undefined => el.customData?.kind;

  // Whole crosses to break: the x itself selected, or both of its parents.
  const crosses = new Map<string, Parents>();
  for (const el of selected) {
    if (kind(el) === "cross-glyph" && el.customData?.parents) {
      crosses.set(pairKey(el.customData.parents), el.customData.parents);
    }
  }
  const selectedGids = new Set(selected.map((el) => el.customData?.genotypeId).filter((id): id is string => !!id));
  for (const el of elements) {
    const p = el.customData?.parents;
    if (kind(el) === "cross-glyph" && p && selectedGids.has(p.maternal) && selectedGids.has(p.paternal)) {
      crosses.set(pairKey(p), p);
    }
  }

  // Offspring to detach: every child of a broken cross, plus any selected
  // genotype that has parents and is not itself a parent of a broken cross.
  const parentsOf = (gid: string): Parents | undefined =>
    elements.find((el) => el.customData?.genotypeId === gid && el.customData?.parents)?.customData?.parents;
  const brokenParents = new Set([...crosses.values()].flatMap((p) => [p.maternal, p.paternal]));
  const detach = new Set<string>();
  const allGids = new Set(elements.map((el) => el.customData?.genotypeId).filter((id): id is string => !!id));
  for (const gid of allGids) {
    const p = parentsOf(gid);
    if (!p) continue;
    if (crosses.has(pairKey(p))) detach.add(gid);
    else if (selectedGids.has(gid) && !brokenParents.has(gid)) detach.add(gid);
  }

  if (!crosses.size && !detach.size) return null;

  const toDelete = new Set<string>();
  const patches = new Map<string, Partial<SceneElement>>();
  const patch = (id: string, fields: Partial<SceneElement>): void => {
    patches.set(id, { ...patches.get(id), ...fields });
  };

  for (const gid of detach) {
    // Lineage arrows into this offspring, and their bound criterion labels.
    for (const el of elements) {
      if (el.customData?.childGenotypeId !== gid) continue;
      if (kind(el) === "cross-lineage" || kind(el) === "cross-criterion") toDelete.add(el.id);
    }
    // Drop `parents` from the offspring's own elements (genotype, frame, label).
    for (const el of elements) {
      if (el.customData?.genotypeId !== gid || !el.customData.parents) continue;
      const { parents: _parents, ...rest } = el.customData;
      patch(el.id, { customData: rest });
    }
  }

  // Remove the x of every broken cross, and of any cross that just lost its
  // last offspring.
  const touchedPairs = new Set([...detach].map((gid) => pairKey(parentsOf(gid) as Parents)));
  const hasRemainingChild = (key: string): boolean =>
    elements.some(
      (el) => el.customData?.genotypeId && el.customData.parents && !detach.has(el.customData.genotypeId) && pairKey(el.customData.parents) === key,
    );
  for (const el of elements) {
    if (kind(el) !== "cross-glyph" || !el.customData?.parents) continue;
    const key = pairKey(el.customData.parents);
    if (crosses.has(key) || (touchedPairs.has(key) && !hasRemainingChild(key))) toDelete.add(el.id);
  }

  // Unhook deleted elements from anything that lists them as bound.
  for (const el of elements) {
    if (toDelete.has(el.id) || !el.boundElements?.some((b) => toDelete.has(b.id))) continue;
    patch(el.id, { boundElements: el.boundElements.filter((b) => !toDelete.has(b.id)) });
  }
  for (const el of elements.filter((el) => toDelete.has(el.id))) patch(el.id, { isDeleted: true });

  return { crosses, detach, patches };
}

export async function breakCross(ctx: OperationContext): Promise<void> {
  // Copies of a genotype made in Excalidraw become their own genotypes first.
  await splitDuplicateGenotypes(ctx);

  const plan = planBreakCross(ctx.ea.getViewElements(), ctx.ea.getViewSelectedElements());
  if (!plan) {
    new Notice("Select the x of a cross, both of its parents, or an offspring to detach.");
    return;
  }
  await ctx.commitPatches(plan.patches);

  const n = plan.detach.size;
  new Notice(
    plan.crosses.size
      ? `Broke ${plan.crosses.size} cross(es); ${n} offspring now standalone.`
      : `Detached ${n} offspring from ${n === 1 ? "its" : "their"} parents.`,
  );
}
