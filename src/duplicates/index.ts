// Copies of a genotype made in Excalidraw (Cmd+D, copy/paste, alt-drag)
// become their own genotypes: see plan.ts for the rules. Commits the plan
// through the running operation. Changes the scene only if a duplicate was
// found; returns whether it did.

import type { OperationContext } from "../operation";
import { planDuplicateSplit } from "./plan";

export async function splitDuplicateGenotypes(ctx: OperationContext): Promise<boolean> {
  const plan = planDuplicateSplit(ctx.ea.getViewElements());
  if (!plan) return false;
  await ctx.commitPatches(plan.patches);
  return true;
}
