// The members of Excalidraw's objects that write the scene or its history.
// They are typed only here, for src/operation/index.ts: every other module
// sees the read-only types of src/excalidraw/ea.ts, and
// tests/unit/write-guard.test.ts fails if one calls them.

import type { AppStateLike, EA, ExcalidrawAPI, ExcalidrawViewLike } from "../excalidraw/ea";
import type { SceneElement } from "../schema";

export type CaptureUpdate = "IMMEDIATELY" | "NEVER" | "EVENTUALLY";

export interface SceneUpdate {
  elements?: readonly SceneElement[];
  appState?: Partial<AppStateLike>;
  captureUpdate?: CaptureUpdate;
}

type Follow = (...args: unknown[]) => unknown;

export interface WritableAPI extends ExcalidrawAPI {
  updateScene(scene: SceneUpdate): void;
  history?: { undo?(): void; redo?(): void; clear?(): void };
  // Run by addElementsToView after a commit (undo-safe design, finding 9).
  refreshAllArrows?: Follow;
  updateContainerSize?: Follow;
}

export interface WritableView extends ExcalidrawViewLike {
  excalidrawAPI: WritableAPI;
  updateScene(scene: SceneUpdate): void;
}

export interface WritableEA extends EA {
  addElementsToView(repositionToCursor?: boolean, save?: boolean, newElementsOnTop?: boolean, shouldRestoreElements?: boolean, captureUpdate?: CaptureUpdate): Promise<boolean>;
}

export const writable = (view: ExcalidrawViewLike): WritableView => view as WritableView;
export const writableEA = (ea: EA): WritableEA => ea as WritableEA;
