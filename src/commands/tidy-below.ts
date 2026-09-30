// Tidy Below: tidies only at or below the selected genotype. Starts Select
// Below (the genotype, its descendants and the mates in every cross they
// parent), then Tidy, which tidies exactly the genotypes Select Below chose.
// The selected genotype stays where it is; its parents, siblings, the x
// glyph above it and the arrow into it are kept (the arrow is re-bound to
// it). Everything else in the drawing is an obstacle the tidied part keeps
// clear of. Ported from scripts/Tidy Below.md (the operation's body).
//
// Tidy Below, its Select Below and its Tidy are one operation (one undo
// step). Both are started with ctx.start (the scripts' flyStart), not
// joined: a failure of either is put back and reported under its own name.
// The script's _tidySeed hand-off is Tidy's `seed` parameter, and its
// _flySelectResult polling is the value Select Below's start resolves to
// (undefined if it failed, did not start, or the drawing left the view).

import { Notice } from "obsidian";
import type { OperationContext } from "../operation";
import { put, take } from "../hooks";
import { select } from "./select";
import { tidy } from "./tidy";

export async function tidyBelow(ctx: OperationContext): Promise<void> {
  if (!ctx.ea.getViewSelectedElements().some((el) => el.customData?.genotypeId)) {
    new Notice("Tidy Below: select a genotype first.");
    return;
  }

  // Resolves with Select Below's result once it has ended, or undefined if
  // it ended without one.
  put("_flySelectResult", undefined);
  const result = await ctx.start("Select Below", (c) => select(c, "below"));
  put("_flySelectResult", undefined);
  // Test hook (consumed on read): fail after Select Below has run, to test
  // that what Select Below changed stands.
  if (take("_tidyBelowFail")) throw new Error("test hook: Tidy Below failed");
  if (!result) {
    new Notice("Tidy Below: Select Below did not finish.");
    return;
  }
  // Tidy with a single genotype selected would tidy its whole lineage.
  if (result.genotypes < 2) {
    new Notice("Tidy Below: nothing below this genotype to tidy.");
    return;
  }
  // Test hook (consumed on read): an async function awaited here, e.g. to
  // switch the tab to another drawing before Tidy starts.
  const pause = take("_tidyBelowPause");
  if (pause) await pause();
  // The genotypes go to Tidy explicitly: the selection Select Below set
  // lands only on Excalidraw's next render. Not started (skipped) if the tab
  // has moved to another drawing.
  void ctx.start("Tidy", (c) => tidy(c, { seed: result.genotypeIds }));
}
