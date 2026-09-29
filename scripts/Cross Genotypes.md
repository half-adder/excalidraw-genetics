/*
Cross Genotypes
===============
Creates an offspring genotype of two selected parental genotypes.

Preconditions:
  Selection must include elements of exactly two distinct genotypes.

Behavior:
  - Infers maternal/paternal assignment from sex glyphs (♀/☿ -> maternal,
    ♂ -> paternal). If glyphs are absent or ambiguous, defaults to
    maternal = leftmost parent by centroid x.
  - Opens a picker: offspring sex, then per chromosome one card from every
    maternal x paternal homolog pair (maternal on top; X lists daughters
    (father's X), sons (father's Y) and both-sex combos ("w or Y"); the X
    card sets the sex (male / female / both) and picking a sex moves X to a
    matching card), plus optional label and
    selection criterion. See docs/plans/2026-09-28-cross-picker-design.md.
  - Stamps `parents: { maternal, paternal }` on every offspring element.
  - Creates (or reuses) a `cross-glyph` element keyed by the parent pair.
  - Creates a `cross-lineage` element keyed by the offspring's genotypeId.
  - Optionally creates `genotype-label` and `cross-criterion` elements.
  - Best-effort initial positioning. Run `Tidy` afterwards for a clean layout.

customData schema (v2): see docs/plans/2026-05-31-schema-v2-design.md
*/

if (!ea.verifyMinimumPluginVersion || !ea.verifyMinimumPluginVersion("1.9.0")) {
  new Notice("Requires Excalidraw plugin 1.9.0+.");
  return;
}

const SCHEMA = 2;
const FONT_SIZE = 20;
// Same style as Genotype: Computer Modern via Excalidraw's Local Font (4),
// Helvetica (2) fallback and for the sex glyph (Computer Modern lacks some).
const LOCAL_FONT_FAMILY = 4;
const FALLBACK_FONT_FAMILY = 2;
const GLYPH_FONT_FAMILY = 2;
const FONT_FAMILY = ea.plugin?.settings?.experimentalEnableFourthFont
  ? LOCAL_FONT_FAMILY : FALLBACK_FONT_FAMILY;
const GLYPH_SIZE = 24;
const CHROMOSOME_GAP = 14;
const FRACTION_PADDING = 4;
const FRACTION_GAP = 5;
const GLYPH_GAP = 12;
const STROKE_WIDTH = 1.5;
const CHROMOSOME_ORDER = ["X", "II", "III", "IV"];
const CROSS_GLYPH_CHAR = "x";
const CROSS_GLYPH_FONT_FAMILY = 1;   // Virgil: hand-drawn "x" between parents
const PARENT_GAP_X = 80;       // gap between left parent and x glyph (and x and right parent)
const LINEAGE_DROP = 60;       // vertical distance from cross-glyph to offspring center

// ---- Helpers (duplicated from Build / Tidy; keep in sync) ---------------

const textOf = el => el.originalText ?? el.rawText ?? el.text ?? "";

function getGenotypeIdFromElement(el) {
  return el?.customData?.genotypeId ?? null;
}

function getGenotypeElements(genotypeId, allElements) {
  return allElements.filter(e => e.customData?.genotypeId === genotypeId);
}

function reconstructShorthand(genotypeId, allElements) {
  const members = getGenotypeElements(genotypeId, allElements);
  const byChrom = {};
  for (const el of members) {
    const cd = el.customData;
    if (cd?.kind !== "genotype-allele") continue;
    if (!byChrom[cd.chromosome]) byChrom[cd.chromosome] = {};
    byChrom[cd.chromosome][cd.side] = textOf(el);
  }
  const parts = [];
  for (const label of CHROMOSOME_ORDER) {
    const a = byChrom[label];
    if (!a) continue;
    if (a.single !== undefined) parts.push(a.single);
    else if (a.top !== undefined && a.bottom !== undefined) parts.push(`${a.top}/${a.bottom}`);
  }
  return parts.join(" ; ");
}

// ---- Detect two parental genotypes from selection -----------------------

window._crossGenotypesLastResult = undefined;
// Cross Mode passes the two parents explicitly in
// window._crossGenotypesParents = { genotypeIds: [a, b], at: Date.now() }
// (its selection lands only on Excalidraw's next render); used once, if fresh.
const givenParents = window._crossGenotypesParents;
window._crossGenotypesParents = undefined;
const allElements = ea.getViewElements();
const parentIds = [];
if (givenParents && Date.now() - givenParents.at < 10000) {
  for (const gid of givenParents.genotypeIds ?? []) if (gid && !parentIds.includes(gid)) parentIds.push(gid);
} else {
  for (const el of ea.getViewSelectedElements()) {
    const gid = getGenotypeIdFromElement(el);
    if (gid && !parentIds.includes(gid)) parentIds.push(gid);
  }
}
if (parentIds.length !== 2) {
  new Notice(`Select elements from exactly two genotypes (found ${parentIds.length}).`);
  window._crossGenotypesLastResult = null;
  return;
}

const parentA = { id: parentIds[0], elements: getGenotypeElements(parentIds[0], allElements) };
const parentB = { id: parentIds[1], elements: getGenotypeElements(parentIds[1], allElements) };

function centroidX(elements) {
  if (elements.length === 0) return 0;
  const xs = elements.map(e => e.x + (e.width || 0) / 2);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function glyphCharOf(elements) {
  const g = elements.find(e => e.customData?.kind === "genotype-glyph");
  return g ? textOf(g) : null;
}

const FEMALE_GLYPHS = new Set(["♀", "☿"]);
const MALE_GLYPHS = new Set(["♂"]);

const aGlyph = glyphCharOf(parentA.elements);
const bGlyph = glyphCharOf(parentB.elements);

let maternalId, paternalId;
if (FEMALE_GLYPHS.has(aGlyph) && MALE_GLYPHS.has(bGlyph)) {
  maternalId = parentA.id; paternalId = parentB.id;
} else if (FEMALE_GLYPHS.has(bGlyph) && MALE_GLYPHS.has(aGlyph)) {
  maternalId = parentB.id; paternalId = parentA.id;
} else if (FEMALE_GLYPHS.has(aGlyph)) {
  maternalId = parentA.id; paternalId = parentB.id;
} else if (FEMALE_GLYPHS.has(bGlyph)) {
  maternalId = parentB.id; paternalId = parentA.id;
} else if (MALE_GLYPHS.has(aGlyph)) {
  paternalId = parentA.id; maternalId = parentB.id;
} else if (MALE_GLYPHS.has(bGlyph)) {
  paternalId = parentB.id; maternalId = parentA.id;
} else {
  // Default: leftmost is maternal.
  if (centroidX(parentA.elements) <= centroidX(parentB.elements)) {
    maternalId = parentA.id; paternalId = parentB.id;
  } else {
    maternalId = parentB.id; paternalId = parentA.id;
  }
}

// ---- Parent homologs + offspring options --------------------------------

const PICK_CHROMOSOMES = ["X", "II", "III"];

// Two homologs per chromosome per parent. Bare = two copies, except the
// father's X, where bare means that X plus Y. Missing = +/+ (father X: +/Y).
function homologsOf(genotypeId, isFather) {
  const byChrom = {};
  for (const el of getGenotypeElements(genotypeId, allElements)) {
    const cd = el.customData;
    if (cd?.kind !== "genotype-allele") continue;
    (byChrom[cd.chromosome] ??= {})[cd.side] = textOf(el).trim();
  }
  const out = {};
  for (const label of CHROMOSOME_ORDER) {
    const a = byChrom[label];
    const fatherX = isFather && label === "X";
    if (!a) {
      out[label] = fatherX ? ["+", "Y"] : ["+", "+"];
    } else if (a.top !== undefined && a.bottom !== undefined) {
      out[label] = [a.top, a.bottom];
    } else {
      const one = a.single ?? a.top ?? a.bottom;
      out[label] = fatherX ? [one, "Y"] : [one, one];
    }
  }
  out.present = new Set(Object.keys(byChrom));
  return out;
}

const mat = homologsOf(maternalId, false);
const pat = homologsOf(paternalId, true);

function pairs(maternal, paternal) {
  const out = [];
  for (const m of maternal) for (const p of paternal) out.push({ top: m, bottom: p });
  return out;
}

// Maternal homolog on top; every mother x father pair listed, no merging.
// X lists daughters (father's X), sons (father's Y), then both-sex combos
// (maternal X over "father's X or Y"), each tagged with `sex`.
function optionsFor() {
  const patX = pat.X.filter(h => h !== "Y");
  const fatherX = patX.length ? patX : ["+"];
  const hasY = pat.X.includes("Y");
  const tagged = (list, sex) => list.map(o => ({ ...o, sex }));
  const X = [
    ...tagged(pairs(mat.X, fatherX), "female"),
    ...(hasY ? tagged(pairs(mat.X, ["Y"]), "male") : []),
    ...(hasY ? tagged(pairs(mat.X, fatherX.map(p => `${p} or Y`)), "both") : []),
  ];
  return { X, II: pairs(mat.II, pat.II), III: pairs(mat.III, pat.III) };
}

// ---- Picker form ---------------------------------------------------------

const GLYPHS = [
  { label: "♂", title: "Male",          value: "♂" },
  { label: "♀", title: "Female",        value: "♀" },
  { label: "☿", title: "Virgin female", value: "☿" },
  { label: "⚥", title: "Both sexes",    value: "⚥" },
  { label: "none", title: "No glyph",   value: null },
];

// Test hook: window._crossGenotypesAuto =
//   { offspringGlyph, pick: { X, II, III }, labelText?, criterionText? }
// skips the form. Consumed (cleared) on read.
const _auto = window._crossGenotypesAuto ?? null;
window._crossGenotypesAuto = undefined;

function openPicker() {
  return new Promise(resolve => {
    const modal = new ea.obsidian.Modal(app);
    const state = { sex: null, pick: { X: 0, II: 0, III: 0 }, label: "", criterion: "" };
    // X lists daughters and sons together; sex and the X card stay consistent:
    // a Y card means male, an XX card female (virgin female kept if chosen).
    const options = optionsFor();
    const sexFromX = () => {
      const kind = options.X[state.pick.X]?.sex;
      if (kind === "male") state.sex = "♂";
      else if (kind === "both") state.sex = "⚥";
      else if (state.sex !== "☿") state.sex = "♀";
    };
    const xFromSex = () => {
      const want = { "♂": "male", "♀": "female", "☿": "female", "⚥": "both" }[state.sex];
      if (!want || options.X[state.pick.X]?.sex === want) return;
      const i = options.X.findIndex(o => o.sex === want);
      if (i >= 0) state.pick.X = i;
    };
    sexFromX();
    let result = null;

    modal.onOpen = () => {
      const { contentEl, titleEl } = modal;
      titleEl.setText("Cross offspring");
      modal.modalEl.style.width = "auto";
      modal.modalEl.style.maxWidth = "95vw";

      // Small DOM rendering of a genotype: glyph, then per chromosome either
      // top over a bar over bottom, or a bare allele; `;` between chromosomes.
      // `chroms` is [{ top, bottom } | { single }] in chromosome order.
      const drawMini = (container, glyph, chroms) => {
        const g = container.createDiv();
        g.style.cssText = "display:flex;align-items:center;gap:6px;";
        if (glyph) g.createSpan({ text: glyph }).style.fontSize = "1.3em";
        chroms.forEach((a, i) => {
          if (a.single === undefined) {
            const f = g.createDiv();
            f.style.cssText = "display:flex;flex-direction:column;align-items:center;";
            f.createDiv({ text: a.top }).style.whiteSpace = "nowrap";
            f.createDiv().style.cssText = "height:1.5px;align-self:stretch;margin:1px 0;background:currentColor;";
            f.createDiv({ text: a.bottom }).style.whiteSpace = "nowrap";
          } else {
            g.createSpan({ text: a.single }).style.whiteSpace = "nowrap";
          }
          if (i < chroms.length - 1) g.createSpan({ text: ";" }).style.fontWeight = "600";
        });
        return g;
      };

      // Header: both parents drawn as they appear on the canvas.
      const header = contentEl.createDiv();
      header.style.cssText =
        "display:flex;align-items:center;justify-content:center;gap:14px;margin-bottom:8px;";
      const drawParent = (gid, fallbackGlyph) => {
        const byChrom = {};
        let glyph = null;
        for (const el of getGenotypeElements(gid, allElements)) {
          const cd = el.customData;
          if (cd?.kind === "genotype-glyph") glyph = textOf(el);
          if (cd?.kind === "genotype-allele") (byChrom[cd.chromosome] ??= {})[cd.side] = textOf(el);
        }
        const chroms = CHROMOSOME_ORDER.filter(c => byChrom[c]).map(c => {
          const a = byChrom[c];
          return (a.top !== undefined && a.bottom !== undefined)
            ? { top: a.top, bottom: a.bottom }
            : { single: a.single ?? a.top ?? a.bottom };
        });
        drawMini(header, glyph ?? fallbackGlyph, chroms);
      };
      drawParent(maternalId, "♀");
      header.createSpan({ text: "×" }).style.cssText = "font-size:1.4em;";
      drawParent(paternalId, "♂");

      // Live preview of the offspring, under the parents (divider above it), above the cards.
      const preview = contentEl.createDiv();
      preview.style.cssText =
        "display:flex;flex-direction:column;align-items:center;margin-bottom:14px;padding-top:8px;" +
        "border-top:1px solid var(--background-modifier-border);";
      preview.createDiv({ text: "Offspring" }).style.cssText =
        "font-size:0.8em;color:var(--text-muted);margin-bottom:4px;";
      const previewBody = preview.createDiv();
      const renderPreview = () => {
        previewBody.empty();
        const chroms = PICK_CHROMOSOMES.map(c => options[c][state.pick[c]]);
        if (mat.present.has("IV") || pat.present.has("IV")) chroms.push({ top: mat.IV[0], bottom: pat.IV[0] });
        drawMini(previewBody, state.sex, chroms.map(o => ({ top: o.top, bottom: o.bottom })));
      };


      const body = contentEl.createDiv();
      body.style.cssText = "display:flex;align-items:center;gap:16px;justify-content:center;";

      const sexCol = body.createDiv();
      // margin-top = column header height, so the column centers on the cards.
      sexCol.style.cssText = "display:flex;flex-direction:column;gap:2px;margin-top:26px;";
      const sexButtons = GLYPHS.map(g => {
        const b = sexCol.createEl("button", { text: g.label, attr: { title: g.title, tabindex: "-1" } });
        b.style.cssText = "height:24px;padding:0 10px;";
        if (g.value) b.style.fontSize = "16px";
        b.onclick = () => {
          state.sex = g.value;
          xFromSex();
          render();
          focusColumn("X");
        };
        return { b, g };
      });

      const grid = body.createDiv();
      grid.style.cssText = "display:flex;align-items:flex-start;gap:8px;";
      const columns = {};
      PICK_CHROMOSOMES.forEach((chr, ci) => {
        const wrap = grid.createDiv();
        wrap.style.cssText = "display:flex;flex-direction:column;align-items:stretch;gap:4px;";
        const h = wrap.createDiv({ text: chr });
        h.style.cssText = "text-align:center;font-weight:600;height:22px;";
        const col = wrap.createDiv({ attr: { tabindex: "0" } });
        col.style.cssText = "display:flex;flex-direction:column;gap:4px;outline:none;padding:2px;border-radius:6px;";
        col.addEventListener("focus", () => { col.style.boxShadow = "0 0 0 2px var(--interactive-accent)"; });
        col.addEventListener("blur", () => { col.style.boxShadow = "none"; });
        columns[chr] = col;
        if (ci < PICK_CHROMOSOMES.length - 1) {
          const sep = grid.createDiv({ text: ";" });
          sep.style.cssText = "font-size:1.6em;font-weight:600;margin-top:40px;";
        }
      });

      const extras = contentEl.createDiv();
      extras.style.cssText = "display:flex;gap:12px;justify-content:center;margin-top:14px;";
      // Criterion is multi-line: Enter adds a line there; Cmd/Ctrl+Enter commits.
      extras.style.alignItems = "flex-start";
      const mkField = (placeholder, key, multiline) => {
        const input = multiline
          ? extras.createEl("textarea", { attr: { placeholder, spellcheck: "false", rows: "3" } })
          : extras.createEl("input", { type: "text", attr: { placeholder, spellcheck: "false" } });
        input.style.width = "220px";
        if (multiline) input.style.resize = "vertical";
        input.addEventListener("input", () => { state[key] = input.value; });
        return input;
      };
      const labelInput = mkField("Label (optional)", "label", false);
      const critInput = mkField("Selection criterion (optional)\nEnter: new line, Cmd+Enter: OK", "criterion", true);

      const buttons = contentEl.createDiv();
      buttons.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-top:12px;";
      const ok = buttons.createEl("button", { text: "OK", cls: "mod-cta" });
      const cancel = buttons.createEl("button", { text: "Cancel" });

      function card(opt, selected, onClick) {
        const c = createDiv();
        c.style.cssText =
          "display:flex;flex-direction:column;align-items:center;padding:4px 12px;border-radius:6px;cursor:pointer;" +
          "border:1px solid var(--background-modifier-border);" +
          (selected ? "background:var(--interactive-accent);color:var(--text-on-accent);" : "");
        c.createDiv({ text: opt.top }).style.whiteSpace = "nowrap";
        const bar = c.createDiv();
        bar.style.cssText = "height:2px;align-self:stretch;margin:2px 0;background:currentColor;";
        c.createDiv({ text: opt.bottom }).style.whiteSpace = "nowrap";
        c.onclick = onClick;
        return c;
      }

      function render() {
        sexButtons.forEach(({ b, g }) => b.toggleClass("mod-cta", g.value === state.sex));
        for (const chr of PICK_CHROMOSOMES) {
          const col = columns[chr];
          col.empty();
          options[chr].forEach((opt, i) => {
            col.appendChild(card(opt, i === state.pick[chr], () => {
              state.pick[chr] = i;
              if (chr === "X") sexFromX();
              render();
              focusColumn(chr);
            }));
          });
        }
        renderPreview();
        window._crossGenotypesOptions = options;
      }

      const focusOrder = [...PICK_CHROMOSOMES.map(c => columns[c]), labelInput, critInput];
      function focusColumn(chr) { columns[chr].focus(); }

      const commit = () => {
        result = { ...state, options };
        modal.close();
      };
      ok.onclick = commit;
      cancel.onclick = () => modal.close();

      contentEl.addEventListener("keydown", e => {
        const active = document.activeElement;
        const idx = focusOrder.indexOf(active);
        const chr = PICK_CHROMOSOMES.find(c => columns[c] === active);
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
          if (chr === "X") sexFromX();
          render();
          focusColumn(chr);
        } else if (chr && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
          e.preventDefault();
          const ci = PICK_CHROMOSOMES.indexOf(chr) + (e.key === "ArrowLeft" ? -1 : 1);
          if (ci >= 0 && ci < PICK_CHROMOSOMES.length) focusColumn(PICK_CHROMOSOMES[ci]);
          else if (ci === PICK_CHROMOSOMES.length) labelInput.focus();
        }
      });

      render();
      window._crossGenotypesModal = { modal, state, columns, labelInput, critInput };
      // Modal.open() focuses the first input after onOpen; take focus back next tick.
      setTimeout(() => focusColumn("X"), 0);
    };
    modal.onClose = () => {
      window._crossGenotypesModal = undefined;
      modal.contentEl.empty();
      resolve(result);
    };
    modal.open();
  });
}

let picked;
if (_auto) {
  const options = optionsFor();
  window._crossGenotypesOptions = options;
  picked = {
    sex: _auto.offspringGlyph ?? null,
    pick: { X: 0, II: 0, III: 0, ...(_auto.pick ?? {}) },
    label: _auto.labelText ?? "",
    criterion: _auto.criterionText ?? "",
    options,
  };
} else {
  picked = await openPicker();
}
if (!picked) { window._crossGenotypesLastResult = null; return; }

const offspringGlyph = picked.sex;
const labelText = picked.label;
const criterionText = picked.criterion;

const chromosomes = [];
for (const label of PICK_CHROMOSOMES) {
  const opt = picked.options[label][picked.pick[label]];
  if (!opt) {
    new Notice(`No option ${picked.pick[label]} for chromosome ${label}.`);
    return;
  }
  chromosomes.push({ label, kind: "het", alleles: { top: opt.top, bottom: opt.bottom } });
}
if (mat.present.has("IV") || pat.present.has("IV")) {
  chromosomes.push({ label: "IV", kind: "het", alleles: { top: mat.IV[0], bottom: pat.IV[0] } });
}

// ---- Create offspring genotype elements --------------------------------

const genotypeId = crypto.randomUUID();

// Crude initial center: midpoint x of parents, below the lower parent.
const parentMaternalElements = getGenotypeElements(maternalId, allElements);
const parentPaternalElements = getGenotypeElements(paternalId, allElements);

function bbox(elements) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const e of elements) {
    minX = Math.min(minX, e.x);
    maxX = Math.max(maxX, e.x + (e.width || 0));
    minY = Math.min(minY, e.y);
    maxY = Math.max(maxY, e.y + (e.height || 0));
  }
  return { minX, maxX, minY, maxY };
}

const matBox = bbox(parentMaternalElements);
const patBox = bbox(parentPaternalElements);
// "Left" parent = lower maxX; "right" parent = higher maxX.
const leftBox = matBox.maxX <= patBox.maxX ? matBox : patBox;
const rightBox = leftBox === matBox ? patBox : matBox;
// midX is the center of the visual gap between the two parents' bounding boxes.
const midX = (leftBox.maxX + rightBox.minX) / 2;

const lowerParentBottomY = Math.max(matBox.maxY, patBox.maxY);
const centerX = midX;
const centerY = lowerParentBottomY + LINEAGE_DROP * 2;

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
ea.style.roughness = 0;

function tag(id, data) {
  ea.addAppendUpdateCustomData(id, {
    schemaVersion: SCHEMA,
    genotypeId,
    parents: { maternal: maternalId, paternal: paternalId },
    ...data,
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
if (offspringGlyph) {
  ea.style.fontSize = GLYPH_SIZE;
  ea.style.fontFamily = GLYPH_FONT_FAMILY;
  glyphId = ea.addText(0, 0, offspringGlyph);
  tag(glyphId, { kind: "genotype-glyph" });
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = FONT_FAMILY;
}

// ---- Layout pass (mirrors Build Genotype) ------------------------------

const slotMaxHeight = Math.max(...chromosomeLayouts.map(c => c.slotHeight));

let totalWidth = 0;
if (glyphId) totalWidth += ea.getElement(glyphId).width + GLYPH_GAP;
for (let i = 0; i < chromosomeLayouts.length; i++) {
  totalWidth += chromosomeLayouts[i].slotWidth;
  if (i < chromosomeLayouts.length - 1) {
    totalWidth += CHROMOSOME_GAP + ea.getElement(separatorIds[i]).width + CHROMOSOME_GAP;
  }
}

let cursorX = centerX - totalWidth / 2;
const midlineY = centerY;

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

// ---- Group + commit ----------------------------------------------------

const allIds = [];
if (glyphId) allIds.push(glyphId);
for (const c of chromosomeLayouts) {
  if (c.kind === "single") allIds.push(c.elements.single);
  else allIds.push(c.elements.top, c.elements.bottom, c.elements.line);
}
allIds.push(...separatorIds);

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

// ---- Optional label (part of offspring group) --------------------------

const LABEL_GAP = 8;
const trimmedLabel = (labelText || "").trim();
if (trimmedLabel) {
  const { boxId, textId } = addLabelBox(trimmedLabel, centerX, midlineY - slotMaxHeight / 2 - LABEL_GAP, {
    schemaVersion: SCHEMA, genotypeId, parents: { maternal: maternalId, paternal: paternalId }, text: trimmedLabel,
  });
  allIds.push(boxId, textId);
}

// Invisible frame around offspring + label: the lineage arrow's binding target.
const FRAME_PAD = 4;
const offBox = ea.getBoundingBox(allIds.map(id => ea.getElement(id)));
ea.style.strokeColor = "transparent";
ea.style.backgroundColor = "transparent";
const frameId = ea.addRect(offBox.topX - FRAME_PAD, offBox.topY - FRAME_PAD,
  offBox.width + 2 * FRAME_PAD, offBox.height + 2 * FRAME_PAD);
tag(frameId, { kind: "genotype-frame" });
ea.style.strokeColor = "#000000";
allIds.push(frameId);

ea.addToGroup(allIds);

// ---- Cross furniture: x glyph + lineage line ---------------------------

// Lineage arrows are elbow arrows: straight down when the child is under the
// cross glyph, otherwise down / across / down through the vertical midpoint.
function lineagePoints(x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 0.5) return [[x1, y1], [x1, y2]];
  const midY = (y1 + y2) / 2;
  return [[x1, y1], [x1, midY], [x2, midY], [x2, y2]];
}

function findCrossGlyph(maternalId, paternalId, allElements) {
  return allElements.find(e =>
    e.customData?.kind === "cross-glyph" &&
    e.customData?.parents?.maternal === maternalId &&
    e.customData?.parents?.paternal === paternalId
  );
}

// Note on view vs workbench: ea.getElement(id) only returns elements added in
// THIS script run (workbench). View elements (already on canvas) expose .x/.y
// /.width/.height directly. So when we reuse an existing cross-glyph we read
// the view element directly; when we create a new one we go through the
// workbench.
let crossGlyphEl;
const existingGlyph = findCrossGlyph(maternalId, paternalId, allElements);
if (existingGlyph) {
  // Bring the existing glyph into the workbench so the arrow can bind to it.
  ea.copyViewElementsToEAforEditing([existingGlyph]);
  crossGlyphEl = ea.getElement(existingGlyph.id);
} else {
  // Position: midpoint between parents in x, midline-aligned with parents in y.
  const maternalMidlineY = parentMaternalElements.reduce(
    (s, e) => s + e.y + (e.height || 0) / 2, 0
  ) / parentMaternalElements.length;
  const paternalMidlineY = parentPaternalElements.reduce(
    (s, e) => s + e.y + (e.height || 0) / 2, 0
  ) / parentPaternalElements.length;
  const glyphMidY = (maternalMidlineY + paternalMidlineY) / 2;

  ea.style.fontSize = GLYPH_SIZE;
  ea.style.fontFamily = CROSS_GLYPH_FONT_FAMILY;
  const newGlyphId = ea.addText(0, 0, CROSS_GLYPH_CHAR);
  ea.addAppendUpdateCustomData(newGlyphId, {
    schemaVersion: SCHEMA,
    kind: "cross-glyph",
    parents: { maternal: maternalId, paternal: paternalId },
  });
  crossGlyphEl = ea.getElement(newGlyphId);
  crossGlyphEl.x = midX - crossGlyphEl.width / 2;
  crossGlyphEl.y = glyphMidY - crossGlyphEl.height / 2;
  ea.style.fontSize = FONT_SIZE;
  ea.style.fontFamily = FONT_FAMILY;
}

// Lineage line: from bottom of the cross-glyph down to the top of the offspring.
const glyphBottomX = crossGlyphEl.x + crossGlyphEl.width / 2;
const glyphBottomY = crossGlyphEl.y + crossGlyphEl.height;
const frameEl = ea.getElement(frameId);
const offspringTopX = frameEl.x + frameEl.width / 2;
const offspringTopY = frameEl.y;

// Bound at the x glyph's bottom middle and the offspring frame's top middle.
const lineageId = ea.addArrow(
  lineagePoints(glyphBottomX, glyphBottomY, offspringTopX, offspringTopY),
  {
    startArrowHead: null, endArrowHead: "triangle", elbowed: true,
    startObjectId: crossGlyphEl.id, startFixedPoint: [0.5, 1],
    endObjectId: frameId, endFixedPoint: [0.5, 0],
  }
);
ea.addAppendUpdateCustomData(lineageId, {
  schemaVersion: SCHEMA,
  kind: "cross-lineage",
  childGenotypeId: genotypeId,
});

// ---- Optional selection criterion (label bound to the lineage arrow) ----

const trimmedCriterion = (criterionText || "").trim();
if (trimmedCriterion) {
  addArrowLabel(lineageId, trimmedCriterion, {
    schemaVersion: SCHEMA, childGenotypeId: genotypeId, text: trimmedCriterion,
  });
}

ea.style.fontSize = prev.fontSize;
ea.style.fontFamily = prev.fontFamily;
ea.style.strokeColor = prev.strokeColor;
ea.style.strokeWidth = prev.strokeWidth;
ea.style.roughness = prev.roughness;
ea.style.backgroundColor = prev.backgroundColor;

await ea.addElementsToView(false, false, true);

new Notice(`Created offspring genotype ${genotypeId.slice(0, 8)}…`);
// Cross Mode waits for this: the new offspring's genotypeId (null if cancelled).
window._crossGenotypesLastResult = genotypeId;

// ---- Auto-tidy the lineage --------------------------------------------

// Tidy the offspring's lineage. The offspring is passed to Tidy as its seed
// (a selection set with updateScene lands only on the next render, so Tidy
// started now would still see the parents selected); it is also selected so
// the user sees it afterwards.
try {
  const api = ea.targetView?.excalidrawAPI;
  if (api) {
    const sceneEls = api.getSceneElements();
    const anchor = sceneEls.find(
      e => !e.isDeleted && e.customData?.genotypeId === genotypeId
    );
    if (anchor) {
      api.updateScene({ appState: { selectedElementIds: { [anchor.id]: true } } });
      window._tidySeed = { genotypeIds: [genotypeId], at: Date.now() };
      app.commands.executeCommandById("obsidian-excalidraw-plugin:Tidy");
    }
  }
} catch (e) {
  // Tidy is best-effort. If something fails, the offspring is still created;
  // the user can run Tidy manually.
  console.warn("Cross: auto-tidy failed:", e);
}
