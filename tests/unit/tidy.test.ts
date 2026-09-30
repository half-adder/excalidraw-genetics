import { describe, expect, it } from "vitest";
import { tidyTarget } from "../../src/commands/tidy";
import type { SceneElement } from "../../src/schema";

const el = (id: string, genotypeId?: string): SceneElement =>
  ({ id, type: "text", x: 0, y: 0, width: 1, height: 1, customData: genotypeId ? { genotypeId } : undefined });

describe("tidyTarget", () => {
  it("nothing selected, no seed: tidy every lineage", () => {
    expect(tidyTarget(undefined, [])).toEqual({ seedId: null, gids: new Set(), notice: null });
  });
  it("a selection without a tagged genotype is refused with the script's Notice", () => {
    expect(tidyTarget(undefined, [el("a")]).notice).toBe("Selected element is not part of a tagged genotype.");
  });
  it("the first tagged selected element is the seed; the set is every selected genotype", () => {
    const t = tidyTarget(undefined, [el("a"), el("b", "G1"), el("c", "G2"), el("d", "G1")]);
    expect(t.seedId).toBe("G1");
    expect([...t.gids]).toEqual(["G1", "G2"]);
    expect(t.notice).toBeNull();
  });
  it("a seed replaces the selection (empty entries dropped); its first id is the seed", () => {
    const t = tidyTarget(["", "G3", "G4"], [el("b", "G1")]);
    expect(t.seedId).toBe("G3");
    expect([...t.gids]).toEqual(["G3", "G4"]);
  });
  it("an empty seed tidies nothing selected, as the script's fresh empty seed did", () => {
    expect(tidyTarget([], [el("b", "G1")])).toEqual({ seedId: null, gids: new Set(), notice: null });
  });
});
