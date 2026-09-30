// Drawing and layout constants shared by several modules (values from the
// scripts).

// Duplicated genotypes (src/duplicates): nearer by less than this: a tie
// (Cmd+D offsets a copy by 10 px).
export const DUPLICATE_TIE_PX = 25;
// Duplicated genotypes: offsets closer than this: copied together.
export const DUPLICATE_SHIFT_PX = 2;

// Layout (Tidy). Vertical gap between generation rows.
export const GENERATION_GAP_Y = 140;
// Horizontal gap between same-depth genotypes.
export const SIBLING_GAP_X = 60;
// Invisible genotype-frame padding, px.
export const FRAME_PAD = 4;
// Between genotype frames.
export const FRAME_GAP = SIBLING_GAP_X - 2 * FRAME_PAD;
// x glyph to the frame it sits beside.
export const GLYPH_PAD = 8;

// Rendering (src/render): genotype text.
export const FONT_SIZE = 20;
// Computer Modern, when Excalidraw's local-font setting is on.
export const LOCAL_FONT_FAMILY = 4;
// Helvetica, used when the local-font setting is off.
export const FALLBACK_FONT_FAMILY = 2;
// Sex-glyph font: Computer Modern lacks the male/mercury/hermaphrodite symbols.
export const GLYPH_FONT_FAMILY = 2;
export const GLYPH_SIZE = 24;
// Horizontal gap either side of a genotype-separator (";").
export const CHROMOSOME_GAP = 14;
// Padding either side of a het chromosome's wider allele text, in its slot.
export const FRACTION_PADDING = 4;
// Vertical gap between the fraction line and each allele's text.
export const FRACTION_GAP = 5;
// Gap between a genotype's sex glyph and its first chromosome.
export const GLYPH_GAP = 12;
export const STROKE_WIDTH = 1.5;
// Gap between an offspring's label box and the genotype.
export const LABEL_GAP = 8;
export const LABEL_BOX_BG = "#a5d8ff";
export const LABEL_BOX_PAD = 6;
// x glyph between cross parents: hand-drawn "x" (Virgil).
export const CROSS_GLYPH_CHAR = "x";
export const CROSS_GLYPH_FONT_FAMILY = 1;
// Vertical distance from a cross's x glyph to its offspring's center.
export const LINEAGE_DROP = 60;
