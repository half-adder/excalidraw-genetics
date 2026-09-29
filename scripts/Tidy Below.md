/*
Tidy Below
==========
Tidies only at or below the selected genotype: runs Select Below (the
genotype, its descendants and the mates in every cross they parent), then
Tidy, which tidies exactly the selected genotypes. The selected genotype
stays where it is; its parents, siblings, the x glyph above it and the arrow
into it are kept (the arrow is re-bound to it). Everything else in the
drawing is an obstacle the tidied part keeps clear of.

Usage:
  Select any element of a genotype, then run Tidy Below.
*/

if (!ea.getViewSelectedElements().some(el => el.customData?.genotypeId)) {
  new Notice("Tidy Below: select a genotype first.");
  return;
}

window._flySelectResult = undefined;
app.commands.executeCommandById("obsidian-excalidraw-plugin:Select Below");
let result;
for (let i = 0; i < 50 && !(result = window._flySelectResult); i++) {
  await new Promise(r => setTimeout(r, 100));
}
window._flySelectResult = undefined;
if (!result) {
  new Notice("Tidy Below: Select Below did not finish.");
  return;
}
// Tidy with a single genotype selected would tidy its whole lineage.
if (result.genotypes < 2) {
  new Notice("Tidy Below: nothing below this genotype to tidy.");
  return;
}
// Pass the genotypes to Tidy explicitly: the selection Select Below set lands
// only on Excalidraw's next render.
window._tidySeed = { genotypeIds: result.genotypeIds, at: Date.now() };
app.commands.executeCommandById("obsidian-excalidraw-plugin:Tidy");
