import type { App } from "obsidian";
import type { AppInternals } from "./ea";

export const EXCALIDRAW_ID = "obsidian-excalidraw-plugin";
export const EXCALIDRAW_MIN_VERSION = "2.20.2";

// Numeric comparison of dotted versions; a pre-release suffix ("-beta-1") is ignored.
export function compareVersions(a: string, b: string): number {
  const nums = (v: string) => v.split("-")[0].split(".").map((p) => Number.parseInt(p, 10) || 0);
  const x = nums(a), y = nums(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return Math.sign(d);
  }
  return 0;
}

export type ExcalidrawCheck = { ok: true } | { ok: false; message: string };

export function excalidrawStatus(installed: string | null, enabled: boolean): ExcalidrawCheck {
  if (installed === null) {
    return { ok: false, message: `Fly Genetics needs the Excalidraw plugin (${EXCALIDRAW_MIN_VERSION} or newer). Please install it from Settings > Community plugins, then reload Fly Genetics.` };
  }
  if (compareVersions(installed, EXCALIDRAW_MIN_VERSION) < 0) {
    return { ok: false, message: `Fly Genetics needs Excalidraw ${EXCALIDRAW_MIN_VERSION} or newer (installed: ${installed}). Update it in Settings > Community plugins.` };
  }
  if (!enabled) {
    return { ok: false, message: "Fly Genetics needs the Excalidraw plugin: please enable it in Settings > Community plugins." };
  }
  return { ok: true };
}

export function checkExcalidraw(app: App): ExcalidrawCheck {
  const plugins = (app as AppInternals).plugins;
  const version = plugins.manifests[EXCALIDRAW_ID]?.version ?? null;
  const enabled = plugins.enabledPlugins.has(EXCALIDRAW_ID) && !!plugins.plugins[EXCALIDRAW_ID];
  return excalidrawStatus(version, enabled);
}
