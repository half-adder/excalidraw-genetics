// A genotype crossed on more than one row gets a copy per lower cross: see
// plan.ts for the rules. Commits the plan through the running operation.
// Changes the scene only if a conflict was found; returns the copies'
// genotype ids (empty if none).

import type { OperationContext } from "../operation";
import type { SceneElement } from "../schema";
import { planMultiRowSplit } from "./plan";

export async function splitMultiRowParents(
  ctx: OperationContext,
  lineage: ReadonlySet<string>,
  subset: Set<string> | null = null,
): Promise<string[]> {
  const all: readonly SceneElement[] = ctx.ea.getViewElements().filter((el: SceneElement) => !el.isDeleted);
  const plan = planMultiRowSplit(all, lineage, subset);
  if (!plan) return [];
  await ctx.commitPatches(plan.patches, plan.added);
  return plan.copies;
}
