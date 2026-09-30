// Cross Mode: toggles a quick-crossing mode. Ported from scripts/Cross Mode.md.
//
// While it is on, the line tool is armed with the cross-line style (red,
// dashed, 20% opacity). Draw a cross line; it disappears and:
//   - genotype -> genotype: the Cross Genotypes picker opens with those two
//     as parents;
//   - either end in empty space: the Genotype form opens to create a new
//     genotype at that end (sex preset opposite to the other end's), then the
//     picker opens to cross the two. Empty -> empty starts a new lineage: the
//     form opens for the start, then for the end, then the picker.
// Cross Mode is one-shot: it turns off once the offspring is created.
// Cancelling the Genotype form cancels it and leaves Cross Mode; cancelling
// the cross picker keeps the mode on so the line can be drawn again. Other
// lines are left alone.
//
// Leave the mode with Esc, by picking any other tool, or by running this
// command again. window._flyCrossMode holds { stop, view } while it is on.

import { Notice } from "obsidian";
import type FlyGeneticsPlugin from "../main";
import { newEA, type ExcalidrawViewLike } from "../excalidraw/ea";
import { peek, put } from "../hooks";
import { operationSupported, runOperation, setAppState, unrecordLastStep, type OperationContext, type Started } from "../operation";
import { splitDuplicateGenotypes } from "../duplicates";
import { boundingBox } from "../scene";
import { textOf, type SceneElement } from "../schema";
import { crossGenotypes } from "./cross-genotypes";
import { genotype } from "./genotype";
import { operationEnv } from "./env";

export const CROSS_LINE = { strokeColor: "#e03131", strokeStyle: "dashed", opacity: 20 } as const;
const POLL_MS = 250;
const HIT_PAD = 8;
const RELEASE_MS = 500;

type Point = { x: number; y: number };

export const isCrossLine = (el: SceneElement): boolean =>
  el.type === "line" && !el.isDeleted &&
  el.strokeColor === CROSS_LINE.strokeColor &&
  el.strokeStyle === CROSS_LINE.strokeStyle &&
  el.opacity === CROSS_LINE.opacity;

// The line's first and last point, in scene coordinates.
export function lineEnds(line: SceneElement): { start: Point; end: Point } {
  const pts = line.points ?? [[0, 0]];
  const last = pts[pts.length - 1];
  return {
    start: { x: line.x + pts[0][0], y: line.y + pts[0][1] },
    end: { x: line.x + last[0], y: line.y + last[1] },
  };
}

// Genotype under a scene point: its invisible frame, else the padded bounding
// box of its elements.
export function genotypeAt(elements: readonly SceneElement[], x: number, y: number): string | null {
  const els = elements.filter((el) => !el.isDeleted && el.customData?.genotypeId);
  const inside = (b: { x: number; y: number; w: number; h: number }, pad: number) =>
    x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;
  for (const f of els.filter((el) => el.customData!.kind === "genotype-frame")) {
    if (inside({ x: f.x, y: f.y, w: f.width, h: f.height }, 0)) return f.customData!.genotypeId!;
  }
  const byGid = new Map<string, SceneElement[]>();
  for (const el of els) {
    const gid = el.customData!.genotypeId!;
    let members = byGid.get(gid);
    if (!members) byGid.set(gid, (members = []));
    members.push(el);
  }
  for (const [gid, members] of byGid) {
    const b = boundingBox(members);
    if (inside({ x: b.topX, y: b.topY, w: b.width, h: b.height }, HIT_PAD)) return gid;
  }
  return null;
}

const partOf = (elements: readonly SceneElement[], gid: string, kind: string) =>
  elements.find((el) => !el.isDeleted && el.customData?.genotypeId === gid && el.customData.kind === kind);

// The text of the genotype's sex glyph, or null.
export function glyphOf(elements: readonly SceneElement[], gid: string): string | null {
  const g = partOf(elements, gid, "genotype-glyph");
  return g ? textOf(g) : null;
}

export const opposite = (g: string | null): string | null =>
  g === "♂" ? "♀" : (g === "♀" || g === "☿") ? "♂" : null;

// What resolving a cross line runs, given as steps (the command's, or a
// test's): the scene now, creating a genotype at a point (with a sex preset;
// its genotypeId, or null if cancelled), crossing two genotypes (the
// offspring's genotypeId, or null if cancelled) and leaving the mode.
export interface LineSteps {
  elements(): readonly SceneElement[];
  createAt(point: Point, defaultGlyph: string | null): Promise<string | null>;
  cross(a: string, b: string): Promise<string | null>;
  stop(message: string): void;
}

export async function resolveLine(line: SceneElement, steps: LineSteps): Promise<void> {
  const { start, end } = lineEnds(line);
  const from = genotypeAt(steps.elements(), start.x, start.y);
  const to = genotypeAt(steps.elements(), end.x, end.y);

  if (from && to === from) return; // a line within one genotype: ignore
  // An end in empty space gets a new genotype there (sex preset opposite to the
  // other end's, when known). Start first, then end. Cancelling the Genotype
  // form cancels the whole operation and leaves the mode.
  const a = from ?? await steps.createAt(start, opposite(to ? glyphOf(steps.elements(), to) : null));
  if (!a) return steps.stop("Cross mode off (cancelled).");
  const b = to ?? await steps.createAt(end, opposite(glyphOf(steps.elements(), a)));
  if (!b) return steps.stop("Cross mode off (cancelled).");
  // One-shot: once the offspring exists, leave the mode. A cancelled picker
  // returns nothing, so the mode stays on to try again.
  if (await steps.cross(a, b)) steps.stop("Cross mode off (offspring created).");
}

export function toggleCrossMode(plugin: FlyGeneticsPlugin, view: ExcalidrawViewLike): void {
  // Toggle off if already running in any view.
  // (One already stopped, its tool change not landed yet, is not running.)
  const running = peek("_flyCrossMode");
  if (running && !running.off) {
    running.stop("Cross mode off.");
    return;
  }

  const api = view.excalidrawAPI;
  if (!api) {
    new Notice("Open an Excalidraw drawing first.");
    return;
  }
  // Checked before any line is taken out of the undo stack.
  if (!operationSupported(newEA(view))) return;

  const modals = plugin.testing.modals;
  const before = api.getAppState();
  const saved = {
    currentItemStrokeColor: before.currentItemStrokeColor,
    currentItemStrokeStyle: before.currentItemStrokeStyle,
    currentItemOpacity: before.currentItemOpacity,
  };

  const arm = () => {
    setAppState(view, {
      currentItemStrokeColor: CROSS_LINE.strokeColor,
      currentItemStrokeStyle: CROSS_LINE.strokeStyle,
      currentItemOpacity: CROSS_LINE.opacity,
    });
    api.setActiveTool({ type: "line", locked: true }); // stay on the line tool between lines
  };

  // Resolves when the mode stops: a child command still running (its form
  // open) is then no longer waited for.
  let stopped: () => void = () => undefined;
  const stopping = new Promise<undefined>((r) => { stopped = () => r(undefined); });
  // Waits for a command started in the operation: its result, or null if it
  // failed, was cancelled, did not start, or the mode stopped first.
  const wait = async (started: Started<string | null>): Promise<string | null> =>
    (await Promise.race([started, stopping])) ?? null;

  // Runs inside the line's operation (see the timer below); `unrecorded`: the
  // line is already out of the drawing (unrecordLastStep).
  async function handle(ctx: OperationContext, line: SceneElement, unrecorded: boolean): Promise<void> {
    if (!unrecorded) await ctx.commitPatches(new Map([[line.id, { isDeleted: true }]]));
    // Copies of a genotype made in Excalidraw become their own genotypes before
    // the ends are looked up.
    await splitDuplicateGenotypes(ctx);
    await resolveLine(line, {
      elements: () => api.getSceneElements(),
      // Deselected for the user; Genotype creates regardless (createAt).
      createAt: (point, defaultGlyph) => {
        ctx.setAppState({ selectedElementIds: {}, selectedGroupIds: {} });
        return wait(ctx.start("Genotype", (c) => genotype(c, { createAt: point, defaultGlyph }, modals)));
      },
      // Selected for the user to see; passed explicitly, since the selection
      // lands only on Excalidraw's next render.
      cross: (a, b) => {
        const els = api.getSceneElements();
        ctx.selectElements([partOf(els, a, "genotype-allele"), partOf(els, b, "genotype-allele")]);
        return wait(ctx.start("Cross Genotypes", (c) => crossGenotypes(c, { parents: [a, b] }, modals)));
      },
      stop,
    });
  }

  // A Cross Mode operation that throws is put back and reported by
  // runOperation; the mode says so, as the script did.
  const base = operationEnv(plugin);
  const env = {
    ...base,
    reportError: (name: string, error: unknown) => {
      base.reportError(name, error);
      if (name === "Cross Mode") new Notice(`Cross mode error: ${error instanceof Error ? error.message : String(error)}`);
    },
  };

  let busy = false;
  // Whether the mode is on (window._flyCrossMode is cleared a little later: see release).
  let on = true;
  // Lines already in the drawing when the mode starts are not cross requests.
  const handled = new Set(api.getSceneElements().filter(isCrossLine).map((el) => el.id));
  const finishing = new Set<string>();
  const notice = new Notice("Cross mode: draw a line between genotypes (or into empty space for a new one). Esc to exit.", 0);

  const tick = async () => {
    if (busy || !on) return;
    if (!view.file || !view.containerEl?.isConnected) return stop("Cross mode off (drawing closed).");
    const st = api.getAppState();
    // Click-click drawing: the line tool keeps adding points until Esc. A cross
    // line only needs two, so once the second click lands (points = two fixed
    // points plus the one following the cursor), finish the line like Esc does.
    const multi = st.multiElement;
    if (multi && isCrossLine(multi) && (multi.points?.length ?? 0) >= 3 && !finishing.has(multi.id)) {
      finishing.add(multi.id);
      const target = view.contentEl.querySelector(".excalidraw canvas.interactive") ?? view.contentEl.querySelector(".excalidraw");
      target?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }));
      return;
    }
    if (st.multiElement || st.newElement || st.draggingElement) return; // still drawing
    // Handle a finished cross line before checking the tool: finishing a line
    // can itself switch tools.
    const line = api.getSceneElements().find((el) => isCrossLine(el) && !handled.has(el.id));
    if (!line) {
      if (st.activeTool?.type !== "line") stop("Cross mode off.");
      return;
    }
    handled.add(line.id);
    busy = true;
    try {
      // The line, the genotypes and cross it leads to, and the Tidy after the
      // cross are one undoable operation, without the line in it.
      const unrecorded = await unrecordLastStep(view, line.id);
      await runOperation(plugin.app, env, view, "Cross Mode", (ctx) => handle(ctx, line, unrecorded));
    } catch (e) {
      console.error("Cross mode:", e);
      new Notice(`Cross mode error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      busy = false;
      if (on) arm();
    }
  };
  const timer = window.setInterval(() => void tick(), POLL_MS);
  plugin.registerInterval(timer);

  function stop(message?: string): void {
    window.clearInterval(timer);
    on = false;
    mode.off = true;
    stopped();
    notice.hide();
    setAppState(view, saved);
    // Back to the selection tool, with the tool lock as it was before the mode.
    api.setActiveTool({ type: "selection", locked: !!before.activeTool?.locked });
    if (message) new Notice(message, 2000);
    void release();
  }

  // The tool change lands on a later render (tens of ms while a command such
  // as Tidy is still drawing): window._flyCrossMode reads as off once it has,
  // or after RELEASE_MS at most.
  async function release(): Promise<void> {
    for (let t = 0; t < RELEASE_MS && api.getAppState().activeTool?.type !== "selection"; t += 20) {
      await new Promise((r) => window.setTimeout(r, 20));
    }
    if (peek("_flyCrossMode") === mode) put("_flyCrossMode", undefined);
  }

  const mode: { stop(message?: string): void; view: unknown; off?: boolean } = { stop, view };
  put("_flyCrossMode", mode);
  arm();
}
