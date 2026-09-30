// Saved answers to the first-load offers. `migration` records the Fly
// Genetics script-migration offer (src/migration.ts); `font` records the
// Computer Modern font-setup offer (src/font/index.ts).
export interface FlyGeneticsSettings {
  migration: "pending" | "done" | "declined";
  font: "pending" | "done" | "declined";
}

export const DEFAULT_SETTINGS: FlyGeneticsSettings = { migration: "pending", font: "pending" };
