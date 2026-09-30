import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SceneElement } from "../../../src/schema";

export const FIXTURE_DIR = join(__dirname, "..", "..", "fixtures");
export interface Fixture { hash: string; names: Record<string, string>; buildErrors: string[]; elements: SceneElement[] }
export const fixtureNames = (): string[] => readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
export const loadFixture = (name: string): Fixture => JSON.parse(readFileSync(join(FIXTURE_DIR, `${name}.json`), "utf8")) as Fixture;
export const gid = (fx: Fixture, name: string): string => {
  const g = fx.names[name];
  if (!g) throw new Error(`fixture has no genotype ${name}`);
  return g;
};
export const nameOf = (fx: Fixture, g: string): string => Object.entries(fx.names).find(([, v]) => v === g)?.[0] ?? g;
