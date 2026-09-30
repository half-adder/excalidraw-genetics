import { ItemView, type App, type TFile, type Plugin } from "obsidian";
import type { SceneElement } from "../schema";

export interface AppStateLike {
  selectedElementIds: Record<string, boolean>;
  selectedGroupIds: Record<string, boolean>;
  activeTool: { type: string; locked?: boolean };
  currentItemStrokeColor: string;
  currentItemStrokeStyle: string;
  currentItemOpacity: number;
  multiElement: SceneElement | null;
  newElement?: SceneElement | null;
  draggingElement?: SceneElement | null;
  [key: string]: unknown;
}

// Read-only views of Excalidraw's objects. The members that write the scene
// or its undo stack are typed only inside src/operation: every scene write
// goes through the operation. tests/unit/write-guard.test.ts fails if a
// module outside src/operation names one of them (in code or comments).
export interface ExcalidrawAPI {
  getSceneElements(): SceneElement[];
  getSceneElementsIncludingDeleted(): SceneElement[];
  getAppState(): AppStateLike;
  setActiveTool(tool: { type: string; locked?: boolean }): void;
}

export interface ExcalidrawViewLike {
  file: TFile | null;
  excalidrawAPI: ExcalidrawAPI;
  contentEl: HTMLElement;
  containerEl: HTMLElement;
  getViewType(): string;
}

export interface EAStyle {
  strokeColor: string;
  backgroundColor: string;
  fillStyle: string;
  strokeWidth: number;
  strokeStyle: string;
  roughness: number;
  opacity: number;
  fontFamily: number;
  fontSize: number;
}

export interface EA {
  targetView: ExcalidrawViewLike | null;
  plugin: { settings: { experimentalEnableFourthFont?: boolean; scriptFolderPath?: string } };
  style: EAStyle;
  elementsDict: Record<string, SceneElement>;
  setView(view?: ExcalidrawViewLike | "first" | "active"): ExcalidrawViewLike | null;
  clear(): void;
  verifyMinimumPluginVersion(version: string): boolean;
  addText(x: number, y: number, text: string, opts?: Record<string, unknown>): string;
  addLine(points: Array<[number, number]>): string;
  addArrow(points: Array<[number, number]>, opts?: Record<string, unknown>): string;
  addRect(x: number, y: number, w: number, h: number): string;
  addToGroup(ids: string[]): string;
  addAppendUpdateCustomData(id: string, data: Record<string, unknown>): void;
  getElement(id: string): SceneElement | undefined;
  getElements(): SceneElement[];
  getViewElements(): SceneElement[];
  getViewSelectedElements(): SceneElement[];
  getBoundingBox(els: readonly SceneElement[]): { topX: number; topY: number; width: number; height: number };
  getViewCenterPosition(): { x: number; y: number } | null;
  copyViewElementsToEAforEditing(els: readonly SceneElement[]): void;
}

// Obsidian internals the plugin reads (not in the public typings).
export interface AppInternals extends App {
  plugins: {
    manifests: Record<string, { version: string } | undefined>;
    enabledPlugins: Set<string>;
    plugins: Record<string, Plugin | undefined>;
  };
  commands: { executeCommandById(id: string): boolean };
}

// A fresh ExcalidrawAutomate instance (its own workbench) bound to `view`.
export function newEA(view: ExcalidrawViewLike): EA {
  const global = (window as unknown as { ExcalidrawAutomate?: { getAPI(view?: ExcalidrawViewLike): EA } }).ExcalidrawAutomate;
  if (!global) throw new Error("ExcalidrawAutomate is not available");
  const ea = global.getAPI(view);
  ea.setView(view);
  return ea;
}

// The active Excalidraw view, as the Script Engine runs scripts against it.
export function activeExcalidrawView(app: App): ExcalidrawViewLike | null {
  const view = app.workspace.getActiveViewOfType(ItemView);
  return view && view.getViewType() === "excalidraw" ? (view as unknown as ExcalidrawViewLike) : null;
}
