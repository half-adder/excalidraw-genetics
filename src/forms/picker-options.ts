// Cross Genotypes picker options: parent homolog extraction, offspring card
// dedup, flip and sex rules, and parent assignment by sex glyph. Pure
// functions only (no EA, no DOM); the modal in cross-picker.ts drives these.

import { CHROMOSOME_ORDER, type Chromosome, type ChromosomeLabel } from "../schema";

export const PICK_CHROMOSOMES = ["X", "II", "III"] as const;
export type PickChromosome = (typeof PICK_CHROMOSOMES)[number];

export type CardSex = "female" | "male" | "both";

export interface CardOption {
  top: string;
  bottom: string;
  sex?: CardSex;
}

export interface PickerOptions {
  X: CardOption[];
  II: CardOption[];
  III: CardOption[];
}

export interface AlleleText {
  chromosome: string;
  side: string;
  text: string;
}

export type ParentHomologs = Record<"X" | "II" | "III" | "IV", [string, string]> & { present: Set<string> };

const FEMALE_GLYPHS = new Set(["♀", "☿"]);
const MALE_GLYPHS = new Set(["♂"]);

// Two homologs per chromosome per parent. Bare = two copies, except the
// father's X, where bare means that X plus Y. Missing = +/+ (father X: +/Y).
export function homologsOf(alleles: readonly AlleleText[], isFather: boolean): ParentHomologs {
  const byChrom: Partial<Record<string, Partial<Record<string, string>>>> = {};
  for (const a of alleles) {
    (byChrom[a.chromosome] ??= {})[a.side] = a.text;
  }
  const out: Partial<Record<ChromosomeLabel, [string, string]>> = {};
  for (const label of CHROMOSOME_ORDER) {
    const a = byChrom[label];
    const fatherX = isFather && label === "X";
    if (!a) {
      out[label] = fatherX ? ["+", "Y"] : ["+", "+"];
    } else if (a.top !== undefined && a.bottom !== undefined) {
      out[label] = [a.top, a.bottom];
    } else {
      // `a` is non-empty here, so at least one of these is set.
      const one = (a.single ?? a.top ?? a.bottom) as string;
      out[label] = fatherX ? [one, "Y"] : [one, one];
    }
  }
  return { ...(out as Record<"X" | "II" | "III" | "IV", [string, string]>), present: new Set(Object.keys(byChrom)) };
}

// Maternal homolog on top. Pairs that are identical, or that differ only in
// which parent gave which homolog (CyO/+ vs +/CyO), are one card: the first
// occurrence in m1xp1, m1xp2, m2xp1, m2xp2 order is kept and later
// duplicates/flips are dropped.
export function pairs(maternal: readonly string[], paternal: readonly string[]): CardOption[] {
  const out: CardOption[] = [];
  const seen = new Set<string>();
  for (const m of maternal) {
    for (const p of paternal) {
      const key = m + "\u0000" + p;
      const flipped = p + "\u0000" + m;
      if (seen.has(key) || seen.has(flipped)) continue;
      seen.add(key);
      seen.add(flipped);
      out.push({ top: m, bottom: p });
    }
  }
  return out;
}

// Maternal homolog on top; mother x father pairs merged per pairs() above.
// X lists daughters (father's X), sons (father's Y), then both-sex combos
// (maternal X over "father's X or Y"), each tagged with `sex`; merging never
// crosses a sex tag because each tag's cards come from its own pairs() call.
export function optionsFor(mat: ParentHomologs, pat: ParentHomologs): PickerOptions {
  const patX = pat.X.filter((h) => h !== "Y");
  const fatherX = patX.length ? patX : ["+"];
  const hasY = pat.X.includes("Y");
  const tagged = (list: CardOption[], sex: CardSex): CardOption[] => list.map((o) => ({ ...o, sex }));
  const X = [
    ...tagged(pairs(mat.X, fatherX), "female"),
    ...(hasY ? tagged(pairs(mat.X, ["Y"]), "male") : []),
    ...(hasY ? tagged(pairs(mat.X, fatherX.map((p) => `${p} or Y`)), "both") : []),
  ];
  return { X, II: pairs(mat.II, pat.II), III: pairs(mat.III, pat.III) };
}

// X cards that carry a Y (sons, "X or Y" both-sex) never flip.
export function canFlip(opt: CardOption): boolean {
  return !opt.sex || opt.sex === "female";
}

// Sex follows the X card: a Y card means male, a both-sex card means both;
// an XX card keeps a virgin-female sex, else defaults to female.
export function sexFromX(options: PickerOptions, pickX: number, sex: string | null): string | null {
  const kind = options.X[pickX]?.sex;
  if (kind === "male") return "♂";
  if (kind === "both") return "⚥";
  if (sex !== "☿") return "♀";
  return sex;
}

// The X card index matching a chosen sex, if any; keeps the current index
// when the current card already matches or no card matches.
export function xFromSex(options: PickerOptions, pickX: number, sex: string | null): number {
  const want = sex === "♂" ? "male" : sex === "♀" ? "female" : sex === "☿" ? "female" : sex === "⚥" ? "both" : null;
  if (!want || options.X[pickX]?.sex === want) return pickX;
  const i = options.X.findIndex((o) => o.sex === want);
  return i >= 0 ? i : pickX;
}

// A card as drawn/used: top and bottom swapped when this chromosome's card
// at this index is flipped.
export function flippedOption(
  options: PickerOptions,
  flip: Record<PickChromosome, Record<number, boolean>>,
  chr: PickChromosome,
  idx: number,
): CardOption {
  const opt = options[chr][idx];
  return flip[chr]?.[idx] ? { ...opt, top: opt.bottom, bottom: opt.top } : opt;
}

// Maternal/paternal assignment from sex glyphs (♀/☿ -> maternal, ♂ ->
// paternal); if glyphs are absent or ambiguous, the leftmost is maternal.
export function assignParents(
  a: { id: string; glyph: string | null; centroidX: number },
  b: { id: string; glyph: string | null; centroidX: number },
): { maternalId: string; paternalId: string } {
  const aFemale = a.glyph !== null && FEMALE_GLYPHS.has(a.glyph);
  const bFemale = b.glyph !== null && FEMALE_GLYPHS.has(b.glyph);
  const aMale = a.glyph !== null && MALE_GLYPHS.has(a.glyph);
  const bMale = b.glyph !== null && MALE_GLYPHS.has(b.glyph);
  if (aFemale && bMale) return { maternalId: a.id, paternalId: b.id };
  if (bFemale && aMale) return { maternalId: b.id, paternalId: a.id };
  if (aFemale) return { maternalId: a.id, paternalId: b.id };
  if (bFemale) return { maternalId: b.id, paternalId: a.id };
  if (aMale) return { maternalId: b.id, paternalId: a.id };
  if (bMale) return { maternalId: a.id, paternalId: b.id };
  return a.centroidX <= b.centroidX ? { maternalId: a.id, paternalId: b.id } : { maternalId: b.id, paternalId: a.id };
}

// The offspring's chromosomes from the picked (and possibly flipped) cards,
// plus IV inherited untouched when either parent carries it. Missing option
// (a stale pick index) is reported instead of thrown, as the script's Notice
// path did.
export function offspringChromosomes(
  options: PickerOptions,
  pick: Record<PickChromosome, number>,
  flip: Partial<Record<PickChromosome, Record<number, boolean>>> | undefined,
  mat: ParentHomologs,
  pat: ParentHomologs,
): Chromosome[] | { missing: PickChromosome; index: number } {
  const chromosomes: Chromosome[] = [];
  for (const label of PICK_CHROMOSOMES) {
    const opt = options[label][pick[label]];
    if (!opt) {
      return { missing: label, index: pick[label] };
    }
    const flipped = flip?.[label]?.[pick[label]];
    const alleles = flipped ? { top: opt.bottom, bottom: opt.top } : { top: opt.top, bottom: opt.bottom };
    chromosomes.push({ label, kind: "het", alleles });
  }
  if (mat.present.has("IV") || pat.present.has("IV")) {
    chromosomes.push({ label: "IV", kind: "het", alleles: { top: mat.IV[0], bottom: pat.IV[0] } });
  }
  return chromosomes;
}
