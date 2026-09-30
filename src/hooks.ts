import type { ExcalidrawFontSettings } from "./font/plan";

// Typed access to the window._* globals the Obsidian-driven tests set and
// read (same names and shapes as the scripts). Inter-command handoffs of the
// scripts (_tidySeed, _crossGenotypesParents, _flySelectResult polling) are
// function parameters and return values in the plugin.

export interface GenotypeAuto {
  glyph: string | null;
  X: { top: string; bottom: string };
  II: { top: string; bottom: string };
  III: { top: string; bottom: string };
  label?: string;
  criterion?: string;
}

export interface CrossAuto {
  offspringGlyph: string | null;
  pick?: Partial<Record<"X" | "II" | "III", number>>;
  labelText?: string;
  criterionText?: string;
}

export interface HookMap {
  _genotypeAuto: GenotypeAuto;
  _genotypeFormProbe: boolean;
  _genotypeFormState: unknown;
  _genotypeCreateAt: { x: number; y: number };
  _genotypeDefaultGlyph: string | null;
  _genotypeLastResult: string | null;
  _genotypeFormModal: unknown;
  _crossGenotypesAuto: CrossAuto;
  _crossGenotypesLastResult: string | null;
  _crossGenotypesModal: unknown;
  _crossGenotypesOptions: unknown;
  _tidyLastResult: number;
  _flySelectResult: { mode: string; genotypes: number; genotypeIds: string[]; elements: number };
  // `off`: stopped, cleared once its tool change has landed (Cross Mode).
  _flyCrossMode: { stop(message?: string): void; view: unknown; off?: boolean };
  // The migration offer (src/migration.ts). Honored only when
  // _flyMigrationTestMode is ALSO set true in the same offerMigration call;
  // a leftover on its own is cleared and ignored. In test mode the answer is
  // kept in memory, never saved. `select`, when given, overrides the modal's
  // default (hash-matched) preselection with a path list, limited to the
  // paths the prompt lists; `confirm: false` always declines.
  _flyMigrationAuto: { scriptFolder?: string; confirm: boolean; select?: string[] };
  _flyMigrationResult: { trashed: string[]; declined: boolean };
  // Overrides how a confirmed path is actually removed. Obsidian-driven
  // tests set this to something that only ever touches their own throwaway
  // folder (never the real system trash) instead of the real
  // trashSystem/trashLocal fallback. Only used when _flyMigrationTestMode is
  // ALSO set true in the same offerMigration call (see src/migration.ts):
  // never on its own, so a leftover from a crashed test run cannot silently
  // redirect a real trash.
  _flyMigrationTrash: (path: string) => Promise<void>;
  _flyMigrationTestMode: true;
  // The font setup offer (src/font/index.ts). Honored only when
  // _flyFontTestMode is ALSO set true in the same offerFontSetup call, and
  // then only with an explicit `fontFolder` and either `skipSettings` or an
  // injected `settings` object (with `saveExcalidraw` standing in for
  // Excalidraw's saveSettings): a test never reads, changes or saves
  // Excalidraw's own settings, and a leftover hook never writes anything
  // without asking. `confirm` and `replaceOther` answer the two questions;
  // left undefined, the prompt opens as usual.
  _flyFontAuto: {
    fontFolder?: string;
    skipSettings?: boolean;
    confirm?: boolean;
    replaceOther?: boolean;
    settings?: ExcalidrawFontSettings;
    saveExcalidraw?: () => Promise<void>;
  };
  _flyFontTestMode: true;
  _flyFontResult: { fontPath: string; wroteFont: boolean; note: string; declined: boolean };
  // Failure and pause hooks of tests/undo.sh (consumed on read).
  _crossGenotypesFail: boolean;
  _tidyFailAfterDelete: boolean;
  _tidyBelowFail: boolean;
  _tidyBelowPause: () => Promise<void>;
}

declare global {
  interface Window extends Partial<HookMap> {}
}

const hooks = (): Partial<HookMap> => window as unknown as Partial<HookMap>;

// Reads a hook and clears it (consumed on read).
export function take<K extends keyof HookMap>(key: K): HookMap[K] | undefined {
  const value = hooks()[key];
  hooks()[key] = undefined;
  return value;
}

export function peek<K extends keyof HookMap>(key: K): HookMap[K] | undefined {
  return hooks()[key];
}

export function put<K extends keyof HookMap>(key: K, value: HookMap[K] | undefined): void {
  hooks()[key] = value;
}
