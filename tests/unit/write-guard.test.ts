import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

// Every scene write goes through src/operation (the undo-safe transaction):
// no other source file may name a member that writes the scene or its undo
// history, or reach the operation's write access. Names are matched anywhere
// in the file, comments and strings included (no comment stripping, so a
// "//" inside a string cannot hide the rest of a line; a comment outside
// src/operation must not name these either). Covers the rule of the merged
// design (docs/plans/2026-09-29-undo-safe-design.md, "Why this is one undo
// step") plus Excalidraw's follow-up calls the operation runs quietly.
const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");
const OPERATION = join(SRC, "operation") + sep;
//
// Broad-word hazards, for whoever gets a failure here: `history` is matched
// as a lowercase whole word anywhere (so a comment or Notice saying "undo
// history" fails too; say "undo stack"), and `writable` is matched as a word
// (so `{ writable: true }` in Object.defineProperty fails too). Rename or
// reword rather than weakening the rule.
//
// selectElements: the operation's own `ctx.selectElements(...)`
// (OperationContext) is allowed; command code must call it on a variable
// named `ctx`. Any other receiver (api.selectElements, Excalidraw's own,
// which records a step), bracket access or destructuring is forbidden.
//
// addText: EA.addText writes only the EA workbench (committed later by
// ctx.commit) and is allowed; ExcalidrawView.addText writes the scene through
// view.addElements and records a step. Workbench calls must therefore use a
// variable named `ea` (`ea.addText`, `ctx.ea.addText`); `.addText` on any
// other receiver, or in bracket form, is forbidden.
const WRITE_MEMBERS = [
  "updateScene", "viewUpdateScene", "resetScene", "addElementsToView", "deleteViewElements", "selectElementsInView",
  "addElements", "mutateElement", "moveViewElementToZIndex", "captureUpdate", "refreshAllArrows", "updateContainerSize",
];
const FORBIDDEN: Array<[string, RegExp]> = [
  ...WRITE_MEMBERS.map((n): [string, RegExp] => [n, new RegExp(`\\b${n}\\b`)]),
  ["addText", /(?<!\bea)\.addText\b|\[\s*["'`]addText/],
  ["selectElements", /(?<!\bctx)\.selectElements\b|\[\s*["'`]selectElements|\{[^{}]*\bselectElements\b[^{}]*\}\s*=/],
  // Any mention: member access, bracket access, destructuring, window.history.
  ["history", /\bhistory\b/],
  // The operation's write access (typed casts and their module).
  ["operation write access", /operation\/excalidraw|\bwritable(EA)?\b|\bWritable(View|API|EA)\b/],
];
const violations = (ts: string) => FORBIDDEN.filter(([, re]) => re.test(ts)).map(([n]) => n);
const tsFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? tsFiles(p) : /\.(ts|tsx|js|mts)$/.test(p) ? [p] : [];
});

describe("write guard", () => {
  it.each([
    ["view.updateScene({ appState: {} })", "updateScene"],
    ["await ea.addElementsToView(false, false, true)", "addElementsToView"],
    ["ea.deleteViewElements(els)", "deleteViewElements"],
    ["ea.selectElementsInView(els)", "selectElementsInView"],
    ["api.selectElements(els)", "selectElements"],
    ["api['selectElements'](els)", "selectElements"],
    ["const { selectElements } = api; selectElements(els)", "selectElements"],
    ["view.addText(0, 0, 'x')", "addText"],
    ["ea.targetView.addText(0, 0, 'x')", "addText"],
    ["view['addText'](0, 0, 'x')", "addText"],
    ["ea.viewUpdateScene({ appState: {} })", "viewUpdateScene"],
    ["api.resetScene()", "resetScene"],
    ["view.addElements(els)", "addElements"],
    ["ea.mutateElement(el, {})", "mutateElement"],
    ["ea.moveViewElementToZIndex(id, 0)", "moveViewElementToZIndex"],
    ["x({ elements, captureUpdate: 'NEVER' })", "captureUpdate"],
    ["api.refreshAllArrows()", "refreshAllArrows"],
    ["api.updateContainerSize([el])", "updateContainerSize"],
    ["api.history?.undo?.()", "history"],
    ["api.history.clear()", "history"],
    ["const { history } = api; history.undo()", "history"],
    ["const h = api.history; h.undo()", "history"],
    ["api['history'].redo()", "history"],
    ["writable(view).updateScene?.({})", "updateScene"],
    ["writable(view).x()", "operation write access"],
    ["writableEA(ea).addElementsToView?.(false)", "addElementsToView"],
    ["writableEA(ea)", "operation write access"],
    ["import { writable } from '../operation/excalidraw';", "operation write access"],
    ["const v = view as WritableView;", "operation write access"],
    ["api[\"updateScene\"]({})", "updateScene"],
    ["api.updateScene.call(api, {})", "updateScene"],
    ["const s = \"a//b\"; view.updateScene({})", "updateScene"],
    ["// ea.addElementsToView()", "addElementsToView"],
  ])("flags %s", (code, name) => {
    expect(violations(code)).toContain(name);
  });
  it("passes code that only reads the scene", () => {
    expect(violations("const els = api.getSceneElements(); const url = 'https://x'; ea.getViewSelectedElements(); // reads only")).toEqual([]);
  });
  it("passes the operation's own selection call on ctx", () => {
    expect(violations("ctx.selectElements(ids)")).toEqual([]);
  });
  it("passes workbench text on ea", () => {
    expect(violations("ea.addText(0, 0, 'x'); ctx.ea.addText(0, 0, 'y')")).toEqual([]);
  });
  it("finds no scene write, history use or write access outside src/operation", () => {
    const bad = tsFiles(SRC)
      .filter((f) => !f.startsWith(OPERATION))
      .flatMap((f) => violations(readFileSync(f, "utf8")).map((v) => `${relative(ROOT, f)}: ${v}`));
    expect(bad).toEqual([]);
  });
});
