import type { EA } from "../../../src/excalidraw/ea";
import type { SceneElement } from "../../../src/schema";

// Deterministic stand-in for ExcalidrawAutomate: text width = characters x
// fontSize / 2, height = fontSize x 1.25 (no real font metrics). Extends the
// render task's brief with the option-driven behavior render/index.ts relies
// on: `addText(..., { box: "box" })` returns a bound container (addLabelBox)
// and `addArrow(..., { startObjectId, endObjectId, ... })` records bindings
// (addLineageArrow, routeLineageArrow).
//
// Matches the installed Excalidraw plugin's own addText: for boxed text, the
// container rect is created FIRST (so it z-orders under its bound text) and
// the text element records vertical alignment as `verticalAlign` (not
// `textVerticalAlign`, which is only the addText *option* name).
export function fakeEA(): EA & { order: string[] } {
  let n = 0;
  const order: string[] = [];
  const dict: Record<string, SceneElement> = {};
  const style = { strokeColor: "#000000", backgroundColor: "transparent", fillStyle: "hachure", strokeWidth: 1, strokeStyle: "solid", roughness: 1, opacity: 100, fontFamily: 1, fontSize: 20 };
  const add = (el: SceneElement) => { dict[el.id] = el; order.push(el.id); return el.id; };
  const base = (type: string, x: number, y: number, w: number, h: number): SceneElement =>
    ({
      id: `el${++n}`, type, x, y, width: w, height: h, groupIds: [], boundElements: [],
      strokeColor: style.strokeColor, backgroundColor: style.backgroundColor, fillStyle: style.fillStyle,
      strokeWidth: style.strokeWidth, fontSize: style.fontSize, fontFamily: style.fontFamily,
    });
  const ea = {
    order, style, elementsDict: dict, targetView: null,
    plugin: { settings: { experimentalEnableFourthFont: true } },
    setView: () => null, clear: () => { for (const k of Object.keys(dict)) delete dict[k]; order.length = 0; },
    verifyMinimumPluginVersion: () => true,
    addText: (x: number, y: number, text: string, opts?: Record<string, unknown>) => {
      const textAlign = (opts?.textAlign as string | undefined) ?? "left";
      const verticalAlign = (opts?.textVerticalAlign as string | undefined) ?? "top";
      if (opts?.box) {
        // Measured the way the real element would be, without creating it
        // yet: the container is sized to fit, then created before the text.
        const pad = (opts.boxPadding as number | undefined) ?? 0;
        const tw = text.length * style.fontSize / 2, th = style.fontSize * 1.25;
        const boxId = add({
          ...base("rectangle", x - pad, y - pad, tw + 2 * pad, th + 2 * pad),
          strokeColor: opts.boxStrokeColor as string | undefined,
          boundElements: [],
        });
        const textId = add({
          ...base("text", x, y, tw, th),
          text, originalText: text, textAlign, verticalAlign,
          containerId: boxId,
        });
        dict[boxId].boundElements = [{ id: textId, type: "text" }];
        return boxId;
      }
      return add({ ...base("text", x, y, text.length * style.fontSize / 2, style.fontSize * 1.25), text, originalText: text, textAlign, verticalAlign });
    },
    addLine: (pts: Array<[number, number]>) => add({ ...base("line", 0, 0, Math.max(...pts.map((p) => p[0])), 0), points: pts }),
    addArrow: (pts: Array<[number, number]>, opts?: Record<string, unknown>) => add({
      ...base("arrow", pts[0][0], pts[0][1], 0, 0),
      points: pts.map(([x, y]) => [x - pts[0][0], y - pts[0][1]] as [number, number]),
      startArrowHead: (opts?.startArrowHead as string | null | undefined) ?? null,
      endArrowHead: (opts?.endArrowHead as string | null | undefined) ?? null,
      elbowed: (opts?.elbowed as boolean | undefined) ?? false,
      startBinding: opts?.startObjectId
        ? { elementId: opts.startObjectId as string, fixedPoint: (opts.startFixedPoint as [number, number] | undefined) ?? null }
        : null,
      endBinding: opts?.endObjectId
        ? { elementId: opts.endObjectId as string, fixedPoint: (opts.endFixedPoint as [number, number] | undefined) ?? null }
        : null,
    }),
    addRect: (x: number, y: number, w: number, h: number) => add(base("rectangle", x, y, w, h)),
    addToGroup: (ids: string[]) => { const g = `g${++n}`; for (const id of ids) dict[id].groupIds = [g]; return g; },
    addAppendUpdateCustomData: (id: string, data: Record<string, unknown>) => { dict[id].customData = { ...(dict[id].customData ?? {}), ...data }; },
    getElement: (id: string) => dict[id],
    getElements: () => Object.values(dict),
    getBoundingBox: (els: readonly SceneElement[]) => {
      const xs0 = els.map((e) => e.x), ys0 = els.map((e) => e.y);
      const xs1 = els.map((e) => e.x + e.width), ys1 = els.map((e) => e.y + e.height);
      const topX = Math.min(...xs0), topY = Math.min(...ys0);
      return { topX, topY, width: Math.max(...xs1) - topX, height: Math.max(...ys1) - topY };
    },
  };
  return ea as unknown as EA & { order: string[] };
}
