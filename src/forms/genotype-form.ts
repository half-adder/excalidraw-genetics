// The Genotype form: a sex-symbol column and one text field per homolog (X,
// II, III x top/bottom), plus label and selection criterion for an
// offspring. Ported from scripts/Genotype.md (openForm); static styles are
// the fly-* classes in styles.css.
//
// Keys: Tab / Shift+Tab next / previous field; Up / Down top / bottom homolog
// of the same chromosome; Left / Right at a field edge jump chromosome;
// Enter commits (Cmd+Enter in the criterion); Esc closes without changes.
// Option+F flips the chromosome under the mouse, else the focused one (focus
// follows the text); the small button beside each header does the same. A
// chromosome carrying "Y" never flips.

import { Modal, type App } from "obsidian";
import { CHROMOSOME_ORDER, FORM_CHROMOSOMES } from "../schema";
import { put } from "../hooks";

export interface Homologs {
  top: string;
  bottom: string;
}

export interface GenotypeFormState {
  glyph: string | null;
  X: Homologs;
  II: Homologs;
  III: Homologs;
  IV: Homologs;
  label?: string;
  criterion?: string;
}

export interface GenotypeFormOptions {
  editMode: boolean;
  offspring: boolean;
  focusKey: string;
}

type FormChromosome = (typeof FORM_CHROMOSOMES)[number];

const GLYPHS: ReadonlyArray<{ label: string; title: string; value: string | null }> = [
  { label: "♂", title: "Male", value: "♂" },
  { label: "♀", title: "Female", value: "♀" },
  { label: "☿", title: "Virgin female", value: "☿" },
  { label: "⚥", title: "Both sexes", value: "⚥" },
  { label: "none", title: "No glyph", value: null },
];
const FIELD_MIN_WIDTH = 120;     // form field width floor, px
const FIELD_PADDING = 28;        // input padding + caret room, px

// Opens the form on `init`; resolves with the entered state, or null if it
// was cancelled (or, creating, left entirely empty). While open, the modal
// is in `modals` and exposed as window._genotypeFormModal for the tests.
export function openGenotypeForm(app: App, init: GenotypeFormState, opts: GenotypeFormOptions, modals: Set<Modal>): Promise<GenotypeFormState | null> {
  const { editMode, focusKey } = opts;
  return new Promise((resolve) => {
    const modal = new Modal(app);
    let result: GenotypeFormState | null = null;
    let glyph = init.glyph;
    let confirmDelete = false;

    modal.onOpen = () => {
      const { contentEl, titleEl } = modal;
      titleEl.setText(editMode ? "Edit genotype" : "New genotype");
      modal.modalEl.addClass("fly-genotype-form");

      // Sex-symbol buttons stacked in a column to the left of the allele grid.
      const body = contentEl.createDiv({ cls: "fly-genotype-body" });
      // The column's top margin offsets the grid's header row so it centers on the fraction line.
      const glyphRow = body.createDiv({ cls: "fly-glyph-column" });
      const glyphButtons = GLYPHS.map((g) => {
        const b = glyphRow.createEl("button", { text: g.label, cls: "fly-glyph-button", attr: { title: g.title, tabindex: "-1" } });
        if (g.value) b.addClass("fly-glyph-symbol");
        b.onclick = () => { glyph = g.value; refreshGlyphs(); };
        return { b, g };
      });
      const refreshGlyphs = () => glyphButtons.forEach(({ b, g }) => b.toggleClass("mod-cta", g.value === glyph));
      refreshGlyphs();

      // Columns: X ; II ; III, with a `;` column between chromosomes. Each
      // chromosome is its own wrapper (a small grid: header+flip button, top
      // allele, fraction bar, bottom allele) so the flip button sits beside
      // the header without disturbing the outer column layout.
      const grid = body.createDiv({ cls: "fly-genotype-grid" });
      const col = (ci: number) => 2 * ci + 1;
      const inputs: Record<string, HTMLInputElement> = {};
      const chrWraps = {} as Record<FormChromosome, HTMLDivElement>;
      const flipButtons = {} as Record<FormChromosome, HTMLButtonElement>;
      // Chromosome under the mouse, for Option+F and the flip button's
      // faint/bright state. Tracked explicitly (not the :hover pseudo-class)
      // so keyboard-driven tests can set it via a synthetic mouseenter.
      let hoveredChr: FormChromosome | null = null;

      // A chromosome flips only when both homologs are filled and neither is
      // "Y": a hemizygous/bare chromosome, or one carrying Y, never flips.
      const canFlipChr = (chr: FormChromosome) => {
        const top = inputs[`${chr}.top`].value.trim(), bottom = inputs[`${chr}.bottom`].value.trim();
        return !!top && !!bottom && top !== "Y" && bottom !== "Y";
      };
      const updateFlipButton = (chr: FormChromosome) => {
        const ok = canFlipChr(chr);
        const btn = flipButtons[chr];
        btn.disabled = !ok;
        btn.style.visibility = ok ? "visible" : "hidden";
        btn.style.opacity = !ok ? "0" : hoveredChr === chr ? "0.85" : "0.35";
      };
      const doFlip = (chr: FormChromosome) => {
        if (!canFlipChr(chr)) return;
        const top = inputs[`${chr}.top`], bottom = inputs[`${chr}.bottom`];
        [top.value, bottom.value] = [bottom.value, top.value];
        resizeColumn(chr);
        updateFlipButton(chr);
        if (confirmDelete) { confirmDelete = false; warn.setText(""); }
      };

      FORM_CHROMOSOMES.forEach((chr, ci) => {
        const wrap = grid.createDiv({ cls: "fly-chromosome" });
        wrap.style.gridColumn = String(col(ci));
        wrap.addEventListener("mouseenter", () => { hoveredChr = chr; updateFlipButton(chr); });
        wrap.addEventListener("mouseleave", () => {
          if (hoveredChr === chr) { hoveredChr = null; updateFlipButton(chr); }
        });
        chrWraps[chr] = wrap;

        const h = wrap.createDiv({ cls: "fly-chromosome-header" });
        h.createSpan({ text: chr, cls: "fly-chromosome-name" });
        const flipBtn = h.createEl("button", { text: "⇅", cls: "fly-flip-button", attr: { title: "Flip (Option+F)", tabindex: "-1" } });
        flipBtn.onclick = (e) => { e.preventDefault(); e.stopPropagation(); doFlip(chr); };
        flipButtons[chr] = flipBtn;

        if (ci < FORM_CHROMOSOMES.length - 1) {
          const sep = grid.createDiv({ text: ";", cls: "fly-chromosome-separator" });
          sep.style.gridColumn = String(col(ci) + 1);
        }
        wrap.createDiv({ cls: "fly-fraction-bar" });
      });
      for (const side of ["top", "bottom"] as const) {
        FORM_CHROMOSOMES.forEach((chr) => {
          const input = chrWraps[chr].createEl("input", { type: "text", attr: { spellcheck: "false" } });
          input.style.gridRow = side === "top" ? "2" : "4";
          input.value = init[chr][side];
          input.style.textAlign = "center";
          inputs[`${chr}.${side}`] = input;
        });
      }

      // Size each chromosome column to its longest allele; the modal grows with it.
      modal.modalEl.style.width = "auto";
      modal.modalEl.style.maxWidth = "95vw";
      const measureCtx = activeDocument.createElement("canvas").getContext("2d");
      const textWidth = (input: HTMLInputElement) => {
        if (!measureCtx) return 0;
        measureCtx.font = getComputedStyle(input).font;
        return measureCtx.measureText(input.value).width;
      };
      const resizeColumn = (chr: FormChromosome) => {
        const pair = [inputs[`${chr}.top`], inputs[`${chr}.bottom`]];
        const w = Math.max(FIELD_MIN_WIDTH, ...pair.map(textWidth)) + FIELD_PADDING;
        for (const input of pair) input.style.width = `${Math.ceil(w)}px`;
      };
      FORM_CHROMOSOMES.forEach((chr) => { resizeColumn(chr); updateFlipButton(chr); });

      // Offspring only: label and (multi-line) selection criterion.
      const extras: Array<HTMLInputElement | HTMLTextAreaElement> = [];
      let labelInput: HTMLInputElement | null = null, critInput: HTMLTextAreaElement | null = null;
      if (opts.offspring) {
        const row = contentEl.createDiv({ cls: "fly-offspring-row" });
        labelInput = row.createEl("input", { type: "text", cls: "fly-label-input", attr: { placeholder: "Label (optional)", spellcheck: "false" } });
        labelInput.value = init.label ?? "";
        critInput = row.createEl("textarea", { cls: "fly-criterion-input", attr: {
          placeholder: "Selection criterion (optional)\nEnter: new line, Cmd+Enter: OK", spellcheck: "false", rows: "3" } });
        critInput.value = init.criterion ?? "";
        extras.push(labelInput, critInput);
      }

      const warn = contentEl.createDiv({ cls: "fly-form-warning" });

      const buttons = contentEl.createDiv({ cls: "fly-form-buttons" });
      const ok = buttons.createEl("button", { text: "OK", cls: "mod-cta" });
      const cancel = buttons.createEl("button", { text: "Cancel" });

      const order = FORM_CHROMOSOMES.flatMap((c) => [`${c}.top`, `${c}.bottom`]);
      const focus = (key: string, caret: "start" | "end") => {
        const el = inputs[key];
        el.focus();
        const pos = caret === "start" ? 0 : el.value.length;
        el.setSelectionRange(pos, pos);
      };

      const commit = () => {
        const read = (chr: FormChromosome): Homologs => ({ top: inputs[`${chr}.top`].value, bottom: inputs[`${chr}.bottom`].value });
        const state: GenotypeFormState = {
          glyph, IV: { ...init.IV },
          label: labelInput ? labelInput.value : undefined,
          criterion: critInput ? critInput.value : undefined,
          X: read("X"), II: read("II"), III: read("III"),
        };
        const empty = CHROMOSOME_ORDER.every((c) => !state[c].top.trim() && !state[c].bottom.trim());
        if (empty && editMode && !confirmDelete) {
          confirmDelete = true;
          warn.setText("All fields are empty. Press Enter again to delete this genotype.");
          return;
        }
        result = empty && !editMode ? null : state;
        modal.close();
      };
      ok.onclick = commit;
      cancel.onclick = () => modal.close();

      for (const [key, input] of Object.entries(inputs)) {
        const [chr, side] = key.split(".") as [FormChromosome, string];
        const ci = FORM_CHROMOSOMES.indexOf(chr);
        input.addEventListener("input", () => {
          resizeColumn(chr);
          updateFlipButton(chr);
          if (confirmDelete) { confirmDelete = false; warn.setText(""); }
        });
        input.addEventListener("keydown", (e) => {
          const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
          const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
          let target: string | null = null;
          let caret: "start" | "end" = "end";
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            return;
          } else if (e.key === "Tab") {
            e.preventDefault();
            tabFrom(input, e.shiftKey);
            return;
          } else if (e.key === "ArrowUp") {
            target = `${chr}.top`;
          } else if (e.key === "ArrowDown") {
            target = `${chr}.bottom`;
          } else if (e.key === "ArrowLeft" && atStart && ci > 0) {
            target = `${FORM_CHROMOSOMES[ci - 1]}.${side}`;
          } else if (e.key === "ArrowRight" && atEnd && ci < FORM_CHROMOSOMES.length - 1) {
            target = `${FORM_CHROMOSOMES[ci + 1]}.${side}`;
            caret = "start";
          } else {
            return;
          }
          e.preventDefault();
          if (target !== key) focus(target, caret);
        });
      }

      // Tab cycles through the allele fields, then the label and criterion.
      function tabFrom(el: HTMLInputElement | HTMLTextAreaElement, back: boolean) {
        const ring = [...order.map((k) => inputs[k]), ...extras];
        const next = ring[(ring.indexOf(el) + (back ? -1 : 1) + ring.length) % ring.length];
        next.focus();
        next.setSelectionRange?.(next.value.length, next.value.length);
      }
      for (const el of extras) {
        (el as HTMLElement).addEventListener("keydown", (e) => {
          if (e.key === "Tab") { e.preventDefault(); tabFrom(el, e.shiftKey); }
          else if (e.key === "Enter" && (el === labelInput || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        });
      }

      // Option+F flips a chromosome: swap its top and bottom text. On macOS
      // this key produces e.key "ƒ", so match on the physical key
      // (e.code) and altKey, not e.key, and always preventDefault so no
      // stray character is typed. Acts on the chromosome under the mouse; if
      // the mouse is not over a chromosome, acts on the chromosome of the
      // focused field, and focus follows the flipped text (same field
      // position, same cursor offset) so typing continues uninterrupted.
      contentEl.addEventListener("keydown", (e) => {
        if (e.code !== "KeyF" || !e.altKey || e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        if (hoveredChr) { doFlip(hoveredChr); return; }
        const active = activeDocument.activeElement;
        const activeKey = Object.keys(inputs).find((k) => inputs[k] === active);
        if (!activeKey) return;
        const [chr, side] = activeKey.split(".") as [FormChromosome, string];
        if (!canFlipChr(chr)) return;
        const caret = inputs[activeKey].selectionStart ?? 0;
        doFlip(chr);
        const other = inputs[`${chr}.${side === "top" ? "bottom" : "top"}`];
        other.focus();
        const pos = Math.min(caret, other.value.length);
        other.setSelectionRange(pos, pos);
      });

      put("_genotypeFormModal", { modal, inputs, focusKey, labelInput, critInput, chromosomes: chrWraps, flipButtons });
      // Modal.open() focuses the first input after onOpen; take focus back next tick.
      window.setTimeout(() => focus(focusKey, "end"), 0);
    };
    modal.onClose = () => {
      put("_genotypeFormModal", undefined);
      modals.delete(modal);
      modal.contentEl.empty();
      resolve(result);
    };
    modals.add(modal);
    modal.open();
  });
}
