// Genotype: create or edit a Drosophila genotype through the Genotype form.
// Ported from scripts/Genotype.md (the operation's body).
//
// Mode: a selection containing a genotype element edits that genotype in
// place; otherwise a new genotype is created at the free spot nearest the
// view center (or `createAt`), never overlapping existing elements.
//
// Edit mode replaces only the genotype's own elements (alleles, fractions,
// separators, glyph). Other elements sharing the genotypeId (labels, the
// frame, lineage) are kept; customData keys this command does not own (e.g.
// `parents`) and outer group memberships are carried onto the new elements.
// An offspring's label and selection criterion are rebuilt from the form.
//
// Hooks (consumed on read): _genotypeAuto skips the form; _genotypeFormProbe
// stores the form's initial state in _genotypeFormState and exits;
// _genotypeCreateAt and _genotypeDefaultGlyph unless given as parameters.
// _genotypeLastResult is set on exit: the genotypeId, or null.

import { Notice, type Modal } from "obsidian";
import type { EA } from "../excalidraw/ea";
import type { OperationContext } from "../operation";
import { take, put } from "../hooks";
import { splitDuplicateGenotypes } from "../duplicates";
import {
  addArrowLabel,
  addFrame,
  addLabelBox,
  drawGenotype,
  genotypeFontFamily,
  placeGenotype,
  withGenotypeStyle,
  type TagFn,
} from "../render";
import { boundingBox, lineagePoints, type Box } from "../scene";
import {
  CHROMOSOME_ORDER,
  FORM_CHROMOSOMES,
  SCHEMA_VERSION,
  textOf,
  type Chromosome,
  type ChromosomeLabel,
  type SceneElement,
} from "../schema";
import { FRAME_PAD, LABEL_GAP, LOCAL_FONT_FAMILY } from "../constants";
import { openGenotypeForm, type GenotypeFormState } from "../forms/genotype-form";

export interface GenotypeParams {
  createAt?: { x: number; y: number };
  defaultGlyph?: string | null;
}

const PLACE_MARGIN = 20;        // clearance from existing elements in create mode
const PLACE_SEARCH_RINGS = 12;  // grid radius searched for a free spot
const MANAGED_KINDS = new Set([
  "genotype-allele", "genotype-fraction", "genotype-separator", "genotype-glyph",
]);
const OWNED_KEYS = new Set(["schemaVersion", "genotypeId", "kind", "chromosome", "side", "after"]);
// X, II and III are always drawn: an empty one is +/+ (so "w ; +/+ ; MKRS/TM6B"
// never reads as a second chromosome). IV is drawn only when it has alleles.
const ALWAYS_DRAWN: readonly ChromosomeLabel[] = ["X", "II", "III"];

export const emptyGenotypeState = (): GenotypeFormState => ({
  glyph: null,
  X: { top: "", bottom: "" }, II: { top: "", bottom: "" },
  III: { top: "", bottom: "" }, IV: { top: "", bottom: "" },
});

// The chromosomes to draw for a form state: top+bottom a fraction, one
// filled a bare allele, both empty not drawn, except that X, II and III are
// drawn as +/+ once any allele is filled. An entirely empty state draws
// nothing (the delete case).
export function chromosomesOf(state: GenotypeFormState): Chromosome[] {
  const anyAllele = CHROMOSOME_ORDER.some((c) => (state[c]?.top ?? "").trim() || (state[c]?.bottom ?? "").trim());
  const chromosomes: Chromosome[] = [];
  for (const label of CHROMOSOME_ORDER) {
    const top = (state[label]?.top ?? "").trim();
    const bottom = (state[label]?.bottom ?? "").trim();
    if (top && bottom) chromosomes.push({ label, kind: "het", alleles: { top, bottom } });
    else if (top || bottom) chromosomes.push({ label, kind: "single", alleles: { single: top || bottom } });
    else if (anyAllele && ALWAYS_DRAWN.includes(label)) chromosomes.push({ label, kind: "het", alleles: { top: "+", bottom: "+" } });
  }
  return chromosomes;
}

// Create mode: the spot nearest (cx, cy) where a genotype `w` wide and
// 2 * halfH high clears every box by PLACE_MARGIN. Candidates form a grid
// around the point, tried in order of distance; the point itself if none is
// free. `left` is the genotype's left edge, `midlineY` its fraction line.
export function findFreeSpot(boxes: readonly Box[], cx: number, cy: number, w: number, halfH: number): { left: number; midlineY: number } {
  const h = 2 * halfH;
  const hits = (left: number, top: number) => boxes.some((b) =>
    left < b.topX + b.width + PLACE_MARGIN && left + w + PLACE_MARGIN > b.topX &&
    top < b.topY + b.height + PLACE_MARGIN && top + h + PLACE_MARGIN > b.topY);
  const sx = (w + PLACE_MARGIN) / 2;
  const sy = h + PLACE_MARGIN;
  const candidates: Array<[number, number]> = [];
  for (let i = -PLACE_SEARCH_RINGS; i <= PLACE_SEARCH_RINGS; i++) {
    for (let j = -PLACE_SEARCH_RINGS; j <= PLACE_SEARCH_RINGS; j++) {
      candidates.push([i * sx, j * sy]);
    }
  }
  candidates.sort((p, q) => Math.hypot(...p) - Math.hypot(...q));
  for (const [dx, dy] of candidates) {
    if (!hits(cx - w / 2 + dx, cy - halfH + dy)) return { left: cx - w / 2 + dx, midlineY: cy + dy };
  }
  return { left: cx - w / 2, midlineY: cy };
}

// The invisible frame around the genotype (and its label): the binding target
// for lineage arrows, whose ends sit at its top middle. `cover` holds view
// elements it must also cover (a kept label, not in the workbench); an old
// frame is kept (same id) so arrows bound to it stay bound, resized.
function frameGenotype(ea: EA, ids: readonly string[], cover: readonly SceneElement[], oldFrame: SceneElement | null, tag: TagFn): string {
  if (!oldFrame && !cover.length) return addFrame(ea, ids, tag);
  const box = ea.getBoundingBox([...ids.map((id) => ea.getElement(id)!), ...cover]);
  const fx = box.topX - FRAME_PAD, fy = box.topY - FRAME_PAD;
  const fw = box.width + 2 * FRAME_PAD, fh = box.height + 2 * FRAME_PAD;
  if (oldFrame) {
    ea.copyViewElementsToEAforEditing([oldFrame]);
    Object.assign(ea.getElement(oldFrame.id)!, { x: fx, y: fy, width: fw, height: fh });
    return oldFrame.id;
  }
  ea.style.strokeColor = "transparent";
  ea.style.backgroundColor = "transparent";
  const frameId = ea.addRect(fx, fy, fw, fh);
  tag(frameId, { kind: "genotype-frame" });
  ea.style.strokeColor = "#000000";
  return frameId;
}

export async function genotype(ctx: OperationContext, params: GenotypeParams, modals: Set<Modal>): Promise<string | null> {
  const ea = ctx.ea;
  ea.clear();

  const fontFamily = genotypeFontFamily(ea);
  if (fontFamily !== LOCAL_FONT_FAMILY) new Notice("Excalidraw local font is off; using Helvetica instead of Computer Modern.");

  // ---- Hooks ---------------------------------------------------------------
  const auto = take("_genotypeAuto") ?? null;
  const probe = !!take("_genotypeFormProbe");
  const createAt = params.createAt ?? take("_genotypeCreateAt") ?? null;
  const defaultGlyph = params.defaultGlyph !== undefined ? params.defaultGlyph : take("_genotypeDefaultGlyph");
  put("_genotypeLastResult", undefined);

  // ---- Mode + read back ----------------------------------------------------

  // Copies of a genotype made in Excalidraw become their own genotypes before
  // the selected one is read.
  if (!createAt) await splitDuplicateGenotypes(ctx);

  // With createAt set (Cross Mode), always create: the deselect Cross Mode
  // does just before lands only on Excalidraw's next render.
  const selected = createAt ? [] : ea.getViewSelectedElements();
  const selectedGenotypeIds = [...new Set(
    selected.map((el) => el.customData?.genotypeId).filter((g): g is string => !!g),
  )];
  const genotypeId = selectedGenotypeIds[0] ?? null;
  const editMode = genotypeId !== null;
  if (selectedGenotypeIds.length > 1) {
    new Notice(`Selection spans ${selectedGenotypeIds.length} genotypes; editing the first.`);
  }

  let oldElements: SceneElement[] = [];
  const initial = emptyGenotypeState();
  if (defaultGlyph !== undefined) initial.glyph = defaultGlyph; // create mode; edit mode reads the real glyph below
  let focusKey = "X.top";
  const offspring: { is: boolean; label?: SceneElement; criterion?: SceneElement; arrow?: SceneElement } = { is: false };

  if (editMode) {
    oldElements = ea.getViewElements().filter((el) =>
      el.customData?.genotypeId === genotypeId && MANAGED_KINDS.has(el.customData?.kind ?? ""));
    const skipped: string[] = [];
    for (const el of oldElements) {
      const cd = el.customData!;
      if (cd.kind === "genotype-glyph") {
        initial.glyph = textOf(el);
      } else if (cd.kind === "genotype-allele") {
        const slot = (CHROMOSOME_ORDER as readonly string[]).includes(cd.chromosome ?? "") ? initial[cd.chromosome as ChromosomeLabel] : undefined;
        if (!slot || !["top", "bottom", "single"].includes(cd.side ?? "")) {
          skipped.push(textOf(el));
          continue;
        }
        if (cd.side === "bottom") slot.bottom = textOf(el);
        else slot.top = textOf(el);
      }
    }
    if (skipped.length) new Notice(`Skipped untagged allele text: ${skipped.join(", ")}`);

    // Offspring: current label and selection criterion, editable in the form.
    const view = ea.getViewElements().filter((el) => !el.isDeleted);
    offspring.is = oldElements.some((el) => el.customData!.parents);
    offspring.label = view.find((el) => el.customData?.genotypeId === genotypeId && el.customData.kind === "genotype-label");
    offspring.criterion = view.find((el) => el.customData?.kind === "cross-criterion" && el.customData.childGenotypeId === genotypeId);
    offspring.arrow = view.find((el) => el.customData?.kind === "cross-lineage" && el.customData.childGenotypeId === genotypeId);
    initial.label = offspring.label ? textOf(offspring.label) : "";
    initial.criterion = offspring.criterion ? textOf(offspring.criterion) : "";

    const selAlleles = selected.filter((el) =>
      el.customData?.genotypeId === genotypeId && el.customData?.kind === "genotype-allele");
    if (selAlleles.length === 1) {
      const cd = selAlleles[0].customData!;
      if ((FORM_CHROMOSOMES as readonly string[]).includes(cd.chromosome ?? "")) {
        focusKey = `${cd.chromosome}.${cd.side === "bottom" ? "bottom" : "top"}`;
      }
    }
  }

  if (probe) {
    put("_genotypeFormState", { editMode, genotypeId, focusKey, ...initial });
    return null;
  }

  const state: GenotypeFormState | null = auto
    ? { ...emptyGenotypeState(), IV: { ...initial.IV }, ...structuredClone(auto) }
    : await openGenotypeForm(ctx.app, initial, { editMode, offspring: offspring.is, focusKey }, modals);
  if (!state) {
    put("_genotypeLastResult", null);
    return null;
  }

  // ---- Build elements ------------------------------------------------------
  const chromosomes = chromosomesOf(state);

  // Anchor: edit mode keeps the old left edge and midline; create uses view center.
  let anchor: { left: number; midlineY: number } | null = null;
  if (editMode && oldElements.length) {
    const left = Math.min(...oldElements.map((el) => el.x));
    const line = oldElements.find((el) => el.customData!.kind === "genotype-fraction");
    const single = oldElements.find((el) => el.customData!.kind === "genotype-allele");
    const midlineY = line ? line.y : single ? single.y + single.height / 2 : oldElements[0].y;
    anchor = { left, midlineY };
  }

  // Carry-through: customData keys we don't own, and outer group memberships.
  const carriedData: Record<string, unknown> = {};
  for (const el of oldElements) {
    for (const [k, v] of Object.entries(el.customData ?? {})) {
      if (!OWNED_KEYS.has(k) && !(k in carriedData)) carriedData[k] = v;
    }
  }
  const oldGroupIds = oldElements[0]?.groupIds ?? [];

  // The invisible frame is kept (same id) across edits so lineage arrows bound
  // to it stay bound; it is resized after the redraw.
  const oldFrame = editMode
    ? ea.getViewElements().find((el) =>
      el.customData?.genotypeId === genotypeId && el.customData?.kind === "genotype-frame") ?? null
    : null;
  const labelElements = editMode
    ? ea.getViewElements().filter((el) =>
      el.customData?.genotypeId === genotypeId &&
      (el.customData?.kind === "genotype-label" || el.customData?.kind === "genotype-label-box"))
    : [];

  const finalGenotypeId = genotypeId ?? crypto.randomUUID();
  const tag: TagFn = (id, data) => {
    ea.addAppendUpdateCustomData(id, {
      ...carriedData, schemaVersion: SCHEMA_VERSION, genotypeId: finalGenotypeId, ...data,
    });
  };

  let noArrowForCriterion = false;
  const allIds = withGenotypeStyle(ea, fontFamily, () => {
    const drawn = drawGenotype(ea, chromosomes, state.glyph, tag, fontFamily);

    const center = ea.getViewCenterPosition() ?? { x: 0, y: 0 };
    const at = createAt ?? center;
    const placement = anchor ?? findFreeSpot(
      ea.getViewElements().filter((el) => !el.isDeleted).map((el) => boundingBox([el])),
      at.x, at.y, drawn.totalWidth, drawn.halfHeight);
    placeGenotype(ea, drawn, placement.left, placement.midlineY);

    // ---- Group + commit ------------------------------------------------------
    const ids = drawn.ids;

    // Offspring label: rebuilt from the form (centered over the redrawn
    // genotype); an empty field removes it. Non-offspring keep any label as is.
    const doomed: SceneElement[] = [];
    let frameCover = labelElements;
    const newLabelIds: string[] = [];
    if (offspring.is && ids.length) {
      const text = (state.label ?? (offspring.label ? textOf(offspring.label) : "")).trim();
      doomed.push(...labelElements);
      frameCover = [];
      if (text) {
        const b = ea.getBoundingBox(ids.map((id) => ea.getElement(id)!));
        const { boxId, textId } = addLabelBox(ea, text, b.topX + b.width / 2, b.topY - LABEL_GAP, {
          schemaVersion: SCHEMA_VERSION, genotypeId: finalGenotypeId, parents: carriedData.parents, text,
        });
        newLabelIds.push(boxId, textId);
      }
    }

    const frameId = ids.length ? frameGenotype(ea, [...ids, ...newLabelIds], frameCover, oldFrame, tag) : null;
    const groupedIds = [...ids, ...newLabelIds, ...(frameId ? [frameId] : [])];

    if (oldGroupIds.length) {
      for (const id of groupedIds) ea.getElement(id)!.groupIds = [...oldGroupIds];
    } else if (groupedIds.length) {
      ea.addToGroup(groupedIds);
    }

    // Re-aim lineage arrows bound to the frame at its new top middle.
    if (oldFrame && frameId) {
      const frame = ea.getElement(frameId)!;
      const endX = frame.x + frame.width / 2, endY = frame.y;
      const arrows = ea.getViewElements().filter((el) =>
        el.type === "arrow" && !el.isDeleted && el.endBinding?.elementId === frameId);
      ea.copyViewElementsToEAforEditing(arrows);
      for (const a of arrows.map((x) => ea.getElement(x.id)!)) {
        const sx = a.x + a.points![0][0], sy = a.y + a.points![0][1];
        const pts = lineagePoints(sx, sy, endX, endY);
        a.x = sx; a.y = sy;
        a.points = pts.map(([x, y]) => [x - sx, y - sy]);
        a.width = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
        a.height = Math.max(...pts.map((p) => p[1])) - Math.min(...pts.map((p) => p[1]));
      }
    }

    // Offspring selection criterion: rebuilt as the lineage arrow's label (after
    // the arrow was re-routed above); an empty field removes it.
    if (offspring.is && ids.length) {
      const text = (state.criterion ?? (offspring.criterion ? textOf(offspring.criterion) : "")).trim();
      const arrow = offspring.arrow;
      const criterion = offspring.criterion;
      if (criterion) doomed.push(criterion);
      if (arrow) {
        if (!ea.getElement(arrow.id)) ea.copyViewElementsToEAforEditing([arrow]);
        const a = ea.getElement(arrow.id)!;
        if (criterion) a.boundElements = (a.boundElements ?? []).filter((b) => b.id !== criterion.id);
        if (text) addArrowLabel(ea, arrow.id, text, { schemaVersion: SCHEMA_VERSION, childGenotypeId: finalGenotypeId, text });
      } else if (text) {
        noArrowForCriterion = true;
      }
    }

    // Old elements are marked deleted in the same batch as the new ones are
    // added, so the edit lands as a single scene update.
    const toDelete = [...oldElements, ...doomed];
    if (toDelete.length) {
      ea.copyViewElementsToEAforEditing(toDelete.filter((el) => !ea.getElement(el.id)));
      for (const el of toDelete) ea.getElement(el.id)!.isDeleted = true;
    }
    return ids;
  });
  if (noArrowForCriterion) new Notice("This offspring has no lineage arrow to put the selection criterion on.");

  await ctx.commit();
  if (allIds.length) ctx.selectElements(allIds);
  const result = allIds.length ? finalGenotypeId : null;
  put("_genotypeLastResult", result);
  return result;
}
