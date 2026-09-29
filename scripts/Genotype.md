/*
Genotype
========
Create or edit a Drosophila genotype through a small form: a sex-symbol row
and one text field per homolog (X, II, III x top/bottom). The genotype is
drawn as native Excalidraw elements (allele text, fraction lines, `;`
separators, optional sex glyph), grouped and tagged with a stable
`genotypeId` in customData.

Mode:
  - Selection contains a genotype element  -> edit that genotype in place.
  - Otherwise                              -> create a new genotype at the
                                              free spot nearest the view
                                              center (never overlapping
                                              existing elements).

Form keys:
  Tab / Shift+Tab  next / previous field (X top, X bottom, II top, ...)
  Up / Down        top / bottom homolog of the same chromosome
  Left / Right     move the caret; at the field edge, jump chromosome
  Enter            redraw and close
  Esc              close without changes

Per chromosome: top+bottom -> fraction; one filled -> bare allele;
both empty -> not drawn. Chromosome IV is not in the form; an existing IV
is carried through unchanged.

Edit mode replaces only the genotype's own elements (alleles, fractions,
separators, glyph). Other elements sharing the genotypeId (Cross Builder
labels, lineage) are untouched. customData keys this script does not own
(e.g. `parents`) and outer group memberships are carried onto the new
elements.

customData schema (v2):
  glyph     : { schemaVersion, kind: "genotype-glyph", genotypeId }
  allele    : { schemaVersion, kind: "genotype-allele", genotypeId,
                chromosome: "X"|"II"|"III"|"IV", side: "single"|"top"|"bottom" }
  fraction  : { schemaVersion, kind: "genotype-fraction", genotypeId,
                chromosome: "X"|"II"|"III"|"IV" }
  separator : { schemaVersion, kind: "genotype-separator", genotypeId,
                after: "X"|"II"|"III" }

Test / Cross Mode hooks (consumed on read unless noted):
  window._genotypeCreateAt = { x, y }   place a new genotype near this point
  window._genotypeLastResult            set on exit: genotypeId, or null
Test hooks (consumed on read):
  window._genotypeAuto = { glyph, X:{top,bottom}, II:{...}, III:{...} }
    skips the form and commits these values (mode chosen from selection).
  window._genotypeFormProbe = true
    opens nothing; stores the form's initial state in
    window._genotypeFormState and exits.
*/

if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.9.0")) {
  new Notice("Requires Excalidraw plugin 1.9.0+.");
  return;
}

const SCHEMA = 2;
const FONT_SIZE = 20;
// Alleles use Excalidraw's Local Font (family 4), set in plugin settings to
// Computer Modern (Excalidraw/Fonts/cmu-serif-500-roman.ttf) to match LaTeX.
// Falls back to Helvetica (2) when the local font is not enabled.
const LOCAL_FONT_FAMILY = 4;
const FALLBACK_FONT_FAMILY = 2;
const GLYPH_FONT_FAMILY = 2;    // Computer Modern lacks the male/mercury/hermaphrodite symbols
const GLYPH_SIZE = 24;
const CHROMOSOME_GAP = 14;
const FRACTION_PADDING = 4;
const FRACTION_GAP = 5;
const GLYPH_GAP = 12;
const STROKE_WIDTH = 1.5;
const FIELD_MIN_WIDTH = 120;     // form field width floor, px
const FIELD_PADDING = 28;       // input padding + caret room, px
const FRAME_PAD = 4;            // invisible genotype-frame padding, px
const PLACE_MARGIN = 20;        // clearance from existing elements in create mode
const PLACE_SEARCH_RINGS = 12;  // grid radius searched for a free spot
const CHROMOSOME_ORDER = ["X", "II", "III", "IV"];
const FORM_CHROMOSOMES = ["X", "II", "III"];
const MANAGED_KINDS = new Set([
  "genotype-allele", "genotype-fraction", "genotype-separator", "genotype-glyph",
]);
const OWNED_KEYS = new Set(["schemaVersion", "genotypeId", "kind", "chromosome", "side", "after"]);
const GLYPHS = [
  { label: "♂", title: "Male",          value: "♂" },
  { label: "♀", title: "Female",        value: "♀" },
  { label: "☿", title: "Virgin female", value: "☿" },
  { label: "⚥", title: "Both sexes",    value: "⚥" },
  { label: "none", title: "No glyph",   value: null },
];
const LABEL_GAP = 8;             // gap between an offspring's label box and the genotype

// Offspring label: text in a black-outlined, light-blue box, centered on
// `centerX` with its bottom edge at `bottomY`. The text is tagged
// `genotype-label`, the box `genotype-label-box`; both carry `data`.
const LABEL_BOX_BG = "#a5d8ff";
const LABEL_BOX_PAD = 6;
function addLabelBox(text, centerX, bottomY, data) {
  const saved = { bg: ea.style.backgroundColor, fill: ea.style.fillStyle, stroke: ea.style.strokeColor };
  ea.style.backgroundColor = LABEL_BOX_BG;
  ea.style.fillStyle = "solid";
  ea.style.strokeColor = "#000000";
  const boxId = ea.addText(0, 0, text, {
    box: "box", boxPadding: LABEL_BOX_PAD, boxStrokeColor: "#000000",
    textAlign: "center", textVerticalAlign: "middle",
  });
  ea.style.backgroundColor = saved.bg;
  ea.style.fillStyle = saved.fill;
  ea.style.strokeColor = saved.stroke;
  const box = ea.getElement(boxId);
  const textId = box.boundElements.find(b => b.type === "text").id;
  const dx = centerX - box.width / 2 - box.x, dy = bottomY - box.height - box.y;
  for (const el of [box, ea.getElement(textId)]) { el.x += dx; el.y += dy; }
  ea.addAppendUpdateCustomData(textId, { ...data, kind: "genotype-label" });
  ea.addAppendUpdateCustomData(boxId, { ...data, kind: "genotype-label-box" });
  return { boxId, textId };
}

// Selection criterion: a real Excalidraw arrow label (text bound to the
// arrow), centered at the midpoint of the arrow's path. May be multi-line.
function addArrowLabel(arrowId, text, data) {
  const arrow = ea.getElement(arrowId);
  const pts = arrow.points.map(([x, y]) => [arrow.x + x, arrow.y + y]);
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let half = segs.reduce((a, b) => a + b, 0) / 2, mx = pts[0][0], my = pts[0][1];
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      mx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      my = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      break;
    }
    half -= segs[i];
  }
  const textId = ea.addText(0, 0, text, { textAlign: "center", textVerticalAlign: "middle" });
  const t = ea.getElement(textId);
  t.containerId = arrowId;
  t.x = mx - t.width / 2;
  t.y = my - t.height / 2;
  arrow.boundElements = [...(arrow.boundElements ?? []), { type: "text", id: textId }];
  ea.addAppendUpdateCustomData(textId, { ...data, kind: "cross-criterion" });
  return textId;
}

ea.clear();

const localFontEnabled = !!ea.plugin?.settings?.experimentalEnableFourthFont;
const FONT_FAMILY = localFontEnabled ? LOCAL_FONT_FAMILY : FALLBACK_FONT_FAMILY;
if (!localFontEnabled) new Notice("Excalidraw local font is off; using Helvetica instead of Computer Modern.");

// ---- Hooks ---------------------------------------------------------------

const _auto = window._genotypeAuto ?? null;
window._genotypeAuto = undefined;
const _probe = !!window._genotypeFormProbe;
window._genotypeFormProbe = undefined;
// Cross Mode hooks: `_genotypeCreateAt = {x, y}` places a new genotype at the
// free spot nearest that point (consumed on read); `_genotypeLastResult` is
// set to the created or edited genotypeId, or null if the form was cancelled.
const _createAt = window._genotypeCreateAt ?? null;
window._genotypeCreateAt = undefined;
const _defaultGlyph = window._genotypeDefaultGlyph; // preset sex for a new genotype
window._genotypeDefaultGlyph = undefined;
window._genotypeLastResult = undefined;

// ---- Mode + read back ----------------------------------------------------

const emptyState = () => ({
  glyph: null,
  X: { top: "", bottom: "" }, II: { top: "", bottom: "" },
  III: { top: "", bottom: "" }, IV: { top: "", bottom: "" },
});

// With _genotypeCreateAt set (Cross Mode), always create: the deselect Cross
// Mode does just before lands only on Excalidraw's next render.
const selected = _createAt ? [] : ea.getViewSelectedElements();
const selectedGenotypeIds = [...new Set(
  selected.map(el => el.customData?.genotypeId).filter(Boolean)
)];
const genotypeId = selectedGenotypeIds[0] ?? null;
const editMode = genotypeId !== null;
if (selectedGenotypeIds.length > 1) {
  new Notice(`Selection spans ${selectedGenotypeIds.length} genotypes; editing the first.`);
}

const elementText = el => el.originalText ?? el.rawText ?? el.text ?? "";

let oldElements = [];
let initial = emptyState();
if (_defaultGlyph !== undefined) initial.glyph = _defaultGlyph; // create mode; edit mode reads the real glyph below
let focusKey = "X.top";
const offspring = { is: false, label: null, criterion: null, arrow: null };

if (editMode) {
  oldElements = ea.getViewElements().filter(el =>
    el.customData?.genotypeId === genotypeId && MANAGED_KINDS.has(el.customData?.kind)
  );
  const skipped = [];
  for (const el of oldElements) {
    const cd = el.customData;
    if (cd.kind === "genotype-glyph") {
      initial.glyph = elementText(el);
    } else if (cd.kind === "genotype-allele") {
      const slot = initial[cd.chromosome];
      if (!slot || !["top", "bottom", "single"].includes(cd.side)) {
        skipped.push(elementText(el));
        continue;
      }
      if (cd.side === "bottom") slot.bottom = elementText(el);
      else slot.top = elementText(el);
    }
  }
  if (skipped.length) new Notice(`Skipped untagged allele text: ${skipped.join(", ")}`);

  // Offspring: current label and selection criterion, editable in the form.
  const view = ea.getViewElements().filter(el => !el.isDeleted);
  offspring.is = oldElements.some(el => el.customData.parents);
  offspring.label = view.find(el => el.customData?.genotypeId === genotypeId && el.customData.kind === "genotype-label");
  offspring.criterion = view.find(el => el.customData?.kind === "cross-criterion" && el.customData.childGenotypeId === genotypeId);
  offspring.arrow = view.find(el => el.customData?.kind === "cross-lineage" && el.customData.childGenotypeId === genotypeId);
  initial.label = offspring.label ? elementText(offspring.label) : "";
  initial.criterion = offspring.criterion ? elementText(offspring.criterion) : "";

  const selAlleles = selected.filter(el =>
    el.customData?.genotypeId === genotypeId && el.customData?.kind === "genotype-allele"
  );
  if (selAlleles.length === 1) {
    const cd = selAlleles[0].customData;
    if (FORM_CHROMOSOMES.includes(cd.chromosome)) {
      focusKey = `${cd.chromosome}.${cd.side === "bottom" ? "bottom" : "top"}`;
    }
  }
}

if (_probe) {
  window._genotypeFormState = { editMode, genotypeId, focusKey, ...initial };
  return;
}

// ---- Form ----------------------------------------------------------------

function openForm(init) {
  return new Promise(resolve => {
    const modal = new ea.obsidian.Modal(app);
    let result = null;
    let glyph = init.glyph;
    let confirmDelete = false;

    modal.onOpen = () => {
      const { contentEl, titleEl } = modal;
      titleEl.setText(editMode ? "Edit genotype" : "New genotype");

      // Sex-symbol buttons stacked in a column to the left of the allele grid.
      const body = contentEl.createDiv();
      body.style.cssText = "display:flex;align-items:center;gap:16px;justify-content:center;";
      const glyphRow = body.createDiv();
      // margin-top offsets the grid's header row so the column centers on the fraction line.
      glyphRow.style.cssText = "display:flex;flex-direction:column;gap:2px;margin-top:28px;";
      const glyphButtons = GLYPHS.map(g => {
        const b = glyphRow.createEl("button", { text: g.label, attr: { title: g.title, tabindex: "-1" } });
        b.style.cssText = "height:24px;padding:0 10px;";
        if (g.value) b.style.fontSize = "16px";
        b.onclick = () => { glyph = g.value; refreshGlyphs(); };
        return { b, g };
      });
      const refreshGlyphs = () => glyphButtons.forEach(({ b, g }) =>
        b.toggleClass("mod-cta", g.value === glyph));
      refreshGlyphs();

      const grid = body.createDiv();
      // Columns: X ; II ; III, with a `;` column between chromosomes.
      // Rows: header, top allele, fraction bar, bottom allele.
      grid.style.cssText = "display:grid;grid-template-columns:auto auto auto auto auto;" +
        "column-gap:8px;row-gap:6px;justify-content:center;align-items:center;";
      const col = ci => 2 * ci + 1;
      FORM_CHROMOSOMES.forEach((chr, ci) => {
        const h = grid.createDiv({ text: chr });
        h.style.cssText = `grid-column:${col(ci)};grid-row:1;text-align:center;font-weight:600;`;
        if (ci < FORM_CHROMOSOMES.length - 1) {
          const sep = grid.createDiv({ text: ";" });
          sep.style.cssText = `grid-column:${col(ci) + 1};grid-row:2 / span 3;font-size:1.6em;font-weight:600;`;
        }
        const bar = grid.createDiv();
        bar.style.cssText = `grid-column:${col(ci)};grid-row:3;height:2px;background:var(--text-normal);`;
      });
      const inputs = {};
      for (const side of ["top", "bottom"]) {
        FORM_CHROMOSOMES.forEach((chr, ci) => {
          const input = grid.createEl("input", { type: "text", attr: { spellcheck: "false" } });
          input.style.gridColumn = String(col(ci));
          input.style.gridRow = side === "top" ? "2" : "4";
          input.value = init[chr][side];
          input.style.textAlign = "center";
          inputs[`${chr}.${side}`] = input;
        });
      }

      // Size each chromosome column to its longest allele; the modal grows with it.
      modal.modalEl.style.width = "auto";
      modal.modalEl.style.maxWidth = "95vw";
      const measureCtx = document.createElement("canvas").getContext("2d");
      const textWidth = input => {
        measureCtx.font = getComputedStyle(input).font;
        return measureCtx.measureText(input.value).width;
      };
      const resizeColumn = chr => {
        const pair = [inputs[`${chr}.top`], inputs[`${chr}.bottom`]];
        const w = Math.max(FIELD_MIN_WIDTH, ...pair.map(textWidth)) + FIELD_PADDING;
        for (const input of pair) input.style.width = `${Math.ceil(w)}px`;
      };
      FORM_CHROMOSOMES.forEach(resizeColumn);

      // Offspring only: label and (multi-line) selection criterion.
      const extras = [];
      let labelInput = null, critInput = null;
      if (offspring.is) {
        const row = contentEl.createDiv();
        row.style.cssText = "display:flex;gap:12px;justify-content:center;align-items:flex-start;margin-top:14px;";
        labelInput = row.createEl("input", { type: "text", attr: { placeholder: "Label (optional)", spellcheck: "false" } });
        labelInput.value = init.label ?? "";
        labelInput.style.width = "200px";
        critInput = row.createEl("textarea", { attr: {
          placeholder: "Selection criterion (optional)\nEnter: new line, Cmd+Enter: OK", spellcheck: "false", rows: "3" } });
        critInput.value = init.criterion ?? "";
        critInput.style.cssText = "width:240px;resize:vertical;";
        extras.push(labelInput, critInput);
      }

      const warn = contentEl.createDiv();
      warn.style.cssText = "color:var(--text-error);margin-top:8px;min-height:1.2em;";

      const buttons = contentEl.createDiv();
      buttons.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-top:8px;";
      const ok = buttons.createEl("button", { text: "OK", cls: "mod-cta" });
      const cancel = buttons.createEl("button", { text: "Cancel" });

      const order = FORM_CHROMOSOMES.flatMap(c => [`${c}.top`, `${c}.bottom`]);
      const focus = (key, caret) => {
        const el = inputs[key];
        el.focus();
        const pos = caret === "start" ? 0 : el.value.length;
        el.setSelectionRange(pos, pos);
      };

      const commit = () => {
        const state = { glyph, IV: { ...init.IV },
          label: labelInput ? labelInput.value : undefined,
          criterion: critInput ? critInput.value : undefined };
        for (const chr of FORM_CHROMOSOMES) {
          state[chr] = { top: inputs[`${chr}.top`].value, bottom: inputs[`${chr}.bottom`].value };
        }
        const empty = CHROMOSOME_ORDER.every(c => !state[c].top.trim() && !state[c].bottom.trim());
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
        const [chr, side] = key.split(".");
        const ci = FORM_CHROMOSOMES.indexOf(chr);
        input.addEventListener("input", () => {
          resizeColumn(chr);
          if (confirmDelete) { confirmDelete = false; warn.setText(""); }
        });
        input.addEventListener("keydown", e => {
          const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
          const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;
          let target = null;
          let caret = "end";
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
      function tabFrom(el, back) {
        const ring = [...order.map(k => inputs[k]), ...extras];
        const next = ring[(ring.indexOf(el) + (back ? -1 : 1) + ring.length) % ring.length];
        next.focus();
        next.setSelectionRange?.(next.value.length, next.value.length);
      }
      for (const el of extras) {
        el.addEventListener("keydown", e => {
          if (e.key === "Tab") { e.preventDefault(); tabFrom(el, e.shiftKey); }
          else if (e.key === "Enter" && (el === labelInput || e.metaKey || e.ctrlKey)) { e.preventDefault(); commit(); }
        });
      }

      window._genotypeFormModal = { modal, inputs, focusKey, labelInput, critInput };
      // Modal.open() focuses the first input after onOpen; take focus back next tick.
      setTimeout(() => focus(focusKey, "end"), 0);
    };
    modal.onClose = () => {
      window._genotypeFormModal = undefined;
      modal.contentEl.empty();
      resolve(result);
    };
    modal.open();
  });
}

const state = _auto
  ? { ...emptyState(), IV: { ...initial.IV }, ...structuredClone(_auto) }
  : await openForm(initial);
if (!state) { window._genotypeLastResult = null; return; }

// ---- Build elements ------------------------------------------------------

// X, II and III are always drawn: an empty one is +/+ (so "w ; +/+ ; MKRS/TM6B"
// never reads as a second chromosome). An entirely empty form stays empty (the
// delete case). IV is drawn only when it has alleles.
const ALWAYS_DRAWN = ["X", "II", "III"];
const anyAllele = CHROMOSOME_ORDER.some(c => (state[c]?.top ?? "").trim() || (state[c]?.bottom ?? "").trim());
const chromosomes = [];
for (const label of CHROMOSOME_ORDER) {
  const top = (state[label]?.top ?? "").trim();
  const bottom = (state[label]?.bottom ?? "").trim();
  if (top && bottom) chromosomes.push({ label, kind: "het", alleles: { top, bottom } });
  else if (top || bottom) chromosomes.push({ label, kind: "single", alleles: { single: top || bottom } });
  else if (anyAllele && ALWAYS_DRAWN.includes(label)) chromosomes.push({ label, kind: "het", alleles: { top: "+", bottom: "+" } });
}

// Anchor: edit mode keeps the old left edge and midline; create uses view center.
let anchor = null;
if (editMode && oldElements.length) {
  const left = Math.min(...oldElements.map(el => el.x));
  const line = oldElements.find(el => el.customData.kind === "genotype-fraction");
  const single = oldElements.find(el => el.customData.kind === "genotype-allele");
  const midlineY = line ? line.y : single ? single.y + single.height / 2 : oldElements[0].y;
  anchor = { left, midlineY };
}

// Carry-through: customData keys we don't own, and outer group memberships.
const carriedData = {};
for (const el of oldElements) {
  for (const [k, v] of Object.entries(el.customData ?? {})) {
    if (!OWNED_KEYS.has(k) && !(k in carriedData)) carriedData[k] = v;
  }
}
const oldGroupIds = oldElements[0]?.groupIds ?? [];

// The invisible frame is kept (same id) across edits so lineage arrows bound
// to it stay bound; it is resized after the redraw.
const oldFrame = editMode
  ? ea.getViewElements().find(el =>
      el.customData?.genotypeId === genotypeId && el.customData?.kind === "genotype-frame")
  : null;
const labelElements = editMode
  ? ea.getViewElements().filter(el =>
      el.customData?.genotypeId === genotypeId &&
      (el.customData?.kind === "genotype-label" || el.customData?.kind === "genotype-label-box"))
  : [];

const finalGenotypeId = genotypeId ?? crypto.randomUUID();

const prev = {
  fontSize: ea.style.fontSize,
  fontFamily: ea.style.fontFamily,
  strokeColor: ea.style.strokeColor,
  strokeWidth: ea.style.strokeWidth,
  roughness: ea.style.roughness,
  backgroundColor: ea.style.backgroundColor,
};
ea.style.fontSize = FONT_SIZE;
ea.style.fontFamily = FONT_FAMILY;
ea.style.strokeColor = "#000000";
ea.style.strokeWidth = STROKE_WIDTH;
ea.style.roughness = 0;           // straight fraction lines, LaTeX-style

function tag(id, data) {
  ea.addAppendUpdateCustomData(id, {
    ...carriedData, schemaVersion: SCHEMA, genotypeId: finalGenotypeId, ...data,
  });
}

const chromosomeLayouts = chromosomes.map(c => {
  const slot = { ...c, elements: {} };
  if (c.kind === "single") {
    const id = ea.addText(0, 0, c.alleles.single);
    slot.elements.single = id;
    tag(id, { kind: "genotype-allele", chromosome: c.label, side: "single" });
    const el = ea.getElement(id);
    slot.slotWidth = el.width;
    slot.slotHeight = el.height;
  } else {
    const topId = ea.addText(0, 0, c.alleles.top);
    const botId = ea.addText(0, 0, c.alleles.bottom);
    slot.elements.top = topId;
    slot.elements.bottom = botId;
    tag(topId, { kind: "genotype-allele", chromosome: c.label, side: "top" });
    tag(botId, { kind: "genotype-allele", chromosome: c.label, side: "bottom" });
    const top = ea.getElement(topId);
    const bot = ea.getElement(botId);
    const textW = Math.max(top.width, bot.width);
    slot.slotWidth = textW + 2 * FRACTION_PADDING;
    slot.slotHeight = top.height + 2 * FRACTION_GAP + bot.height;
    const lineId = ea.addLine([[0, 0], [slot.slotWidth, 0]]);
    slot.elements.line = lineId;
    tag(lineId, { kind: "genotype-fraction", chromosome: c.label });
  }
  return slot;
});

const separatorIds = [];
for (let i = 0; i < chromosomeLayouts.length - 1; i++) {
  const sepId = ea.addText(0, 0, ";");
  tag(sepId, { kind: "genotype-separator", after: chromosomeLayouts[i].label });
  separatorIds.push(sepId);
}

let glyphId = null;
if (state.glyph && chromosomeLayouts.length) {
  ea.style.fontSize = GLYPH_SIZE;
  ea.style.fontFamily = GLYPH_FONT_FAMILY;
  glyphId = ea.addText(0, 0, state.glyph);
  tag(glyphId, { kind: "genotype-glyph" });
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = FONT_FAMILY;
}

// ---- Layout pass ---------------------------------------------------------

let totalWidth = 0;
if (glyphId) totalWidth += ea.getElement(glyphId).width + GLYPH_GAP;
for (let i = 0; i < chromosomeLayouts.length; i++) {
  totalWidth += chromosomeLayouts[i].slotWidth;
  if (i < chromosomeLayouts.length - 1) {
    totalWidth += CHROMOSOME_GAP + ea.getElement(separatorIds[i]).width + CHROMOSOME_GAP;
  }
}

// Vertical extent above/below the midline, for collision checks.
let halfHeight = 0;
if (glyphId) halfHeight = ea.getElement(glyphId).height / 2;
for (const c of chromosomeLayouts) {
  if (c.kind === "single") {
    halfHeight = Math.max(halfHeight, ea.getElement(c.elements.single).height / 2);
  } else {
    const h = Math.max(ea.getElement(c.elements.top).height, ea.getElement(c.elements.bottom).height);
    halfHeight = Math.max(halfHeight, FRACTION_GAP + h);
  }
}

// Create mode: nearest spot to the view center that clears every existing
// element by PLACE_MARGIN. Candidates form a grid around the center, tried
// in order of distance.
function findFreeSpot(cx, cy, w, halfH) {
  const boxes = ea.getViewElements()
    .filter(el => !el.isDeleted)
    .map(el => ea.getBoundingBox([el]));
  const h = 2 * halfH;
  const hits = (left, top) => boxes.some(b =>
    left < b.topX + b.width + PLACE_MARGIN && left + w + PLACE_MARGIN > b.topX &&
    top < b.topY + b.height + PLACE_MARGIN && top + h + PLACE_MARGIN > b.topY
  );
  const sx = (w + PLACE_MARGIN) / 2;
  const sy = h + PLACE_MARGIN;
  const candidates = [];
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

// Same routing as Cross Genotypes / Tidy lineage arrows.
function lineagePoints(x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 0.5) return [[x1, y1], [x1, y2]];
  const midY = (y1 + y2) / 2;
  return [[x1, y1], [x1, midY], [x2, midY], [x2, y2]];
}

const center = ea.getViewCenterPosition() ?? { x: 0, y: 0 };
const placement = anchor ?? (_createAt
  ? findFreeSpot(_createAt.x, _createAt.y, totalWidth, halfHeight)
  : findFreeSpot(center.x, center.y, totalWidth, halfHeight));
let cursorX = placement.left;
const midlineY = placement.midlineY;

if (glyphId) {
  const g = ea.getElement(glyphId);
  g.x = cursorX;
  g.y = midlineY - g.height / 2;
  cursorX += g.width + GLYPH_GAP;
}

for (let i = 0; i < chromosomeLayouts.length; i++) {
  const c = chromosomeLayouts[i];
  const slotX = cursorX;
  if (c.kind === "single") {
    const t = ea.getElement(c.elements.single);
    t.x = slotX + (c.slotWidth - t.width) / 2;
    t.y = midlineY - t.height / 2;
  } else {
    const top = ea.getElement(c.elements.top);
    const bot = ea.getElement(c.elements.bottom);
    const line = ea.getElement(c.elements.line);
    top.x = slotX + (c.slotWidth - top.width) / 2;
    top.y = midlineY - FRACTION_GAP - top.height;
    line.x = slotX;
    line.y = midlineY;
    bot.x = slotX + (c.slotWidth - bot.width) / 2;
    bot.y = midlineY + FRACTION_GAP;
  }
  cursorX += c.slotWidth;
  if (i < chromosomeLayouts.length - 1) {
    cursorX += CHROMOSOME_GAP;
    const sep = ea.getElement(separatorIds[i]);
    sep.x = cursorX;
    sep.y = midlineY - sep.height / 2;
    cursorX += sep.width + CHROMOSOME_GAP;
  }
}

// ---- Group + commit ------------------------------------------------------

const allIds = [];
if (glyphId) allIds.push(glyphId);
for (const c of chromosomeLayouts) {
  if (c.kind === "single") allIds.push(c.elements.single);
  else allIds.push(c.elements.top, c.elements.bottom, c.elements.line);
}
allIds.push(...separatorIds);

// Offspring label: rebuilt from the form (centered over the redrawn
// genotype); an empty field removes it. Non-offspring keep any label as is.
const doomed = [];
let frameCover = labelElements;
const newLabelIds = [];
if (offspring.is && allIds.length) {
  const text = (state.label ?? (offspring.label ? elementText(offspring.label) : "")).trim();
  doomed.push(...labelElements);
  frameCover = [];
  if (text) {
    const b = ea.getBoundingBox(allIds.map(id => ea.getElement(id)));
    const { boxId, textId } = addLabelBox(text, b.topX + b.width / 2, b.topY - LABEL_GAP, {
      schemaVersion: SCHEMA, genotypeId: finalGenotypeId, parents: carriedData.parents, text,
    });
    newLabelIds.push(boxId, textId);
  }
}

// Invisible frame around the genotype (and its label, if any): the binding
// target for lineage arrows, whose ends sit at its top middle.
let frameId = null;
if (allIds.length) {
  const box = ea.getBoundingBox([...allIds, ...newLabelIds].map(id => ea.getElement(id)).concat(frameCover));
  const fx = box.topX - FRAME_PAD, fy = box.topY - FRAME_PAD;
  const fw = box.width + 2 * FRAME_PAD, fh = box.height + 2 * FRAME_PAD;
  if (oldFrame) {
    ea.copyViewElementsToEAforEditing([oldFrame]);
    frameId = oldFrame.id;
    Object.assign(ea.getElement(frameId), { x: fx, y: fy, width: fw, height: fh });
  } else {
    ea.style.strokeColor = "transparent";
    ea.style.backgroundColor = "transparent";
    frameId = ea.addRect(fx, fy, fw, fh);
    tag(frameId, { kind: "genotype-frame" });
    ea.style.strokeColor = "#000000";
  }
}
const groupedIds = [...allIds, ...newLabelIds, ...(frameId ? [frameId] : [])];

if (oldGroupIds.length) {
  for (const id of groupedIds) ea.getElement(id).groupIds = [...oldGroupIds];
} else if (groupedIds.length) {
  ea.addToGroup(groupedIds);
}

// Re-aim lineage arrows bound to the frame at its new top middle.
if (oldFrame && frameId) {
  const frame = ea.getElement(frameId);
  const endX = frame.x + frame.width / 2, endY = frame.y;
  const arrows = ea.getViewElements().filter(el =>
    el.type === "arrow" && !el.isDeleted && el.endBinding?.elementId === frameId);
  ea.copyViewElementsToEAforEditing(arrows);
  for (const a of arrows.map(a => ea.getElement(a.id))) {
    const sx = a.x + a.points[0][0], sy = a.y + a.points[0][1];
    const pts = lineagePoints(sx, sy, endX, endY);
    a.x = sx; a.y = sy;
    a.points = pts.map(([x, y]) => [x - sx, y - sy]);
    a.width = Math.max(...pts.map(p => p[0])) - Math.min(...pts.map(p => p[0]));
    a.height = Math.max(...pts.map(p => p[1])) - Math.min(...pts.map(p => p[1]));
  }
}

// Offspring selection criterion: rebuilt as the lineage arrow's label (after
// the arrow was re-routed above); an empty field removes it.
if (offspring.is && allIds.length) {
  const text = (state.criterion ?? (offspring.criterion ? elementText(offspring.criterion) : "")).trim();
  const arrow = offspring.arrow;
  if (offspring.criterion) doomed.push(offspring.criterion);
  if (arrow) {
    if (!ea.getElement(arrow.id)) ea.copyViewElementsToEAforEditing([arrow]);
    const a = ea.getElement(arrow.id);
    if (offspring.criterion) a.boundElements = (a.boundElements ?? []).filter(b => b.id !== offspring.criterion.id);
    if (text) addArrowLabel(arrow.id, text, { schemaVersion: SCHEMA, childGenotypeId: finalGenotypeId, text });
  } else if (text) {
    new Notice("This offspring has no lineage arrow to put the selection criterion on.");
  }
}

// Old elements are marked deleted in the same batch as the new ones are added,
// so the edit lands as a single scene update.
const toDelete = [...oldElements, ...doomed];
if (toDelete.length) {
  ea.copyViewElementsToEAforEditing(toDelete.filter(el => !ea.getElement(el.id)));
  for (const el of toDelete) ea.getElement(el.id).isDeleted = true;
}

ea.style.fontSize = prev.fontSize;
ea.style.fontFamily = prev.fontFamily;
ea.style.strokeColor = prev.strokeColor;
ea.style.strokeWidth = prev.strokeWidth;
ea.style.roughness = prev.roughness;
ea.style.backgroundColor = prev.backgroundColor;

await ea.addElementsToView(false, false, true);
if (allIds.length) ea.selectElementsInView(allIds);
window._genotypeLastResult = allIds.length ? finalGenotypeId : null;
