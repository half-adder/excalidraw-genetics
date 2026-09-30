// The Cross Genotypes picker: the two parents drawn as a header, a live
// preview of the offspring, a sex column linked to the X card, one column of
// cards per chromosome (X, II, III) and optional label and selection
// criterion. Ported from scripts/Cross Genotypes.md (openPicker, GLYPHS);
// static styles are the fly-* classes in styles.css.
//
// Keys: Up / Down pick a card in the focused column; Left / Right move
// between columns (Right from III goes to the label); Tab / Shift+Tab cycle
// the columns and inputs; Enter commits (Cmd/Ctrl+Enter in the criterion,
// where Enter adds a line); Esc closes without a result. F flips the card
// under the mouse, else the focused column's selected card; flipping also
// selects the card. X cards that carry a Y never flip. F typed in the label
// or criterion types normally.

import { Modal, type App } from "obsidian";
import { put } from "../hooks";
import {
  PICK_CHROMOSOMES,
  canFlip,
  flippedOption,
  sexFromX,
  xFromSex,
  type CardOption,
  type ParentHomologs,
  type PickChromosome,
  type PickerOptions,
} from "./picker-options";

// A parent as the header draws it: its sex glyph (or the fallback), then per
// chromosome a fraction or a bare allele, in chromosome order.
export interface ParentDrawing {
  glyph: string | null;
  chroms: Array<{ top: string; bottom: string } | { single: string }>;
}

export interface PickerState {
  sex: string | null;
  pick: Record<PickChromosome, number>;
  label: string;
  criterion: string;
  // flip[chr][idx]: card idx of chromosome chr is shown and used top-bottom
  // swapped. Per card, lasts while the picker is open.
  flip: Record<PickChromosome, Record<number, boolean>>;
}

export interface PickerResult extends PickerState {
  options: PickerOptions;
}

export interface PickerInput {
  maternal: ParentDrawing;
  paternal: ParentDrawing;
  mat: ParentHomologs;
  pat: ParentHomologs;
  options: PickerOptions;
}

const GLYPHS: ReadonlyArray<{ label: string; title: string; value: string | null }> = [
  { label: "♂", title: "Male", value: "♂" },
  { label: "♀", title: "Female", value: "♀" },
  { label: "☿", title: "Virgin female", value: "☿" },
  { label: "⚥", title: "Both sexes", value: "⚥" },
  { label: "none", title: "No glyph", value: null },
];

type MiniChrom = { top: string; bottom: string } | { single: string };

// Small DOM rendering of a genotype: glyph, then per chromosome either top
// over a bar over bottom, or a bare allele; `;` between chromosomes.
function drawMini(container: HTMLElement, glyph: string | null, chroms: readonly MiniChrom[]): HTMLElement {
  const g = container.createDiv({ cls: "fly-mini" });
  if (glyph) g.createSpan({ text: glyph }).style.fontSize = "1.3em";
  chroms.forEach((a, i) => {
    if (!("single" in a)) {
      const f = g.createDiv({ cls: "fly-mini-fraction" });
      f.createDiv({ text: a.top }).style.whiteSpace = "nowrap";
      f.createDiv({ cls: "fly-mini-bar" });
      f.createDiv({ text: a.bottom }).style.whiteSpace = "nowrap";
    } else {
      g.createSpan({ text: a.single }).style.whiteSpace = "nowrap";
    }
    if (i < chroms.length - 1) g.createSpan({ text: ";" }).style.fontWeight = "600";
  });
  return g;
}

// Opens the picker; resolves with the picked state and the options it
// showed, or null if it was cancelled. While open, the modal is in `modals`
// and exposed as window._crossGenotypesModal for the tests; every render
// records the options in window._crossGenotypesOptions.
export function openCrossPicker(app: App, input: PickerInput, modals: Set<Modal>): Promise<PickerResult | null> {
  const { maternal, paternal, mat, pat, options } = input;
  return new Promise((resolve) => {
    const modal = new Modal(app);
    const state: PickerState = { sex: null, pick: { X: 0, II: 0, III: 0 }, label: "", criterion: "", flip: { X: {}, II: {}, III: {} } };
    // X lists daughters and sons together; sex and the X card stay
    // consistent: a Y card means male, an XX card female (virgin female kept
    // if chosen).
    const updateSexFromX = () => { state.sex = sexFromX(options, state.pick.X, state.sex); };
    const updateXFromSex = () => { state.pick.X = xFromSex(options, state.pick.X, state.sex); };
    const shown = (chr: PickChromosome, idx: number): CardOption => flippedOption(options, state.flip, chr, idx);
    updateSexFromX();
    let result: PickerResult | null = null;

    modal.onOpen = () => {
      const { contentEl, titleEl } = modal;
      titleEl.setText("Cross offspring");
      modal.modalEl.addClass("fly-cross-picker");
      modal.modalEl.style.width = "auto";
      modal.modalEl.style.maxWidth = "95vw";

      // Header: both parents drawn as they appear on the canvas.
      const header = contentEl.createDiv({ cls: "fly-picker-header" });
      drawMini(header, maternal.glyph, maternal.chroms);
      header.createSpan({ text: "×", cls: "fly-picker-times" });
      drawMini(header, paternal.glyph, paternal.chroms);

      // Live preview of the offspring, under the parents (divider above it), above the cards.
      const preview = contentEl.createDiv({ cls: "fly-picker-preview" });
      preview.createDiv({ text: "Offspring", cls: "fly-picker-preview-title" });
      const previewBody = preview.createDiv();
      const renderPreview = () => {
        previewBody.empty();
        const chroms: CardOption[] = PICK_CHROMOSOMES.map((c) => shown(c, state.pick[c]));
        if (mat.present.has("IV") || pat.present.has("IV")) chroms.push({ top: mat.IV[0], bottom: pat.IV[0] });
        drawMini(previewBody, state.sex, chroms.map((o) => ({ top: o.top, bottom: o.bottom })));
      };

      const body = contentEl.createDiv({ cls: "fly-picker-body" });

      // The column's top margin is the column header height, so it centers on the cards.
      const sexCol = body.createDiv({ cls: "fly-picker-sex" });
      const sexButtons = GLYPHS.map((g) => {
        const b = sexCol.createEl("button", { text: g.label, cls: "fly-glyph-button", attr: { title: g.title, tabindex: "-1" } });
        if (g.value) b.addClass("fly-glyph-symbol");
        b.onclick = () => {
          state.sex = g.value;
          updateXFromSex();
          render();
          focusColumn("X");
        };
        return { b, g };
      });

      const grid = body.createDiv({ cls: "fly-picker-grid" });
      const columns = {} as Record<PickChromosome, HTMLDivElement>;
      PICK_CHROMOSOMES.forEach((chr, ci) => {
        const wrap = grid.createDiv({ cls: "fly-picker-column" });
        wrap.createDiv({ text: chr, cls: "fly-picker-column-header" });
        const col = wrap.createDiv({ cls: "fly-picker-cards", attr: { tabindex: "0" } });
        col.addEventListener("focus", () => { col.style.boxShadow = "0 0 0 2px var(--interactive-accent)"; });
        col.addEventListener("blur", () => { col.style.boxShadow = "none"; });
        columns[chr] = col;
        if (ci < PICK_CHROMOSOMES.length - 1) grid.createDiv({ text: ";", cls: "fly-picker-separator" });
      });

      // Criterion is multi-line: Enter adds a line there; Cmd/Ctrl+Enter commits.
      const extras = contentEl.createDiv({ cls: "fly-picker-extras" });
      const mkField = <E extends HTMLInputElement | HTMLTextAreaElement>(input: E, key: "label" | "criterion", multiline: boolean): E => {
        input.style.width = "220px";
        if (multiline) input.style.resize = "vertical";
        input.addEventListener("input", () => { state[key] = input.value; });
        return input;
      };
      const labelInput = mkField(extras.createEl("input", { type: "text", attr: { placeholder: "Label (optional)", spellcheck: "false" } }), "label", false);
      const critInput = mkField(extras.createEl("textarea", {
        attr: { placeholder: "Selection criterion (optional)\nEnter: new line, Cmd+Enter: OK", spellcheck: "false", rows: "3" },
      }), "criterion", true);

      const buttons = contentEl.createDiv({ cls: "fly-form-buttons" });
      const ok = buttons.createEl("button", { text: "OK", cls: "mod-cta" });
      const cancel = buttons.createEl("button", { text: "Cancel" });

      // Card under the mouse (chr, idx into options[chr]), for F. Not the
      // browser :hover pseudo-class: tracked explicitly so keyboard-driven
      // tests can set it via a synthetic mouseenter.
      let hovered: { chr: PickChromosome; idx: number } | null = null;

      const card = (chr: PickChromosome, idx: number, opt: CardOption, selected: boolean, onClick: () => void): HTMLDivElement => {
        const c = createDiv({ cls: selected ? "fly-card is-selected" : "fly-card" });
        c.createDiv({ text: opt.top }).style.whiteSpace = "nowrap";
        c.createDiv({ cls: "fly-card-bar" });
        c.createDiv({ text: opt.bottom }).style.whiteSpace = "nowrap";
        c.onclick = onClick;
        c.addEventListener("mouseenter", () => { hovered = { chr, idx }; });
        c.addEventListener("mouseleave", () => {
          if (hovered && hovered.chr === chr && hovered.idx === idx) hovered = null;
        });
        return c;
      };

      function render() {
        sexButtons.forEach(({ b, g }) => b.toggleClass("mod-cta", g.value === state.sex));
        for (const chr of PICK_CHROMOSOMES) {
          const col = columns[chr];
          col.empty();
          options[chr].forEach((_, i) => {
            col.appendChild(card(chr, i, shown(chr, i), i === state.pick[chr], () => {
              state.pick[chr] = i;
              if (chr === "X") updateSexFromX();
              render();
              focusColumn(chr);
            }));
          });
        }
        renderPreview();
        put("_crossGenotypesOptions", options);
      }

      const focusOrder: HTMLElement[] = [...PICK_CHROMOSOMES.map((c) => columns[c]), labelInput, critInput];
      function focusColumn(chr: PickChromosome) { columns[chr].focus(); }

      const commit = () => {
        result = { ...state, options };
        modal.close();
      };
      ok.onclick = commit;
      cancel.onclick = () => modal.close();

      contentEl.addEventListener("keydown", (e) => {
        const active = activeDocument.activeElement;
        const idx = focusOrder.indexOf(active as HTMLElement);
        const chr = PICK_CHROMOSOMES.find((c) => columns[c] === active);
        if (e.key === "Enter") {
          if (active === critInput && !(e.metaKey || e.ctrlKey)) return; // newline
          e.preventDefault();
          commit();
        } else if (e.key === "Tab") {
          e.preventDefault();
          const n = focusOrder.length;
          focusOrder[((idx < 0 ? 0 : idx) + (e.shiftKey ? -1 : 1) + n) % n].focus();
        } else if (chr && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          e.preventDefault();
          const n = options[chr].length;
          state.pick[chr] = (state.pick[chr] + (e.key === "ArrowUp" ? -1 : 1) + n) % n;
          if (chr === "X") updateSexFromX();
          render();
          focusColumn(chr);
        } else if (chr && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          const ci = PICK_CHROMOSOMES.indexOf(chr) + (e.key === "ArrowLeft" ? -1 : 1);
          if (ci >= 0 && ci < PICK_CHROMOSOMES.length) focusColumn(PICK_CHROMOSOMES[ci]);
          else if (ci === PICK_CHROMOSOMES.length) labelInput.focus();
        } else if ((e.key === "f" || e.key === "F") && !(e.metaKey || e.ctrlKey || e.altKey)) {
          if (active === labelInput || active === critInput) return; // type normally
          e.preventDefault();
          const target = hovered ?? (chr ? { chr, idx: state.pick[chr] } : null);
          if (!target || !canFlip(options[target.chr][target.idx])) return; // no card, or an X/Y card
          state.pick[target.chr] = target.idx; // flipping a card also selects it
          if (target.chr === "X") updateSexFromX();
          state.flip[target.chr][target.idx] = !state.flip[target.chr][target.idx];
          render();
          focusColumn(target.chr);
        }
      });

      render();
      put("_crossGenotypesModal", { modal, state, columns, labelInput, critInput });
      // Modal.open() focuses the first input after onOpen; take focus back next tick.
      window.setTimeout(() => focusColumn("X"), 0);
    };
    modal.onClose = () => {
      put("_crossGenotypesModal", undefined);
      modals.delete(modal);
      modal.contentEl.empty();
      resolve(result);
    };
    modals.add(modal);
    modal.open();
  });
}
