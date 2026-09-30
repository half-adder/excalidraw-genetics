import { describe, expect, it } from "vitest";
import { fixtureNames, loadFixture } from "./helpers/fixtures";
import { genotypeIdOf, kindOf, SCHEMA_VERSION, textOf, validateCustomData } from "../../src/schema";

describe("validateCustomData", () => {
  it.each(fixtureNames())("accepts every tagged element of fixture %s", (name) => {
    const bad = loadFixture(name).elements
      .filter((e) => e.customData)
      .map((e) => [e.id, validateCustomData(e.customData)] as const)
      .filter(([, r]) => !r.ok);
    expect(bad).toEqual([]);
  });
  it("rejects malformed customData", () => {
    const base = { schemaVersion: SCHEMA_VERSION, genotypeId: "g" };
    expect(validateCustomData({ ...base, kind: "genotype-allele", chromosome: "V", side: "top" }).ok).toBe(false);
    expect(validateCustomData({ ...base, kind: "genotype-allele", chromosome: "II", side: "left" }).ok).toBe(false);
    expect(validateCustomData({ ...base, kind: "genotype-frame", parents: { maternal: "a" } }).ok).toBe(false);
    expect(validateCustomData({ schemaVersion: SCHEMA_VERSION, kind: "cross-glyph" }).ok).toBe(false);
    expect(validateCustomData({ schemaVersion: SCHEMA_VERSION, kind: "cross-lineage" }).ok).toBe(false);
    expect(validateCustomData({ ...base, kind: "genotype-nonsense" }).ok).toBe(false);
    expect(validateCustomData("x").ok).toBe(false);
  });
  it("allows keys it does not own (Genotype carries them through)", () => {
    expect(validateCustomData({ schemaVersion: 2, kind: "genotype-glyph", genotypeId: "g", note: 1 }).ok).toBe(true);
  });
});

describe("accessors", () => {
  const el = { id: "a", type: "text", x: 0, y: 0, width: 1, height: 1, text: "w\n", originalText: "w", customData: { schemaVersion: 2, kind: "genotype-allele", genotypeId: "g", chromosome: "X", side: "top" } };
  it("reads kind, genotype id and text", () => {
    expect(kindOf(el)).toBe("genotype-allele");
    expect(genotypeIdOf(el)).toBe("g");
    expect(genotypeIdOf(null)).toBe(null);
    expect(textOf(el)).toBe("w");
    expect(textOf({ ...el, originalText: undefined, rawText: undefined })).toBe("w\n");
  });
});
