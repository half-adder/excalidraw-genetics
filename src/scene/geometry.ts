// Pure geometry helpers for scene elements. Ported from Tidy.md:
// `lineagePoints` (elbow/straight arrow routing), `pathMidpoint` (arrow-label
// placement) and `boundingBox` (the pure equivalent of `ea.getBoundingBox`
// for unrotated elements).

import type { SceneElement } from "../schema";

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  topX: number;
  topY: number;
  width: number;
  height: number;
}

export function boundingBox(els: readonly SceneElement[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    if (el.points && el.points.length) {
      for (const [px, py] of el.points) {
        minX = Math.min(minX, el.x + px);
        maxX = Math.max(maxX, el.x + px);
        minY = Math.min(minY, el.y + py);
        maxY = Math.max(maxY, el.y + py);
      }
    } else {
      minX = Math.min(minX, el.x);
      maxX = Math.max(maxX, el.x + el.width);
      minY = Math.min(minY, el.y);
      maxY = Math.max(maxY, el.y + el.height);
    }
  }
  return { topX: minX, topY: minY, width: maxX - minX, height: maxY - minY };
}

// Lineage arrows are elbow arrows: straight down when the child is under the
// cross glyph, otherwise down / across / down through the vertical midpoint.
export function lineagePoints(x1: number, y1: number, x2: number, y2: number): Array<[number, number]> {
  if (Math.abs(x2 - x1) < 0.5) return [[x1, y1], [x1, y2]];
  const midY = (y1 + y2) / 2;
  return [[x1, y1], [x1, midY], [x2, midY], [x2, y2]];
}

// The midpoint of an arrow's path by cumulative segment length, for placing
// a selection-criterion label at the middle of the arrow rather than its
// bounding-box center.
export function pathMidpoint(arrow: SceneElement): [number, number] {
  const rawPoints = arrow.points ?? [];
  const pts: Array<[number, number]> = rawPoints.map(([x, y]) => [arrow.x + x, arrow.y + y]);
  const segs = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
  let half = segs.reduce((a, b) => a + b, 0) / 2;
  let mx = pts[0][0];
  let my = pts[0][1];
  for (let i = 0; i < segs.length; i++) {
    if (half <= segs[i]) {
      const t = segs[i] ? half / segs[i] : 0;
      mx = pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t;
      my = pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t;
      break;
    }
    half -= segs[i];
  }
  return [mx, my];
}
