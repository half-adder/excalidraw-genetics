// v2 customData schema: types and validators for the Fly Genetics drawing
// format. Ported unchanged from the scripts (README "Data model (schema
// v2)"; the `tag`/`addAppendUpdateCustomData` calls in Genotype.md,
// Cross Genotypes.md and Tidy.md).

export const SCHEMA_VERSION = 2;

export const CHROMOSOME_ORDER = ["X", "II", "III", "IV"] as const;
export type ChromosomeLabel = (typeof CHROMOSOME_ORDER)[number];
export const FORM_CHROMOSOMES = ["X", "II", "III"] as const;

export type Side = "single" | "top" | "bottom";

export type GenotypeKind =
  | "genotype-allele"
  | "genotype-fraction"
  | "genotype-separator"
  | "genotype-glyph"
  | "genotype-frame"
  | "genotype-label"
  | "genotype-label-box";
export type CrossKind = "cross-glyph" | "cross-lineage" | "cross-criterion";
export type Kind = GenotypeKind | CrossKind;

const GENOTYPE_KINDS: readonly GenotypeKind[] = [
  "genotype-allele",
  "genotype-fraction",
  "genotype-separator",
  "genotype-glyph",
  "genotype-frame",
  "genotype-label",
  "genotype-label-box",
];
const CROSS_KINDS: readonly CrossKind[] = ["cross-glyph", "cross-lineage", "cross-criterion"];
const ALL_KINDS: readonly Kind[] = [...GENOTYPE_KINDS, ...CROSS_KINDS];

export interface Parents {
  maternal: string;
  paternal: string;
}

export interface CustomData {
  schemaVersion?: number;
  kind?: string;
  genotypeId?: string;
  parents?: Parents;
  chromosome?: string;
  side?: string;
  after?: string;
  childGenotypeId?: string;
  text?: string;
  [key: string]: unknown;
}

export interface BoundRef {
  id: string;
  type: string;
}
export interface Binding {
  elementId: string;
  fixedPoint?: [number, number] | null;
  mode?: string;
  focus?: number;
  gap?: number;
}

export interface SceneElement {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  angle?: number;
  version?: number;
  versionNonce?: number;
  index?: string | null;
  isDeleted?: boolean;
  groupIds?: string[];
  boundElements?: BoundRef[] | null;
  containerId?: string | null;
  points?: Array<[number, number]>;
  startBinding?: Binding | null;
  endBinding?: Binding | null;
  fixedSegments?: unknown;
  text?: string;
  originalText?: string;
  rawText?: string;
  customData?: CustomData;
  [key: string]: unknown;
}

export type Chromosome =
  | { label: ChromosomeLabel; kind: "het"; alleles: { top: string; bottom: string } }
  | { label: ChromosomeLabel; kind: "single"; alleles: { single: string } };

export type ValidationResult = { ok: true } | { ok: false; error: string };

const isString = (v: unknown): v is string => typeof v === "string";

const isChromosomeLabel = (v: unknown): v is ChromosomeLabel =>
  isString(v) && (CHROMOSOME_ORDER as readonly string[]).includes(v);

const isSide = (v: unknown): v is Side => v === "single" || v === "top" || v === "bottom";

const validateParents = (parents: unknown): ValidationResult => {
  if (parents === undefined) return { ok: true };
  if (typeof parents !== "object" || parents === null) {
    return { ok: false, error: "parents must be an object" };
  }
  const p = parents as Record<string, unknown>;
  if (!isString(p.maternal) || !isString(p.paternal)) {
    return { ok: false, error: "parents.maternal and parents.paternal must be strings" };
  }
  return { ok: true };
};

export function validateCustomData(cd: unknown): ValidationResult {
  if (typeof cd !== "object" || cd === null || Array.isArray(cd)) {
    return { ok: false, error: "not an object" };
  }
  const data = cd as Record<string, unknown>;

  if (data.schemaVersion !== SCHEMA_VERSION) {
    return { ok: false, error: `schemaVersion must be ${SCHEMA_VERSION}` };
  }

  const kind = data.kind;
  if (!isString(kind) || !(ALL_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, error: "kind must be one of the known kinds" };
  }

  const parentsResult = validateParents(data.parents);
  if (!parentsResult.ok) return parentsResult;

  if ((GENOTYPE_KINDS as readonly string[]).includes(kind)) {
    if (!isString(data.genotypeId)) {
      return { ok: false, error: "genotypeId must be a string" };
    }
  }

  switch (kind as Kind) {
    case "genotype-allele": {
      if (!isChromosomeLabel(data.chromosome)) {
        return { ok: false, error: "chromosome must be one of CHROMOSOME_ORDER" };
      }
      if (!isSide(data.side)) {
        return { ok: false, error: "side must be single, top or bottom" };
      }
      break;
    }
    case "genotype-fraction": {
      if (!isChromosomeLabel(data.chromosome)) {
        return { ok: false, error: "chromosome must be one of CHROMOSOME_ORDER" };
      }
      break;
    }
    case "genotype-separator": {
      if (!isChromosomeLabel(data.after)) {
        return { ok: false, error: "after must be one of CHROMOSOME_ORDER" };
      }
      break;
    }
    case "cross-glyph": {
      if (data.parents === undefined) {
        return { ok: false, error: "cross-glyph requires parents" };
      }
      break;
    }
    case "cross-lineage":
    case "cross-criterion": {
      if (!isString(data.childGenotypeId)) {
        return { ok: false, error: "childGenotypeId must be a string" };
      }
      break;
    }
    default:
      break;
  }

  return { ok: true };
}

export function kindOf(el: SceneElement | null | undefined): Kind | null {
  const kind = el?.customData?.kind;
  return isString(kind) && (ALL_KINDS as readonly string[]).includes(kind) ? (kind as Kind) : null;
}

export function genotypeIdOf(el: SceneElement | null | undefined): string | null {
  const id = el?.customData?.genotypeId;
  return isString(id) ? id : null;
}

export function textOf(el: SceneElement): string {
  return el.originalText ?? el.rawText ?? el.text ?? "";
}
