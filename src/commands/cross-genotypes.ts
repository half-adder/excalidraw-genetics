// Cross Genotypes: creates an offspring genotype of two parental genotypes.
// Ported from scripts/Cross Genotypes.md (the operation's body, without the
// picker, which is src/forms/cross-picker.ts).
//
// Parents: `params.parents` (Cross Mode), else the selection, which must hold
// elements of exactly two genotypes. Maternal / paternal from the sex glyphs
// (♀/☿ maternal, ♂ paternal), else the leftmost parent is maternal. The
// picker (or the _crossGenotypesAuto hook) gives the offspring's sex, one
// card per chromosome, label and selection criterion. Every offspring
// element carries `parents`; the x glyph of the pair is reused or created;
// a lineage arrow runs from it to the offspring's frame (the criterion is its
// label). Then the offspring is selected and Tidy is started on its lineage,
// as part of this operation (one undo step).
//
// Hooks: _crossGenotypesAuto skips the picker (consumed on read);
// _crossGenotypesOptions holds the options shown; _crossGenotypesLastResult
// is the new genotypeId (null: no parents or cancelled); _crossGenotypesFail
// makes the command throw after drawing (tests/undo.sh).

import { Notice, type Modal } from "obsidian";
import type { OperationContext } from "../operation";
import { take, put, type CrossAuto } from "../hooks";
import { splitDuplicateGenotypes } from "../duplicates";
import {
  addArrowLabel,
  addCrossGlyph,
  addFrame,
  addLabelBox,
  addLineageArrow,
  drawGenotype,
  genotypeFontFamily,
  placeGenotype,
  withGenotypeStyle,
  type TagFn,
} from "../render";
import { boundingBox, genotypeElements, lineagePoints } from "../scene";
import { CHROMOSOME_ORDER, SCHEMA_VERSION, textOf, type SceneElement } from "../schema";
import { LABEL_GAP, LINEAGE_DROP } from "../constants";
import {
  assignParents,
  homologsOf,
  offspringChromosomes,
  optionsFor,
  type AlleleText,
  type PickerOptions,
} from "../forms/picker-options";
import { openCrossPicker, type ParentDrawing, type PickerResult } from "../forms/cross-picker";
import { tidy } from "./tidy";

export interface CrossParams {
  // The two parents' genotypeIds (Cross Mode: its selection lands only on
  // Excalidraw's next render).
  parents?: [string, string];
}

// Mean x of the elements' centers (0 for none).
export function centroidX(elements: readonly SceneElement[]): number {
  if (elements.length === 0) return 0;
  const xs = elements.map((e) => e.x + (e.width || 0) / 2);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

// The text of the genotype's sex glyph, or null.
export function glyphOf(elements: readonly SceneElement[]): string | null {
  const g = elements.find((e) => e.customData?.kind === "genotype-glyph");
  return g ? textOf(g) : null;
}

// The genotype's allele texts (trimmed), for homologsOf.
export function alleleTexts(elements: readonly SceneElement[]): AlleleText[] {
  return elements.filter((el) => el.customData?.kind === "genotype-allele").map((el) => ({
    chromosome: el.customData!.chromosome ?? "",
    side: el.customData!.side ?? "",
    text: textOf(el).trim(),
  }));
}

// A parent as the picker's header draws it: its glyph (else `fallback`), then
// its chromosomes in order, a fraction when both homologs are drawn.
export function parentDrawing(elements: readonly SceneElement[], fallback: string): ParentDrawing {
  const byChrom: Partial<Record<string, Partial<Record<string, string>>>> = {};
  let glyph: string | null = null;
  for (const el of elements) {
    const cd = el.customData;
    if (cd?.kind === "genotype-glyph") glyph = textOf(el);
    if (cd?.kind === "genotype-allele") (byChrom[cd.chromosome ?? ""] ??= {})[cd.side ?? ""] = textOf(el);
  }
  const chroms = CHROMOSOME_ORDER.filter((c) => byChrom[c]).map((c) => {
    const a = byChrom[c]!;
    return a.top !== undefined && a.bottom !== undefined
      ? { top: a.top, bottom: a.bottom }
      : { single: (a.single ?? a.top ?? a.bottom) as string };
  });
  return { glyph: glyph ?? fallback, chroms };
}

// Where a cross of these parents puts its offspring and a new x glyph: the
// offspring centered on the gap between the parents, 2 * LINEAGE_DROP below
// the lower one; the x glyph in that gap, on the parents' mean midline.
export function crossPlacement(matEls: readonly SceneElement[], patEls: readonly SceneElement[]): { midX: number; centerY: number; glyphMidY: number } {
  const box = (els: readonly SceneElement[]) => {
    const b = boundingBox(els);
    return { minX: b.topX, maxX: b.topX + b.width, maxY: b.topY + b.height };
  };
  const matBox = box(matEls), patBox = box(patEls);
  // "Left" parent = lower maxX; "right" parent = higher maxX.
  const leftBox = matBox.maxX <= patBox.maxX ? matBox : patBox;
  const rightBox = leftBox === matBox ? patBox : matBox;
  // The center of the visual gap between the two parents' bounding boxes.
  const midX = (leftBox.maxX + rightBox.minX) / 2;
  const centerY = Math.max(matBox.maxY, patBox.maxY) + LINEAGE_DROP * 2;
  const midline = (els: readonly SceneElement[]) => els.reduce((s, e) => s + e.y + (e.height || 0) / 2, 0) / els.length;
  return { midX, centerY, glyphMidY: (midline(matEls) + midline(patEls)) / 2 };
}

// The picker's answer from the _crossGenotypesAuto hook (no flips); records
// the options in _crossGenotypesOptions, as the picker does when it renders.
export function autoPick(auto: CrossAuto, options: PickerOptions): Omit<PickerResult, "flip"> {
  put("_crossGenotypesOptions", options);
  return {
    sex: auto.offspringGlyph ?? null,
    pick: { X: 0, II: 0, III: 0, ...(auto.pick ?? {}) },
    label: auto.labelText ?? "",
    criterion: auto.criterionText ?? "",
    options,
  };
}

// Whether every parent still has a live element in the drawing (Cross Mode
// hands over genotypeIds; one deleted in between has nothing to place by).
export function parentsInDrawing(parentIds: readonly string[], elements: readonly SceneElement[]): boolean {
  return parentIds.every((gid) => elements.some((el) => !el.isDeleted && el.customData?.genotypeId === gid));
}

export async function crossGenotypes(ctx: OperationContext, params: CrossParams, modals: Set<Modal>): Promise<string | null> {
  const ea = ctx.ea;
  ea.clear();

  // ---- Detect two parental genotypes ---------------------------------------
  put("_crossGenotypesLastResult", undefined);
  // Copies of a genotype made in Excalidraw become their own genotypes before
  // the parents are read (the selection may be on a copy).
  await splitDuplicateGenotypes(ctx);
  const allElements = ea.getViewElements();
  const parentIds: string[] = [];
  const given = params.parents ?? ea.getViewSelectedElements().map((el) => el.customData?.genotypeId);
  for (const gid of given) if (gid && !parentIds.includes(gid)) parentIds.push(gid);
  if (parentIds.length !== 2) {
    new Notice(`Select elements from exactly two genotypes (found ${parentIds.length}).`);
    put("_crossGenotypesLastResult", null);
    return null;
  }
  if (!parentsInDrawing(parentIds, allElements)) {
    new Notice("A parent genotype is no longer in the drawing.");
    put("_crossGenotypesLastResult", null);
    return null;
  }

  const [a, b] = parentIds.map((id) => ({ id, elements: genotypeElements(id, allElements) }));
  const { maternalId, paternalId } = assignParents(
    { id: a.id, glyph: glyphOf(a.elements), centroidX: centroidX(a.elements) },
    { id: b.id, glyph: glyphOf(b.elements), centroidX: centroidX(b.elements) },
  );
  const matEls = genotypeElements(maternalId, allElements);
  const patEls = genotypeElements(paternalId, allElements);

  // ---- Parent homologs + offspring options ---------------------------------
  const mat = homologsOf(alleleTexts(matEls), false);
  const pat = homologsOf(alleleTexts(patEls), true);

  const auto = take("_crossGenotypesAuto") ?? null;
  const picked: Omit<PickerResult, "flip"> & Partial<Pick<PickerResult, "flip">> | null = auto
    ? autoPick(auto, optionsFor(mat, pat))
    : await openCrossPicker(ctx.app, {
      maternal: parentDrawing(matEls, "♀"),
      paternal: parentDrawing(patEls, "♂"),
      mat, pat, options: optionsFor(mat, pat),
    }, modals);
  if (!picked) {
    put("_crossGenotypesLastResult", null);
    return null;
  }

  const chromosomes = offspringChromosomes(picked.options, picked.pick, picked.flip, mat, pat);
  if (!Array.isArray(chromosomes)) {
    new Notice(`No option ${chromosomes.index} for chromosome ${chromosomes.missing}.`);
    return null;
  }

  // ---- Create offspring genotype elements ----------------------------------
  const genotypeId = crypto.randomUUID();
  const parents = { maternal: maternalId, paternal: paternalId };
  // Crude initial placement: midpoint x of the parents, below the lower one.
  const { midX, centerY, glyphMidY } = crossPlacement(matEls, patEls);
  const fontFamily = genotypeFontFamily(ea);
  const tag: TagFn = (id, data) => {
    ea.addAppendUpdateCustomData(id, { schemaVersion: SCHEMA_VERSION, genotypeId, parents, ...data });
  };

  withGenotypeStyle(ea, fontFamily, () => {
    const drawn = drawGenotype(ea, chromosomes, picked.sex, tag, fontFamily);
    placeGenotype(ea, drawn, midX - drawn.totalWidth / 2, centerY);
    const allIds = [...drawn.ids];

    // Optional label (part of the offspring's group).
    const label = (picked.label || "").trim();
    if (label) {
      const { boxId, textId } = addLabelBox(ea, label, midX, centerY - drawn.slotMaxHeight / 2 - LABEL_GAP, {
        schemaVersion: SCHEMA_VERSION, genotypeId, parents, text: label,
      });
      allIds.push(boxId, textId);
    }

    // Invisible frame around offspring + label: the lineage arrow's binding target.
    const frameId = addFrame(ea, allIds, tag);
    allIds.push(frameId);
    ea.addToGroup(allIds);

    // ---- Cross furniture: x glyph + lineage arrow ----------------------------
    const existingGlyph = allElements.find((e) =>
      e.customData?.kind === "cross-glyph" &&
      e.customData.parents?.maternal === maternalId &&
      e.customData.parents?.paternal === paternalId);
    let crossGlyphEl: SceneElement;
    if (existingGlyph) {
      // Brought into the workbench so the arrow can bind to it.
      ea.copyViewElementsToEAforEditing([existingGlyph]);
      crossGlyphEl = ea.getElement(existingGlyph.id)!;
    } else {
      crossGlyphEl = addCrossGlyph(ea, maternalId, paternalId, { x: midX, y: glyphMidY }, fontFamily);
    }

    // From the bottom middle of the x glyph to the top middle of the frame.
    const frame = ea.getElement(frameId)!;
    const lineageId = addLineageArrow(ea,
      lineagePoints(crossGlyphEl.x + crossGlyphEl.width / 2, crossGlyphEl.y + crossGlyphEl.height, frame.x + frame.width / 2, frame.y),
      crossGlyphEl.id, frameId, genotypeId);

    // Optional selection criterion (label bound to the lineage arrow).
    const criterion = (picked.criterion || "").trim();
    if (criterion) {
      addArrowLabel(ea, lineageId, criterion, { schemaVersion: SCHEMA_VERSION, childGenotypeId: genotypeId, text: criterion });
    }
  });

  await ctx.commit();
  // Test hook: fail after drawing the offspring, before the result is set, to
  // test that the operation puts back what it changed.
  if (take("_crossGenotypesFail")) throw new Error("test hook: Cross Genotypes failed");

  new Notice(`Created offspring genotype ${genotypeId.slice(0, 8)}…`);
  // Cross Mode waits for this: the new offspring's genotypeId.
  put("_crossGenotypesLastResult", genotypeId);

  // ---- Auto-tidy the lineage -------------------------------------------------
  // The offspring is Tidy's seed (a selection set now lands only on the next
  // render, so Tidy would still see the parents selected); it is also
  // selected so the user sees it afterwards. Tidy is started as part of this
  // operation, so the cross and its Tidy are one undo step.
  try {
    const anchor = ea.getViewElements().find((e) => !e.isDeleted && e.customData?.genotypeId === genotypeId);
    if (anchor) {
      ctx.setAppState({ selectedElementIds: { [anchor.id]: true } });
      void ctx.start("Tidy", (c) => tidy(c, { seed: [genotypeId] }));
    }
  } catch (e) {
    // Tidy is best-effort. If something fails, the offspring is still
    // created; the user can run Tidy manually.
    console.warn("Cross: auto-tidy failed:", e);
  }
  return genotypeId;
}
