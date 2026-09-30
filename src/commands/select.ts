// Select Below and Select Lineage: select the selected genotype's below-set
// or whole lineage, with the cross furniture (x glyphs, arrows, criteria)
// among them. Ported from scripts/Select Below.md and scripts/Select
// Lineage.md (the operation's body; identical but for MODE).
//
// Select Below: the seed, its descendants, and the mates in every cross they
// parent. The arrow into the seed from its own parents is left out (it is
// bound, so it follows when the selection is dragged).
// Select Lineage: everything connected through parent/child and mate links.
//
// Hook: _flySelectResult is set on exit with the result (also this
// function's return value); unset (via put(..., undefined)) is not done here
// since there is nothing to clear on entry, matching the scripts, which only
// ever write it at the end.

import { Notice } from "obsidian";
import type { OperationContext } from "../operation";
import { put } from "../hooks";
import { splitDuplicateGenotypes } from "../duplicates";
import { selectionSet, type SelectMode } from "../scene";

export interface SelectResult {
  mode: SelectMode;
  genotypes: number;
  genotypeIds: string[];
  elements: number;
}

export async function select(ctx: OperationContext, mode: SelectMode): Promise<SelectResult | null> {
  const ea = ctx.ea;

  // Copies of a genotype made in Excalidraw become their own genotypes first.
  await splitDuplicateGenotypes(ctx);

  const all = ea.getViewElements().filter((el) => !el.isDeleted);
  const seed = ea.getViewSelectedElements().find((el) => el.customData?.genotypeId)?.customData?.genotypeId;
  if (!seed) {
    new Notice("Select a genotype first.");
    return null;
  }

  const set = selectionSet(all, seed, mode);
  ctx.selectElements(set.elements);

  const result: SelectResult = {
    mode,
    genotypes: set.genotypeIds.size,
    genotypeIds: [...set.genotypeIds],
    elements: set.elements.length,
  };
  put("_flySelectResult", result);
  return result;
}
